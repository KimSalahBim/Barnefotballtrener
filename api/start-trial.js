import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  timeout: 10000,           // 10 second timeout
  maxNetworkRetries: 2,     // Retry failed requests twice
});
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


function makeErrorId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHost(rawHost) {
  return String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/:443$/, '')
    .replace(/\.$/, '');
}

function isDebugHost(host) {
  // Debug ONLY on localhost / 127.0.0.1 / *.vercel.app (strip port)
  const h = String(host || '').toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function makeIdempotencyKey(prefix, parts) {
  const raw = [prefix, ...parts].join('_');
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 240);
}

function rankSubscriptionStatus(status) {
  if (status === 'trialing') return 0;
  if (status === 'active') return 1;
  if (status === 'past_due') return 2;
  if (status === 'unpaid') return 3;
  if (status === 'incomplete') return 4;
  if (status === 'incomplete_expired') return 5;
  if (status === 'canceled') return 9;
  return 8;
}

async function customerHasRelevantSubscription(customerId) {
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  const best = (subs.data || []).slice().sort((a, b) => rankSubscriptionStatus(a.status) - rankSubscriptionStatus(b.status))[0];
  if (!best) return false;
  return best.status === 'active' || best.status === 'trialing' || best.status === 'past_due';
}

async function bindCustomerToUserIfNeeded(customer, userId) {
  const current = String(customer?.metadata?.supabase_user_id || '');
  if (current === userId) return customer;
  if (current && current !== userId) return null;

  const key = makeIdempotencyKey('bftr_cust_bind', [userId, customer.id]);
  const updated = await stripe.customers.update(
    customer.id,
    { metadata: { ...(customer.metadata || {}), supabase_user_id: userId } },
    { idempotencyKey: key }
  );
  return updated;
}

async function findOrCreateCustomer(email, userId) {
  const normalizedEmail = normalizeEmail(email);

  const list = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
  const customers = list.data || [];

  // 1) Exact metadata match
  const exact = customers.find((c) => String(c?.metadata?.supabase_user_id || '') === userId);
  if (exact) return exact;

  // Exclude customers explicitly bound to another userId
  const candidates = customers.filter((c) => {
    const bound = String(c?.metadata?.supabase_user_id || '');
    return !bound || bound === userId;
  });

  // 2) Check a few newest for relevant subscription (handles duplicates)
  const newestFew = candidates.slice(0, 3);
  for (const c of newestFew) {
    try {
      const hasSub = await customerHasRelevantSubscription(c.id);
      if (hasSub) {
        const bound = await bindCustomerToUserIfNeeded(c, userId);
        if (bound) return bound;
      }
    } catch (_) {}
  }

  // 3) Fallback bind newest candidate
  if (newestFew.length) {
    const bound = await bindCustomerToUserIfNeeded(newestFew[0], userId);
    if (bound) return bound;
  }

  // 4) Create new (idempotent)
  const createKey = makeIdempotencyKey('bftr_cust_create', [userId, normalizedEmail]);
  return await stripe.customers.create(
    { email: normalizedEmail, metadata: { supabase_user_id: userId } },
    { idempotencyKey: createKey }
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

async function hasActiveSubscription(customerId) {
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  const sub = pickBestSubscription(subs.data || []);
  if (!sub) return false;
  return sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';
}

async function hasLifetimePurchase(customerId) {
  const lifetimePriceId = process.env.STRIPE_PRICE_LIFETIME;
  if (!lifetimePriceId) return false;

  const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 20 });
  for (const s of sessions.data || []) {
    if (s.mode !== 'payment') continue;

    const paid = s.payment_status === 'paid';
    const complete = s.status === 'complete' || s.status === 'completed';
    if (!paid && !complete) continue;

    try {
      const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 10 });
      if ((items.data || []).some((it) => it?.price?.id === lifetimePriceId)) return true;
    } catch (_) {}
  }
  return false;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    const accessToken = match?.[1];
    if (!accessToken) return res.status(401).json({ error: 'Missing Bearer token' });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Invalid session' });

    const userId = userData.user.id;
    const email = userData.user.email;
    if (!email) return res.status(400).json({ error: 'User has no email' });

    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}

    const planType = body.planType;
    if (!planType || !['month', 'year'].includes(planType)) {
      return res.status(400).json({ error: "Invalid planType (use 'month' or 'year')" });
    }

    // Krever user_access-tabell (bevisst)
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('user_access')
      .select('user_id, trial_started_at, trial_ends_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (selErr) {
      console.error('start-trial select error:', selErr);
      return res.status(500).json({ error: 'Database error (user_access)' });
    }

    if (existing?.trial_started_at) {
      return res.status(409).json({
        error: 'Trial already used',
        trial_ends_at: existing.trial_ends_at,
      });
    }

    // Enforce: trial kun hvis ikke aktiv sub / lifetime
    const customer = await findOrCreateCustomer(email, userId);
    const activeSub = await hasActiveSubscription(customer.id);
    if (activeSub) return res.status(409).json({ error: 'Already has active subscription' });

    const lifetime = await hasLifetimePurchase(customer.id);
    if (lifetime) return res.status(409).json({ error: 'Already has lifetime access' });

    const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 7);
    const now = new Date();
    const endsAt = addDays(now, TRIAL_DAYS);

    const { error: upErr } = await supabaseAdmin
      .from('user_access')
      .upsert(
        {
          user_id: userId,
          trial_started_at: now.toISOString(),
          trial_ends_at: endsAt.toISOString(),
          trial_plan: planType,
          updated_at: now.toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (upErr) {
      console.error('start-trial upsert error:', upErr);
      return res.status(500).json({ error: 'Could not start trial' });
    }

    return res.status(200).json({
      success: true,
      trial_started_at: now.toISOString(),
      trial_ends_at: endsAt.toISOString(),
      trial_days: TRIAL_DAYS,
    });
  } catch (e) {
    const errorId = makeErrorId();
    const host = normalizeHost(req.headers.host);
    const debug = isDebugHost(host);
    console.error(`start-trial error (${errorId}) [host=${host}]`, e);
    return res.status(500).json({ error: "Server error", ...(debug ? { error_id: errorId } : {}) });
  }
}
