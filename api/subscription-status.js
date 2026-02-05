// api/subscription-status.js
// Returnerer tilgangsstatus for innlogget bruker.
// Tilgang hvis:
// - aktivt abonnement (month/year)
// - livstid kjøpt (one-time payment via Stripe Checkout)
// - aktiv trial (Supabase user_access)
// Krever env:
// - STRIPE_SECRET_KEY
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - STRIPE_PRICE_MONTH / STRIPE_PRICE_YEAR / STRIPE_PRICE_LIFETIME (anbefalt)

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// RELIABILITY: Configure Stripe client with timeout and retries to prevent hangs
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  timeout: 10000,           // 10 second timeout (prevents invoice fetch hangs)
  maxNetworkRetries: 2,     // Retry failed requests twice
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function idKey(prefix, parts) {
  const safe = (parts || [])
    .filter(Boolean)
    .map((p) => String(p).replace(/[^a-zA-Z0-9_-]/g, '_'))
    .join('_');
  return `${prefix}_${safe}`.slice(0, 200);
}

function isDebugHost(hostHeader) {
  const h = String(hostHeader || '').toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
}

function mapPlanFromPriceId(priceId) {
  if (!priceId) return null;
  if (process.env.STRIPE_PRICE_MONTH && priceId === process.env.STRIPE_PRICE_MONTH) return 'month';
  if (process.env.STRIPE_PRICE_YEAR && priceId === process.env.STRIPE_PRICE_YEAR) return 'year';
  if (process.env.STRIPE_PRICE_LIFETIME && priceId === process.env.STRIPE_PRICE_LIFETIME) return 'lifetime';
  return null;
}

async function findOrCreateCustomer(email, userId) {
  const normalizedEmail = normalizeEmail(email);
  // Stripe returns most recent first.
  const list = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
  const all = list.data || [];

  // Safety: never reuse a Stripe customer that is explicitly bound to another Supabase user.
  const candidates = all.filter((c) => {
    const bound = c?.metadata?.supabase_user_id;
    return !bound || bound === userId;
  });

  // 1) Strong match: metadata binding
  const metaMatch = candidates.find((c) => c?.metadata?.supabase_user_id === userId);
  if (metaMatch) return metaMatch;

  // 2) Prefer a customer that already has a relevant subscription (active/trialing/past_due)
  // (avoid picking a “random” duplicate that only has canceled/incomplete history)
  for (const c of candidates.slice(0, 3)) {
    try {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 10 });
      const hasRelevant = (subs.data || []).some((s) =>
        s && (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due')
      );
      if (hasRelevant) return c;
    } catch (_) {
      // ignore and continue
    }
  }

  // 3) Fallback: most recent candidate
  if (candidates.length > 0) return candidates[0];

  // 4) Create new (idempotent)
  return await stripe.customers.create(
    {
      email: normalizedEmail,
      metadata: { supabase_user_id: userId || '' },
    },
    { idempotencyKey: idKey('bf_cus_create', [userId, normalizedEmail]) }
  );
}

function pickBestSubscription(subs) {
  if (!subs?.length) return null;
  const rank = (s) => {
    const st = s.status;
    if (st === 'trialing') return 0;
    if (st === 'active') return 1;
    if (st === 'past_due') return 2;
    if (st === 'unpaid') return 3;
    if (st === 'incomplete') return 4;
    if (st === 'incomplete_expired') return 5;
    if (st === 'canceled') return 9;
    return 8;
  };
  return subs.slice().sort((a, b) => rank(a) - rank(b))[0];
}

