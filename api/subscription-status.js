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
  const authHeader =
    req && req.headers && req.headers.authorization ? req.headers.authorization : "";
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  const accessToken = match && match[1] ? match[1] : null;

  if (!accessToken) return { user: null, error: "Missing Bearer token" };

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data || !data.user) return { user: null, error: "Invalid session" };

  return { user: data.user, error: null };
}

async function findStripeCustomer(userId, email) {
  try {
    if (userId) {
      const found = await stripe.customers.search({
        query: "metadata['supabase_user_id']:'" + userId + "'",
        limit: 1,
      });
      if (found && found.data && found.data[0]) return found.data[0];
    }
  } catch (_) {}

  try {
    if (email) {
      const foundByEmail = await stripe.customers.search({
        query: "email:'" + email + "'",
        limit: 1,
      });
      if (foundByEmail && foundByEmail.data && foundByEmail.data[0]) return foundByEmail.data[0];
    }
  } catch (_) {}

  return null;
}

async function hasActiveSubscription(customerId, monthPrice, yearPrice) {
  if (!customerId) return { active: false, plan: null, current_period_end: null };

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  const list = subs && subs.data ? subs.data : [];
  const activeSub = list.find((s) => s && (s.status === "active" || s.status === "trialing"));
  if (!activeSub) return { active: false, plan: null, current_period_end: null };

  let plan = null;
  const items = activeSub.items && activeSub.items.data ? activeSub.items.data : [];
  for (let i = 0; i < items.length; i++) {
    const pid = items[i] && items[i].price && items[i].price.id ? items[i].price.id : null;
    if (pid && yearPrice && pid === yearPrice) {
      plan = "year";
      break;
    }
    if (pid && monthPrice && pid === monthPrice) {
      plan = "month";
      break;
    }
  }

  let iso = null;
  try {
    iso = activeSub.current_period_end
      ? new Date(activeSub.current_period_end * 1000).toISOString()
      : null;
  } catch (e) {
    iso = null;
  }

  return { active: true, plan: plan, current_period_end: iso };
}

async function hasLifetimePurchase(customerId, lifetimePriceId) {
  if (!customerId || !lifetimePriceId) return false;

  const sessions = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: 20,
  });

  const arr = sessions && sessions.data ? sessions.data : [];
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (!s) continue;
    if (s.mode !== "payment") continue;
    if (s.payment_status !== "paid") continue;

    const full = await stripe.checkout.sessions.retrieve(s.id, {
      expand: ["line_items"],
    });

    const items = full && full.line_items && full.line_items.data ? full.line_items.data : [];
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      const pid = it && it.price && it.price.id ? it.price.id : null;
      if (pid === lifetimePriceId) return true;
    }
  }

  return false;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Missing Supabase server env" });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing Stripe server env" });
    }

    const auth = await getUserFromBearer(req);
    if (auth.error) return res.status(401).json({ error: auth.error });

    const userId = auth.user.id;
    const email = auth.user.email;

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
    let trialEndsAt = null;
    try {
      trialEndsAt = accessRow && accessRow.trial_ends_at ? new Date(accessRow.trial_ends_at) : null;
    } catch (e) {
      trialEndsAt = null;
    }

    const trialUsed = !!(accessRow && accessRow.trial_started_at);
    const trialActive = !!(trialEndsAt && trialEndsAt.getTime() > now.getTime());

    const customer = await findStripeCustomer(userId, email);
    const customerId = customer && customer.id ? customer.id : null;

    const monthPrice = process.env.STRIPE_PRICE_MONTH || null;
    const yearPrice = process.env.STRIPE_PRICE_YEAR || null;
    const lifetimePrice = process.env.STRIPE_PRICE_LIFETIME || null;

    const lifetime = await hasLifetimePurchase(customerId, lifetimePrice);
    if (lifetime) {
      return res.status(200).json({
        active: true,
        trial: false,
        lifetime: true,
        plan: "lifetime",
        current_period_end: null,
        trial_ends_at: null,
        reason: "lifetime",
        canStartTrial: false,
      });
    }

    const sub = await hasActiveSubscription(customerId, monthPrice, yearPrice);
    if (sub.active) {
      return res.status(200).json({
        active: true,
        trial: false,
        lifetime: false,
        plan: sub.plan,
        current_period_end: sub.current_period_end,
        trial_ends_at: null,
        reason: "active_subscription",
        canStartTrial: false,
      });
    }

    if (trialActive) {
      let trialIso = null;
      try {
        trialIso = trialEndsAt ? trialEndsAt.toISOString() : null;
      } catch (e) {
        trialIso = null;
      }

      return res.status(200).json({
        active: false,
        trial: true,
        lifetime: false,
        plan: accessRow && accessRow.trial_plan ? accessRow.trial_plan : null,
        current_period_end: trialIso,
        trial_ends_at: trialIso,
        reason: "trial_active",
        canStartTrial: false,
      });
    }

    let trialIso2 = null;
    try {
      trialIso2 = trialEndsAt ? trialEndsAt.toISOString() : null;
    } catch (e) {
      trialIso2 = null;
    }

    return res.status(200).json({
      active: false,
      trial: false,
      lifetime: false,
      plan: null,
      current_period_end: trialIso2,
      trial_ends_at: trialIso2,
      reason: trialUsed ? "trial_expired" : "no_access",
      canStartTrial: !trialUsed,
    });
  } catch (e) {
    console.error("subscription-status error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
