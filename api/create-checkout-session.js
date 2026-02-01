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

function getBaseUrl(req) {
  // SECURITY: Always use APP_URL if set (prevents host header injection)
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  
  // PRODUCTION: Fail hard if APP_URL not set in production
  if (process.env.NODE_ENV === 'production') {
    console.error('[create-checkout-session] ❌ APP_URL not configured in production!');
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
    console.error('[create-checkout-session] ⚠️ Invalid host header:', rawHost, '(normalized:', normalizedHost + ')');
    throw new Error('Invalid host header');
  }
  
  // NORMALIZE PROTOCOL: handle "https, http" comma-separated variants from proxies
  const protoRaw = String(req.headers["x-forwarded-proto"] || "https");
  const proto = protoRaw.split(',')[0].trim();
  // Force HTTPS in production even if proxy says HTTP
  const safeProto = (proto === 'http' && process.env.NODE_ENV === 'production') ? 'https' : proto;
  
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

    // 4) Finn eller opprett Stripe customer på e-post
    let customerId = null;

    // 4a) Finn på e-post først (bruk list for sikkerhet, ikke search)
    const found = await stripe.customers.list({
      email: email,
      limit: 1,
    });
    customerId = found.data?.[0]?.id || null;

    if (!customerId) {
      // Opprett kunde med metadata
      const created = await stripe.customers.create({
        email,
        metadata: {
          supabase_user_id: userId,
        },
      });
      customerId = created.id;
    } else {
      // Sørg for at metadata finnes (nyttig for senere feilsøking)
      const existing = found.data?.[0];
      const meta = existing?.metadata || {};
      if (!meta.supabase_user_id) {
        await stripe.customers.update(customerId, {
          metadata: { ...meta, supabase_user_id: userId },
        });
      }
    }

    // 5) Opprett Checkout Session
    const baseUrl = getBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?canceled=true`,
      client_reference_id: userId,
      metadata: {
        supabase_user_id: userId,
        plan_type: planType,
      },
      // Dette er nyttig på subscriptions:
      subscription_data:
        mode === "subscription"
          ? {
              metadata: {
                supabase_user_id: userId,
                plan_type: planType,
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
    console.error("create-checkout-session error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
