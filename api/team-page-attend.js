// © 2026 Barnefotballtrener.no. All rights reserved.
// api/team-page-attend.js
// Unauthenticated endpoint for parents to register attendance via team page.
// Uses service_role to write to event_players (parents have no Supabase session).
//
// Required env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Simple in-memory rate limiter (resets on cold start, good enough for barnefotball)
var rateLimits = {};
var RATE_WINDOW_MS = 60 * 1000;
var RATE_MAX = 30;

function checkRateLimit(token) {
  var now = Date.now();
  if (!rateLimits[token] || now - rateLimits[token].start > RATE_WINDOW_MS) {
    rateLimits[token] = { start: now, count: 1 };
    return true;
  }
  rateLimits[token].count++;
  return rateLimits[token].count <= RATE_MAX;
}

function isValidToken(t) {
  return typeof t === 'string' && t.length >= 8 && t.length <= 24 && /^[a-zA-Z0-9_-]+$/.test(t);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1) Parse body
    var body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch (_) {}

    var token = body.token;
    var eventId = body.event_id;
    var playerId = body.player_id;
    var status = body.status; // 'yes', 'no', 'maybe'

    if (!token || !isValidToken(token)) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    if (!eventId || !playerId || !status) {
      return res.status(400).json({ error: 'event_id, player_id and status are required' });
    }
    if (status !== 'yes' && status !== 'no' && status !== 'maybe') {
      return res.status(400).json({ error: 'status must be yes, no, or maybe' });
    }

    // 2) Rate limit
    if (!checkRateLimit(token)) {
      return res.status(429).json({ error: 'For mange forespørsler. Vent litt.' });
    }

    // 3) Verify token
    var { data: page } = await supabaseAdmin
      .from('team_pages')
      .select('team_id')
      .eq('token', token)
      .eq('active', true)
      .maybeSingle();

    if (!page) {
      return res.status(404).json({ error: 'Ugyldig eller deaktivert lenke' });
    }

    // Get data owner from teams table (stable after ownership transfer)
    var { data: team } = await supabaseAdmin
      .from('teams')
      .select('user_id')
      .eq('id', page.team_id)
      .single();

    if (!team) {
      return res.status(404).json({ error: 'Laget finnes ikke' });
    }

    var ownerId = team.user_id;

    // 4) Verify event belongs to this team's season
    var { data: event } = await supabaseAdmin
      .from('events')
      .select('id, season_id, status')
      .eq('id', eventId)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (!event) {
      return res.status(404).json({ error: 'Hendelsen finnes ikke' });
    }

    // Don't allow attendance changes on cancelled or completed events
    if (event.status === 'cancelled') {
      return res.status(400).json({ error: 'Hendelsen er avlyst' });
    }
    if (event.status === 'completed') {
      return res.status(400).json({ error: 'Hendelsen er allerede gjennomført' });
    }

    // 5) Verify player exists in this season
    var { data: seasonPlayer } = await supabaseAdmin
      .from('season_players')
      .select('player_id, player_name')
      .eq('season_id', event.season_id)
      .eq('player_id', playerId)
      .eq('user_id', ownerId)
      .eq('active', true)
      .maybeSingle();

    if (!seasonPlayer) {
      return res.status(404).json({ error: 'Spilleren finnes ikke i denne sesongen' });
    }

    // 6) Update or insert event_players
    // Important: don't overwrite in_squad on existing rows (coach may have set it)
    var attended = status === 'yes' ? true : (status === 'no' ? false : null);

    // Check if row exists
    var { data: existingEp } = await supabaseAdmin
      .from('event_players')
      .select('id')
      .eq('event_id', eventId)
      .eq('player_id', playerId)
      .maybeSingle();

    if (existingEp) {
      // Update only attended + player_name (preserve coach's in_squad setting)
      var { error: updateErr } = await supabaseAdmin
        .from('event_players')
        .update({
          attended: attended,
          player_name: seasonPlayer.player_name,
        })
        .eq('event_id', eventId)
        .eq('player_id', playerId);

      if (updateErr) {
        console.error('[team-page-attend] Update error:', updateErr);
        return res.status(500).json({ error: 'Kunne ikke registrere oppmøte' });
      }
    } else {
      // New row: set in_squad based on attendance (coach can override later)
      var { error: insertErr } = await supabaseAdmin
        .from('event_players')
        .insert({
          event_id: eventId,
          season_id: event.season_id,
          user_id: ownerId,
          player_id: playerId,
          attended: attended,
          in_squad: status === 'yes',
          player_name: seasonPlayer.player_name,
        });

      if (insertErr) {
        // Race condition: row was created between our SELECT and INSERT
        // (e.g. coach registered attendance in the app at the same time)
        // Retry as UPDATE (safe — preserves coach's in_squad)
        if (insertErr.code === '23505') {
          var { error: retryErr } = await supabaseAdmin
            .from('event_players')
            .update({
              attended: attended,
              player_name: seasonPlayer.player_name,
            })
            .eq('event_id', eventId)
            .eq('player_id', playerId);

          if (retryErr) {
            console.error('[team-page-attend] Retry update error:', retryErr);
            return res.status(500).json({ error: 'Kunne ikke registrere oppmøte' });
          }
        } else {
          console.error('[team-page-attend] Insert error:', insertErr);
          return res.status(500).json({ error: 'Kunne ikke registrere oppmøte' });
        }
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[team-page-attend] Unexpected error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
