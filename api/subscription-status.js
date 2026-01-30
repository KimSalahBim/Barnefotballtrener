// api/subscription-status.js
// Returnerer abonnement-status for innlogget bruker
// Krever: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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

async function checkStripeSubscription(customerId) {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  if (!subs.data?.length) {
    return {
      active: false,
      trial: false,
      lifetime: false,
      plan: null,
      current_period_end: null,
      cancel_at_period_end: false,
      cancel_at: null,
      subscription_id: null,
      reason: 'no_subscription',
    };
  }

  // Velg "beste" abonnementsrad
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

  subs.data.sort((a, b) => rank(a) - rank(b));
  const sub = subs.data[0];

  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan = mapPlanFromPriceId(priceId);

  const isoEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;

  const active = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';

  return {
    active,
    trial: sub.status === 'trialing',
    lifetime: plan === 'lifetime',
    plan,
    subscription_id: sub.id,
    status: sub.status,
    current_period_end: isoEnd,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    cancel_at: cancelAt,
    reason: active ? 'active_subscription' : 'inactive_subscription',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const email = user.email;
    if (!email) return res.status(400).json({ error: 'User has no email' });

    const customer = await findOrCreateCustomer(email, user.id);

    const stripeStatus = await checkStripeSubscription(customer.id);
    return res.status(200).json(stripeStatus);

  } catch (err) {
    console.error('subscription-status error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
