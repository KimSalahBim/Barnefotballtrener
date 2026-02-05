import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// RELIABILITY: Configure Stripe client with timeout and retries
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  timeout: 10000,           // 10 second timeout
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
  // Stripe idempotency keys must be <= 255 chars; keep it short and deterministic.
  return `${prefix}_${safe}`.slice(0, 200);
}


function isDebugHost(hostHeader) {
  const h = String(hostHeader || '').toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
}

async function selectOrCreateCustomer({ email, userId }) {
  const normalizedEmail = normalizeEmail(email);
  // Stripe lists most recent customers first.
  const list = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
  const candidates = (list.data || []).filter((c) => {
    const metaId = c?.metadata?.supabase_user_id;
    // If another supabase_user_id is already bound, never reuse that customer for safety.
    return !metaId || metaId === userId;
  });

  // 1) Strong match: metadata.supabase_user_id
  const metaMatch = candidates.find((c) => c?.metadata?.supabase_user_id === userId);
  if (metaMatch) return metaMatch;

  // 2) If duplicates exist without metadata, prefer a customer that already has a relevant subscription.
  // Limit network calls: check only the 3 most recent candidates.
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

  // 4) Create new customer (idempotent)
  return await stripe.customers.create(
    {
      email: normalizedEmail,
      metadata: { supabase_user_id: userId },
    },
    { idempotencyKey: idKey('bf_cus_create', [userId, normalizedEmail]) }
  );
}

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
    console.error('[create-checkout-session] ❌ APP_URL not configured in production!');
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
    console.error('[create-checkout-session] ⚠️ Invalid host header:', rawHost, '(normalized:', normalizedHost + ')');
    throw new Error('Invalid host header');
  }

  // NORMALIZE PROTOCOL: handle "https, http" comma-separated variants from proxies
  const protoRaw = String(req.headers["x-forwarded-proto"] || "https");
  const proto = protoRaw.split(',')[0].trim();
  // Force HTTPS in production even if proxy says HTTP
  const safeProto = (proto === 'http' && isProd) ? 'https' : proto;

  return `${safeProto}://${normalizedHost}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 1) Hent og verifiser Supabase token
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    const accessToken = match?.[1];
    if (!accessToken) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(accessToken);

    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const user = userData.user;
    const userId = user.id;
    const email = user.email;

    if (!email) {
      return res.status(400).json({ error: "User has no email" });
    }

    // 2) Les body
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    } catch (_) {}

    // Aksepter både 'planType' og 'plan' for bakoverkompatibilitet
    const planType = body.planType || body.plan;
    if (!planType || !["month", "year", "lifetime"].includes(planType)) {
      return res.status(400).json({ error: "Invalid planType" });
    }

    // 3) Hent priceId fra env (ikke stol på klienten)
    const priceByPlan = {
      month: process.env.STRIPE_PRICE_MONTH,
      year: process.env.STRIPE_PRICE_YEAR,
      lifetime: process.env.STRIPE_PRICE_LIFETIME,
    };

    const priceId = priceByPlan[planType];
    if (!priceId) {
      return res.status(500).json({ error: `Missing price env for ${planType}` });
    }

    const mode = planType === "lifetime" ? "payment" : "subscription";

    // 4) Finn eller opprett Stripe customer på en deterministisk og idempotent måte
    const customer = await selectOrCreateCustomer({ email, userId });
    let customerId = customer.id;

    // Ensure metadata is present for later deterministic selection.
    const meta = customer?.metadata || {};
    if (!meta.supabase_user_id) {
      await stripe.customers.update(
        customerId,
        { metadata: { ...meta, supabase_user_id: userId } },
        { idempotencyKey: idKey('bf_cus_update', [customerId, userId]) }
      );
    }

    // 5) Opprett Checkout Session
    const baseUrl = getBaseUrl(req);

    // LEGAL COMPLIANCE: Angrerett (Right to Withdrawal) consent tracking
    // Forbrukeravtaleloven § 22 requires explicit consent that service starts immediately
    // and acknowledgment that this causes loss of the 14-day withdrawal right
    const customerIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                       req.headers['x-real-ip'] || 
                       req.connection?.remoteAddress || 
                       'unknown';

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?canceled=true`,
      client_reference_id: userId,
      
      // LEGAL: Display angrerett notice at checkout (visible to customer before payment)
      custom_text: {
        submit: {
          message: 'Ved å fullføre kjøpet samtykker du til umiddelbar levering og erkjenner at angreretten faller bort i henhold til Forbrukeravtaleloven § 22.'
        }
      },
      
      // LEGAL: Store consent metadata for audit trail
      metadata: {
        supabase_user_id: userId,
        plan_type: planType,
        price_id: priceId,
        // Angrerett consent tracking (Forbrukeravtaleloven compliance)
        angrerett_acknowledged: 'true',
        acknowledgment_timestamp: new Date().toISOString(),
        customer_ip: customerIp,
        consent_version: 'v1_2025-02-03', // Track which version of terms user agreed to
      },
      
      // Dette er nyttig på subscriptions:
      subscription_data:
        mode === "subscription"
          ? {
              metadata: {
                supabase_user_id: userId,
                plan_type: planType,
                price_id: priceId,
                angrerett_acknowledged: 'true',
                acknowledgment_timestamp: new Date().toISOString(),
              },
            }
          : undefined,
    });

    // Validering: Stripe skal alltid returnere url for hosted checkout
    if (!session.url) {
      console.error('create-checkout-session: Stripe session missing url:', session);
      return res.status(500).json({ error: 'Stripe session missing checkout URL' });
    }

    // Returner både sessionId og url (url er det klienten trenger)
    return res.status(200).json({ 
      sessionId: session.id,
      url: session.url
    });
  } catch (e) {
    const errorId = `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    console.error('[create-checkout-session] error_id=%s', errorId, e);

    const debug = isDebugHost(req.headers.host);
    return res.status(500).json(
      debug
        ? { error: 'Server error', error_id: errorId }
        : { error: 'Server error' }
    );
  }
}
