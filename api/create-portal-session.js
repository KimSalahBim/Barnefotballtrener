// api/create-portal-session.js
// Lager Stripe Customer Portal-session.
// Støtter to flows: "manage" (standard) og "cancel" (starter kanselleringsflyt)
// Krever: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Finn/lag Stripe customer for e-post
async function findOrCreateCustomer(email, userId) {
  const list = await stripe.customers.list({ email, limit: 1 });
  if (list.data?.length) return list.data[0];

  return await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId || '' },
  });
}

async function pickSubscriptionId(customerId) {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  if (!subs.data?.length) return null;

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
  return subs.data[0]?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse body (Vercel kan gi string)
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {}

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const email = user.email;
    if (!email) return res.status(400).json({ error: 'User has no email' });

    const flow = String(body?.flow || 'manage').toLowerCase();
    const returnUrl = body?.returnUrl || `${req.headers.origin || ''}/#`;

    const customer = await findOrCreateCustomer(email, user.id);

    const sessionParams = {
      customer: customer.id,
      return_url: returnUrl,
    };

    if (flow === 'cancel') {
      const subId = await pickSubscriptionId(customer.id);
      if (subId) {
        sessionParams.flow_data = {
          type: 'subscription_cancel',
          subscription_cancel: { subscription: subId },
        };
      }
      // Hvis ingen sub: fall back til vanlig portal
    }

    const portalSession = await stripe.billingPortal.sessions.create(sessionParams);
    return res.status(200).json({ url: portalSession.url });

  } catch (err) {
    console.error('create-portal-session error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
