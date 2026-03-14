// © 2026 Barnefotballtrener.no. All rights reserved.
// api/team-page-read.js
// Public (unauthenticated) endpoint for the parent-facing team page.
// Token-based access. All personal data is filtered server-side.
//
// GDPR FILTERING (hardcoded, not configurable):
// NEVER returned: player skill, positions, absence_reason, minutes_played,
//   match_events (goals/assists), plan_json, grouping data, individual stats.
// RETURNED: player id + first name (for attendance picker), aggregated counts.
//
// Required env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Token must be alphanumeric/base64url only
function isValidToken(t) {
  return typeof t === 'string' && t.length >= 8 && t.length <= 24 && /^[a-zA-Z0-9_-]+$/.test(t);
}

// Exercise lookup: key → { name, nffCategory }
// Mirrors exercises-data.js. Used to resolve block data for parent display.
// GDPR safe: exercise names are pedagogical content, not personal data.
var EX_MAP = {
  drink:{n:'Drikkepause',c:'pause'},custom:{n:'Egendefinert',c:''},
  tag:{n:'Lek / Sisten',c:'sjef_over_ballen'},warm_ball:{n:'Ballmestring',c:'sjef_over_ballen'},
  rondo_easy:{n:'Rondo',c:'spille_med_og_mot'},driving:{n:'Føring av ball',c:'sjef_over_ballen'},
  pass_pair:{n:'Pasning parvis',c:'sjef_over_ballen'},pass_move:{n:'Pasning og bevegelse',c:'sjef_over_ballen'},
  pass_square:{n:'Pasningsfirkant',c:'sjef_over_ballen'},dribble:{n:'Dribling 1 mot 1',c:'spille_med_og_mot'},
  turn:{n:'Vendinger',c:'sjef_over_ballen'},receive_turn:{n:'Mottak og vending',c:'sjef_over_ballen'},
  shot:{n:'Skudd på mål',c:'scoringstrening'},shot_race:{n:'Skuddstafett',c:'scoringstrening'},
  '1v1':{n:'1 mot 1',c:'spille_med_og_mot'},'2v1':{n:'2 mot 1',c:'spille_med_og_mot'},
  '3v2':{n:'3 mot 2',c:'spille_med_og_mot'},'2v2':{n:'2 mot 2',c:'spille_med_og_mot'},
  '1v1_gates':{n:'1 mot 1 med porter',c:'spille_med_og_mot'},
  ssg:{n:'Smålagsspill',c:'smalagsspill'},possession:{n:'Ballbesittelse',c:'smalagsspill'},
  game_activity:{n:'Fri spillaktivitet',c:'smalagsspill'},square_game:{n:'Spill i soner',c:'smalagsspill'},
  ssg_theme:{n:'Spill med betingelser',c:'smalagsspill'},transition:{n:'Omstillingsspill',c:'smalagsspill'},
  possession_dir:{n:'Retningsspill',c:'smalagsspill'},build_up:{n:'Spilloppbygging bakfra',c:'smalagsspill'},
  keeper:{n:'Keepertrening',c:'sjef_over_ballen'},keeper_play:{n:'Keeperduell',c:'sjef_over_ballen'},
  ball_tag:{n:'Ballsisten',c:'sjef_over_ballen'},defend_press:{n:'Press på ballfører',c:'spille_med_og_mot'},
  wall_pass:{n:'Veggspill',c:'spille_med_og_mot'},finish_assist:{n:'Avslutning med medspiller',c:'scoringstrening'},
  block_shot:{n:'Blokker og redd',c:'spille_med_og_mot'},relay_ball:{n:'Stafett med ball',c:'sjef_over_ballen'},
  prepp:{n:'Prepp\'n',c:'sjef_over_ballen'},zone_defense:{n:'Soneforsvar',c:'spille_med_og_mot'},
  sit_attack:{n:'Situasjonsøvelse angrep',c:'spille_med_og_mot'},sit_defend:{n:'Situasjonsøvelse forsvar',c:'spille_med_og_mot'},
  cross_finish:{n:'Innlegg og avslutning',c:'scoringstrening'},
};

