// api/webhook.js
// Stripe Webhook endpoint (Test + Live).
// Formål nå: verifiser signatur og kvitter (200) uten å endre app-logikk.
// Dette gjør at du kan koble Stripe-webhooks trygt *nå*,
// og senere (valgfritt) utvide til hybrid entitlements uten refactor.
//
// Krever env:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  timeout: 10000,
  maxNetworkRetries: 1,
});

function isDebugHost(hostHeader) {
  const h = String(hostHeader || '').toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
}

async function readRawBody(req) {
  // Best effort: support multiple runtimes (Vercel may provide req.body as string/object)
  if (req?.body) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    // Some platforms expose rawBody
    if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody;
  }

  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Next.js-style hint (ignored if not applicable). Safe to keep.
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const debug = isDebugHost(req.headers.host);

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Misconfig: return 500 so Stripe will retry and you notice quickly.
    console.error('[webhook] ❌ Missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).send('Server misconfigured');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('[webhook] ❌ Missing stripe-signature header');
    return res.status(400).send('Missing signature');
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error('[webhook] ❌ Signature verification failed:', err?.message || err);
    return res.status(400).send('Invalid signature');
  }

  // Minimal handling: log in debug, always ACK.
  if (debug) {
    console.log('[webhook] ✅ Event:', event.type, 'id=', event.id);
  }

  // NOTE: Entitlements-DB synk (hybrid) er bevisst IKKE aktivert her enda.
  // Når du ønsker hybrid, er første steg å legge inn idempotent DB-update per event.type.

  return res.status(200).json({ received: true });
}