async function checkStripeSubscription(customerId) {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  const sub = pickBestSubscription(subs.data || []);
  if (!sub) {
    return {
      hasSubscription: false,
      active: false,
      trial: false,
      plan: null,
      subscription_id: null,
      status: null,
      current_period_end: null,
      cancel_at_period_end: false,
      cancel_at: null,
    };
  }

  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan = mapPlanFromPriceId(priceId);

  // REVENUE PROTECTION: Do NOT treat past_due as active indefinitely
  // Allow 72-hour grace period for payment retry, then revoke access
  let active = sub.status === 'active' || sub.status === 'trialing';
  
  if (!active && sub.status === 'past_due') {
    console.log('[subscription-status] ⚠️ Subscription is past_due, checking grace period...');
    
    // Check if within grace period (72 hours from latest invoice creation)
    if (sub.latest_invoice) {
      try {
        const invoice = await stripe.invoices.retrieve(sub.latest_invoice);
        const invoiceCreatedMs = (invoice?.created || 0) * 1000;
        const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000; // 72 hours
        const timeElapsedMs = Date.now() - invoiceCreatedMs;
        
        if (timeElapsedMs <= GRACE_PERIOD_MS) {
          console.log(`[subscription-status] ✅ Within grace period (${Math.floor(timeElapsedMs / 1000 / 60 / 60)}h elapsed)`);
          active = true;
        } else {
          console.log(`[subscription-status] ❌ Grace period expired (${Math.floor(timeElapsedMs / 1000 / 60 / 60)}h elapsed), access revoked`);
          active = false;
        }
      } catch (err) {
        console.error('[subscription-status] ⚠️ Failed to retrieve invoice for grace check:', err.message);
        // Safe fallback: revoke access if we can't verify grace period
        active = false;
      }
    } else {
      console.log('[subscription-status] ⚠️ past_due but no latest_invoice, revoking access');
      active = false;
    }
  }

  const isoEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;

  return {
    hasSubscription: true,
    active,
    trial: sub.status === 'trialing',
    plan,
    subscription_id: sub.id,
    status: sub.status,
    current_period_end: isoEnd,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    cancel_at: cancelAt,
  };
}

async function checkLifetimePurchase(customerId) {
  const lifetimePriceId = process.env.STRIPE_PRICE_LIFETIME;
  if (!lifetimePriceId) return { lifetime: false };

  const sessions = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: 20,
  });

  for (const s of sessions.data || []) {
    if (s.mode !== 'payment') continue;

    // Stripe can mark some sessions as no_payment_required (e.g. fully discounted)
    const paid =
      s.payment_status === 'paid' ||
      s.payment_status === 'no_payment_required';

    const complete = s.status === 'complete' || s.status === 'completed';
    if (!paid && !complete) continue;

    // Fast path: prefer Checkout Session metadata when present (new purchases)
    const meta = s.metadata || {};
    const planType = meta.plan_type;
    const metaPriceId = meta.price_id;

    // If metadata explicitly confirms lifetime, accept immediately
    if (planType === 'lifetime' || metaPriceId === lifetimePriceId) {
      return {
        lifetime: true,
        purchased_at: s.created ? new Date(s.created * 1000).toISOString() : null,
      };
    }

    // If metadata explicitly says NOT lifetime, skip expensive lineItems lookup
    if (planType && planType !== 'lifetime') continue;
    if (metaPriceId && metaPriceId !== lifetimePriceId) continue;

    // Fallback: old sessions without metadata (or incomplete metadata)
    try {
      const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 10 });
      const hasLifetime = (items.data || []).some((it) => it?.price?.id === lifetimePriceId);
      if (hasLifetime) {
        return {
          lifetime: true,
          purchased_at: s.created ? new Date(s.created * 1000).toISOString() : null,
        };
      }
    } catch (e) {
      // hopp videre
    }
  }

  return { lifetime: false };
}


async function checkTrialStatus(userId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_access')
      .select('trial_started_at, trial_ends_at, trial_plan')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return { trial: false, trial_ends_at: null, trial_plan: null, canStartTrial: false, trial_used: false, trial_expired: false };
    }

    const now = new Date();
    const started = data?.trial_started_at ? new Date(data.trial_started_at) : null;
    const ends = data?.trial_ends_at ? new Date(data.trial_ends_at) : null;

    const trialActive = !!(ends && !Number.isNaN(ends.getTime()) && ends > now);
    const trialUsed = !!((started && !Number.isNaN(started.getTime())) || (ends && !Number.isNaN(ends.getTime())));
    const trialExpired = !!(trialUsed && ends && !Number.isNaN(ends.getTime()) && ends <= now);

    return {
      trial: trialActive,
      // Include ends_at even if expired (useful for UX/support messaging)
      trial_ends_at: data?.trial_ends_at || null,
      trial_plan: data?.trial_plan || null,
      canStartTrial: !trialUsed,
      trial_used: trialUsed,
      trial_expired: trialExpired,
    };
  } catch (_) {
    return { trial: false, trial_ends_at: null, trial_plan: null, canStartTrial: false, trial_used: false, trial_expired: false };
  }
}

