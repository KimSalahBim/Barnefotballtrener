// api/create-portal-session.js
// Lager Stripe Customer Portal-session.
// Støtter to flows: "manage" (standard) og "cancel" (starter kanselleringsflyt)
// Krever: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// RELIABILITY: Configure Stripe client with timeout and retries
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  timeout: 10000,           // 10 second timeout
  maxNetworkRetries: 2,     // Retry failed requests twice
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper: Get base URL for this deployment
function getBaseUrl(req) {
  // SECURITY: Always use APP_URL if set (prevents host header injection)
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  
  // PRODUCTION: Fail hard if APP_URL not set in production
  if (process.env.NODE_ENV === 'production') {
    console.error('[create-portal-session] ❌ APP_URL not configured in production!');
    throw new Error('APP_URL must be configured in production environment');
  }
  
  // DEV/LOCAL ONLY: Fallback with strict validation
  const rawHost = String(req.headers.host || '');
  
  // NORMALIZE: lowercase, trim whitespace, remove trailing dot, remove :443 port
  const normalizedHost = rawHost
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')           // trailing dot
    .replace(/:443$/, '');        // explicit https port
  
  const allowedHosts = new Set([
    'localhost:3000',
    'localhost:5173',
    'barnefotballtrener.vercel.app',
    'barnefotballtrener.no',
    'www.barnefotballtrener.no'
  ]);
  
  if (!allowedHosts.has(normalizedHost)) {
    console.error('[create-portal-session] ⚠️ Invalid host header:', rawHost, '(normalized:', normalizedHost + ')');
    throw new Error('Invalid host header');
  }
  
  // NORMALIZE PROTOCOL: handle "https, http" comma-separated variants from proxies
  const protoRaw = String(req.headers["x-forwarded-proto"] || "https");
  const proto = protoRaw.split(',')[0].trim();
  // Force HTTPS in production even if proxy says HTTP
  const safeProto = (proto === 'http' && process.env.NODE_ENV === 'production') ? 'https' : proto;
  
  return `${safeProto}://${normalizedHost}`;
}

// Helper: Validate returnUrl to prevent open redirect
function safeReturnUrl(req, candidate) {
  const base = getBaseUrl(req);
  try {
    const baseUrl = new URL(base);
    const u = new URL(candidate || base, base);
    
    // Must match origin
    if (u.origin !== baseUrl.origin) {
      console.warn('[create-portal-session] ⚠️ Rejected returnUrl (wrong origin):', candidate);
      return baseUrl.toString();
    }
    
    // Optional: enforce same base path prefix if APP_URL contains subpath
    if (baseUrl.pathname && baseUrl.pathname !== '/' && !u.pathname.startsWith(baseUrl.pathname)) {
      console.warn('[create-portal-session] ⚠️ Rejected returnUrl (wrong base path):', candidate);
      return baseUrl.toString();
    }
    
    return u.toString();
  } catch (err) {
    console.warn('[create-portal-session] ⚠️ Invalid returnUrl:', candidate, err.message);
    return base;
  }
}

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
    const returnUrl = safeReturnUrl(req, body?.returnUrl);

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
