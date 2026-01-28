import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 1) Hent Supabase access token fra Authorization header
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    const accessToken = match?.[1];

    if (!accessToken) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    // 2) Verifiser token -> få user
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

    // 3) Finn Stripe customer (først via metadata, så via e-post)
    let customerId = null;

    // 3a) Søk via metadata supabase_user_id
    try {
      const found = await stripe.customers.search({
        query: `metadata['supabase_user_id']:'${userId}'`,
        limit: 1,
      });
      customerId = found.data?.[0]?.id || null;
    } catch (e) {
      // Ignorer og fall tilbake til e-post
    }

    // 3b) Fall tilbake: søk via e-post
    if (!customerId) {
      const foundByEmail = await stripe.customers.search({
        query: `email:'${email}'`,
        limit: 1,
      });
      customerId = foundByEmail.data?.[0]?.id || null;
    }

    // VIKTIG: Vi oppretter IKKE ny customer her.
    // Hvis vi gjør det, får brukeren en "tom portal" uten abonnement.
    if (!customerId) {
      return res.status(404).json({
        error:
          "Fant ingen Stripe-kunde/abonnement på denne e-posten ennå. Har du kjøpt abonnement med samme e-post?",
      });
    }

    // 4) Opprett Customer Portal session
    const returnUrl =
      process.env.APP_URL ||
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("create-portal-session error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
