// © 2026 Barnefotballtrener.no. All rights reserved.
// /api/leave-club.js (v3)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  'https://barnefotballtrener.no',
  'https://www.barnefotballtrener.no',
]);
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

    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Mangler autorisering' });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Ugyldig sesjon' });
    }

    // Slett medlemskap (1 bruker = 1 klubb, så dette fjerner det ene)
    const { error: deleteError, count } = await supabase
      .from('club_members')
      .delete({ count: 'exact' })
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('❌ Delete error:', deleteError);
      return res.status(500).json({ error: 'Kunne ikke forlate klubb' });
    }

    console.log(`✅ User ${user.id.substring(0, 8)} left ${count || 0} club(s)`);

    return res.status(200).json({
      success: true,
      removed: count || 0,
      message: 'Du har forlatt klubben. Du trenger nå et eget abonnement for å bruke appen.'
    });

  } catch (err) {
    console.error('❌ leave-club error:', err);
    return res.status(500).json({ error: 'En uventet feil oppstod' });
  }
}
