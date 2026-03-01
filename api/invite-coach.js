// © 2026 Barnefotballtrener.no. All rights reserved.
// api/invite-coach.js
// Server-side invitasjon: slår opp e-post → user_id via service_role
//
// Required env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_EDITORS_PER_TEAM = 4;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1) Authenticate caller
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const callerId = user.id;

    // 2) Parse request
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch (_) {}

    const { team_id, email } = body;
    if (!team_id || !email) {
      return res.status(400).json({ error: 'team_id and email are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // 3) Verify caller is owner of the team
    const { data: team, error: teamErr } = await supabaseAdmin
      .from('teams')
      .select('id, user_id, name')
      .eq('id', team_id)
      .single();

    if (teamErr || !team) {
      return res.status(404).json({ error: 'Laget ble ikke funnet' });
    }

    if (team.user_id !== callerId) {
      return res.status(403).json({ error: 'Bare lageier kan invitere trenere' });
    }

    // 4) Look up invited user by email (direct query, handles any user count)
    const { data: foundUsers, error: lookupErr } = await supabaseAdmin
      .rpc('get_user_id_by_email', { lookup_email: normalizedEmail });

    // Fallback: direct query on auth.users if RPC doesn't exist
    let invitedUserId = null;
    if (lookupErr || !foundUsers || foundUsers.length === 0) {
      // Use admin API to search
      const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (listErr) {
        console.error('[invite-coach] listUsers error:', listErr);
        return res.status(500).json({ error: 'Kunne ikke søke etter brukere' });
      }

      const invitedUser = (users || []).find(function (u) {
        return u.email && u.email.toLowerCase() === normalizedEmail;
      });

      if (!invitedUser) {
        return res.status(404).json({
          error: 'Ingen bruker med denne e-postadressen. Treneren må opprette konto på barnefotballtrener.no først.',
        });
      }

      invitedUserId = invitedUser.id;
    } else {
      invitedUserId = foundUsers[0].id;
    }

    // 5) Don't invite yourself
    if (invitedUserId === callerId) {
      return res.status(400).json({ error: 'Du kan ikke invitere deg selv' });
    }

    // 6) Check if already a member
    const { data: existing } = await supabaseAdmin
      .from('team_members')
      .select('id, status')
      .eq('team_id', team_id)
      .eq('user_id', invitedUserId)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'active') {
        return res.status(409).json({ error: 'Denne treneren er allerede med på laget' });
      }
      if (existing.status === 'pending') {
        return res.status(409).json({ error: 'Det er allerede sendt en invitasjon til denne treneren' });
      }
    }

    // 7) Check editor count limit
    const { data: members } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('team_id', team_id)
      .neq('role', 'owner');

    if (members && members.length >= MAX_EDITORS_PER_TEAM) {
      return res.status(400).json({
        error: 'Maks ' + MAX_EDITORS_PER_TEAM + ' trenere per lag',
      });
    }

    // 8) Create team_members row
    const { data: membership, error: insertErr } = await supabaseAdmin
      .from('team_members')
      .insert({
        team_id: team_id,
        user_id: invitedUserId,
        role: 'editor',
        status: 'pending',
        invited_by: callerId,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[invite-coach] Insert error:', insertErr);
      return res.status(500).json({ error: 'Kunne ikke opprette invitasjon' });
    }

    return res.status(200).json({
      success: true,
      message: 'Invitasjon sendt til ' + normalizedEmail,
      membership_id: membership.id,
    });
  } catch (err) {
    console.error('[invite-coach] Unexpected error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