export default async function handler(req, res) {
  // SECURITY: Set no-cache headers for personalized data (prevents caching of auth-dependent responses)
  res.setHeader('Cache-Control', 'no-store, private, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    
    console.log('[subscription-status] Request received (auth header present: %s)', !!authHeader);
    
    if (!token) {
      console.error('[subscription-status] ❌ No token provided');
      return res.status(401).json({ error: 'Missing token' });
    }

    console.log('[subscription-status] Validating token with Supabase Admin...');
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    
    if (userErr) {
      console.error('[subscription-status] ❌ Supabase getUser error:', userErr.message);
      // SECURITY: Don't leak internal error details to client
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    if (!user) {
      console.error('[subscription-status] ❌ No user returned from Supabase');
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    // PRIVACY: Log validation without full user ID
    console.log('[subscription-status] ✅ User validated');

    const email = user.email;
    if (!email) {
      console.error('[subscription-status] ❌ User has no email');
      return res.status(400).json({ error: 'User has no email' });
    }

    const customer = await findOrCreateCustomer(email, user.id);

    // Ensure deterministic binding for future lookups.
    const meta = customer?.metadata || {};
    if (!meta.supabase_user_id) {
      try {
        await stripe.customers.update(
          customer.id,
          { metadata: { ...meta, supabase_user_id: user.id } },
          { idempotencyKey: idKey('bf_cus_update', [customer.id, user.id]) }
        );
      } catch (e) {
        // Non-fatal: access checks below still use the customer.id we selected.
        console.error('[subscription-status] ⚠️ Failed to update customer metadata:', e?.message || e);
      }
    }

    // 1) Stripe subscription
    const sub = await checkStripeSubscription(customer.id);
    if (sub.active) {
      return res.status(200).json({
        active: true,
        trial: sub.trial,
        lifetime: false,
        plan: sub.plan,
        subscription_id: sub.subscription_id,
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        cancel_at: sub.cancel_at,
        trial_ends_at: null,
        canStartTrial: false,
        reason: 'active_subscription',
      });
    }

    // 2) Lifetime
    const lt = await checkLifetimePurchase(customer.id);
    if (lt.lifetime) {
      return res.status(200).json({
        active: true,
        trial: false,
        lifetime: true,
        plan: 'lifetime',
        subscription_id: null,
        status: 'lifetime',
        current_period_end: null,
        cancel_at_period_end: false,
        cancel_at: null,
        trial_ends_at: null,
        canStartTrial: false,
        purchased_at: lt.purchased_at || null,
        reason: 'lifetime_purchase',
      });
    }

    // 3) Trial (Supabase)
    const tr = await checkTrialStatus(user.id);
    if (tr.trial) {
      return res.status(200).json({
        active: true,
        trial: true,
        lifetime: false,
        plan: tr.trial_plan || null,
        subscription_id: null,
        status: 'trial',
        current_period_end: null,
        cancel_at_period_end: false,
        cancel_at: null,
        trial_ends_at: tr.trial_ends_at,
        canStartTrial: false,
        reason: 'trial_active',
      });
    }

    // 4) Ingen tilgang
    const noAccessReason = tr.trial_expired
      ? 'trial_expired'
      : (tr.canStartTrial ? 'trial_available' : 'no_access');

    return res.status(200).json({
      active: false,
      trial: false,
      lifetime: false,
      plan: null,
      subscription_id: null,
      status: sub.status || null,
      current_period_end: sub.current_period_end || null,
      cancel_at_period_end: sub.cancel_at_period_end || false,
      cancel_at: sub.cancel_at || null,
      // If trial has been used (and may be expired), return trial_ends_at for clearer UX
      trial_ends_at: (tr.trial_used && tr.trial_ends_at) ? tr.trial_ends_at : null,
      canStartTrial: !!tr.canStartTrial,
      reason: noAccessReason,
    });
  } catch (err) {
    const errorId = `ss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    console.error('[subscription-status] error_id=%s', errorId, err);

    const debug = isDebugHost(req.headers.host);
    return res.status(500).json(
      debug
        ? { error: 'Server error', error_id: errorId }
        : { error: 'Server error' }
    );
  }
}
