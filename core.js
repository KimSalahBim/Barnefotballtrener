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

  async function supabaseLoadPlayers(teamIdOverride, userIdOverride) {
    const sb = getSupabaseClient();
    const uid = userIdOverride || getUserId();
    const tid = teamIdOverride || state.currentTeamId;
    if (!sb || !uid || !tid) return null;

    try {
      const { data, error } = await sb
        .from('players')
        .select('id, name, skill, goalie, active, team_id')
        .eq('user_id', uid)
        .eq('team_id', tid);

      if (error) {
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
    const uid = userIdOverride || getUserId();
    const tid = teamIdOverride || state.currentTeamId;
    if (!sb || !uid || !tid) return;

    try {
      if (players.length === 0) {
        // Slett alle for dette laget
        await sb.from('players').delete().eq('user_id', uid).eq('team_id', tid);
        return;
      }

      // Upsert alle nåværende spillere (atomisk per rad)
      const rows = players.map(p => ({
        id: p.id,
        user_id: uid,
        team_id: tid,
        name: p.name,
        skill: p.skill,
        goalie: p.goalie,
        active: p.active,
        updated_at: new Date().toISOString()
      }));

      const { error: upsertErr } = await sb
        .from('players')
        .upsert(rows, { onConflict: 'user_id,id' });

      if (upsertErr) {
        console.warn('[core.js] Supabase upsert feilet:', upsertErr.message);
      }
    } catch (e) {
      console.warn('[core.js] Supabase save exception:', e.message);
    }
  }

  // Slett enkeltspiller direkte fra Supabase (kalles ved brukersletting)
  async function supabaseDeletePlayer(playerId) {
    const sb = getSupabaseClient();
    const uid = getUserId();
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
    const uid = getUserId();
    const tid = state.currentTeamId;
    if (!sb || !uid || !tid) return;

    try {
      // Slett alle eksisterende for dette laget
      await sb.from('players').delete().eq('user_id', uid).eq('team_id', tid);

      // Sett inn nye (hvis noen)
      if (players.length > 0) {
        const rows = players.map(p => ({
          id: p.id,
          user_id: uid,
          team_id: tid,
          name: p.name,
          skill: p.skill,
          goalie: p.goalie,
          active: p.active,
          updated_at: new Date().toISOString()
        }));
        const { error } = await sb.from('players').insert(rows);
        if (error) console.warn('[core.js] Supabase replace-insert feilet:', error.message);
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
    var uidSnap = getUserId();
    var tidSnap = state.currentTeamId;
    var playersSnap = (state.players || []).map(function(p) { return { id: p.id, name: p.name, skill: p.skill, goalie: p.goalie, active: p.active }; });
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
    var uid = getUserId();
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

  function debouncedCloudSync(key, jsonData) {
    clearTimeout(_cloudSyncTimers[key]);
    // Snapshot kontekst for å unngå feil-lag sync ved team-bytte
    var dataSnap = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
    var tidSnap = state.currentTeamId;
    var uidSnap = getUserId();
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
  const MAX_TEAMS = 3;
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
      var result = await sb
        .from('teams')
        .select('id, name, color, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: true });

      if (result.error) {
        console.warn('[core.js] loadTeams feilet:', result.error.message);
        return [];
      }
      return result.data || [];
    } catch (e) {
      console.warn('[core.js] loadTeams exception:', e.message);
      return [];
    }
  }

  async function createTeam(name, color) {
    var sb = getSupabaseClient();
    var uid = getUserId();
    if (!sb || !uid) return null;

    if (state.teams.length >= MAX_TEAMS) {
      showNotification('Du kan ha maks ' + MAX_TEAMS + ' lag.', 'warning');
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
    if (teams.length > 0) {
      state.teams = teams;
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

    // Teller spillere per lag fra Supabase-cache i state
    var playerCount = state.players.length;

    var html = '<button class="team-switcher-btn" id="teamSwitcherBtn" type="button">' +
      '<span class="team-color-dot" style="background:' + escapeHtml(team.color) + '"></span>' +
      '<span class="team-switcher-name">' + escapeHtml(team.name) + '</span>' +
      '<span class="team-switcher-count">' + playerCount + ' spillere</span>' +
      '<span class="team-switcher-arrow"><i class="fas fa-chevron-down"></i></span>' +
      '</button>';

    html += '<div class="team-dropdown" id="teamDropdown">';
    state.teams.forEach(function(t) {
      var isActive = t.id === state.currentTeamId;
      html += '<div class="team-dropdown-item' + (isActive ? ' active' : '') + '" data-team-id="' + t.id + '">' +
        '<span class="team-color-dot" style="background:' + escapeHtml(t.color) + '"></span>' +
        '<span class="team-item-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="team-item-actions">' +
          '<button class="team-item-edit" data-team-id="' + t.id + '" title="Rediger"><i class="fas fa-pen"></i></button>' +
          (state.teams.length > 1 ? '<button class="team-item-delete" data-team-id="' + t.id + '" title="Slett"><i class="fas fa-trash"></i></button>' : '') +
        '</span>' +
        '<span class="team-item-check">' + (isActive ? '<i class="fas fa-check"></i>' : '') + '</span>' +
        '</div>';
    });

    if (state.teams.length < MAX_TEAMS) {
      html += '<div class="team-dropdown-add" id="teamDropdownAdd">' +
        '<i class="fas fa-plus"></i>' +
        '<span>Opprett nytt lag</span>' +
        '<span style="margin-left:auto;font-size:12px;color:var(--gray-400)">' + state.teams.length + ' av ' + MAX_TEAMS + '</span>' +
        '</div>';
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

    container.querySelectorAll('.team-dropdown-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        // Ikke bytt lag hvis bruker klikket edit/delete
        if (e.target.closest('.team-item-edit') || e.target.closest('.team-item-delete')) return;
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

    if (state.teams.length <= 1) {
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
    currentTeamId: null
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

      out.push({
        id,
        name,
        skill,
        goalie: Boolean(p.goalie),
        active: p.active === false ? false : true
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

        state.selection.grouping = new Set(state.players.filter(p => p.active).map(p => p.id));
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
        // Cloud er tom → bootstrap: push lokal data opp
        bootstrapCloudFromLocal();
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
      return `
        <div class="player-card" data-id="${p.id}">
          <input type="checkbox" class="player-active-toggle" ${p.active ? 'checked' : ''}>
          <div class="player-info">
            <div class="player-name">${escapeHtml(p.name)}</div>
            <div class="player-tags">${state.settings.useSkill ? `<span class="tag">Nivå ${p.skill}</span>` : ''}${p.goalie ? `<span class="tag">🧤</span>` : `<span class="tag">⚽</span>`}</div>
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

      const activeToggle = card.querySelector('.player-active-toggle');
      if (activeToggle) {
        activeToggle.addEventListener('change', () => {
          p.active = !!activeToggle.checked;
          saveState();
          updateStats();
          renderSelections();
          publishPlayers();
        });
      }

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

          p.name = name;
          p.skill = skill;
          p.goalie = goalie;

          saveState();
          renderAll();
          showNotification('Spiller oppdatert', 'success');
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
    const selectable = state.players.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name, 'nb'));

    if (groupingEl) {
      groupingEl.innerHTML = selectable.map(p => `
        <label class="player-checkbox">
          <input type="checkbox" data-id="${p.id}" ${state.selection.grouping.has(p.id) ? 'checked' : ''}>
          <span class="checkmark"></span>
          <div class="player-details">
            <div class="player-name">${escapeHtml(p.name)}</div>
            <div class="player-meta">
              ${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}
            </div>
          </div>
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
    // Robust mobil-håndtering for iOS/Safari
    // Mål: ingen "tomt felt" øverst i Liga eller andre faner

    document.querySelectorAll('.app-nav .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (!tab) return;

        // STEG 1: Fjern active fra ALLE nav-knapper
        document.querySelectorAll('.app-nav .nav-btn').forEach(b => b.classList.remove('active'));
        
        // STEG 2: Fjern active fra ALLE tabs OG eksplisitt skjul dem
        document.querySelectorAll('.tab-content').forEach(c => {
          c.classList.remove('active');
          // Eksplisitt skjul (backup til CSS)
          c.style.display = 'none';
          c.style.visibility = 'hidden';
          c.style.position = 'absolute';
          c.style.left = '-99999px';
        });

        // STEG 3: Aktiver kun den valgte tab-knappen
        btn.classList.add('active');
        
        // STEG 4: Aktiver og vis kun den valgte tab
        const content = document.getElementById(tab);

        if (content) {
          content.classList.add('active');
          // Eksplisitt vis (backup til CSS)
          content.style.display = 'block';
          content.style.visibility = 'visible';
          content.style.position = 'relative';
          content.style.left = 'auto';

          // Mobilfix (iOS/Safari): blur fokus + tving til topp
          // Gjør dette SYNC (ikke async) for å unngå race conditions
          try {
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
              document.activeElement.blur();
            }
          } catch (_) {}

          // Scroll til toppen UMIDDELBART - viktig for iOS
          const scroller = document.scrollingElement || document.documentElement;
          try { 
            scroller.scrollTop = 0; 
            scroller.scrollLeft = 0;
          } catch (_) {}
          
          try { 
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); 
          } catch (_) {
            // Fallback for eldre Safari
            try { window.scrollTo(0, 0); } catch (_) {}
          }

          // Debug logging (kun på debug-hosts)
          if (window.__BF_IS_DEBUG_HOST && tab === 'liga') {
            console.log('[LIGA DEBUG] Bytte til Liga-fanen');
            console.log('[LIGA DEBUG] window.scrollY:', window.scrollY);
            console.log('[LIGA DEBUG] document.scrollingElement.scrollTop:', scroller.scrollTop);
            
            // Sjekk hvilke tabs som er active
            const allTabs = document.querySelectorAll('.tab-content');
            const activeTabs = document.querySelectorAll('.tab-content.active');
            console.log('[LIGA DEBUG] Totalt tabs:', allTabs.length);
            console.log('[LIGA DEBUG] Active tabs:', activeTabs.length);
            activeTabs.forEach((t, i) => {
              console.log(`[LIGA DEBUG] Active tab ${i}:`, t.id, t.className);
            });
            
            // Sjekk om Liga-innholdet faktisk er synlig
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
                
                // Sjekk første child
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
                
                // Tell antall children
                console.log('[LIGA DEBUG] Antall children:', ligaEl.children.length);
                
                // VIKTIG: Sjekk om det er andre tab-content over Liga
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
                
                // Sjekk også parent-containeren til Liga
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
                
                // Sjekk siblings (andre elementer på samme nivå som Liga)
                const siblings = Array.from(main?.children || []);
                console.log('[LIGA DEBUG] Søsken til Liga (elementer før Liga):', siblings.length);
                siblings.forEach((sib, idx) => {
                  if (sib === ligaEl) {
                    console.log(`[LIGA DEBUG] → Liga er child #${idx}`);
                    return;
                  }
                  const sibRect = sib.getBoundingClientRect();
                  if (sibRect.height > 0) {
                    console.log(`[LIGA DEBUG] → Søsken #${idx}:`, {
                      tagName: sib.tagName,
                      id: sib.id,
                      className: sib.className,
                      height: sibRect.height,
                      top: sibRect.top
                    });
                  }
                });
              } else {
                console.log('[LIGA DEBUG] FEIL: Liga element ikke funnet!');
              }
            }, 100);
          }
        }

        // keep selections fresh
        renderSelections();
        publishPlayers();
      });
    });
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
          active: true
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
          state.selection.grouping = new Set(state.players.filter(p => p.active).map(p => p.id));

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

    el.innerHTML = groups.map((g, i) => {
      return `
        <div class="results-card">
          <h3>Gruppe ${i + 1} <span class="small-text" style="opacity:0.8;">(${g.length} spillere)</span></h3>
          <div class="results-list">
            ${g.map(p => `<div class="result-item">${escapeHtml(p.name)} ${p.goalie ? ' 🧤' : ''}</div>`).join('')}
          </div>
        </div>
      `;
    }).join('');
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
            <div class="liga-match-card" style="display:flex; align-items:stretch; justify-content:space-between; gap:8px; padding:8px 10px; border:1px solid rgba(0,0,0,0.06); border-radius:10px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.03);">
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
  // initApp (called by auth.js / auth-ui.js)
  // ------------------------------
  window.initApp = function initApp() {
    console.log('[core.js] initApp STARTER');
    if (window.appInitialized) {
      console.log('[core.js] App allerede initialisert');
      return;
    }
    window.appInitialized = true;

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
      state.selection.grouping = new Set(state.players.filter(p => p.active).map(p => p.id));

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

      console.log('[core.js] initApp FERDIG');
    })();
  };

})();
