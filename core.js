// © 2026 Barnefotballtrener.no. All rights reserved.
// Barnefotballtrener - core.js
// ================================================
// Kjernelogikk for appen (spillere, navigasjon, trening, kamp).
// Mål: stabil drift uten "white screen" + robust state (window.players = Array).

(function () {
  'use strict';

  // ------------------------------
  // Safe storage (tåler Tracking Prevention / private mode)
  // ------------------------------
  const _mem = new Map();

  function safeGet(key) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? _mem.get(key) ?? null : v;
    } catch (e) {
      return _mem.get(key) ?? null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      _mem.set(key, value);
    }
  }

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      _mem.delete(key);
    }
  }

  // ------------------------------
  // Keys (per bruker hvis innlogget)
  // ------------------------------
  function getUserKeyPrefix() {
    try {
      const uid = (window.authService && typeof window.authService.getUserId === 'function')
  ? (window.authService.getUserId() || 'anon')
  : 'anon';
      const tid = (state && state.currentTeamId) ? state.currentTeamId : (window._bftTeamId || 'default');
      return `bft:${uid}:${tid}`;
    } catch (e) {
      return 'bft:anon:default';
    }
  }

  function k(suffix) {
    return `${getUserKeyPrefix()}:${suffix}`;
  }

  // ------------------------------
  // Supabase sync (spillere)
  // ------------------------------
  function getSupabaseClient() {
    // window.supabase er Supabase-klienten (satt av auth.js)
    try {
      const sb = window.supabase || window.supabaseClient;
      if (sb && sb.from) return sb;
    } catch (_) {}
    return null;
  }

  function getUserId() {
    try {
      if (window.authService && typeof window.authService.getUserId === 'function') {
        return window.authService.getUserId() || null;
      }
    } catch (_) {}
    return null;
  }

  // Returnerer eierens user_id for nåværende lag (for INSERT-operasjoner)
  function getOwnerUid() {
    var team = state.teams.find(function(t) { return t.id === state.currentTeamId; });
    return (team && team._owner_uid) ? team._owner_uid : getUserId();
  }

  // Er nåværende lag et delt lag (bruker er editor, ikke eier)?
  function isSharedTeam() {
    var team = state.teams.find(function(t) { return t.id === state.currentTeamId; });
    return !!(team && team._isShared);
  }

  // Session flag: skip positions in Supabase calls if column doesn't exist yet
  let _positionsColumnMissing = false;

  async function supabaseLoadPlayers(teamIdOverride, userIdOverride) {
    const sb = getSupabaseClient();
    const uid = userIdOverride || getOwnerUid();
    const tid = teamIdOverride || state.currentTeamId;
    if (!sb || !uid || !tid) return null;

    try {
      const { data, error } = await sb
        .from('players')
        .select('id, name, skill, goalie, active, team_id, positions')
        .eq('user_id', uid)
        .eq('team_id', tid);

      if (error) {
        // If positions column doesn't exist yet, retry without it
        if (error.message && (error.message.includes('positions') || error.code === '42703' || error.message.includes('column'))) {
          console.warn('[core.js] positions column not found, retrying SELECT without it');
          _positionsColumnMissing = true;
          const { data: d2, error: e2 } = await sb
            .from('players')
            .select('id, name, skill, goalie, active, team_id')
            .eq('user_id', uid)
            .eq('team_id', tid);
          if (e2) { console.warn('[core.js] Retry load also failed:', e2.message); return null; }
          return d2 || [];
        }
        console.warn('[core.js] Supabase load feilet:', error.message);
        return null;
      }

      console.log('[core.js] Supabase: hentet', (data || []).length, 'spillere for lag', tid);
      return data || [];
    } catch (e) {
      console.warn('[core.js] Supabase load exception:', e.message);
      return null;
    }
  }

  async function supabaseSavePlayers(players, teamIdOverride, userIdOverride) {
    const sb = getSupabaseClient();
    const uid = userIdOverride || getOwnerUid();
    const tid = teamIdOverride || state.currentTeamId;
    if (!sb || !uid || !tid) return;

    try {
      if (players.length === 0) {
        // Slett alle for dette laget
        await sb.from('players').delete().eq('user_id', uid).eq('team_id', tid);
        return;
      }

      // Upsert alle nåværende spillere (atomisk per rad)
      const baseRow = (p) => ({
        id: p.id,
        user_id: uid,
        team_id: tid,
        name: p.name,
        skill: p.skill,
        goalie: p.goalie,
        active: p.active,
        updated_at: new Date().toISOString()
      });
      const rows = players.map(p => _positionsColumnMissing
        ? baseRow(p)
        : { ...baseRow(p), positions: p.positions || ['F','M','A'] }
      );

      const { error: upsertErr } = await sb
        .from('players')
        .upsert(rows, { onConflict: 'user_id,id' });

      if (upsertErr) {
        console.warn('[core.js] Supabase upsert feilet:', upsertErr.message);
        // If error is likely due to missing positions column, retry without it
        if (!_positionsColumnMissing && upsertErr.message && (upsertErr.message.includes('positions') || upsertErr.code === '42703' || upsertErr.message.includes('column'))) {
          _positionsColumnMissing = true;
          console.warn('[core.js] Retrying upsert without positions field (cached for session)...');
          const rowsNoPos = rows.map(({ positions, ...rest }) => rest);
          const { error: retryErr } = await sb
            .from('players')
            .upsert(rowsNoPos, { onConflict: 'user_id,id' });
          if (retryErr) {
            console.warn('[core.js] Retry also failed:', retryErr.message);
          } else {
            console.log('[core.js] Retry without positions succeeded');
          }
        }
      }
    } catch (e) {
      console.warn('[core.js] Supabase save exception:', e.message);
    }
  }

  // Slett enkeltspiller direkte fra Supabase (kalles ved brukersletting)
  async function supabaseDeletePlayer(playerId) {
    const sb = getSupabaseClient();
    const uid = getOwnerUid();
    const tid = state.currentTeamId;
    if (!sb || !uid || !playerId || !tid) return;

    try {
      await sb.from('players').delete().eq('user_id', uid).eq('team_id', tid).eq('id', playerId);
    } catch (e) {
      console.warn('[core.js] Supabase delete player exception:', e.message);
    }
  }

  // Full erstatning: slett alle + upsert nye. Brukes ved import og clearAll.
  async function supabaseReplaceAllPlayers(players) {
    const sb = getSupabaseClient();
    const uid = getOwnerUid();
    const tid = state.currentTeamId;
    if (!sb || !uid || !tid) return;

    try {
      // Slett alle eksisterende for dette laget
      await sb.from('players').delete().eq('user_id', uid).eq('team_id', tid);

      // Sett inn nye (hvis noen)
      if (players.length > 0) {
        const baseRow = (p) => ({
          id: p.id, user_id: uid, team_id: tid,
          name: p.name, skill: p.skill, goalie: p.goalie, active: p.active,
          updated_at: new Date().toISOString()
        });
        const rows = players.map(p => _positionsColumnMissing
          ? baseRow(p)
          : { ...baseRow(p), positions: p.positions || ['F','M','A'] }
        );
        const { error } = await sb.from('players').insert(rows);
        if (error) {
          console.warn('[core.js] Supabase replace-insert feilet:', error.message);
          if (!_positionsColumnMissing && error.message && (error.message.includes('positions') || error.code === '42703' || error.message.includes('column'))) {
            _positionsColumnMissing = true;
            console.warn('[core.js] Retrying insert without positions field...');
            const rowsNoPos = rows.map(({ positions, ...rest }) => rest);
            const { error: retryErr } = await sb.from('players').insert(rowsNoPos);
            if (retryErr) console.warn('[core.js] Retry also failed:', retryErr.message);
          }
        }
      }
    } catch (e) {
      console.warn('[core.js] Supabase replaceAll exception:', e.message);
    }
  }

  // Debounce: vent 1.5s etter siste endring før Supabase-sync
  let _supabaseSaveTimer = null;
  function debouncedSupabaseSave() {
    clearTimeout(_supabaseSaveTimer);
    // Snapshot nåværende kontekst for å unngå at team-bytte sender til feil lag
    var uidSnap = getOwnerUid();
    var tidSnap = state.currentTeamId;
    var playersSnap = (state.players || []).map(function(p) { return { id: p.id, name: p.name, skill: p.skill, goalie: p.goalie, active: p.active, positions: (p.positions || ['F','M','A']).slice() }; });
    _supabaseSaveTimer = setTimeout(function() {
      supabaseSavePlayers(playersSnap, tidSnap, uidSnap).catch(function(e) {
        console.warn('[core.js] Supabase debounced sync feilet:', e.message);
      });
    }, 1500);
  }

  // ------------------------------
  // Cloud sync: user_data (settings, liga, workouts, competitions)
  // localStorage = cache, Supabase = source of truth
  // ------------------------------
  var _cloudSyncTimers = {};

  async function supabaseLoadAllUserData() {
    var sb = getSupabaseClient();
    var uid = getOwnerUid();
    var tid = state.currentTeamId;
    if (!sb || !uid || uid === 'anon' || !tid || tid === 'default') return null;

    try {
      var result = await sb.from('user_data')
        .select('key, value, updated_at')
        .eq('user_id', uid)
        .eq('team_id', tid);

      if (result.error) {
        console.warn('[core.js] Cloud load feilet:', result.error.message);
        return null;
      }

      return result.data || [];
    } catch (e) {
      console.warn('[core.js] Cloud load feilet:', e.message);
      return null;
    }
  }

  var _personalCloudKeys = { settings: true, workout_draft_v1: true };

  function debouncedCloudSync(key, jsonData) {
    clearTimeout(_cloudSyncTimers[key]);
    // Snapshot kontekst for å unngå feil-lag sync ved team-bytte
    var dataSnap = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
    var tidSnap = state.currentTeamId;
    // Personlige nøkler bruker ekte bruker-uid, delte nøkler bruker eierens uid
    var uidSnap = _personalCloudKeys[key] ? getUserId() : getOwnerUid();
    _cloudSyncTimers[key] = setTimeout(function() {
      if (!uidSnap || uidSnap === 'anon' || !tidSnap || tidSnap === 'default') return;
      try {
        var parsed = JSON.parse(dataSnap);
        var sb = getSupabaseClient();
        if (!sb) return;

        // Hvis data er null/undefined, slett raden (unngår NOT NULL violation)
        if (parsed === null || parsed === undefined) {
          sb.from('user_data').delete()
            .eq('user_id', uidSnap).eq('team_id', tidSnap).eq('key', key)
            .then(function() {}).catch(function() {});
          return;
        }

        sb.from('user_data').upsert({
          user_id: uidSnap,
          team_id: tidSnap,
          key: key,
          value: parsed,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,team_id,key' }).then(function(result) {
          if (result.error) console.warn('[core.js] Cloud sync feilet for', key, ':', result.error.message);
        }).catch(function() {});
      } catch (e) {
        console.warn('[core.js] Cloud sync parse feilet for', key);
      }
    }, 2000);
  }

  // Eksponér for andre moduler (workout.js, competitions.js)
  window._bftCloud = {
    save: function(key, jsonString) { debouncedCloudSync(key, jsonString); },
    loadAll: function() { return supabaseLoadAllUserData(); }
  };

  // ------------------------------
  // Team management (Supabase)
  // ------------------------------
  const MAX_TEAMS = 6;
  const TEAM_COLORS = ['#1976d2', '#d32f2f', '#2e7d32', '#f57c00', '#7b1fa2', '#00838f'];

  function generateTeamId() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var id = 't_';
    for (var i = 0; i < 8; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return id;
  }

  async function loadTeams() {
    var sb = getSupabaseClient();
    var uid = getUserId();
    if (!sb || !uid) return [];

    try {
      // 1. Egne lag
      var result = await sb
        .from('teams')
        .select('id, name, color, created_at, user_id')
        .eq('user_id', uid)
        .order('created_at', { ascending: true });

      if (result.error) {
        console.warn('[core.js] loadTeams feilet:', result.error.message);
        return null;
      }

      var ownTeams = (result.data || []).map(function(t) {
        t._isOwned = true;
        t._isShared = false;
        t._owner_uid = t.user_id;
        return t;
      });

      // 2. Delte lag (der bruker er editor med aktiv status)
      var memberResult = await sb.from('team_members')
        .select('team_id, role')
        .eq('user_id', uid)
        .eq('status', 'active')
        .neq('role', 'owner');

      var sharedTeams = [];
      var sharedTeamIds = (memberResult.data || []).map(function(m) { return m.team_id; });

      if (sharedTeamIds.length > 0) {
        var sharedResult = await sb.from('teams')
          .select('id, name, color, created_at, user_id')
          .in('id', sharedTeamIds);

        if (!sharedResult.error && sharedResult.data) {
          sharedTeams = sharedResult.data.map(function(t) {
            t._isOwned = false;
            t._isShared = true;
            t._owner_uid = t.user_id;
            return t;
          });
        }
      }

      console.log('[core.js] loadTeams: ' + ownTeams.length + ' egne, ' + sharedTeams.length + ' delte');
      return ownTeams.concat(sharedTeams);
    } catch (e) {
      console.warn('[core.js] loadTeams exception:', e.message);
      return null;
    }
  }

  async function createTeam(name, color) {
    var sb = getSupabaseClient();
    var uid = getUserId();
    if (!sb || !uid) return null;

    var ownedCount = state.teams.filter(function(t) { return t._isOwned !== false; }).length;
    if (ownedCount >= MAX_TEAMS) {
      showNotification('Du kan ha maks ' + MAX_TEAMS + ' egne lag.', 'warning');
      return null;
    }

    var team = {
      id: generateTeamId(),
      user_id: uid,
      name: name.trim(),
      color: color || TEAM_COLORS[state.teams.length % TEAM_COLORS.length]
    };

    try {
      var result = await sb.from('teams').insert(team);
      if (result.error) {
        console.warn('[core.js] createTeam feilet:', result.error.message);
        showNotification('Kunne ikke opprette lag.', 'error');
        return null;
      }

      // Opprett team_members owner-rad
      await sb.from('team_members').insert({
        team_id: team.id,
        user_id: uid,
        role: 'owner',
        status: 'active'
      });

      // Sett metadata for team-objektet
      team._isOwned = true;
      team._isShared = false;
      team._owner_uid = uid;

      console.log('[core.js] Opprettet lag:', team.name);
      return team;
    } catch (e) {
      console.warn('[core.js] createTeam exception:', e.message);
      return null;
    }
  }

  async function deleteTeam(teamId) {
    var sb = getSupabaseClient();
    var uid = getUserId();
    if (!sb || !uid || !teamId) return false;

    if (state.teams.length <= 1) {
      showNotification('Du kan ikke slette ditt siste lag.', 'warning');
      return false;
    }

    try {
      // Slett sesongdata FØR laget (seasons.team_id er ikke FK, så ingen CASCADE)
      // Barn av seasons (events, event_players, match_events, season_players, training_series)
      // slettes automatisk via ON DELETE CASCADE fra seasons.
      try {
        var delSeasons = await sb.from('seasons').delete().eq('team_id', teamId).eq('user_id', uid);
        if (delSeasons.error) console.warn('[core.js] deleteTeam seasons cleanup:', delSeasons.error.message);
        else console.log('[core.js] Slettet sesonger for lag', teamId);
      } catch (e) {
        console.warn('[core.js] deleteTeam seasons cleanup exception:', e.message);
      }

      // Spillere slettes automatisk via ON DELETE CASCADE
      var result = await sb.from('teams').delete().eq('id', teamId).eq('user_id', uid);
      if (result.error) {
        console.warn('[core.js] deleteTeam feilet:', result.error.message);
        return false;
      }

      // Slett user_data for dette laget
      try {
        await sb.from('user_data').delete().eq('user_id', uid).eq('team_id', teamId);
      } catch (_) {}

      // Slett team_members for dette laget
      try {
        await sb.from('team_members').delete().eq('team_id', teamId);
      } catch (_) {}

      // Fjern localStorage-data for dette laget
      var prefix = 'bft:' + uid + ':' + teamId + ':';
      try {
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.startsWith(prefix)) keysToRemove.push(key);
        }
        keysToRemove.forEach(function(key) { localStorage.removeItem(key); });
      } catch (_) {}

      console.log('[core.js] Slettet lag:', teamId);
      return true;
    } catch (e) {
      console.warn('[core.js] deleteTeam exception:', e.message);
      return false;
    }
  }

  async function ensureDefaultTeam() {
    // Hvis bruker ikke har noen lag, opprett et standardlag
    // og migrer eksisterende spillere til det
    var sb = getSupabaseClient();
    var uid = getUserId();
    if (!sb || !uid) return;

    var teams = await loadTeams();
    if (teams === null) {
      console.warn('[core.js] ensureDefaultTeam: Avbryter – klarte ikke å laste lag (unngår duplikat standardlag).');
      return;
    }

    // Dedup: Hvis flere lag heter "Mitt lag", behold eldste og migrer spillere
    if (teams.length > 1) {
      var mittLagTeams = teams.filter(function(t) { return t.name === 'Mitt lag'; });
      if (mittLagTeams.length > 1) {
        console.log('[core.js] Fant', mittLagTeams.length, 'duplikat "Mitt lag" - rydder opp...');
        var keep = mittLagTeams[0]; // eldste (sortert by created_at asc)
        var dupes = mittLagTeams.slice(1);
        for (var d = 0; d < dupes.length; d++) {
          try {
            // Flytt spillere fra duplikat til hovedlaget
            await sb.from('players')
              .update({ team_id: keep.id })
              .eq('user_id', uid)
              .eq('team_id', dupes[d].id);
            // Slett duplikatlaget
            await sb.from('teams')
              .delete()
              .eq('id', dupes[d].id)
              .eq('user_id', uid);
            console.log('[core.js] Slettet duplikat "Mitt lag":', dupes[d].id);
          } catch (e) {
            console.warn('[core.js] Dedup feilet for', dupes[d].id, ':', e.message);
          }
        }
        // Fjern duplikatene fra listen
        teams = teams.filter(function(t) {
          return !dupes.some(function(dup) { return dup.id === t.id; });
        });
      }
    }

    if (teams.length > 0) {
      state.teams = teams;
      return;
    }

    // Dobbeltsjekk: last på nytt for å unngå race condition
    var retryTeams = await loadTeams();
    if (retryTeams === null) {
      console.warn('[core.js] ensureDefaultTeam: Retry feilet – avbryter (unngår duplikat standardlag).');
      return;
    }
    if (retryTeams.length > 0) {
      state.teams = retryTeams;
      return;
    }

    // Opprett standardlag
    var team = await createTeam('Mitt lag', '#1976d2');
    if (!team) return;

    // Migrer spillere uten team_id (server-side migration bør ha gjort dette,
    // men som backup migrerer vi klient-side også)
    try {
      var orphans = await sb
        .from('players')
        .select('id')
        .eq('user_id', uid)
        .is('team_id', null);

      if (orphans.data && orphans.data.length > 0) {
        await sb
          .from('players')
          .update({ team_id: team.id })
          .eq('user_id', uid)
          .is('team_id', null);
        console.log('[core.js] Migrerte', orphans.data.length, 'spillere til standardlag');
      }
    } catch (e) {
      console.warn('[core.js] Migrering av spillere feilet:', e.message);
    }

    state.teams = [team];
  }

  function migrateLocalStorageToTeamPrefix() {
    // Engangs: flytt localStorage-data fra gammel prefix (bft:uid:xxx) til ny (bft:uid:teamId:xxx)
    // Dette gjelder settings, liga, workout-data, competitions etc.
    var uid = getUserId();
    var tid = state.currentTeamId;
    if (!uid || uid === 'anon' || !tid || tid === 'default') return;

    var migrationKey = 'bft:' + uid + ':ls_migrated_to_team';
    if (safeGet(migrationKey) === 'true') return;

    var oldPrefix = 'bft:' + uid + ':';
    var newPrefix = 'bft:' + uid + ':' + tid + ':';

    // Nøkler som skal migreres (suffixer)
    var suffixes = [
      'settings', 'liga',
      'exercise_freq_v1', 'parallel', 'single',
      'workout_draft_v1', 'workout_sessions_v1', 'workout_templates_v1',
      'competitions', 'migrated_to_supabase'
    ];

    var migrated = 0;
    suffixes.forEach(function(suffix) {
      var oldKey = oldPrefix + suffix;
      var newKey = newPrefix + suffix;
      var val = safeGet(oldKey);
      if (val !== null && safeGet(newKey) === null) {
        safeSet(newKey, val);
        migrated++;
      }
    });

    if (migrated > 0) {
      console.log('[core.js] Migrerte', migrated, 'localStorage-nøkler til team-prefix');
    }

    safeSet(migrationKey, 'true');
  }

  async function switchTeam(teamId) {
    if (teamId === state.currentTeamId) return;

    // 1. Avbryt pending saves for nåværende lag
    clearTimeout(_supabaseSaveTimer);

    // 2. Lagre nåværende state
    saveState();

    // 3. Bytt lag
    state.currentTeamId = teamId;
    window._bftTeamId = teamId;

    // Lagre valgt lag i bruker-scoped localStorage (ikke team-scoped)
    try {
      var uid = getUserId() || 'anon';
      localStorage.setItem('bft:' + uid + ':activeTeamId', teamId);
    } catch (_) {}

    // 4. Nullstill state
    state.players = [];
    state.liga = null;
    state.selection.grouping = new Set();
    state._localEdited = false;

    // 5. Last inn data for nytt lag
    loadState();

    // 6. Oppdater UI
    renderAll();
    publishPlayers();
    renderTeamSwitcher();

    // 7. Notifiser andre moduler om team-bytte
    try { window.dispatchEvent(new CustomEvent('team:changed', { detail: { teamId: teamId } })); } catch (_) {}

    // 8. Hent spillere fra Supabase for nytt lag
    await loadPlayersFromSupabase();

    // 9. Hent øvrig data (settings, liga, workouts, competitions) fra cloud
    loadCloudUserData();

    console.log('[core.js] Byttet til lag:', teamId);
  }

  function getActiveTeamId() {
    // Prøv å hente sist valgte lag fra localStorage
    try {
      var uid = getUserId() || 'anon';
      return localStorage.getItem('bft:' + uid + ':activeTeamId') || null;
    } catch (_) {
      return null;
    }
  }

  // ------------------------------
  // Team Switcher UI
  var _teamSwitcherOutsideClickAttached = false;

  // ------------------------------
  function renderTeamSwitcher() {
    var container = $('teamSwitcherWrapper');
    if (!container) return;

    var team = state.teams.find(function(t) { return t.id === state.currentTeamId; });
    if (!team) return;

    var playerCount = state.players.length;
    var sharedLabel = team._isShared ? ' · Delt' : '';

    var html = '<button class="team-switcher-btn" id="teamSwitcherBtn" type="button">' +
      '<span class="team-color-dot" style="background:' + escapeHtml(team.color) + '"></span>' +
      '<span class="team-switcher-name">' + escapeHtml(team.name) + sharedLabel + '</span>' +
      '<span class="team-switcher-count">' + playerCount + ' spillere</span>' +
      '<span class="team-switcher-arrow"><i class="fas fa-chevron-down"></i></span>' +
      '</button>';

    html += '<div class="team-dropdown" id="teamDropdown">';

    // Mine lag
    var ownTeams = state.teams.filter(function(t) { return !t._isShared; });
    var sharedTeams = state.teams.filter(function(t) { return t._isShared; });

    if (sharedTeams.length > 0) {
      html += '<div class="team-dropdown-section">Mine lag</div>';
    }

    ownTeams.forEach(function(t) {
      var isActive = t.id === state.currentTeamId;
      html += '<div class="team-dropdown-item' + (isActive ? ' active' : '') + '" data-team-id="' + t.id + '">' +
        '<span class="team-color-dot" style="background:' + escapeHtml(t.color) + '"></span>' +
        '<span class="team-item-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="team-item-actions">' +
          '<button class="team-item-invite" data-team-id="' + t.id + '" title="Inviter trener"><i class="fas fa-user-plus"></i></button>' +
          '<button class="team-item-edit" data-team-id="' + t.id + '" title="Rediger"><i class="fas fa-pen"></i></button>' +
          (ownTeams.length > 1 ? '<button class="team-item-delete" data-team-id="' + t.id + '" title="Slett"><i class="fas fa-trash"></i></button>' : '') +
        '</span>' +
        '<span class="team-item-check">' + (isActive ? '<i class="fas fa-check"></i>' : '') + '</span>' +
        '</div>';
    });

    var ownedCount = ownTeams.length;
    if (ownedCount < MAX_TEAMS) {
      html += '<div class="team-dropdown-add" id="teamDropdownAdd">' +
        '<i class="fas fa-plus"></i>' +
        '<span>Opprett nytt lag</span>' +
        '<span style="margin-left:auto;font-size:12px;color:var(--text-400)">' + ownedCount + ' av ' + MAX_TEAMS + '</span>' +
        '</div>';
    }

    // Delte lag
    if (sharedTeams.length > 0) {
      html += '<div class="team-dropdown-section">Delte lag</div>';
      sharedTeams.forEach(function(t) {
        var isActive = t.id === state.currentTeamId;
        html += '<div class="team-dropdown-item' + (isActive ? ' active' : '') + '" data-team-id="' + t.id + '">' +
          '<span class="team-color-dot" style="background:' + escapeHtml(t.color) + '"></span>' +
          '<span class="team-item-name">' + escapeHtml(t.name) + '</span>' +
          '<span class="team-item-actions">' +
            '<button class="team-item-leave" data-team-id="' + t.id + '" title="Forlat lag"><i class="fas fa-sign-out-alt"></i></button>' +
          '</span>' +
          '<span class="team-item-check">' + (isActive ? '<i class="fas fa-check"></i>' : '') + '</span>' +
          '</div>';
      });
    }

    html += '</div>';
    container.innerHTML = html;

    // Event listeners
    var btn = $('teamSwitcherBtn');
    if (btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var dd = $('teamDropdown');
        if (dd) dd.classList.toggle('show');
        btn.classList.toggle('open');
      });
    }

    // Invite buttons
    container.querySelectorAll('.team-item-invite').forEach(function(invBtn) {
      invBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var tid = invBtn.getAttribute('data-team-id');
        var dd = $('teamDropdown');
        if (dd) dd.classList.remove('show');
        if (btn) btn.classList.remove('open');
        showInviteModal(tid);
      });
    });

    // Edit buttons
    container.querySelectorAll('.team-item-edit').forEach(function(editBtn) {
      editBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var tid = editBtn.getAttribute('data-team-id');
        var dd = $('teamDropdown');
        if (dd) dd.classList.remove('show');
        if (btn) btn.classList.remove('open');
        showEditTeamModal(tid);
      });
    });

    // Delete buttons
    container.querySelectorAll('.team-item-delete').forEach(function(delBtn) {
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var tid = delBtn.getAttribute('data-team-id');
        var dd = $('teamDropdown');
        if (dd) dd.classList.remove('show');
        if (btn) btn.classList.remove('open');
        confirmDeleteTeam(tid);
      });
    });

    // Leave buttons (delte lag)
    container.querySelectorAll('.team-item-leave').forEach(function(leaveBtn) {
      leaveBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var tid = leaveBtn.getAttribute('data-team-id');
        var dd = $('teamDropdown');
        if (dd) dd.classList.remove('show');
        if (btn) btn.classList.remove('open');
        confirmLeaveTeam(tid);
      });
    });

    container.querySelectorAll('.team-dropdown-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        // Ikke bytt lag hvis bruker klikket edit/delete/invite
        if (e.target.closest('.team-item-edit') || e.target.closest('.team-item-delete') || e.target.closest('.team-item-invite')) return;
        var tid = item.getAttribute('data-team-id');
        if (tid && tid !== state.currentTeamId) {
          switchTeam(tid);
        }
        var dd = $('teamDropdown');
        if (dd) dd.classList.remove('show');
        if (btn) btn.classList.remove('open');
      });
    });

    var addBtn = $('teamDropdownAdd');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var dd = $('teamDropdown');
        if (dd) dd.classList.remove('show');
        if (btn) btn.classList.remove('open');
        showNewTeamModal();
      });
    }

    // Lukk dropdown ved klikk utenfor (attach kun én gang)
    if (!_teamSwitcherOutsideClickAttached) {
      _teamSwitcherOutsideClickAttached = true;
      document.addEventListener('click', function(e) {
        var c = $('teamSwitcherWrapper');
        if (!c) return;
        if (!c.contains(e.target)) {
          var dd = $('teamDropdown');
          if (dd) dd.classList.remove('show');
          var b = $('teamSwitcherBtn');
          if (b) b.classList.remove('open');
        }
      });
    }
  }

  function showNewTeamModal() {
    // Fjern eventuell eksisterende modal
    var existing = $('newTeamModal');
    if (existing) existing.remove();

    var usedColors = state.teams.map(function(t) { return t.color; });
    var defaultColor = TEAM_COLORS.find(function(c) { return usedColors.indexOf(c) === -1; }) || TEAM_COLORS[0];
    var ownedCount = state.teams.filter(function(t) { return t._isOwned !== false; }).length;

    var modal = document.createElement('div');
    modal.id = 'newTeamModal';
    modal.className = 'team-modal-overlay';
    modal.innerHTML =
      '<div class="team-modal-box">' +
        '<h3>Opprett nytt lag</h3>' +
        '<p class="team-modal-desc">Hvert lag har sin egen spillerliste, liga og treningshistorikk.</p>' +
        '<label for="newTeamNameInput">Lagnavn</label>' +
        '<input type="text" id="newTeamNameInput" placeholder="F.eks. J11 Steinkjer" maxlength="30">' +
        '<label style="margin-top:14px">Farge</label>' +
        '<div class="team-color-picker">' +
          TEAM_COLORS.map(function(c) {
            return '<div class="team-color-option' + (c === defaultColor ? ' selected' : '') + '" data-color="' + c + '" style="background:' + c + '"></div>';
          }).join('') +
        '</div>' +
        '<div class="team-modal-actions">' +
          '<button class="team-modal-cancel" type="button">Avbryt</button>' +
          '<button class="team-modal-create" type="button">Opprett lag</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var selectedColor = defaultColor;

    // Color picker
    modal.querySelectorAll('.team-color-option').forEach(function(dot) {
      dot.addEventListener('click', function() {
        modal.querySelectorAll('.team-color-option').forEach(function(d) { d.classList.remove('selected'); });
        dot.classList.add('selected');
        selectedColor = dot.getAttribute('data-color');
      });
    });

    // Cancel
    modal.querySelector('.team-modal-cancel').addEventListener('click', function() {
      modal.remove();
    });

    // Create
    modal.querySelector('.team-modal-create').addEventListener('click', async function() {
      var nameInput = $('newTeamNameInput');
      var name = (nameInput.value || '').trim();
      if (!name) {
        nameInput.style.borderColor = 'var(--error)';
        nameInput.focus();
        return;
      }

      var team = await createTeam(name, selectedColor);
      if (team) {
        state.teams.push(team);
        modal.remove();
        switchTeam(team.id);
        showNotification('Lag "' + name + '" opprettet!', 'success');
      }
    });

    // Close on overlay click
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.remove();
    });

    // Focus input
    setTimeout(function() {
      var input = $('newTeamNameInput');
      if (input) input.focus();
    }, 100);
  }

  // Slett lag (kalles fra innstillinger eller kontekstmeny)
  function confirmDeleteTeam(teamId) {
    var team = state.teams.find(function(t) { return t.id === teamId; });
    if (!team) return;

    // Delte lag: bruk "forlat" i stedet
    if (team._isShared) {
      confirmLeaveTeam(teamId);
      return;
    }

    var ownTeams = state.teams.filter(function(t) { return !t._isShared; });
    if (ownTeams.length <= 1) {
      showNotification('Du kan ikke slette ditt siste lag.', 'warning');
      return;
    }

    if (!confirm('Er du sikker på at du vil slette "' + team.name + '"?\n\nAlle spillere, treningsøkter og ligadata for dette laget blir permanent slettet.')) {
      return;
    }

    (async function() {
      var success = await deleteTeam(teamId);
      if (success) {
        state.teams = state.teams.filter(function(t) { return t.id !== teamId; });
        // Hvis slettet lag var aktivt, bytt til neste
        if (teamId === state.currentTeamId) {
          var nextTeam = state.teams[0];
          if (nextTeam) await switchTeam(nextTeam.id);
        } else {
          renderTeamSwitcher();
        }
        showNotification('Laget "' + team.name + '" er slettet.', 'success');
      }
    })();
  }

  // Rediger lag
  function showEditTeamModal(teamId) {
    var team = state.teams.find(function(t) { return t.id === teamId; });
    if (!team) return;

    // Kun eier kan redigere lag
    if (team._isShared) {
      showNotification('Bare lageier kan redigere laget.', 'warning');
      return;
    }

    var existing = $('editTeamModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'editTeamModal';
    modal.className = 'team-modal-overlay';
    modal.innerHTML =
      '<div class="team-modal-box">' +
        '<h3>Rediger lag</h3>' +
        '<label for="editTeamNameInput">Lagnavn</label>' +
        '<input type="text" id="editTeamNameInput" value="' + escapeHtml(team.name) + '" maxlength="30">' +
        '<label style="margin-top:14px">Farge</label>' +
        '<div class="team-color-picker">' +
          TEAM_COLORS.map(function(c) {
            return '<div class="team-color-option' + (c === team.color ? ' selected' : '') + '" data-color="' + c + '" style="background:' + c + '"></div>';
          }).join('') +
        '</div>' +
        '<div class="team-modal-actions">' +
          '<button class="team-modal-cancel" type="button">Avbryt</button>' +
          '<button class="team-modal-create" type="button">Lagre</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var selectedColor = team.color;

    modal.querySelectorAll('.team-color-option').forEach(function(dot) {
      dot.addEventListener('click', function() {
        modal.querySelectorAll('.team-color-option').forEach(function(d) { d.classList.remove('selected'); });
        dot.classList.add('selected');
        selectedColor = dot.getAttribute('data-color');
      });
    });

    modal.querySelector('.team-modal-cancel').addEventListener('click', function() {
      modal.remove();
    });

    modal.querySelector('.team-modal-create').addEventListener('click', async function() {
      var nameInput = $('editTeamNameInput');
      var newName = (nameInput.value || '').trim();
      if (!newName) {
        nameInput.style.borderColor = 'var(--error)';
        nameInput.focus();
        return;
      }

      var sb = getSupabaseClient();
      var uid = getUserId();
      if (!sb || !uid) { modal.remove(); return; }

      try {
        var updateData = { name: newName, color: selectedColor };
        var result = await sb.from('teams').update(updateData).eq('id', teamId).eq('user_id', uid);
        if (result.error) {
          console.warn('[core.js] Oppdatering av lag feilet:', result.error.message);
          showNotification('Kunne ikke oppdatere laget.', 'error');
          return;
        }

        // Oppdater lokal state
        team.name = newName;
        team.color = selectedColor;
        modal.remove();
        renderTeamSwitcher();
        showNotification('Laget er oppdatert.', 'success');
      } catch (e) {
        console.warn('[core.js] Oppdatering av lag feilet:', e.message);
        showNotification('Kunne ikke oppdatere laget.', 'error');
      }
    });

    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.remove();
    });

    setTimeout(function() {
      var input = $('editTeamNameInput');
      if (input) { input.focus(); input.select(); }
    }, 100);
  }
  window.deleteCurrentTeam = function() {
    confirmDeleteTeam(state.currentTeamId);
  };

  // Forlat delt lag
  function confirmLeaveTeam(teamId) {
    var team = state.teams.find(function(t) { return t.id === teamId; });
    if (!team || !team._isShared) return;

    if (!confirm('Vil du forlate "' + team.name + '"?\n\nDu mister tilgang til laget, men data forblir intakt.')) {
      return;
    }

    (async function() {
      var sb = getSupabaseClient();
      var uid = getUserId();
      if (!sb || !uid) return;

      try {
        var res = await sb.from('team_members').delete()
          .eq('team_id', teamId)
          .eq('user_id', uid);

        if (res.error) {
          console.warn('[core.js] leaveTeam feilet:', res.error.message);
          showNotification('Kunne ikke forlate laget.', 'error');
          return;
        }

        state.teams = state.teams.filter(function(t) { return t.id !== teamId; });
        if (teamId === state.currentTeamId && state.teams.length > 0) {
          await switchTeam(state.teams[0].id);
        } else {
          renderTeamSwitcher();
        }
        showNotification('Du har forlatt "' + team.name + '".', 'success');
      } catch (e) {
        console.warn('[core.js] leaveTeam exception:', e.message);
      }
    })();
  }

  // Inviter trener-modal
  function showInviteModal(teamId) {
    var team = state.teams.find(function(t) { return t.id === teamId; });
    if (!team || team._isShared) return;

    var existing = $('inviteModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'inviteModal';
    modal.className = 'team-modal-overlay';
    modal.innerHTML =
      '<div class="team-modal-box">' +
        '<h3>Inviter trener</h3>' +
        '<p style="font-size:13px;color:var(--text-400);margin:0 0 14px">Treneren må ha en konto på barnefotballtrener.no. Skriv inn e-postadressen de brukte ved registrering.</p>' +
        '<label for="inviteEmailInput">E-post</label>' +
        '<input type="email" id="inviteEmailInput" placeholder="trener@eksempel.no" autocomplete="email">' +
        '<div id="inviteError" style="color:var(--error);font-size:13px;margin-top:6px;display:none"></div>' +
        '<div class="team-modal-actions">' +
          '<button class="team-modal-cancel" type="button">Avbryt</button>' +
          '<button class="team-modal-create" type="button" id="inviteSendBtn">Send invitasjon</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    modal.querySelector('.team-modal-cancel').addEventListener('click', function() {
      modal.remove();
    });

    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.remove();
    });

    var sendBtn = $('inviteSendBtn');
    sendBtn.addEventListener('click', async function() {
      var emailInput = $('inviteEmailInput');
      var errorDiv = $('inviteError');
      var email = (emailInput.value || '').trim().toLowerCase();

      errorDiv.style.display = 'none';

      if (!email || !email.includes('@')) {
        emailInput.style.borderColor = 'var(--error)';
        emailInput.focus();
        return;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = 'Sender...';

      try {
        var sb = getSupabaseClient();
        if (!sb) throw new Error('Ikke innlogget');

        var session = await sb.auth.getSession();
        var token = session.data.session ? session.data.session.access_token : null;
        if (!token) throw new Error('Ingen sesjon');

        var response = await fetch('/api/invite-coach', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify({ team_id: teamId, email: email }),
        });

        var result = await response.json();

        if (!response.ok) {
          errorDiv.textContent = result.error || 'Noe gikk galt';
          errorDiv.style.display = 'block';
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send invitasjon';
          return;
        }

        modal.remove();
        showNotification('Invitasjon sendt til ' + email + '. Treneren ser invitasjonen neste gang de logger inn.', 'success');
      } catch (e) {
        errorDiv.textContent = e.message || 'Noe gikk galt';
        errorDiv.style.display = 'block';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send invitasjon';
      }
    });

    setTimeout(function() {
      var input = $('inviteEmailInput');
      if (input) input.focus();
    }, 100);
  }


  async function migrateLocalToSupabase(teamIdOverride, userIdOverride) {
    // Engangs: flytt localStorage-spillere til Supabase hvis Supabase er tom for dette laget
    const sb = getSupabaseClient();
    const uid = userIdOverride || getUserId();
    const tid = teamIdOverride || state.currentTeamId;
    if (!sb || !uid || !tid) return;

    // Bruk eksplisitt prefix (unngå avhengighet av state under async)
    var prefixSnap = 'bft:' + uid + ':' + tid;
    var migratedKey = prefixSnap + ':migrated_to_supabase';
    var playersKey = prefixSnap + ':players';

    // Allerede migrert?
    if (safeGet(migratedKey) === 'true') return;

    const localRaw = safeGet(playersKey);
    if (!localRaw) return; // ingenting lokalt å migrere

    let localPlayers;
    try {
      const parsed = JSON.parse(localRaw);
      if (Array.isArray(parsed)) localPlayers = normalizePlayers(parsed);
      else if (parsed && Array.isArray(parsed.players)) localPlayers = normalizePlayers(parsed.players);
      else return;
    } catch (_) { return; }

    if (localPlayers.length === 0) return;

    // Sjekk om Supabase allerede har data
    try {
      const { data } = await sb
        .from('players')
        .select('id')
        .eq('user_id', uid)
        .eq('team_id', tid)
        .limit(1);

      if (data && data.length > 0) {
        console.log('[core.js] Supabase har allerede spillere, skipper migrering');
        return;
      }
    } catch (_) { return; }

    // Migrer
    console.log('[core.js] Migrerer', localPlayers.length, 'spillere fra localStorage til Supabase');
    await supabaseSavePlayers(localPlayers, tid, uid);

    // Marker som migrert
    safeSet(migratedKey, 'true');
  }

  // ------------------------------
  // State
  // ------------------------------
  const state = {
    players: [],
    settings: {
      useSkill: true
    },
    selection: {
      grouping: new Set()
    },
    liga: null,
    teams: [],
    currentTeamId: null,
    currentGroups: null   // cached for drag-drop editing
  };

  // Expose for other modules (kampdag.js)
  function publishPlayers() {
    window.players = state.players; // MUST be an Array
    console.log('[core.js] publishPlayers: Setting window.players to', state.players.length, 'spillere');
    window.dispatchEvent(new CustomEvent('players:updated', { detail: { count: state.players.length } }));
    console.log('[core.js] publishPlayers: Event sendt');
  }

  // ------------------------------
  // Helpers
  // ------------------------------
  function $(id) { return document.getElementById(id); }

  function showNotification(message, type = 'info') {
    const el = $('notification');
    if (!el) return;

    el.textContent = message;
    el.className = `notification ${type}`;
    el.style.display = 'block';

    clearTimeout(showNotification._t);
    showNotification._t = setTimeout(() => {
      el.style.display = 'none';
    }, 2600);
  }

  // make available globally (auth-ui.js uses it)
  window.showNotification = window.showNotification || showNotification;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function uuid() {
    // Small, collision-safe enough for local use
    return 'p_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function normalizePlayers(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    const seen = new Set();
    for (const p of input) {
      if (!p) continue;
      const id = String(p.id || uuid());
      if (seen.has(id)) continue;
      seen.add(id);

      const name = String(p.name || '').trim();
      if (!name) continue;

      let skill = Number(p.skill ?? 3);
      if (!Number.isFinite(skill)) skill = 3;
      skill = Math.max(1, Math.min(6, Math.round(skill)));

      const validPos = Array.isArray(p.positions) ? p.positions.filter(z => ['F','M','A'].includes(z)) : [];
      out.push({
        id,
        name,
        skill,
        goalie: Boolean(p.goalie),
        active: p.active === false ? false : true,
        positions: validPos.length > 0 ? validPos : ['F','M','A']
      });
    }
    return out;
  }

  function loadState() {
    // settings (alltid fra localStorage - små data)
    const s = safeGet(k('settings'));
    if (s) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed?.useSkill === 'boolean') state.settings.useSkill = parsed.useSkill;
      } catch {}
    }

    // players — last fra localStorage som rask fallback (synkron)
    const p = safeGet(k('players'));
    if (p) {
      try {
        const parsed = JSON.parse(p);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.players)) {
          state.players = normalizePlayers(parsed.players);
        } else if (Array.isArray(parsed)) {
          state.players = normalizePlayers(parsed);
        } else {
          state.players = [];
        }
      } catch (e) {
        console.error('[core.js] loadState: localStorage parse feil:', e);
        state.players = [];
      }
    } else {
      state.players = [];
    }
    console.log('[core.js] loadState: localStorage ga', state.players.length, 'spillere');

    // liga (alltid fra localStorage)
    const l = safeGet(k('liga'));
    if (l) {
      try { state.liga = JSON.parse(l); } catch { state.liga = null; }
    } else {
      state.liga = null;
    }

    // selections
    state.selection.grouping = new Set();
  }

  // Asynkron Supabase-lasting - kalles etter initApp for å oppdatere med server-data
  async function loadPlayersFromSupabase() {
    try {
      // Snapshot kontekst for å detektere team-bytte under async operasjoner
      var uidSnap = getUserId();
      var tidSnap = state.currentTeamId;
      var playersKeySnap = k('players');

      // Prøv migrering først (engangs, hvis localStorage har data og Supabase er tom)
      await migrateLocalToSupabase(tidSnap, uidSnap);

      // Hvis team/user endret mens vi ventet, avbryt
      if (getUserId() !== uidSnap || state.currentTeamId !== tidSnap) return;

      // Hvis bruker allerede har redigert, ikke overskriv med server-data
      if (state._localEdited) {
        console.log('[core.js] Bruker har redigert lokalt, skipper Supabase-oppdatering');
        return;
      }

      const sbPlayers = await supabaseLoadPlayers(tidSnap, uidSnap);
      if (sbPlayers === null) {
        console.log('[core.js] Supabase utilgjengelig, bruker localStorage');
        return;
      }

      // Hvis team/user endret mens vi ventet, avbryt
      if (getUserId() !== uidSnap || state.currentTeamId !== tidSnap) return;

      // Sjekk igjen etter async-operasjonen (bruker kan ha redigert mens vi ventet)
      if (state._localEdited) return;

      if (sbPlayers.length === 0 && state.players.length > 0) {
        console.log('[core.js] Supabase tom, syncer', state.players.length, 'spillere opp');
        await supabaseSavePlayers(state.players, tidSnap, uidSnap);
        return;
      }

      if (sbPlayers.length > 0) {
        // Siste sjekk før vi overskriver state
        if (getUserId() !== uidSnap || state.currentTeamId !== tidSnap) return;

        state.players = normalizePlayers(sbPlayers);
        safeSet(playersKeySnap, JSON.stringify(state.players));
        console.log('[core.js] Supabase: bruker', state.players.length, 'spillere som source of truth');

        state.selection.grouping = new Set(state.players.map(p => p.id));
        renderAll();
        publishPlayers();
        renderTeamSwitcher();
      }
    } catch (e) {
      console.warn('[core.js] loadPlayersFromSupabase feilet:', e.message);
    }
  }

  // Last settings/liga fra cloud (Supabase user_data)
  async function loadCloudUserData() {
    try {
      var tid = state.currentTeamId; // snapshot FØR async
      var rows = await supabaseLoadAllUserData();

      // null = feil/utilgjengelig → ikke gjør noe
      if (rows === null) return;

      // Sjekk at vi fortsatt er på samme lag
      if (state.currentTeamId !== tid) return;

      if (rows.length === 0) {
        // Cloud er tom → bootstrap: push lokal data opp (bare for egne lag)
        if (!isSharedTeam()) bootstrapCloudFromLocal();
        return;
      }

      rows.forEach(function(row) {
        if (state.currentTeamId !== tid) return; // lag byttet under async

        if (row.key === 'settings' && row.value) {
          try {
            if (typeof row.value.useSkill === 'boolean') {
              state.settings.useSkill = row.value.useSkill;
              safeSet(k('settings'), JSON.stringify(state.settings));
            }
          } catch (_) {}
        }

        if (row.key === 'liga' && row.value) {
          try {
            state.liga = row.value;
            safeSet(k('liga'), JSON.stringify(state.liga));
          } catch (_) {}
        }
      });

      if (state.currentTeamId === tid) {
        renderAll();
        console.log('[core.js] Cloud data lastet (settings, liga)');
      }
    } catch (e) {
      console.warn('[core.js] loadCloudUserData feilet:', e.message);
    }
  }

  function bootstrapCloudFromLocal() {
    // Engangs: push eksisterende lokal data til cloud (settings, liga)
    // Kalles kun når user_data er tom for dette laget
    var settingsRaw = safeGet(k('settings'));
    if (settingsRaw) debouncedCloudSync('settings', settingsRaw);

    var ligaRaw = safeGet(k('liga'));
    if (ligaRaw) debouncedCloudSync('liga', ligaRaw);

    console.log('[core.js] Bootstrap: pusher lokal data til cloud');
  }

  function saveState() {
    safeSet(k('settings'), JSON.stringify(state.settings));
    safeSet(k('players'), JSON.stringify(state.players));
    safeSet(k('liga'), JSON.stringify(state.liga));

    // Marker at bruker har gjort endringer (brukes av loadPlayersFromSupabase)
    state._localEdited = true;

    // Debounced sync til Supabase (venter 1.5s etter siste endring)
    debouncedSupabaseSave();

    // Cloud sync for settings og liga
    debouncedCloudSync('settings', JSON.stringify(state.settings));
    debouncedCloudSync('liga', JSON.stringify(state.liga));
  }

  // ------------------------------
  // Rendering
  // ------------------------------
  function updateStats() {
    const total = state.players.length;
    const goalies = state.players.filter(p => p.goalie).length;
    const active = state.players.filter(p => p.active).length;

    const t = $('totalPlayers'); if (t) t.textContent = String(total);
    const g = $('totalGoalies'); if (g) g.textContent = String(goalies);
    const a = $('playerCount'); if (a) a.textContent = String(active);
  }

  function renderPlayerList() {
    const container = $('playerList');
    if (!container) return;

    const sorted = [...state.players].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    container.innerHTML = sorted.map(p => {
      const pos = p.positions || ['F','M','A'];
      return `
        <div class="player-card" data-id="${escapeHtml(p.id)}">
          <div class="player-info">
            <div class="player-name">${escapeHtml(p.name)}</div>
            <div class="player-tags">${state.settings.useSkill ? `<span class="tag">Nivå ${p.skill}</span>` : ''}${p.goalie ? `<span class="tag">🧤</span>` : `<span class="tag">⚽</span>`}</div>
          </div>
          <div class="player-positions" title="Posisjoner (kampdag)">
            <button type="button" class="pos-btn${pos.includes('F') ? ' pos-f-on' : ''}" data-zone="F">F</button>
            <button type="button" class="pos-btn${pos.includes('M') ? ' pos-m-on' : ''}" data-zone="M">M</button>
            <button type="button" class="pos-btn${pos.includes('A') ? ' pos-a-on' : ''}" data-zone="A">A</button>
          </div>
          <button class="icon-btn edit" type="button" title="Rediger">✏️</button>
          <button class="icon-btn delete" type="button" title="Slett">🗑️</button>
        </div>
      `;
    }).join('');

    // bind events
    container.querySelectorAll('.player-card').forEach(card => {
      const id = card.getAttribute('data-id');
      const p = state.players.find(x => x.id === id);
      if (!p) return;

      // Ensure player is always active (active toggle removed from UI)
      if (!p.active) { p.active = true; saveState(); }

      // Position preference buttons (F/M/A)
      card.querySelectorAll('.pos-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const zone = btn.getAttribute('data-zone');
          let pos = p.positions || ['F','M','A'];
          if (pos.includes(zone)) {
            pos = pos.filter(z => z !== zone);
          } else {
            pos = [...new Set([...pos, zone])];
          }
          // Can't have zero positions - reset to all
          if (pos.length === 0) pos = ['F','M','A'];
          p.positions = pos;
          // Update ALL button visuals in this card (not just clicked one)
          card.querySelectorAll('.pos-btn').forEach(b => {
            const z = b.getAttribute('data-zone');
            const cls = { F: 'pos-f-on', M: 'pos-m-on', A: 'pos-a-on' }[z];
            b.classList.toggle(cls, pos.includes(z));
          });
          saveState();
          publishPlayers();
        });
      });

      const editBtn = card.querySelector('button.edit');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          const newName = window.prompt('Nytt navn:', p.name);
          if (newName === null) return;
          const name = String(newName).trim();
          
          // PRIVACY COMPLIANCE: Validate player name length (max 50 chars)
          if (!name) return showNotification('Navn kan ikke være tomt', 'error');
          if (name.length > 50) {
            return showNotification('Spillernavn må være maks 50 tegn (kun fornavn anbefales)', 'error');
          }
          
          // PRIVACY WARNING: Alert if name contains space (might be full name)
          if (name.includes(' ') && !p.name.includes(' ')) {
            // Only warn if adding space (not if already had space)
            const confirmed = window.confirm(
              '⚠️ PERSONVERN-ADVARSEL:\n\n' +
              'Navnet inneholder mellomrom og kan være et fullt navn.\n\n' +
              'For å beskytte barns personvern bør du KUN bruke fornavn.\n\n' +
              'Vil du fortsette likevel?'
            );
            if (!confirmed) {
              return;
            }
          }

          let skill = p.skill;
          if (state.settings.useSkill) {
            const newSkill = window.prompt('Ferdighetsnivå (1–6):', String(p.skill));
            if (newSkill === null) return;
            const v = Number(newSkill);
            if (Number.isFinite(v)) skill = Math.max(1, Math.min(6, Math.round(v)));
          }

          const goalie = window.confirm('Skal spilleren kunne stå i mål? (OK = ja, Avbryt = nei)');

          const oldName = p.name;
          p.name = name;
          p.skill = skill;
          p.goalie = goalie;

          saveState();
          publishPlayers();
          renderAll();
          showNotification('Spiller oppdatert', 'success');

          // Dispatch rename event so season module can sync denormalized names
          if (oldName !== name) {
            window.dispatchEvent(new CustomEvent('player:renamed', {
              detail: { playerId: p.id, newName: name, oldName: oldName }
            }));
          }
        });
      }

      const delBtn = card.querySelector('button.delete');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          const ok = window.confirm(`Slette "${p.name}"?`);
          if (!ok) return;
          state.players = state.players.filter(x => x.id !== id);
          // remove from selections
          state.selection.grouping.delete(id);

          saveState();
          // Slett direkte fra Supabase (ikke vent på debounce)
          clearTimeout(_supabaseSaveTimer); // unngå redundant debounce-upsert
          supabaseDeletePlayer(id);
          renderAll();
          publishPlayers();
          showNotification('Spiller slettet', 'info');
        });
      }
    });
  }

  function renderSelections() {
    const groupingEl = $('groupingSelection');

    // only active players selectable
    const selectable = state.players.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    const _pcColors = ['#93c5fd','#a5b4fc','#f9a8d4','#fcd34d','#6ee7b7','#fca5a5','#67e8f9','#c4b5fd','#f0abfc','#5eead4','#fdba74','#bef264','#fb7185','#7dd3fc','#d8b4fe','#86efac','#fed7aa','#99f6e4'];

    if (groupingEl) {
      groupingEl.innerHTML = selectable.map((p, i) => `
        <label class="player-checkbox" style="--pc-color:${_pcColors[i % _pcColors.length]}">
          <input type="checkbox" data-id="${escapeHtml(p.id)}" ${state.selection.grouping.has(p.id) ? 'checked' : ''}>
          <div class="pc-avatar">${escapeHtml((p.name || '?').charAt(0).toUpperCase())}</div>
          <div class="pc-info">
            <div class="player-name">${escapeHtml(p.name)}</div>
            ${p.goalie ? '<span class="pc-keeper">🧤 Keeper</span>' : ''}
          </div>
          <div class="pc-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        </label>
      `).join('');

      groupingEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.getAttribute('data-id');
          if (!id) return;
          if (cb.checked) state.selection.grouping.add(id);
          else state.selection.grouping.delete(id);
          const c = $('groupingPlayerCount'); if (c) c.textContent = String(state.selection.grouping.size);
        });
      });

      const c = $('groupingPlayerCount'); if (c) c.textContent = String(state.selection.grouping.size);
    }
  }

  function renderLogo() {
    const el = $('logoContainer');
    if (!el) return;
    el.innerHTML = `
  <div class="app-title">
    <img src="apple-touch-icon.png" alt="Barnefotballtrener logo" class="app-logo" />
    <div class="app-name">Barnefotballtrener</div>
  </div>
`;

  }

  function renderAll() {
    updateStats();
    renderPlayerList();
    renderSelections();
  }

  // ------------------------------
  // Training / Match algorithms
  // ------------------------------
  function getSelectedPlayers(set) {
    const ids = new Set(set);
    return state.players.filter(p => p.active && ids.has(p.id));
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sortBySkillWithRandomTies(players) {
    // Sort by skill descending, but shuffle within the same skill so repeated clicks give variation
    const buckets = new Map();
    for (const p of players) {
      const k = Number(p.skill) || 0;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    const skills = Array.from(buckets.keys()).sort((a, b) => b - a);
    const out = [];
    for (const s of skills) {
      out.push(...shuffle(buckets.get(s)));
    }
    return out;
  }

  function makeBalancedGroups(players, groupCount) {
    if (window.Grouping && typeof window.Grouping.makeBalancedGroups === 'function') {
      return window.Grouping.makeBalancedGroups(players, groupCount, state.settings.useSkill);
    }

    const n = Math.max(2, Math.min(6, Number(groupCount) || 2));
    let list = players;

    if (state.settings.useSkill) {
      list = sortBySkillWithRandomTies(players);
    } else {
      list = shuffle(players);
    }

    const groups = Array.from({ length: n }, () => []);
    const perm = shuffle(Array.from({ length: n }, (_, i) => i));
    let dir = 1;
    let idx = 0;
    for (const p of list) {
      groups[perm[idx]].push(p);
      idx += dir;
      if (idx === n) { dir = -1; idx = n - 1; }
      if (idx === -1) { dir = 1; idx = 0; }
    }
    return groups;
  }

  // Differensiering: "beste sammen, neste beste sammen ..."
  // Krever ferdighetsnivå aktivert for å gi mening.
  function makeDifferentiatedGroups(players, groupCount) {
    if (window.Grouping && typeof window.Grouping.makeDifferentiatedGroups === 'function') {
      return window.Grouping.makeDifferentiatedGroups(players, groupCount, state.settings.useSkill);
    }

    const n = Math.max(2, Math.min(6, Number(groupCount) || 2));
    if (!state.settings.useSkill) {
      return null; // håndteres i UI
    }

    const list = sortBySkillWithRandomTies(players);
    const total = list.length;

    const base = Math.floor(total / n);
    const extra = total % n;
    const indices = Array.from({ length: n }, (_, i) => i);
    const shuffledIndices = shuffle(indices);
    const bonusSet = new Set(shuffledIndices.slice(0, extra));
    const sizes = Array.from({ length: n }, (_, i) => base + (bonusSet.has(i) ? 1 : 0));

    const groups = [];
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const size = sizes[i];
      groups.push(list.slice(cursor, cursor + size));
      cursor += size;
    }
    return groups;
  }

  // Generisk "jevne lag" for 2..6 lag. Snake-draft med randomisert start + myk keeper-korreksjon.
  function makeEvenTeams(players, teamCount) {
    if (window.Grouping && typeof window.Grouping.makeEvenTeams === 'function') {
      return window.Grouping.makeEvenTeams(players, teamCount, state.settings.useSkill);
    }

    const n = Math.max(2, Math.min(6, Number(teamCount) || 2));

    let list = players;
    if (state.settings.useSkill) {
      list = sortBySkillWithRandomTies(players);
    } else {
      list = shuffle(players);
    }

    const teams = Array.from({ length: n }, () => ({ players: [], sum: 0 }));

    // Snake draft med permutasjon for variasjon
    const perm = shuffle(Array.from({ length: n }, (_, i) => i));
    let dir = 1;
    let idx2 = 0;
    for (const p of list) {
      const t = teams[perm[idx2]];
      t.players.push(p);
      t.sum += (p.skill || 0);

      idx2 += dir;
      if (idx2 === n) { dir = -1; idx2 = n - 1; }
      if (idx2 === -1) { dir = 1; idx2 = 0; }
    }

    // Post-draft keeper-korreksjon
    const totalKeepers = list.filter(p => p.goalie).length;
    if (totalKeepers > 0 && totalKeepers < list.length) {
      for (let attempt = 0; attempt < n; attempt++) {
        const noKeeper = teams.findIndex(t => t.players.length > 0 && !t.players.some(p => p.goalie));
        if (noKeeper === -1) break;
        const multiKeeper = teams.findIndex(t => t.players.filter(p => p.goalie).length >= 2);
        if (multiKeeper === -1) break;
        const keeperIdx = teams[multiKeeper].players.findIndex(p => p.goalie);
        const fieldIdx = teams[noKeeper].players.findIndex(p => !p.goalie);
        if (keeperIdx === -1 || fieldIdx === -1) break;
        const keeper = teams[multiKeeper].players[keeperIdx];
        const field = teams[noKeeper].players[fieldIdx];
        teams[multiKeeper].players[keeperIdx] = field;
        teams[noKeeper].players[fieldIdx] = keeper;
        teams[multiKeeper].sum += (field.skill || 0) - (keeper.skill || 0);
        teams[noKeeper].sum += (keeper.skill || 0) - (field.skill || 0);
      }
    }

    return { teams, teamCount: n };
  }

  // (Old render functions removed - replaced by renderGroupingResults)

  // ------------------------------
  // UI wiring
  // ------------------------------
  function setupTabs() {
    // Nordic Pitch Steg 2: Bunnmeny + "Mer" popup
    // Robust mobil-håndtering for iOS/Safari
    // Mål: ingen "tomt felt" øverst i Liga eller andre faner

    function toggleMerPopup() {
      const popup = document.getElementById('merPopup');
      if (!popup) return;
      popup.style.display = (popup.style.display === 'none' || !popup.style.display) ? 'block' : 'none';
    }

    function closeMerPopup() {
      const popup = document.getElementById('merPopup');
      if (!popup) return;
      popup.style.display = 'none';
    }

    function switchTab(tabId) {
      if (!tabId) return;

      // STEG 0: Sidetittel
      const titleMap = {
        players: 'Spillere',
        grouping: 'Gruppeinndeling',
        kampdag: 'Kampdag',
        competitions: 'Konkurranse',
        liga: 'Liga',
        workout: 'Treningsøkt',
        sesong: 'Sesong'
      };
      const titleEl = document.getElementById('pageTitleText');
      if (titleEl && titleMap[tabId]) titleEl.textContent = titleMap[tabId];

      // STEG 1: Fjern active fra alle nav-knapper (bunnmeny + mer-items)
      document.querySelectorAll('#bottomNav .bottom-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.mer-item').forEach(b => b.classList.remove('active'));

      // STEG 2: Skjul alle tabs
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.style.display = 'none';
        c.style.visibility = 'hidden';
        c.style.position = 'absolute';
        c.style.left = '-99999px';
      });

      // STEG 3: Aktiver riktig nav-knapp
      const navBtn = document.querySelector(`.bottom-nav-btn[data-tab="${tabId}"]`);
      if (navBtn) {
        navBtn.classList.add('active');
      } else {
        // Tab er under "Mer" – aktiver Mer-knappen + riktig mer-item
        const merBtn = document.getElementById('merBtn');
        if (merBtn) merBtn.classList.add('active');
        const merItem = document.querySelector(`.mer-item[data-tab="${tabId}"]`);
        if (merItem) merItem.classList.add('active');
      }

      // STEG 4: Vis valgt tab
      const content = document.getElementById(tabId);
      if (content) {
        content.classList.add('active');
        content.style.display = 'block';
        content.style.visibility = 'visible';
        content.style.position = 'relative';
        content.style.left = 'auto';
      }

      // Keep selections fresh (som i original nav-kode)
      if (typeof renderSelections === 'function') renderSelections();
      if (typeof publishPlayers === 'function') publishPlayers();

      // STEG 5: Toggle sesong-bunnmeny
      var bottomNav = document.getElementById('bottomNav');
      var seasonNav = document.getElementById('seasonNav');
      if (tabId === 'sesong') {
        if (bottomNav) bottomNav.style.display = 'none';
        if (seasonNav) seasonNav.style.display = '';
        // Notify season module to sync nav state
        try { window.dispatchEvent(new Event('season:nav-sync')); } catch(_) {}
      } else {
        if (seasonNav) seasonNav.style.display = 'none';
        if (bottomNav) bottomNav.style.display = '';
      }

      // STEG 6: Lukk Mer-popup
      closeMerPopup();

      // STEG 7: Scroll til topp + blur (iOS/Safari fix)
      try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch (_) {}

      const scroller = document.scrollingElement || document.documentElement;
      try {
        scroller.scrollTop = 0;
        scroller.scrollLeft = 0;
      } catch (_) {}

      try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (_) {
        try { window.scrollTo(0, 0); } catch (_) {}
      }

      // Debug logging (kun på debug-hosts)
      if (window.__BF_IS_DEBUG_HOST && tabId === 'liga') {
        console.log('[LIGA DEBUG] Bytte til Liga-fanen');
        console.log('[LIGA DEBUG] window.scrollY:', window.scrollY);
        console.log('[LIGA DEBUG] document.scrollingElement.scrollTop:', scroller.scrollTop);

        const allTabs = document.querySelectorAll('.tab-content');
        const activeTabs = document.querySelectorAll('.tab-content.active');
        console.log('[LIGA DEBUG] Totalt tabs:', allTabs.length);
        console.log('[LIGA DEBUG] Active tabs:', activeTabs.length);
        activeTabs.forEach((t, i) => {
          console.log(`[LIGA DEBUG] Active tab ${i}:`, t.id, t.className);
        });

        setTimeout(() => {
          const ligaEl = document.getElementById('liga');
          if (ligaEl) {
            const rect = ligaEl.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(ligaEl);

            console.log('[LIGA DEBUG] Liga element:', {
              exists: true,
              hasActiveClass: ligaEl.classList.contains('active'),
              display: computedStyle.display,
              visibility: computedStyle.visibility,
              opacity: computedStyle.opacity,
              height: computedStyle.height,
              paddingTop: computedStyle.paddingTop,
              marginTop: computedStyle.marginTop
            });

            console.log('[LIGA DEBUG] Liga bounding rect:', {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              bottom: rect.bottom,
              right: rect.right
            });

            const firstChild = ligaEl.firstElementChild;
            if (firstChild) {
              const childRect = firstChild.getBoundingClientRect();
              const childStyle = window.getComputedStyle(firstChild);
              console.log('[LIGA DEBUG] Første child:', {
                tagName: firstChild.tagName,
                className: firstChild.className,
                display: childStyle.display,
                visibility: childStyle.visibility,
                height: childStyle.height,
                top: childRect.top
              });
            }

            console.log('[LIGA DEBUG] Antall children:', ligaEl.children.length);

            const allTabsNow = document.querySelectorAll('.tab-content');
            console.log('[LIGA DEBUG] Sjekker alle tabs...');
            allTabsNow.forEach((tabEl, idx) => {
              const tRect = tabEl.getBoundingClientRect();
              const tStyle = window.getComputedStyle(tabEl);
              console.log(`[LIGA DEBUG] Tab ${idx} "${tabEl.id}":`, {
                height: tRect.height,
                top: tRect.top,
                display: tStyle.display,
                position: tStyle.position,
                hasActive: tabEl.classList.contains('active')
              });
              if (tabEl.id !== 'liga' && tRect.height > 0) {
                console.log(`[LIGA DEBUG] ⚠️ TAB "${tabEl.id}" tar plass (${tRect.height}px) og er over Liga!`);
              }
            });

            const main = ligaEl.parentElement;
            if (main) {
              const mainRect = main.getBoundingClientRect();
              const mainStyle = window.getComputedStyle(main);
              console.log('[LIGA DEBUG] Parent container (<main>):', {
                tagName: main.tagName,
                top: mainRect.top,
                paddingTop: mainStyle.paddingTop,
                marginTop: mainStyle.marginTop
              });
            }
          }
        }, 50);
      }
    }

    // Bunnmeny click handlers
    document.querySelectorAll('#bottomNav .bottom-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (!tab) return;
        if (tab === '_mer') {
          toggleMerPopup();
        } else {
          switchTab(tab);
        }
      });
    });

    // Mer-popup handlers
    document.getElementById('merOverlay')?.addEventListener('click', closeMerPopup);

    document.querySelectorAll('.mer-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = item.getAttribute('data-tab');
        if (t) switchTab(t);
      });
    });

    // Season nav: Home button exits sesong
    var seasonHome = document.getElementById('seasonNavHome');
    if (seasonHome) seasonHome.addEventListener('click', function() { switchTab('players'); });

    // Expose for other modules if needed
    window.__BF_switchTab = switchTab;
    window.__BF_getTeamId = function() { return state.currentTeamId; };
    window.__BF_getOwnerUid = function() { return getOwnerUid(); };
    window.__BF_isSharedTeam = function() { return isSharedTeam(); };
    window.__BF_saveState = saveState;
    window.__BF_publishPlayers = publishPlayers;
  }

  function setupSkillToggle() {
    const t = $('skillToggle');
    const hint = $('skillToggleHint');
    if (!t) return;

    t.checked = !!state.settings.useSkill;

    const refreshHint = () => {
      if (!hint) return;
      hint.textContent = state.settings.useSkill
        ? 'Nivå er aktivert. (Brukes i gruppering og lagdeling.)'
        : 'Nivå er deaktivert. (Lagdeling blir tilfeldig.)';
    };

    refreshHint();

    t.addEventListener('change', () => {
      state.settings.useSkill = !!t.checked;
      saveState();
      renderAll();
      publishPlayers();
      refreshHint();
    });
  }

  function setupPlayersUI() {
    const addBtn = $('addPlayerBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const nameEl = $('playerName');
        const skillEl = $('playerSkill');
        const goalieEl = $('playerGoalie');

        const name = String(nameEl?.value || '').trim();
        
        // PRIVACY COMPLIANCE: Validate player name length (max 50 chars)
        // Prevents excessive personal data storage about children (GDPR Art. 5(1)(c) - data minimization)
        if (!name) return showNotification('Skriv inn et navn først', 'error');
        if (name.length > 50) {
          return showNotification('Spillernavn må være maks 50 tegn (kun fornavn anbefales)', 'error');
        }
        
        // PRIVACY WARNING: Alert if name contains space (might be full name)
        if (name.includes(' ')) {
          const confirmed = window.confirm(
            '⚠️ PERSONVERN-ADVARSEL:\n\n' +
            'Navnet inneholder mellomrom og kan være et fullt navn.\n\n' +
            'For å beskytte barns personvern bør du KUN bruke fornavn.\n\n' +
            'Vil du fortsette likevel?'
          );
          if (!confirmed) {
            return;
          }
        }

        const skill = Number(skillEl?.value ?? 3);
        const goalie = !!goalieEl?.checked;

        state.players.push({
          id: uuid(),
          name,
          skill: Number.isFinite(skill) ? Math.max(1, Math.min(6, Math.round(skill))) : 3,
          goalie,
          active: true,
          positions: ['F','M','A']
        });

        // auto-select new player in grouping
        const id = state.players[state.players.length - 1].id;
        state.selection.grouping.add(id);

        if (nameEl) nameEl.value = '';
        if (goalieEl) goalieEl.checked = false;

        saveState();
        renderAll();
        publishPlayers();
        showNotification('Spiller lagt til', 'success');
      });
    }

    // Export / Import / Clear
    const exportBtn = $('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: state.settings,
          players: state.players
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'barnefotballtrener-spillere.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    }

    const importBtn = $('importBtn');
    const importFile = $('importFile');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const f = importFile.files?.[0];
        if (!f) return;
        try {
          const text = await f.text();
          const parsed = JSON.parse(text);
          const incomingPlayers = normalizePlayers(parsed.players ?? parsed);
          if (incomingPlayers.length === 0) {
            showNotification('Fant ingen gyldige spillere i filen', 'error');
            importFile.value = '';
            return;
          }

          // Warn user that import replaces all existing players
          if (state.players.length > 0) {
            const ok = window.confirm(
              `⚠️ Import erstatter alle eksisterende spillere (${state.players.length} stk).\n\n` +
              `Filen inneholder ${incomingPlayers.length} spillere.\n\n` +
              'Vil du fortsette?'
            );
            if (!ok) {
              importFile.value = '';
              return;
            }
          }

          state.players = incomingPlayers;

          // reset selections to all active players
          state.selection.grouping = new Set(state.players.map(p => p.id));

          if (parsed.settings && typeof parsed.settings.useSkill === 'boolean') {
            state.settings.useSkill = parsed.settings.useSkill;
            const t = $('skillToggle'); if (t) t.checked = state.settings.useSkill;
          }

          saveState();
          // Full erstatning i Supabase (gamle spillere med andre IDer må fjernes)
          clearTimeout(_supabaseSaveTimer); // unngå redundant debounce
          supabaseReplaceAllPlayers(state.players);
          renderAll();
          publishPlayers();
          showNotification('Importert', 'success');
        } catch (e) {
          console.error(e);
          showNotification('Kunne ikke importere filen', 'error');
        } finally {
          importFile.value = '';
        }
      });
    }

    const clearBtn = $('clearAllBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const ok = window.confirm('Slette alle spillere? Dette kan ikke angres.');
        if (!ok) return;
        state.players = [];
        state.selection.grouping = new Set();
        saveState();
        // Slett alle fra Supabase umiddelbart
        clearTimeout(_supabaseSaveTimer); // unngå redundant debounce
        supabaseSavePlayers([]);
        renderAll();
        publishPlayers();
        showNotification('Alle spillere slettet', 'info');
      });
    }
  }

  function setupGroupingUI() {
    const btn = $('groupingActionBtn');
    if (!btn) return;

    let currentMode = 'even'; // 'even' | 'diff'

    // Modusvelger
    document.querySelectorAll('.grouping-mode-btn').forEach(mBtn => {
      mBtn.addEventListener('click', () => {
        document.querySelectorAll('.grouping-mode-btn').forEach(b => b.classList.remove('active'));
        mBtn.classList.add('active');
        currentMode = mBtn.getAttribute('data-gmode') || 'even';

        // Oppdater hint og knappetekst
        const hint = $('groupingModeHint');
        if (hint) {
          hint.textContent = currentMode === 'diff'
            ? 'Differensierte grupper: beste spillere sammen, neste nivå sammen osv.'
            : 'Jevne grupper: spillere fordeles slik at alle grupper får omtrent likt nivå.';
        }
        if (btn) {
          btn.innerHTML = currentMode === 'diff'
            ? '<i class="fas fa-people-group"></i> Lag differensierte grupper'
            : '<i class="fas fa-people-group"></i> Lag jevne grupper';
        }
      });
    });

    // Velg alle / Fjern alle
    const selectAllBtn = $('groupingSelectAllBtn');
    const clearAllBtn = $('groupingClearAllBtn');

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        const activeIds = state.players.filter(p => p.active).map(p => p.id);
        state.selection.grouping = new Set(activeIds);
        renderSelections();
        showNotification('Valgte alle aktive spillere', 'success');
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        state.selection.grouping = new Set();
        renderSelections();
        showNotification('Fjernet alle valgte spillere', 'success');
      });
    }

    btn.addEventListener('click', () => {
      const players = getSelectedPlayers(state.selection.grouping);
      if (players.length < 2) return showNotification('Velg minst 2 spillere', 'error');

      const groupCount = Number($('groupingCount')?.value ?? 2);

      if (currentMode === 'diff') {
        if (!state.settings.useSkill) {
          showNotification('Slå på "Bruk ferdighetsnivå" for differensierte grupper', 'error');
          return;
        }
        const groups = (window.Grouping && window.Grouping.makeDifferentiatedGroups)
          ? window.Grouping.makeDifferentiatedGroups(players, groupCount, true)
          : makeDifferentiatedGroups(players, groupCount);
        if (!groups) {
          showNotification('Kunne ikke lage grupper', 'error');
          return;
        }
        renderGroupingResults(groups);
        showNotification('Differensierte grupper laget', 'success');
      } else {
        // Jevne grupper (balansert)
        const groups = (window.Grouping && window.Grouping.makeBalancedGroups)
          ? window.Grouping.makeBalancedGroups(players, groupCount, !!state.settings.useSkill)
          : makeBalancedGroups(players, groupCount);
        renderGroupingResults(groups);
        showNotification('Jevne grupper laget', 'success');
      }
    });
  }

  function renderGroupingResults(groups) {
    const el = $('groupingResults');
    if (!el) return;

    // Deep copy into state for drag-drop mutations
    state.currentGroups = groups.map(g => g.map(p => ({ ...p })));

    renderGroupsFromState();
  }

  function renderGroupsFromState() {
    const el = $('groupingResults');
    if (!el || !state.currentGroups) return;

    const groups = state.currentGroups;

    el.innerHTML = `
      <div class="grpdd-hint small-text" style="opacity:0.7; margin-bottom:8px; text-align:center;">
        <i class="fas fa-hand-pointer" style="margin-right:4px;"></i>
        Hold inne en spiller for å dra til en annen (bytt) eller til en gruppe (flytt).
      </div>
      ${groups.map((g, gi) => `
        <div class="results-card grpdd-group" data-grpdd-gi="${gi}">
          <h3 class="grpdd-group" data-grpdd-gi="${gi}">
            Gruppe ${gi + 1} <span class="small-text" style="opacity:0.8;">(${g.length} spillere)</span>
          </h3>
          <div class="results-list">
            ${g.map((p, pi) => `
              <div class="result-item grpdd-player"
                   data-grpdd-gi="${gi}"
                   data-grpdd-pi="${pi}">
                <span class="grpdd-grip"><i class="fas fa-grip-vertical"></i></span>
                <span class="grpdd-name">${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    `;

    // Attach shared drag-drop behavior
    if (window.GroupDragDrop && window.GroupDragDrop.enable) {
      window.GroupDragDrop.enable(el, groups, function () {
        renderGroupsFromState();
      }, { notify: showNotification });
    }
  }

  function setupLigaUI() {
    const teamsInput = $('ligaTeams');
    const roundsInput = $('ligaRounds');
    const namesWrap = $('ligaTeamNames');
    const matchesEl = $('ligaMatches');
    const tableEl = $('ligaTable');
    const startBtn = $('startLigaBtn');
    const resetBtn = $('resetLigaBtn');

    if (!teamsInput || !roundsInput || !namesWrap || !matchesEl || !tableEl) return;

    function ensureNameInputs(n) {
      const count = Math.max(2, Math.min(5, Number(n) || 2));
      const existing = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      // If correct count, keep values
      if (existing.length === count) return;

      const prevValues = existing.map(i => String(i.value || '').trim()).filter(Boolean);
      namesWrap.innerHTML = '';

      for (let i = 0; i < count; i++) {
        const v = prevValues[i] || `Lag ${i + 1}`;
        const row = document.createElement('div');
        row.className = 'team-name-row';
        row.innerHTML = `
          <label class="team-name-label">Lag ${i + 1}</label>
          <input class="input team-name-input" data-team-name="${i+1}" type="text" value="${escapeHtml(v)}" />
        `;
        namesWrap.appendChild(row);
      }
    }

    function getTeamNames() {
      const inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      return inputs.map((i, idx) => {
        const v = String(i.value || '').trim();
        return v || `Lag ${idx + 1}`;
      });
    }

    function genRoundRobin(names) {
      // "circle method" – støtter oddetall med BYE
      const list = [...names];
      let hasBye = false;
      if (list.length % 2 === 1) { list.push('BYE'); hasBye = true; }
      const n = list.length;
      const rounds = n - 1;
      const half = n / 2;

      const schedule = [];
      let arr = [...list];

      for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < half; i++) {
          const home = arr[i];
          const away = arr[n - 1 - i];
          if (home === 'BYE' || away === 'BYE') continue;
          schedule.push({ round: r + 1, home, away, homeGoals: null, awayGoals: null });
        }
        // rotate: keep first fixed
        const fixed = arr[0];
        const rest = arr.slice(1);
        rest.unshift(rest.pop());
        arr = [fixed, ...rest];
      }
      return { schedule, hasBye };
    }

    function buildLeague() {
      const nTeams = Math.max(2, Math.min(5, Number(teamsInput.value) || 2));
      const nRounds = Math.max(1, Math.min(5, Number(roundsInput.value) || 1));
      const names = getTeamNames();

      const { schedule } = genRoundRobin(names.slice(0, nTeams));
      const matches = [];
      let mid = 1;

      for (let rep = 0; rep < nRounds; rep++) {
        for (const m of schedule) {
          const flip = (rep % 2 === 1);
          matches.push({
            id: `m_${mid++}`,
            rep: rep + 1,
            round: m.round,
            home: flip ? m.away : m.home,
            away: flip ? m.home : m.away,
            homeGoals: null,
            awayGoals: null
          });
        }
      }

      return {
        createdAt: Date.now(),
        teams: names.slice(0, nTeams).map((name, i) => ({ id: `t_${i + 1}`, name })),
        rounds: nRounds,
        matches
      };
    }

    function calcTable(league) {
      const rows = new Map();
      for (const t of league.teams) {
        rows.set(t.name, { team: t.name, p:0, w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0 });
      }

      for (const m of league.matches) {
        if (m.homeGoals === null || m.awayGoals === null) continue;
        const h = rows.get(m.home);
        const a = rows.get(m.away);
        if (!h || !a) continue;

        h.p++; a.p++;
        h.gf += m.homeGoals; h.ga += m.awayGoals;
        a.gf += m.awayGoals; a.ga += m.homeGoals;

        if (m.homeGoals > m.awayGoals) { h.w++; a.l++; h.pts += 3; }
        else if (m.homeGoals < m.awayGoals) { a.w++; h.l++; a.pts += 3; }
        else { h.d++; a.d++; h.pts += 1; a.pts += 1; }
      }

      for (const r of rows.values()) r.gd = r.gf - r.ga;

      return Array.from(rows.values()).sort((x, y) =>
        (y.pts - x.pts) || (y.gd - x.gd) || (y.gf - x.gf) || x.team.localeCompare(y.team, 'nb')
      );
    }

    function render(league) {
      // Matches
      matchesEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'liga-matches';

      // group by rep+round
      const groups = new Map();
      for (const m of league.matches) {
        const key = `${m.rep}-${m.round}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
      }
      const groupKeys = Array.from(groups.keys()).sort((a,b)=>{
        const [ar,arnd] = a.split('-').map(Number);
        const [br,brnd] = b.split('-').map(Number);
        return (ar-br) || (arnd-brnd);
      });

      for (const k2 of groupKeys) {
        const [rep, round] = k2.split('-').map(Number);
        const h3 = document.createElement('div');
        h3.style.fontWeight = '800';
        h3.style.margin = '10px 0 6px';
        h3.textContent = `Runde ${round} (serie ${rep})`;
        wrap.appendChild(h3);

        for (const m of groups.get(k2)) {
          const row = document.createElement('div');
          row.className = 'liga-match-row';
          row.innerHTML = `
            <div class="liga-match-card" style="display:flex; align-items:stretch; justify-content:space-between; gap:8px; padding:8px 10px; border:1px solid rgba(0,0,0,0.06); border-radius:10px; background:var(--bg-card); box-shadow:0 1px 4px rgba(0,0,0,0.03);">
              <div class="liga-side home" style="flex:1; min-width:0;">
                <div style="font-size:10px; font-weight:700; opacity:.5; margin-bottom:2px;">Hjemme</div>
                <div class="liga-team-name" style="font-size:14px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:4px;">${escapeHtml(m.home)}</div>
                <input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="${m.id}" data-side="home"
                  placeholder="0" value="${m.homeGoals ?? ''}"
                  style="width:100%; text-align:center; font-size:16px; font-weight:900; padding:6px 8px; border-radius:8px;">
              </div>
              <div class="liga-mid" aria-hidden="true" style="display:flex; align-items:center; justify-content:center; width:16px; font-weight:900; opacity:.4; font-size:14px;">–</div>
              <div class="liga-side away" style="flex:1; min-width:0;">
                <div style="font-size:10px; font-weight:700; opacity:.5; margin-bottom:2px; text-align:right;">Borte</div>
                <div class="liga-team-name" style="font-size:14px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:4px; text-align:right;">${escapeHtml(m.away)}</div>
                <input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="${m.id}" data-side="away"
                  placeholder="0" value="${m.awayGoals ?? ''}"
                  style="width:100%; text-align:center; font-size:16px; font-weight:900; padding:6px 8px; border-radius:8px;">
              </div>
            </div>
          `;
          wrap.appendChild(row);
        }
      }
      matchesEl.appendChild(wrap);

      // Table
      const rows = calcTable(league);
      tableEl.innerHTML = `
        <div style="overflow:auto;">
          <table class="liga-table">
            <thead>
              <tr>
                <th>Lag</th><th>K</th><th>V</th><th>U</th><th>T</th><th>Mål</th><th>Diff</th><th>P</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${escapeHtml(r.team)}</td>
                  <td>${r.p}</td>
                  <td>${r.w}</td>
                  <td>${r.d}</td>
                  <td>${r.l}</td>
                  <td>${r.gf}-${r.ga}</td>
                  <td>${r.gd}</td>
                  <td><strong>${r.pts}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      // bind score inputs
      matchesEl.querySelectorAll('input.liga-score').forEach(inp => {
        inp.addEventListener('input', () => {
          const mid = inp.getAttribute('data-mid');
          const side = inp.getAttribute('data-side');
          if (!mid || !side) return;
          const match = league.matches.find(x => x.id === mid);
          if (!match) return;

          const v = inp.value === '' ? null : Number(inp.value);
          const val = (v === null || !Number.isFinite(v) || v < 0) ? null : Math.floor(v);

          if (side === 'home') match.homeGoals = val;
          else match.awayGoals = val;

          state.liga = league;
          saveState();
          // re-render only table for speed
          const rows2 = calcTable(league);
          tableEl.innerHTML = `
            <div style="overflow:auto;">
              <table class="liga-table">
                <thead>
                  <tr>
                    <th>Lag</th><th>K</th><th>V</th><th>U</th><th>T</th><th>Mål</th><th>Diff</th><th>P</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows2.map(r => `
                    <tr>
                      <td>${escapeHtml(r.team)}</td>
                      <td>${r.p}</td>
                      <td>${r.w}</td>
                      <td>${r.d}</td>
                      <td>${r.l}</td>
                      <td>${r.gf}-${r.ga}</td>
                      <td>${r.gd}</td>
                      <td><strong>${r.pts}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        });
      });

      // Liga: Editable team names after league is started
      // Show editable inputs above matches
      const editNamesHtml = `
        <div style="margin-bottom:12px;">
          <div style="font-weight:800; font-size:13px; margin-bottom:6px;">Rediger lagnavn:</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${league.teams.map((t, i) => `
              <input class="input liga-edit-name" data-team-idx="${i}" type="text" value="${escapeHtml(t.name)}" 
                style="flex:1; min-width:100px; max-width:180px; font-size:13px; padding:6px 8px;">
            `).join('')}
          </div>
        </div>
      `;
      matchesEl.insertAdjacentHTML('afterbegin', editNamesHtml);

      matchesEl.querySelectorAll('input.liga-edit-name').forEach(inp => {
        inp.addEventListener('change', () => {
          const idx = Number(inp.getAttribute('data-team-idx'));
          const newName = String(inp.value || '').trim();
          if (!newName || idx < 0 || idx >= league.teams.length) return;

          const oldName = league.teams[idx].name;
          if (oldName === newName) return;

          // Update team name
          league.teams[idx].name = newName;
          // Update all matches referencing this team
          for (const m of league.matches) {
            if (m.home === oldName) m.home = newName;
            if (m.away === oldName) m.away = newName;
          }

          state.liga = league;
          saveState();
          render(league);
          showNotification(`Lagnavn endret: ${oldName} → ${newName}`, 'success');
        });
      });
    }

    // initial names
    ensureNameInputs(teamsInput.value);

    teamsInput.addEventListener('change', () => {
      ensureNameInputs(teamsInput.value);
    });

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const league = buildLeague();
        state.liga = league;
        saveState();
        render(league);
        showNotification('Liga opprettet', 'success');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.liga = null;
        saveState();
        matchesEl.innerHTML = '';
        tableEl.innerHTML = '';
        ensureNameInputs(teamsInput.value);
        showNotification('Liga nullstilt', 'info');
      });
    }

    // restore persisted league
    if (state.liga && state.liga.teams && state.liga.matches) {
      // try to restore team names into inputs
      const n = state.liga.teams.length;
      teamsInput.value = String(n);
      ensureNameInputs(n);
      const inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      state.liga.teams.forEach((t, i) => { if (inputs[i]) inputs[i].value = t.name; });
      render(state.liga);
    }
  }


  // Exposed global helper used by inline onclick in HTML
  // Expose grouping algorithms for other modules (e.g. workout.js)
  // Important: workout.js MUST reuse these to stay in sync with Treningsgrupper/Laginndeling.

  window.changeNumber = function (inputId, delta) {
    const el = $(inputId);
    if (!el) return;
    const min = Number(el.getAttribute('min') ?? '-999999');
    const max = Number(el.getAttribute('max') ?? '999999');
    const v = Number(el.value || 0);
    const next = Math.max(min, Math.min(max, v + Number(delta || 0)));
    el.value = String(next);
  };

  // ------------------------------
  // ------------------------------
  // Invitasjoner (trenerdeling)
  // ------------------------------
  async function checkPendingInvitations() {
    var sb = getSupabaseClient();
    var uid = getUserId();
    if (!sb || !uid) return;

    try {
      // Hent ventende invitasjoner med lagnavn
      var res = await sb.from('team_members')
        .select('id, team_id, role, created_at')
        .eq('user_id', uid)
        .eq('status', 'pending');

      if (res.error || !res.data || res.data.length === 0) return;

      // Hent lagnavn for invitasjonene
      var teamIds = res.data.map(function(m) { return m.team_id; });
      var teamsRes = await sb.from('teams')
        .select('id, name, color')
        .in('id', teamIds);

      var teamMap = {};
      if (teamsRes.data) {
        teamsRes.data.forEach(function(t) { teamMap[t.id] = t; });
      }

      // Vis banner for hver invitasjon
      res.data.forEach(function(inv) {
        var team = teamMap[inv.team_id];
        if (team) showInvitationBanner(inv.id, team);
      });
    } catch (e) {
      console.warn('[core.js] checkPendingInvitations feilet:', e.message);
    }
  }

  function showInvitationBanner(membershipId, team) {
    // Fjern eksisterende banner for dette medlemskapet
    var existingBanner = document.getElementById('invBanner_' + membershipId);
    if (existingBanner) existingBanner.remove();

    var banner = document.createElement('div');
    banner.id = 'invBanner_' + membershipId;
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:300;background:var(--primary);color:white;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    banner.innerHTML =
      '<span><strong>Invitasjon:</strong> Du er invitert til <strong>' + escapeHtml(team.name) + '</strong></span>' +
      '<span style="display:flex;gap:8px;">' +
        '<button id="invAccept_' + membershipId + '" style="background:white;color:var(--primary);border:none;padding:6px 14px;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px;">Aksepter</button>' +
        '<button id="invDecline_' + membershipId + '" style="background:transparent;color:white;border:1px solid rgba(255,255,255,0.5);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;">Avslå</button>' +
      '</span>';

    document.body.appendChild(banner);

    document.getElementById('invAccept_' + membershipId).addEventListener('click', async function() {
      var sb = getSupabaseClient();
      if (!sb) return;

      var res = await sb.from('team_members')
        .update({ status: 'active' })
        .eq('id', membershipId);

      if (res.error) {
        showNotification('Kunne ikke akseptere invitasjonen.', 'error');
        return;
      }

      banner.remove();
      showNotification('Du er nå med på ' + team.name + '!', 'success');

      // Oppdater lag-listen
      var teams = await loadTeams();
      if (teams) {
        state.teams = teams;
        renderTeamSwitcher();
      }
    });

    document.getElementById('invDecline_' + membershipId).addEventListener('click', async function() {
      var sb = getSupabaseClient();
      if (!sb) return;

      var res = await sb.from('team_members')
        .delete()
        .eq('id', membershipId);

      banner.remove();
      if (!res.error) {
        showNotification('Invitasjon avslått.', 'info');
      }
    });
  }

  // initApp (called by auth.js / auth-ui.js)
  // ------------------------------
  window.initApp = function initApp() {
    console.log('[core.js] initApp STARTER');
    if (window.appInitialized) {
      console.log('[core.js] App allerede initialisert');
      return;
    }
    window.appInitialized = true;

    // Vis bunnmeny (skjult i HTML for å unngå flash på login-skjerm)
    var _bn = document.getElementById('bottomNav');
    if (_bn) _bn.style.display = 'flex';

    // Asynkron: last lag og deretter data
    (async function() {
      try {
        // 1. Last lag fra Supabase (opprett standardlag hvis nødvendig)
        await ensureDefaultTeam();

        if (state.teams.length === 0) {
          console.warn('[core.js] Ingen lag tilgjengelig, bruker fallback');
          state.currentTeamId = 'default';
        } else {
          // Bruk sist valgte lag, eller første lag
          var savedTeamId = getActiveTeamId();
          var validTeam = savedTeamId && state.teams.some(function(t) { return t.id === savedTeamId; });
          state.currentTeamId = validTeam ? savedTeamId : state.teams[0].id;
        }

        // Eksponer for andre moduler
        window._bftTeamId = state.currentTeamId;

        // 1b. Migrer localStorage fra gammel prefix (bft:uid:xxx) til ny (bft:uid:teamId:xxx)
        migrateLocalStorageToTeamPrefix();

        console.log('[core.js] Aktivt lag:', state.currentTeamId, '(' + state.teams.length + ' lag totalt)');
      } catch (e) {
        console.warn('[core.js] Feil ved lasting av lag:', e.message);
        state.currentTeamId = 'default';
        window._bftTeamId = 'default';
      }

      // 2. Last state (spillere, settings, liga) for valgt lag
      loadState();
      console.log('[core.js] State lastet, spillere:', state.players.length);

      // default select all active players
      state.selection.grouping = new Set(state.players.map(p => p.id));

      renderLogo();
      setupTabs();
      setupSkillToggle();
      setupPlayersUI();
      setupGroupingUI();
      setupLigaUI();

      renderAll();
      renderTeamSwitcher();
      publishPlayers();

      // Asynkron: hent spillere fra Supabase
      loadPlayersFromSupabase();

      // Asynkron: last øvrig data fra cloud (settings, liga, etc)
      loadCloudUserData();

      // Asynkron: sjekk ventende invitasjoner
      checkPendingInvitations();

      console.log('[core.js] initApp FERDIG');
    })();
  };

})();