// Theme lookup: key → display name. Mirrors NFF_THEMES in nff-data.js.
var THEME_MAP = {
  foering_dribling: 'Føring og dribling',
  vendinger_mottak: 'Vendinger og mottak',
  pasning_samspill: 'Pasning og samspill',
  avslutning: 'Avslutning',
  '1v1_duell': '1 mot 1',
  samarbeidsspill: 'Samarbeidsspill',
  forsvarsspill: 'Forsvarsspill',
  omstilling: 'Omstilling',
  spilloppbygging: 'Spilloppbygging',
  romforstaelse: 'Romforståelse',
  keeper: 'Keeper',
  leik: 'Lek',
  oppvarming_generell: 'Oppvarming',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1) Validate token
    var token = req.query.token;
    if (!token || !isValidToken(token)) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    var playerId = req.query.player_id || null;

    // 2) Look up team page
    var { data: page, error: pageErr } = await supabaseAdmin
      .from('team_pages')
      .select('team_id, active')
      .eq('token', token)
      .eq('active', true)
      .maybeSingle();

    if (pageErr || !page) {
      return res.status(404).json({ error: 'Lagsiden finnes ikke eller er deaktivert' });
    }

    var teamId = page.team_id;

    // 3) Fetch team — use teams.user_id as data owner (stable even after ownership transfer)
    var { data: team } = await supabaseAdmin
      .from('teams')
      .select('name, user_id')
      .eq('id', teamId)
      .single();

    if (!team) {
      return res.status(404).json({ error: 'Laget finnes ikke' });
    }

    var ownerId = team.user_id;

    // 4) Fetch active season (must match team_id — user may have multiple teams)
    var now = new Date().toISOString();
    var { data: seasons } = await supabaseAdmin
      .from('seasons')
      .select('id, name, format, age_class, start_date, end_date')
      .eq('user_id', ownerId)
      .eq('team_id', teamId)
      .lte('start_date', now)
      .order('start_date', { ascending: false })
      .limit(1);

    var season = (seasons && seasons.length > 0) ? seasons[0] : null;
    if (!season) {
      // Try any season for this team (might not have started yet)
      // nullsFirst:false ensures real dates come before null start_dates
      var { data: anySeason } = await supabaseAdmin
        .from('seasons')
        .select('id, name, format, age_class, start_date, end_date')
        .eq('user_id', ownerId)
        .eq('team_id', teamId)
        .order('start_date', { ascending: false, nullsFirst: false })
        .limit(1);
      season = (anySeason && anySeason.length > 0) ? anySeason[0] : null;
    }

    if (!season) {
      return res.status(200).json({
        team: { name: team.name },
        season: null,
        players: [],
        events: [],
        training_info: null,
        nff: null,
      });
    }

    // 5) Fetch players — ONLY id and name, never skill/positions/goalie
    var { data: rawPlayers } = await supabaseAdmin
      .from('season_players')
      .select('player_id, player_name, active')
      .eq('season_id', season.id)
      .eq('user_id', ownerId)
      .eq('active', true);

    var players = (rawPlayers || []).map(function (p) {
      return { id: p.player_id, name: p.player_name };
    }).sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '', 'nb');
    });

    // 6) Fetch events: upcoming + last 3 completed
    var { data: upcomingEvents } = await supabaseAdmin
      .from('events')
      .select('id, type, title, start_time, duration_minutes, location, opponent, is_home, format, status, result_home, result_away, parent_message, share_workout, share_fairness, share_comment')
      .eq('season_id', season.id)
      .eq('user_id', ownerId)
      .gte('start_time', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()) // Include events from 3h ago
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true })
      .limit(20);

    var { data: recentEvents } = await supabaseAdmin
      .from('events')
      .select('id, type, title, start_time, duration_minutes, location, opponent, is_home, format, status, result_home, result_away, parent_message, share_workout, share_fairness, share_comment')
      .eq('season_id', season.id)
      .eq('user_id', ownerId)
      .eq('status', 'completed')
      .order('start_time', { ascending: false })
      .limit(3);

    // Merge and deduplicate
    var allEventsMap = {};
    (upcomingEvents || []).forEach(function (e) { allEventsMap[e.id] = e; });
    (recentEvents || []).forEach(function (e) { allEventsMap[e.id] = e; });
    var allEvents = Object.values(allEventsMap).sort(function (a, b) {
      return new Date(a.start_time) - new Date(b.start_time);
    });

    // 7) Fetch attendance for all events
    var eventIds = allEvents.map(function (e) { return e.id; });
    var eventAttendance = {};

    if (eventIds.length > 0) {
      // GDPR: only select attended + in_squad + player_id. NEVER absence_reason.
      var { data: rawAttendance } = await supabaseAdmin
        .from('event_players')
        .select('event_id, player_id, attended, in_squad')
        .eq('user_id', ownerId)
        .in('event_id', eventIds);

      (rawAttendance || []).forEach(function (ep) {
        if (!eventAttendance[ep.event_id]) eventAttendance[ep.event_id] = [];
        eventAttendance[ep.event_id].push(ep);
      });
    }

    // 8) For events with share_workout=true, fetch workout data
    var workoutsByEvent = {};
    var workoutEventIds = allEvents
      .filter(function (e) { return e.share_workout && e.type === 'training'; })
      .map(function (e) { return e.id; });

    if (workoutEventIds.length > 0) {
      // workouts table: blocks (JSONB), theme (TEXT), duration_minutes (INT) are direct columns
      // Note: Don't filter by user_id — workouts.user_id is not updated during ownership transfer.
      // event_id scope is sufficient (events are already verified above).
      var { data: rawWorkouts } = await supabaseAdmin
        .from('workouts')
        .select('id, event_id, theme, duration_minutes, blocks')
        .in('event_id', workoutEventIds);

      (rawWorkouts || []).forEach(function (w) {
        if (!w.event_id) return;
        var blocks = w.blocks || [];
        if (typeof blocks === 'string') { try { blocks = JSON.parse(blocks); } catch (_) { blocks = []; } }
        // GDPR: strip grouping, player names, coach comments from blocks.
        // Block structure: { kind: 'single'|'parallel', a: { exerciseKey, minutes, ... }, b?: {...} }
        var safeBlocks = [];
        blocks.forEach(function (block) {
          var exercises = [block.a];
          if (block.kind === 'parallel' && block.b) exercises.push(block.b);
          exercises.forEach(function (ex) {
            if (!ex) return;
            var key = ex.exerciseKey || '';
            var lookup = EX_MAP[key];
            var name = (ex.customName && ex.customName.trim()) || (lookup ? lookup.n : key) || key;
            var nff = lookup ? lookup.c : '';
            safeBlocks.push({
              exerciseName: name,
              minutes: parseInt(ex.minutes, 10) || 0,
              nffCategory: nff,
            });
          });
        });
        workoutsByEvent[w.event_id] = {
          theme: (w.theme && THEME_MAP[w.theme]) || w.theme || null,
          totalMinutes: w.duration_minutes || 0,
          learningGoals: [],
          blocks: safeBlocks,
        };
      });
    }

    // 9) Build event response with aggregated attendance
    var events = allEvents.map(function (e) {
      var att = eventAttendance[e.id] || [];
      var confirmed = 0, declined = 0, unknown = 0, myStatus = null;

      att.forEach(function (ep) {
        if (ep.attended === true) confirmed++;
        else if (ep.attended === false) declined++;
        else unknown++;

        if (playerId && ep.player_id === playerId) {
          if (ep.attended === true) myStatus = 'yes';
          else if (ep.attended === false) myStatus = 'no';
          else myStatus = 'maybe';
        }
      });

      var totalPlayers = players.length;
      var notResponded = totalPlayers - confirmed - declined - unknown;

      // Fairness data (only if coach opted in and match is completed)
      var fairness = null;
      if (e.share_fairness && e.status === 'completed') {
        var attendedCount = att.filter(function (ep) { return ep.attended === true; }).length;
        // Count keepers from plan_json would require loading it - skip for now,
        // the coach sets this via share_fairness toggle knowing the context
        fairness = {
          playersParticipated: attendedCount,
        };
      }

      // Workout data (only if coach opted in)
      var workout = null;
      if (e.share_workout && workoutsByEvent[e.id]) {
        workout = workoutsByEvent[e.id];
      }

      return {
        id: e.id,
        type: e.type,
        title: e.title,
        start_time: e.start_time,
        duration_minutes: e.duration_minutes,
        location: e.location,
        opponent: e.opponent,
        is_home: e.is_home,
        format: e.format,
        status: e.status,
        result_home: e.status === 'completed' ? e.result_home : null,
        result_away: e.status === 'completed' ? e.result_away : null,
        parent_message: e.parent_message || null,
        share_comment: e.status === 'completed' ? (e.share_comment || null) : null,
        fairness: fairness,
        workout: workout,
        attendance: {
          confirmed: confirmed,
          declined: declined,
          maybe: unknown,
          not_responded: Math.max(0, notResponded),
          my_status: myStatus,
        },
      };
    });

    // 10) Fetch training series for fixed training info
    var { data: series } = await supabaseAdmin
      .from('training_series')
      .select('day_of_week, start_time, duration_minutes, location')
      .eq('season_id', season.id)
      .eq('user_id', ownerId)
      .limit(3);

    var trainingInfo = null;
    if (series && series.length > 0) {
      var dayNames = ['sondag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lordag'];
      trainingInfo = series.map(function (s) {
        return {
          day: dayNames[s.day_of_week] || '',
          time: s.start_time ? s.start_time.slice(0, 5) : '',
          duration: s.duration_minutes || 60,
          location: s.location || '',
        };
      });
    }

    // 11) NFF info based on age class
    var nff = null;
    if (season.age_class) {
      var ageMatch = season.age_class.match(/(\d+)/);
      var age = ageMatch ? parseInt(ageMatch[1], 10) : null;
      if (age) {
        var duration = 60;
        var ageLabel = '';
        if (age <= 7) { duration = 60; ageLabel = '6-7 år'; }
        else if (age <= 9) { duration = 75; ageLabel = '8-9 år'; }
        else if (age <= 12) { duration = 90; ageLabel = '10-12 år'; }
        else { duration = 90; ageLabel = '13-16 år'; }

        nff = {
          age_class: ageLabel,
          duration: duration,
          description: 'NFF anbefaler variert trening med vekt på ballmestring og spilleglede for ' + ageLabel + '.',
        };
      }
    }

    // 12) Return filtered response
    return res.status(200).json({
      team: { name: team.name },
      season: {
        name: season.name,
        age_class: season.age_class,
        format: season.format,
      },
      players: players,
      events: events,
      training_info: trainingInfo,
      nff: nff,
    });

  } catch (err) {
    console.error('[team-page-read] Unexpected error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
