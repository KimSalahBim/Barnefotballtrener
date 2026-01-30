// api/create-portal-session.js
// Lager Stripe Customer Portal-session.
// Støtter to flows: "manage" (standard) og "cancel" (starter kanselleringsflyt)
// Krever: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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
  // Ta med flere statuser for å være robust
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  if (!subs.data?.length) return null;

  const rank = (s) => {
    // lavere er bedre
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
  const best = subs.data[0];
  return best?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const email = user.email;
    if (!email) return res.status(400).json({ error: 'User has no email' });

    const flow = (req.body?.flow || 'manage').toLowerCase();
    const returnUrl = req.body?.returnUrl || `${req.headers.origin || ''}/#`;

    const customer = await findOrCreateCustomer(email, user.id);

    const sessionParams = {
      customer: customer.id,
      return_url: returnUrl,
    };

    // Flow: direkte inn i kanselleringsskjermen i portalen
    if (flow === 'cancel') {
      const subId = await pickSubscriptionId(customer.id);
      if (!subId) {
        // Hvis kunden ikke har abonnement, send de til vanlig portal
        const portal = await stripe.billingPortal.sessions.create(sessionParams);
        return res.status(200).json({ url: portal.url });
      }

      // Stripe Billing Portal: flow_data
      // Docs: https://docs.stripe.com/api/customer_portal/sessions/create
      sessionParams.flow_data = {
        type: 'subscription_cancel',
        subscription_cancel: {
          subscription: subId,
        },
      };
    }

    // (valgfritt) Hvis du ønsker at "manage" også hopper inn i abonnement-visning:
    // else if (flow === 'manage') { ... subscription_update ... }

    const portalSession = await stripe.billingPortal.sessions.create(sessionParams);
    return res.status(200).json({ url: portalSession.url });

  } catch (err) {
    console.error('create-portal-session error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
