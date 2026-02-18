// © 2026 Barnefotballtrener.no. All rights reserved.
// /api/join-club.js (v3)
// Atomisk join via RPC. CORS allowlist. Env guard.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  'https://barnefotballtrener.no',
  'https://www.barnefotballtrener.no',
]);
// Legg til staging-origins ved behov:
if (process.env.VERCEL_ENV !== 'production') {
  ALLOWED_ORIGINS.add('http://localhost:3000');
  ALLOWED_ORIGINS.add('http://localhost:5500');
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://barnefotballtrener.no';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return res.status(500).json({ error: 'Serverkonfigurasjonsfeil' });
    }

    // 1. Verifiser JWT
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Mangler autorisering' });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Ugyldig sesjon. Logg inn på nytt.' });
    }

    // 2. Les og valider invitasjonskode
    const { inviteCode } = req.body || {};
    if (!inviteCode || typeof inviteCode !== 'string') {
      return res.status(400).json({ error: 'Mangler invitasjonskode' });
    }

    const code = inviteCode.trim().toUpperCase();
    if (code.length < 3 || code.length > 50 || !/^[A-Z0-9_-]+$/.test(code)) {
      return res.status(400).json({ error: 'Ugyldig kodeformat' });
    }

    // 3. Atomisk join via RPC (håndterer locking, validering, seat-count)
    const { data, error } = await supabase.rpc('join_club_safe', {
      p_user_id: user.id,
      p_invite_code: code
    });

    if (error) {
      console.error('❌ join_club_safe RPC error:', error);
      return res.status(500).json({ error: 'Kunne ikke behandle forespørselen' });
    }

    if (!data || !data.success) {
      return res.status(400).json({ error: (data && data.error) || 'Ukjent feil' });
    }

    // 4. Suksess
    const logMsg = data.already_member
      ? `ℹ️ User ${user.id.substring(0, 8)} already in "${data.club_name}"`
      : `✅ User ${user.id.substring(0, 8)} joined "${data.club_name}" (${data.seats_used}/${data.seats_total})`;
    console.log(logMsg);

    return res.status(200).json({
      success: true,
      already_member: !!data.already_member,
      club_name: data.club_name,
      seats_used: data.seats_used || null,
      seats_total: data.seats_total || null,
      message: data.already_member
        ? `Du er allerede medlem av ${data.club_name}`
        : `Velkommen til ${data.club_name}! Du har nå full tilgang.`
    });

  } catch (err) {
    console.error('❌ join-club error:', err);
    return res.status(500).json({ error: 'En uventet feil oppstod' });
  }
}
