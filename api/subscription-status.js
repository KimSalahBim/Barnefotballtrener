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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function mapPlanFromPriceId(priceId) {
  if (!priceId) return null;
  if (process.env.STRIPE_PRICE_MONTH && priceId === process.env.STRIPE_PRICE_MONTH) return 'month';
  if (process.env.STRIPE_PRICE_YEAR && priceId === process.env.STRIPE_PRICE_YEAR) return 'year';
  if (process.env.STRIPE_PRICE_LIFETIME && priceId === process.env.STRIPE_PRICE_LIFETIME) return 'lifetime';
  return null;
}

async function findOrCreateCustomer(email, userId) {
  const list = await stripe.customers.list({ email, limit: 1 });
  if (list.data?.length) return list.data[0];

  return await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId || '' },
  });
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

  const active = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';
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

    const paid = s.payment_status === 'paid';
    const complete = s.status === 'complete' || s.status === 'completed';
    if (!paid && !complete) continue;

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
      return { trial: false, trial_ends_at: null, trial_plan: null, canStartTrial: false };
    }

    const now = new Date();
    const started = data?.trial_started_at ? new Date(data.trial_started_at) : null;
    const ends = data?.trial_ends_at ? new Date(data.trial_ends_at) : null;

    const trialActive = !!(ends && !Number.isNaN(ends.getTime()) && ends > now);
    const trialUsed = !!(started && !Number.isNaN(started.getTime()));

    return {
      trial: trialActive,
      trial_ends_at: data?.trial_ends_at || null,
      trial_plan: data?.trial_plan || null,
      canStartTrial: !trialUsed,
    };
  } catch (_) {
    return { trial: false, trial_ends_at: null, trial_plan: null, canStartTrial: false };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const email = user.email;
    if (!email) return res.status(400).json({ error: 'User has no email' });

    const customer = await findOrCreateCustomer(email, user.id);

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
      trial_ends_at: null,
      canStartTrial: !!tr.canStartTrial,
      reason: tr.canStartTrial ? 'trial_available' : 'no_access',
    });
  } catch (err) {
    console.error('subscription-status error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
