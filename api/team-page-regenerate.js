// © 2026 Barnefotballtrener.no. All rights reserved.
// api/team-page-regenerate.js
// Regenerates the token for an existing team page.
// Old link dies immediately. Only team owner.
//
// Required env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Host validation — matches create-checkout-session.js allowlist
function getBaseUrl(req) {
  var rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  var host = rawHost.toLowerCase().replace(/:443$/, '').replace(/\.$/, '');
  var bare = host.split(':')[0];

  var isLocal = bare === 'localhost' || bare === '127.0.0.1';
  var isAllowed = isLocal ||
    bare === 'barnefotballtrener.no' || bare === 'www.barnefotballtrener.no' ||
    bare === 'barnefotballtrener.vercel.app' ||
    (bare.endsWith('.vercel.app') && bare.startsWith('barnefotballtrener-'));

  if (!isAllowed) {
    var appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    return appUrl || 'https://barnefotballtrener.no';
  }

  var proto = isLocal ? 'http' : 'https';
  return proto + '://' + host;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1) Authenticate
    var authHeader = req.headers.authorization || '';
    var sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!sessionToken) return res.status(401).json({ error: 'Missing Bearer token' });

    var { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(sessionToken);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    var callerId = user.id;

    // 2) Parse body
    var body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch (_) {}

    var teamId = body.team_id;
    if (!teamId) return res.status(400).json({ error: 'team_id is required' });

    // 3) Verify caller is owner
    var { data: membership } = await supabaseAdmin
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', callerId)
      .eq('status', 'active')
      .maybeSingle();

    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Bare lageier kan regenerere lenke' });
    }

    // 4) Check that team page exists
    var { data: page } = await supabaseAdmin
      .from('team_pages')
      .select('id')
      .eq('team_id', teamId)
      .maybeSingle();

    if (!page) {
      return res.status(404).json({ error: 'Ingen lagside funnet for dette laget' });
    }

    // 5) Generate new token
    var newToken = crypto.randomBytes(9).toString('base64url');

    var { error: updateErr } = await supabaseAdmin
      .from('team_pages')
      .update({ token: newToken, active: true })
      .eq('team_id', teamId);

    if (updateErr) {
      console.error('[team-page-regenerate] Update error:', updateErr);
      return res.status(500).json({ error: 'Kunne ikke regenerere lenke' });
    }

    return res.status(200).json({
      success: true,
      token: newToken,
      url: getBaseUrl(req) + '/lag/' + newToken,
    });
  } catch (err) {
    console.error('[team-page-regenerate] Unexpected error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
