import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getUserFromBearer(req) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  const accessToken = match?.[1];
  if (!accessToken) return { user: null, error: "Missing Bearer token" };

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) return { user: null, error: "Invalid session" };

  return { user: data.user, error: null };
}

async function findStripeCustomer({ userId, email }) {
  // Prefer metadata match
  try {
    const found = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${userId}'`,
      limit: 1,
    });
    if (found.data?.[0]) return found.data[0];
  } catch (_) {}

  // Fallback: email
  try {
    if (email) {
      const foundByEmail = await stripe.customers.search({
        query: `email:'${email}'`,
        limit: 1,
      });
      if (foundByEmail.data?.[0]) return foundByEmail.data[0];
    }
  } catch (_) {}

  return null;
}

async function hasActiveSubscription(customerId, priceIds) {
  if (!customerId) return { active: false, plan: null, current_period_end: null };

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  const active = subs.data.find((s) => ["active", "trialing"].includes(s.status));
  if (!active) return { active: false, plan: null, current_period_end: null };

  const items = active.items?.data || [];
  const item = items.find((it) => priceIds.includes(it.price?.id));

  let plan = null;
  if (item?.price?.id === process.env.STRIPE_PRICE_YEAR) plan = "year";
  else if (item?.price?.id === process.env.STRIPE_PRICE_MONTH) plan = "month";

  return {
    active: true,
    plan,
    current_period_end: active.current_period_end
      ? new Date(active.current_period_end * 1000).toISOString()
      : null,
  };
}

async function hasLifetimePurchase(customerId, lifetimePriceId) {
  if (!customerId || !lifetimePriceId) return false;

  const sessions = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: 20,
  });

  for (const s of sessions.data || []) {
    if (s.mode !== "payment") continue;
    if (s.payment_status !== "paid") continue;

    const full = await stripe.checkout.sessions.retrieve(s.id, {
      expand: ["line_items"],
    });
    const items = full.line_items?.data || [];
    const match = items.some((it) => it.price?.id === lifetimePriceId);
    if (match) return true;
  }

  return false;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { user, error } = await getUserFromBearer(req);
    if (error) return res.status(401).json({ error });

    const userId = user.id;
    const email = user.email;

    // Trial status from Supabase
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
    const trialEndsAt = accessRow?.trial_ends_at ? new Date(accessRow.trial_ends_at) : null;
    const trialActive = !!(trialEndsAt && trialEndsAt.getTime() > now.getTime());
    const trialUsed = !!accessRow?.trial_started_at;

    // Stripe status
    const customer = await findStripeCustomer({ userId, email });
    const customerId = customer?.id || null;

    const monthPrice = process.env.STRIPE_PRICE_MONTH;
    const yearPrice = process.env.STRIPE_PRICE_YEAR;
    const lifetimePrice = process.env.STRIPE_PRICE_LIFETIME;

    const sub = await hasActiveSubscription(
      customerId,
      [monthPrice, yearPrice].filter(Boolean)
    );
    const lifetime = await hasLifetimePurchase(customerId, lifetimePrice);

    if (lifetime) {
      return res.status(200).json({
        active: true,
        trial: false,
        lifetime: true,
        plan: "lifetime",
        canStartTrial: !trialUsed,
      });
    }

    if (sub.active) {
      return res.status(200).json({
        active: true,
        trial: false,
        lifetime: false,
        plan: sub.plan,
        current_period_end: sub.current_period_end,
        canStartTrial: !trialUsed,
      });
    }

    if (trialActive) {
      return res.status(200).json({
        active: false,
        trial: true,
        lifetime: false,
        plan: accessRow?.trial_plan || null,
        trial_ends_at: trialEndsAt?.toISOString() || null,
        canStartTrial: false,
      });
    }

    return res.status(200).json({
      active: false,
      trial: false,
      lifetime: false,
      plan: null,
      trial_ends_at: trialEndsAt?.toISOString() || null,
      canStartTrial: !trialUsed,
      reason: trialUsed ? "trial_expired" : "no_access",
    });
  } catch (e) {
    console.error("subscription-status error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
