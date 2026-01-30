// api/subscription-status.js (backend – Vercel Node function, CommonJS)
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

function mustEnv(name) {
  const v = process.env[name];
  return v && String(v).trim() ? v : null;
}

const STRIPE_SECRET_KEY = mustEnv("STRIPE_SECRET_KEY");
const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

const supabaseAdmin =
  (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

async function getUserFromBearer(req) {
  const authHeader = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const match = String(authHeader).match(/^Bearer (.+)$/);
  const accessToken = match && match[1] ? match[1] : null;

  if (!accessToken) return { user: null, error: "Missing Bearer token" };
  if (!supabaseAdmin) return { user: null, error: "Server misconfigured (supabaseAdmin)" };

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data || !data.user) return { user: null, error: "Invalid session" };

  return { user: data.user, error: null };
}

async function findStripeCustomer({ userId, email }) {
  if (!stripe) return null;

  // 1) Prefer metadata match
  try {
    const found = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${userId}'`,
      limit: 1,
    });
    if (found && found.data && found.data[0]) return found.data[0];
  } catch (e) {
    // not fatal
  }

  // 2) Fallback: email
  try {
    if (email) {
      const foundByEmail = await stripe.customers.search({
        query: `email:'${email}'`,
        limit: 1,
      });
      if (foundByEmail && foundByEmail.data && foundByEmail.data[0]) return foundByEmail.data[0];
    }
  } catch (e) {
    // not fatal
  }

  return null;
}

async function hasActiveSubscription(customerId, priceIds) {
  if (!stripe || !customerId) {
    return { active: false, plan: null, current_period_end: null };
  }

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  const list = (subs && subs.data) ? subs.data : [];
  const activeSub = list.find((s) => s && (s.status === "active" || s.status === "trialing"));
  if (!activeSub) return { active: false, plan: null, current_period_end: null };

  const items = (activeSub.items && activeSub.items.data) ? activeSub.items.data : [];
  const item = items.find((it) => {
    const pid = it && it.price && it.price.id ? it.price.id : null;
    return pid && priceIds.includes(pid);
  });

  const STRIPE_PRICE_YEAR = mustEnv("STRIPE_PRICE_YEAR");
  const STRIPE_PRICE_MONTH = mustEnv("STRIPE_PRICE_MONTH");

  let plan = null;
  const itemPriceId = item && item.price && item.price.id ? item.price.id : null;
  if (itemPriceId && STRIPE_PRICE_YEAR && itemPriceId === STRIPE_PRICE_YEAR) plan = "year";
  else if (itemPriceId && STRIPE_PRICE_MONTH && itemPriceId === STRIPE_PRICE_MONTH) plan = "month";

  let iso = null;
  try {
    iso = activeSub.current_period_end
      ? new Date(activeSub.current_period_end * 1000).toISOString()
      : null;
  } catch (_) {
    iso = null;
  }

  return { active: true, plan, current_period_end: iso };
}

async function hasLifetimePurchase(customerId, lifetimePriceId) {
  if (!stripe || !customerId || !lifetimePriceId) return false;

  const sessions = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: 20,
  });

  const arr = (sessions && sessions.data) ? sessions.data : [];

  for (const s of arr) {
    if (!s) continue;
    if (s.mode !== "payment") continue;
    if (s.payment_status !== "paid") continue;

    const full = await stripe.checkout.sessions.retrieve(s.id, { expand: ["line_items"] });
    const items = (full && full.line_items && full.line_items.data) ? full.line_items.data : [];
    const match = items.some((it) => (it && it.price && it.price.id) === lifetimePriceId);
    if (match) return true;
  }

  return false;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!stripe) {
      console.error("subscription-status: Missing STRIPE_SECRET_KEY");
      return res.status(500).json({ error: "Server misconfigured (stripe)" });
    }
    if (!supabaseAdmin) {
      console.error("subscription-status: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return res.status(500).json({ error: "Server misconfigured (supabase)" });
    }

    const { user, error } = await getUserFromBearer(req);
    if (error) return res.status(401).json({ error });

    const userId = user.id;
    const email = user.email || null;

    // Read trial from Supabase
    const { data: accessRow, error: accessErr } = await supabaseAdmin
      .from("user_access")
      .select("trial_started_at, trial_ends_at, trial_plan")
      .eq("user_id", userId)
      .maybeSingle();

    if (accessErr) {
      console.error("user_access select error:", accessErr);
      return res.status(500).json({ error: "Database error (user_access)" });
    }

    const now = new Date();
    const trialEndsAt = accessRow && accessRow.trial_ends_at ? new Date(accessRow.trial_ends_at) : null;
    const trialActive = !!(trialEndsAt && trialEndsAt.getTime() > now.getTime());
    const trialUsed = !!(accessRow && accessRow.trial_started_at);

    const customer = await findStripeCustomer({ userId, email });
    const customerId = customer ? customer.id : null;

    const STRIPE_PRICE_MONTH = mustEnv("STRIPE_PRICE_MONTH");
    const STRIPE_PRICE_YEAR = mustEnv("STRIPE_PRICE_YEAR");
    const STRIPE_PRICE_LIFETIME = mustEnv("STRIPE_PRICE_LIFETIME");

    const priceIds = [STRIPE_PRICE_MONTH, STRIPE_PRICE_YEAR].filter(Boolean);
    const sub = await hasActiveSubscription(customerId, priceIds);
    const lifetime = await hasLifetimePurchase(customerId, STRIPE_PRICE_LIFETIME);

    if (lifetime) {
      return res.status(200).json({
        active: true,
        trial: false,
        lifetime: true,
        plan: "lifetime",
        current_period_end: null,
        trial_ends_at: null,
        canStartTrial: false,
        reason: "lifetime",
      });
    }

    if (sub.active) {
      return res.status(200).json({
        active: true,
        trial: false,
        lifetime: false,
        plan: sub.plan,
        current_period_end: sub.current_period_end,
        trial_ends_at: null,
        canStartTrial: false,
        reason: "active_subscription",
      });
    }

    if (trialActive) {
      let trialIso = null;
      try { trialIso = trialEndsAt ? trialEndsAt.toISOString() : null; } catch (_) { trialIso = null; }

      return res.status(200).json({
        active: false,
        trial: true,
        lifetime: false,
        plan: (accessRow && accessRow.trial_plan) ? accessRow.trial_plan : null,
        current_period_end: trialIso,
        trial_ends_at: trialIso,
        canStartTrial: false,
        reason: "trial_active",
      });
    }

    // No access (trial may be used/expired)
    let trialIso2 = null;
    try { trialIso2 = trialEndsAt ? trialEndsAt.toISOString() : null; } catch (_) { trialIso2 = null; }

    return res.status(200).json({
      active: false,
      trial: false,
      lifetime: false,
      plan: null,
      current_period_end: trialIso2,  // keep consistent for frontend
      trial_ends_at: trialIso2,       // optional debug/compat
      canStartTrial: !trialUsed,
      reason: trialUsed ? "trial_expired" : "no_access",
    });

  } catch (e) {
    console.error("subscription-status error:", e);
    return res.status(500).json({ error: "Server error" });
  }
};
