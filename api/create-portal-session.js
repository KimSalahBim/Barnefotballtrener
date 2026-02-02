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

// Helper: Get base URL for this deployment
function getBaseUrl(req) {
  // SECURITY: Always use APP_URL if set (prevents host header injection)
  if (process.env.APP_URL) {
    return String(process.env.APP_URL).replace(/\/+$/, '');
  }

  // Vercel: NODE_ENV kan være "production" også i Preview.
  // Vi bruker VERCEL_ENV når den finnes for å skille preview vs production.
  const isProd = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === 'production'
    : process.env.NODE_ENV === 'production';

  // PRODUCTION: Fail hard if APP_URL not set in production
  if (isProd) {
    console.error('[create-portal-session] ❌ APP_URL not configured in production!');
    throw new Error('APP_URL must be configured in production environment');
  }

  // DEV/LOCAL ONLY: Fallback with strict validation
  const rawHost = String(req.headers.host || '');

  // NORMALIZE: lowercase, trim whitespace, remove :443 port, remove trailing dot
  const normalizedHost = rawHost
    .trim()
    .toLowerCase()
    .replace(/:443$/, '')          // explicit https port
    .replace(/\.$/, '');          // trailing dot

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
  // Force HTTPS in production even if proxy sier HTTP
  const safeProto = (proto === 'http' && isProd) ? 'https' : proto;

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

// Finn/velg Stripe customer for e-post (robust mot duplikater)
// Regler:
// 1) Foretrekk customer med metadata.supabase_user_id === userId
// 2) Ellers: se på opptil 3 nyeste "ubundne" customers og velg en som har en subscription (active/trialing/past_due)
// 3) Ellers: velg nyeste ubundne customer
// 4) Hvis ingen ubundne: opprett ny customer (idempotent)
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function makeIdempotencyKey(prefix, parts) {
  const raw = [prefix, ...parts].join('_');
  // Stripe idempotency key max length is 255; keep some margin
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
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });
  const best = (subs.data || []).slice().sort((a, b) => rankSubscriptionStatus(a.status) - rankSubscriptionStatus(b.status))[0];
  if (!best) return false;
  return best.status === 'active' || best.status === 'trialing' || best.status === 'past_due';
}

async function bindCustomerToUserIfNeeded(customer, userId) {
  const current = String(customer?.metadata?.supabase_user_id || '');
  if (current === userId) return customer;
  if (current && current !== userId) {
    // Never re-bind a customer that is explicitly bound to another Supabase user
    return null;
  }

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

  // List more than 1 to handle duplicates deterministically
  const list = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
  const customers = list.data || [];

  // 1) Exact metadata match
  const exact = customers.find((c) => String(c?.metadata?.supabase_user_id || '') === userId);
  if (exact) return exact;

  // Partition: exclude customers bound to another userId
  const candidates = customers.filter((c) => {
    const bound = String(c?.metadata?.supabase_user_id || '');
    return !bound || bound === userId;
  });

  // 2) Look at up to 3 newest candidates and pick one with relevant subscription
  const newestFew = candidates.slice(0, 3);
  for (const c of newestFew) {
    try {
      const hasSub = await customerHasRelevantSubscription(c.id);
      if (hasSub) {
        const bound = await bindCustomerToUserIfNeeded(c, userId);
        if (bound) return bound;
      }
    } catch (_) {
      // ignore and continue
    }
  }

  // 3) Fallback: bind newest candidate if possible
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
    const errorId = makeErrorId();
    const host = normalizeHost(req.headers.host);
    const debug = isDebugHost(host);
    console.error(`create-portal-session error (${errorId}) [host=${host}]`, err);
    // Avoid leaking internal errors on production domain
    return res.status(500).json({ error: (debug ? (err.message || "Server error") : "Server error"), ...(debug ? { error_id: errorId } : {}) });
  }
}
