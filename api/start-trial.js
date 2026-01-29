import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

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

    const userId = userData.user.id;

    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {}

    const planType = body.planType;
    if (!planType || !["month", "year"].includes(planType)) {
      return res.status(400).json({ error: "Invalid planType (use 'month' or 'year')" });
    }

    const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 7);
    const now = new Date();
    const endsAt = addDays(now, TRIAL_DAYS);

    const { data: existing, error: selErr } = await supabaseAdmin
      .from("user_access")
      .select("user_id, trial_started_at, trial_ends_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) {
      console.error("start-trial select error:", selErr);
      return res.status(500).json({ error: "Database error (user_access)" });
    }

    if (existing?.trial_started_at) {
      return res.status(409).json({
        error: "Trial already used",
        trial_ends_at: existing.trial_ends_at,
      });
    }

    const { error: upErr } = await supabaseAdmin
      .from("user_access")
      .upsert(
        {
          user_id: userId,
          trial_started_at: now.toISOString(),
          trial_ends_at: endsAt.toISOString(),
          trial_plan: planType,
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upErr) {
      console.error("start-trial upsert error:", upErr);
      return res.status(500).json({ error: "Could not start trial" });
    }

    return res.status(200).json({
      success: true,
      trial_started_at: now.toISOString(),
      trial_ends_at: endsAt.toISOString(),
      trial_days: TRIAL_DAYS,
    });
  } catch (e) {
    console.error("start-trial error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
