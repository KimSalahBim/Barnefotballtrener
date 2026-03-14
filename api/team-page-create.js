// © 2026 Barnefotballtrener.no. All rights reserved.
// api/team-page-create.js
// Creates a parent-facing team page with a unique token.
// Only team owner can create. Returns existing if already created.
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

function generateToken() {
  // 12 chars base64url = 9 bytes = ~53 bits entropy
  return crypto.randomBytes(9).toString('base64url');
}

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
    // Fall back to APP_URL env or canonical domain
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
    var { data: membership, error: memErr } = await supabaseAdmin
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', callerId)
      .eq('status', 'active')
      .maybeSingle();

    if (memErr || !membership) {
      return res.status(403).json({ error: 'Ingen tilgang til dette laget' });
    }
    if (membership.role !== 'owner') {
      return res.status(403).json({ error: 'Bare lageier kan opprette lagside' });
    }

    // 3b) Get data owner (teams.user_id is stable even after ownership transfer)
    var { data: team } = await supabaseAdmin
      .from('teams')
      .select('user_id')
      .eq('id', teamId)
      .single();

    if (!team) {
      return res.status(404).json({ error: 'Laget finnes ikke' });
    }

    var dataOwnerId = team.user_id;

    // 4) Check if team page already exists
    var { data: existing } = await supabaseAdmin
      .from('team_pages')
      .select('token, active')
      .eq('team_id', teamId)
      .maybeSingle();

    if (existing) {
      var baseUrl = getBaseUrl(req);
      // Reactivate if deactivated
      if (!existing.active) {
        var newToken = generateToken();
        await supabaseAdmin
          .from('team_pages')
          .update({ token: newToken, active: true })
          .eq('team_id', teamId);
        return res.status(200).json({
          success: true,
          token: newToken,
          url: baseUrl + '/lag/' + newToken,
          created: false,
        });
      }
      return res.status(200).json({
        success: true,
        token: existing.token,
        url: baseUrl + '/lag/' + existing.token,
        created: false,
      });
    }

    // 5) Create new team page
    var token = generateToken();
    var { error: insertErr } = await supabaseAdmin
      .from('team_pages')
      .insert({
        team_id: teamId,
        user_id: dataOwnerId,
        token: token,
        active: true,
      });

    if (insertErr) {
      console.error('[team-page-create] Insert error:', insertErr);
      return res.status(500).json({ error: 'Kunne ikke opprette lagside' });
    }

    var baseUrl = getBaseUrl(req);
    return res.status(200).json({
      success: true,
      token: token,
      url: baseUrl + '/lag/' + token,
      created: true,
    });
  } catch (err) {
    console.error('[team-page-create] Unexpected error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
