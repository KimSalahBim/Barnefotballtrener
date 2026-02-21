// © 2026 Barnefotballtrener.no. All rights reserved.
// season.js — Sesong-modul Fase 1
// Opprett sesong → legg til kamper/treninger → åpne i Kampdag.
// IIFE-mønster identisk med kampdag.js. Init via players:updated.

(function() {
  'use strict';

  console.log('[season.js] loaded');

  // =========================================================================
  //  STATE
  // =========================================================================
  var seasons = [];
  var currentSeason = null;
  var events = [];
  var snView = 'list'; // 'list' | 'create-season' | 'dashboard' | 'create-event' | 'edit-event' | 'event-detail'
  var editingEvent = null; // event object when editing

  // =========================================================================
  //  HELPERS
  // =========================================================================
  function getTeamId() { return window.__BF_getTeamId ? window.__BF_getTeamId() : (window._bftTeamId || null); }
  function getUserId() { return window.authService ? window.authService.getUserId() : null; }
  function getSb() {
    var sb = window.supabase || window.supabaseClient;
    return (sb && sb.from) ? sb : null;
  }
  function $(id) { return document.getElementById(id); }
  function notify(msg, type) { if (window.showNotification) window.showNotification(msg, type || 'info'); }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Format: '7er', '5er' etc.
  function formatLabel(n) { return n + 'er'; }

  // Norwegian date formatting
  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return dateStr; }
  }

  function formatDateLong(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (e) { return dateStr; }
  }

  function formatTime(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function formatDateRange(start, end) {
    if (!start && !end) return '';
    if (start && end) return formatDate(start) + ' \u2013 ' + formatDate(end);
    if (start) return 'Fra ' + formatDate(start);
    return 'Til ' + formatDate(end);
  }

  // Is event in the future?
  function isFuture(ev) {
    try { return new Date(ev.start_time) >= new Date(); } catch (e) { return false; }
  }

  // Sort events by start_time ascending
  function sortEvents(arr) {
    return arr.slice().sort(function(a, b) {
      return new Date(a.start_time) - new Date(b.start_time);
    });
  }

  // Type label and icon
  function typeLabel(type) {
    if (type === 'match') return 'Kamp';
    if (type === 'training') return 'Trening';
    if (type === 'cup_match') return 'Cupkamp';
    return type;
  }
  function typeIcon(type) {
    if (type === 'match' || type === 'cup_match') return '\u26BD';
    if (type === 'training') return '\uD83C\uDFBD';
    return '\uD83D\uDCC5';
  }

  // Build a local ISO datetime string for input[type=datetime-local]
  function toLocalDatetime(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      var h = String(d.getHours()).padStart(2, '0');
      var min = String(d.getMinutes()).padStart(2, '0');
      return y + '-' + m + '-' + day + 'T' + h + ':' + min;
    } catch (e) { return ''; }
  }

  // =========================================================================
  //  INJECT CSS (once)
  // =========================================================================
  (function injectStyles() {
    if ($('snStyles')) return;
    var style = document.createElement('style');
    style.id = 'snStyles';
    style.textContent = [
      // Season list cards
      '.sn-season-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-lg); padding:16px 18px; margin-bottom:12px; cursor:pointer; transition:transform 0.15s,box-shadow 0.15s; }',
      '.sn-season-card:hover { transform:translateY(-1px); box-shadow:var(--shadow-md); }',
      '.sn-season-card:active { transform:translateY(0); }',
      '.sn-card-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }',
      '.sn-card-name { font-size:17px; font-weight:700; color:var(--text-800); }',
      '.sn-badge { display:inline-block; background:var(--primary-dim); color:var(--primary); font-size:12px; font-weight:700; padding:3px 10px; border-radius:var(--radius-full); }',
      '.sn-card-meta { font-size:13px; color:var(--text-500); }',

      // Dashboard
      '.sn-dash-header { display:flex; align-items:center; gap:10px; margin-bottom:4px; }',
      '.sn-back { background:none; border:none; font-size:20px; cursor:pointer; padding:4px 8px; color:var(--text-600); border-radius:var(--radius-sm); }',
      '.sn-back:hover { background:var(--bg); }',
      '.sn-dash-title { font-size:20px; font-weight:700; color:var(--text-800); }',
      '.sn-dash-meta { font-size:13px; color:var(--text-500); margin-bottom:16px; margin-left:38px; }',
      '.sn-actions { display:flex; gap:8px; margin-bottom:20px; }',
      '.sn-actions button { flex:1; }',

      // Event list items
      '.sn-event-item { display:flex; align-items:center; gap:12px; padding:12px 14px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-md); margin-bottom:8px; cursor:pointer; transition:transform 0.15s; }',
      '.sn-event-item:hover { transform:translateY(-1px); box-shadow:var(--shadow-sm); }',
      '.sn-event-icon { font-size:22px; flex-shrink:0; width:36px; text-align:center; }',
      '.sn-event-info { flex:1; min-width:0; }',
      '.sn-event-title { font-size:15px; font-weight:600; color:var(--text-800); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.sn-event-meta { font-size:13px; color:var(--text-500); }',
      '.sn-event-arrow { color:var(--text-400); font-size:14px; flex-shrink:0; }',

      // Section headers
      '.sn-section { font-size:14px; font-weight:700; color:var(--text-600); margin:20px 0 8px 2px; text-transform:uppercase; letter-spacing:0.5px; }',

      // Empty state
      '.sn-empty { text-align:center; padding:40px 20px; }',
      '.sn-empty-icon { font-size:48px; margin-bottom:12px; }',
      '.sn-empty-text { font-size:15px; color:var(--text-500); margin-bottom:20px; line-height:1.5; }',

      // Forms
      '.sn-form { padding:0; }',
      '.sn-form .form-group { margin-bottom:14px; }',
      '.sn-form .form-group label { display:block; margin-bottom:6px; font-weight:600; color:var(--text-700); font-size:14px; }',
      '.sn-form .form-group input, .sn-form .form-group select, .sn-form .form-group textarea { width:100%; padding:11px 14px; border:2px solid var(--border); border-radius:var(--radius-md); font-size:15px; font-family:inherit; background:var(--bg-input); color:var(--text-800); transition:border-color 0.2s; }',
      '.sn-form .form-group input:focus, .sn-form .form-group select:focus, .sn-form .form-group textarea:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-dim); }',
      '.sn-form .form-group textarea { resize:vertical; min-height:60px; }',
      '.sn-form-row { display:flex; gap:10px; }',
      '.sn-form-row .form-group { flex:1; min-width:0; }',
      '.sn-form-buttons { display:flex; gap:8px; margin-top:18px; }',
      '.sn-form-buttons button { flex:1; }',

      // Home/away toggle
      '.sn-toggle-group { display:flex; gap:0; border:2px solid var(--border); border-radius:var(--radius-md); overflow:hidden; }',
      '.sn-toggle-btn { flex:1; padding:10px; border:none; background:var(--bg-input); color:var(--text-600); font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; transition:background 0.15s,color 0.15s; }',
      '.sn-toggle-btn.active { background:var(--primary); color:#fff; }',

      // Detail view
      '.sn-detail-row { display:flex; gap:8px; padding:10px 0; border-bottom:1px solid var(--border); }',
      '.sn-detail-label { font-size:13px; color:var(--text-500); min-width:90px; flex-shrink:0; }',
      '.sn-detail-value { font-size:15px; color:var(--text-800); font-weight:500; }',
      '.sn-detail-actions { display:flex; gap:8px; margin-top:20px; }',
      '.sn-detail-actions button { flex:1; }',

      // Delete button
      '.sn-btn-danger { background:var(--error-dim); color:var(--error); border:1.5px solid var(--error); border-radius:var(--radius-md); padding:11px 16px; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; transition:background 0.15s; }',
      '.sn-btn-danger:hover { background:var(--error); color:#fff; }',

      // Responsive
      '@media (max-width:480px) { .sn-form-row { flex-direction:column; gap:0; } .sn-actions { flex-direction:column; } }'
    ].join('\n');
    document.head.appendChild(style);
  })();

  // =========================================================================
  //  DOM SELF-REPAIR
  //  Original index.html has an unclosed div in the workout section.
  //  Some browsers nest #sesong inside #workout as error recovery.
  //  This fix detects and corrects the nesting at runtime.
  // =========================================================================
  function repairDomNesting() {
    var el = document.getElementById('sesong');
    if (!el) return;
    var parent = el.parentElement;
    if (parent && parent.id !== '' && parent.classList.contains('tab-content')) {
      // sesong is nested inside another tab — move it to <main>
      var main = el.closest('main');
      if (main) {
        main.appendChild(el);
        console.log('[season.js] DOM repaired: #sesong moved out of #' + parent.id);
      }
    }
  }

  // Run repair when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', repairDomNesting);
  } else {
    repairDomNesting();
  }

  // =========================================================================
  //  EVENT LISTENERS (immediately, NOT in DOMContentLoaded)
  // =========================================================================
  var _snInitialized = false;

  window.addEventListener('players:updated', function() {
    var tid = getTeamId();
    if (tid && tid !== 'default') {
      if (!_snInitialized) {
        _snInitialized = true;
        loadSeasons();
      } else {
        var el = $('sesong');
        if (el && el.classList.contains('active')) render();
      }
    }
  });

  window.addEventListener('team:changed', function() {
    currentSeason = null;
    seasons = [];
    events = [];
    snView = 'list';
    _snInitialized = false;
    // players:updated follows immediately after team:changed
  });

  // =========================================================================
  //  SUPABASE CRUD
  // =========================================================================

  async function loadSeasons() {
    var sb = getSb();
    var tid = getTeamId();
    var uid = getUserId();
    if (!sb || !tid || !uid) { seasons = []; render(); return; }

    try {
      var res = await sb.from('seasons')
        .select('*')
        .eq('team_id', tid)
        .eq('user_id', uid)
        .order('created_at', { ascending: false });

      if (res.error) throw res.error;
      seasons = res.data || [];

      // Fetch event counts per season in one query
      if (seasons.length > 0) {
        var sIds = seasons.map(function(s) { return s.id; });
        var evRes = await sb.from('events')
          .select('season_id')
          .eq('user_id', uid)
          .in('season_id', sIds);

        if (!evRes.error && evRes.data) {
          var countMap = {};
          for (var i = 0; i < evRes.data.length; i++) {
            var sid = evRes.data[i].season_id;
            countMap[sid] = (countMap[sid] || 0) + 1;
          }
          for (var j = 0; j < seasons.length; j++) {
            seasons[j]._eventCount = countMap[seasons[j].id] || 0;
          }
        }
      }
    } catch (e) {
      console.error('[season.js] loadSeasons error:', e);
      seasons = [];
    }
    render();
  }

  async function createSeason(data) {
    var sb = getSb();
    var tid = getTeamId();
    var uid = getUserId();
    if (!sb || !tid || !uid) { notify('Kunne ikke koble til databasen.', 'error'); return null; }

    try {
      var row = {
        user_id: uid,
        team_id: tid,
        name: data.name.trim(),
        format: parseInt(data.format) || 7,
        start_date: data.start_date || null,
        end_date: data.end_date || null
      };
      var res = await sb.from('seasons').insert(row).select().single();
      if (res.error) throw res.error;
      notify('Sesong opprettet!', 'success');
      return res.data;
    } catch (e) {
      console.error('[season.js] createSeason error:', e);
      notify('Feil ved oppretting av sesong.', 'error');
      return null;
    }
  }

  async function deleteSeason(id) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) return false;

    try {
      var res = await sb.from('seasons').delete().eq('id', id).eq('user_id', uid);
      if (res.error) throw res.error;
      notify('Sesong slettet.', 'success');
      return true;
    } catch (e) {
      console.error('[season.js] deleteSeason error:', e);
      notify('Feil ved sletting.', 'error');
      return false;
    }
  }

  async function loadEvents(seasonId) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !seasonId || !uid) { events = []; return; }

    try {
      var res = await sb.from('events')
        .select('*')
        .eq('season_id', seasonId)
        .eq('user_id', uid)
        .order('start_time', { ascending: true });

      if (res.error) throw res.error;
      events = res.data || [];
    } catch (e) {
      console.error('[season.js] loadEvents error:', e);
      events = [];
    }
  }

  async function createEvent(seasonId, data) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) { notify('Kunne ikke koble til databasen.', 'error'); return null; }

    try {
      var row = {
        season_id: seasonId,
        user_id: uid,
        type: data.type,
        title: (data.title || '').trim() || null,
        start_time: data.start_time,
        duration_minutes: parseInt(data.duration_minutes) || 60,
        location: (data.location || '').trim() || null,
        opponent: (data.opponent || '').trim() || null,
        is_home: (data.type === 'match' || data.type === 'cup_match') ? (data.is_home !== false) : null,
        format: data.format ? parseInt(data.format) : null,
        notes: (data.notes || '').trim() || null
      };
      var res = await sb.from('events').insert(row).select().single();
      if (res.error) throw res.error;
      notify(typeLabel(data.type) + ' lagt til!', 'success');
      return res.data;
    } catch (e) {
      console.error('[season.js] createEvent error:', e);
      notify('Feil ved oppretting.', 'error');
      return null;
    }
  }

  async function updateEvent(id, fields) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) { notify('Kunne ikke koble til databasen.', 'error'); return null; }

    try {
      var res = await sb.from('events').update(fields).eq('id', id).eq('user_id', uid).select().single();
      if (res.error) throw res.error;
      notify('Hendelse oppdatert.', 'success');
      return res.data;
    } catch (e) {
      console.error('[season.js] updateEvent error:', e);
      notify('Feil ved oppdatering.', 'error');
      return null;
    }
  }

  async function deleteEvent(id) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) return false;

    try {
      var res = await sb.from('events').delete().eq('id', id).eq('user_id', uid);
      if (res.error) throw res.error;
      notify('Hendelse slettet.', 'success');
      return true;
    } catch (e) {
      console.error('[season.js] deleteEvent error:', e);
      notify('Feil ved sletting.', 'error');
      return false;
    }
  }

  // =========================================================================
  //  RENDER ROUTER
  // =========================================================================

  function render() {
    var root = $('snRoot');
    if (!root) return;

    switch (snView) {
      case 'list':           renderSeasonList(root);   break;
      case 'create-season':  renderCreateSeason(root); break;
      case 'dashboard':      renderDashboard(root);    break;
      case 'create-event':   renderCreateEvent(root);  break;
      case 'edit-event':     renderEditEvent(root);    break;
      case 'event-detail':   renderEventDetail(root);  break;
      default:               renderSeasonList(root);   break;
    }
  }

  // =========================================================================
  //  VIEW: SEASON LIST
  // =========================================================================

  function renderSeasonList(root) {
    if (seasons.length === 0) {
      root.innerHTML =
        '<div class="sn-empty">' +
          '<div class="sn-empty-icon">\uD83D\uDCC5</div>' +
          '<div class="sn-empty-text">Ingen sesonger enn\u00e5.<br>Opprett din f\u00f8rste sesong for \u00e5 planlegge kamper og treninger.</div>' +
          '<button class="btn-primary" id="snCreateFirstBtn">Opprett sesong</button>' +
        '</div>';
      $('snCreateFirstBtn').addEventListener('click', function() {
        snView = 'create-season';
        render();
      });
      return;
    }

    var html = '';
    for (var i = 0; i < seasons.length; i++) {
      var s = seasons[i];
      var range = formatDateRange(s.start_date, s.end_date);
      var countText = s._eventCount === 1 ? '1 hendelse' : (s._eventCount || 0) + ' hendelser';
      var meta = [];
      if (range) meta.push(range);
      meta.push(countText);

      html +=
        '<div class="sn-season-card" data-sid="' + s.id + '">' +
          '<div class="sn-card-top">' +
            '<span class="sn-card-name">' + escapeHtml(s.name) + '</span>' +
            '<span class="sn-badge">' + formatLabel(s.format) + '</span>' +
          '</div>' +
          '<div class="sn-card-meta">' + escapeHtml(meta.join(' \u00B7 ')) + '</div>' +
        '</div>';
    }

    html += '<button class="btn-secondary" id="snCreateMoreBtn" style="width:100%;margin-top:8px;">' +
      '<i class="fas fa-plus" style="margin-right:6px;"></i>Opprett ny sesong</button>';

    root.innerHTML = html;

    // Bind click handlers
    var cards = root.querySelectorAll('.sn-season-card');
    for (var c = 0; c < cards.length; c++) {
      cards[c].addEventListener('click', (function(sid) {
        return function() { openSeason(sid); };
      })(cards[c].getAttribute('data-sid')));
    }

    $('snCreateMoreBtn').addEventListener('click', function() {
      snView = 'create-season';
      render();
    });
  }

  // =========================================================================
  //  VIEW: CREATE SEASON
  // =========================================================================

  function renderCreateSeason(root) {
    root.innerHTML =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromCreate">\u2190</button>' +
          '<span class="sn-dash-title">Ny sesong</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snSeasonName">Navn</label>' +
            '<input type="text" id="snSeasonName" placeholder="F.eks. V\u00e5r 2026" maxlength="60" autocomplete="off">' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snSeasonFormat">Kampformat</label>' +
            '<select id="snSeasonFormat">' +
              '<option value="3">3er</option>' +
              '<option value="5">5er</option>' +
              '<option value="7" selected>7er</option>' +
              '<option value="9">9er</option>' +
              '<option value="11">11er</option>' +
            '</select>' +
          '</div>' +
          '<div class="sn-form-row">' +
            '<div class="form-group">' +
              '<label for="snStartDate">Startdato</label>' +
              '<input type="date" id="snStartDate">' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="snEndDate">Sluttdato</label>' +
              '<input type="date" id="snEndDate">' +
            '</div>' +
          '</div>' +
          '<div class="sn-form-buttons">' +
            '<button class="btn-secondary" id="snCancelCreate">Avbryt</button>' +
            '<button class="btn-primary" id="snSaveSeason">Opprett</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    $('snBackFromCreate').addEventListener('click', goToList);
    $('snCancelCreate').addEventListener('click', goToList);

    $('snSaveSeason').addEventListener('click', async function() {
      var name = ($('snSeasonName').value || '').trim();
      if (!name) {
        notify('Gi sesongen et navn.', 'warning');
        $('snSeasonName').focus();
        return;
      }
      var btn = $('snSaveSeason');
      btn.disabled = true;
      btn.textContent = 'Oppretter\u2026';

      var season = await createSeason({
        name: name,
        format: $('snSeasonFormat').value,
        start_date: $('snStartDate').value || null,
        end_date: $('snEndDate').value || null
      });

      if (season) {
        await loadSeasons();
        openSeason(season.id);
      } else {
        btn.disabled = false;
        btn.textContent = 'Opprett';
      }
    });

    // Focus name field
    setTimeout(function() { var el = $('snSeasonName'); if (el) el.focus(); }, 50);
  }

  // =========================================================================
  //  VIEW: DASHBOARD (season detail with events)
  // =========================================================================

  function renderDashboard(root) {
    if (!currentSeason) { goToList(); return; }
    var s = currentSeason;

    var range = formatDateRange(s.start_date, s.end_date);
    var metaParts = [formatLabel(s.format)];
    if (range) metaParts.push(range);

    var html =
      '<div class="settings-card" style="margin-bottom:12px;">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromDash">\u2190</button>' +
          '<span class="sn-dash-title">' + escapeHtml(s.name) + '</span>' +
        '</div>' +
        '<div class="sn-dash-meta">' + escapeHtml(metaParts.join(' \u00B7 ')) + '</div>' +
        '<div class="sn-actions">' +
          '<button class="btn-primary" id="snAddMatch"><i class="fas fa-futbol" style="margin-right:5px;"></i>Legg til kamp</button>' +
          '<button class="btn-secondary" id="snAddTraining"><i class="fas fa-dumbbell" style="margin-right:5px;"></i>Legg til trening</button>' +
        '</div>' +
      '</div>';

    // Split events into upcoming and past
    var upcoming = [];
    var past = [];
    var sorted = sortEvents(events);
    for (var i = 0; i < sorted.length; i++) {
      if (isFuture(sorted[i])) upcoming.push(sorted[i]);
      else past.push(sorted[i]);
    }

    if (upcoming.length === 0 && past.length === 0) {
      html +=
        '<div class="sn-empty" style="padding:30px 20px;">' +
          '<div class="sn-empty-text">Ingen hendelser lagt til enn\u00e5.<br>Legg til kamper og treninger for denne sesongen.</div>' +
        '</div>';
    }

    if (upcoming.length > 0) {
      html += '<div class="sn-section">Kommende</div>';
      html += renderEventItems(upcoming);
    }

    if (past.length > 0) {
      html += '<div class="sn-section">Tidligere</div>';
      html += renderEventItems(past);
    }

    // Delete season button
    html +=
      '<div style="margin-top:32px; padding-top:16px; border-top:1px solid var(--border);">' +
        '<button class="sn-btn-danger" id="snDeleteSeason" style="width:100%;">' +
          '<i class="fas fa-trash" style="margin-right:6px;"></i>Slett sesong' +
        '</button>' +
      '</div>';

    root.innerHTML = html;

    // Bind handlers
    $('snBackFromDash').addEventListener('click', goToList);

    $('snAddMatch').addEventListener('click', function() {
      editingEvent = null;
      snView = 'create-event';
      render();
      // Pre-select match type
      setTimeout(function() { var el = $('snEventType'); if (el) { el.value = 'match'; el.dispatchEvent(new Event('change')); } }, 20);
    });

    $('snAddTraining').addEventListener('click', function() {
      editingEvent = null;
      snView = 'create-event';
      render();
      setTimeout(function() { var el = $('snEventType'); if (el) { el.value = 'training'; el.dispatchEvent(new Event('change')); } }, 20);
    });

    $('snDeleteSeason').addEventListener('click', async function() {
      var evCount = events.length;
      var msg = 'Er du sikker p\u00e5 at du vil slette sesongen \u00AB' + s.name + '\u00BB?';
      if (evCount > 0) msg += '\n\nDette vil ogs\u00e5 slette ' + evCount + ' hendelse' + (evCount === 1 ? '' : 'r') + '.';
      if (!confirm(msg)) return;

      var btn = $('snDeleteSeason');
      btn.disabled = true;
      btn.textContent = 'Sletter\u2026';

      var ok = await deleteSeason(s.id);
      if (ok) {
        currentSeason = null;
        events = [];
        snView = 'list';
        await loadSeasons();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash" style="margin-right:6px;"></i>Slett sesong';
      }
    });

    bindEventItemClicks(root);
  }

  function renderEventItems(arr) {
    var html = '';
    for (var i = 0; i < arr.length; i++) {
      var ev = arr[i];
      var title = ev.title || ev.opponent || typeLabel(ev.type);
      if (ev.type === 'match' && ev.opponent && !ev.title) {
        title = (ev.is_home ? 'Hjemme' : 'Borte') + ' vs ' + ev.opponent;
      }
      var meta = formatDateLong(ev.start_time);
      var time = formatTime(ev.start_time);
      if (time) meta += ', kl. ' + time;
      if (ev.location) meta += ' \u00B7 ' + ev.location;

      html +=
        '<div class="sn-event-item" data-eid="' + ev.id + '">' +
          '<div class="sn-event-icon">' + typeIcon(ev.type) + '</div>' +
          '<div class="sn-event-info">' +
            '<div class="sn-event-title">' + escapeHtml(title) + '</div>' +
            '<div class="sn-event-meta">' + escapeHtml(meta) + '</div>' +
          '</div>' +
          '<div class="sn-event-arrow">\u203A</div>' +
        '</div>';
    }
    return html;
  }

  function bindEventItemClicks(root) {
    var items = root.querySelectorAll('.sn-event-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', (function(eid) {
        return function() {
          var ev = events.find(function(e) { return e.id === eid; });
          if (ev) {
            editingEvent = ev;
            snView = 'event-detail';
            render();
          }
        };
      })(items[i].getAttribute('data-eid')));
    }
  }

  // =========================================================================
  //  VIEW: CREATE EVENT
  // =========================================================================

  function renderEventForm(root, existing) {
    var isEdit = !!existing;
    var ev = existing || {};
    var type = ev.type || 'match';
    var isMatch = (type === 'match' || type === 'cup_match');

    var title = isEdit ? 'Rediger hendelse' : 'Ny hendelse';

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromEvent">\u2190</button>' +
          '<span class="sn-dash-title">' + title + '</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snEventType">Type</label>' +
            '<select id="snEventType">' +
              '<option value="match"' + (type === 'match' ? ' selected' : '') + '>Kamp</option>' +
              '<option value="training"' + (type === 'training' ? ' selected' : '') + '>Trening</option>' +
            '</select>' +
          '</div>' +
          '<div id="snMatchFields" style="' + (isMatch ? '' : 'display:none;') + '">' +
            '<div class="form-group">' +
              '<label for="snOpponent">Motstander</label>' +
              '<input type="text" id="snOpponent" placeholder="F.eks. Steinkjer IL" maxlength="80" autocomplete="off" value="' + escapeHtml(ev.opponent || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Hjemme / Borte</label>' +
              '<div class="sn-toggle-group">' +
                '<button type="button" class="sn-toggle-btn' + (ev.is_home !== false ? ' active' : '') + '" data-val="true">Hjemme</button>' +
                '<button type="button" class="sn-toggle-btn' + (ev.is_home === false ? ' active' : '') + '" data-val="false">Borte</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snTitle">Tittel <span style="font-weight:400;color:var(--text-400);">(valgfritt)</span></label>' +
            '<input type="text" id="snTitle" placeholder="Vises i hendelseslisten" maxlength="80" autocomplete="off" value="' + escapeHtml(ev.title || '') + '">' +
          '</div>' +
          '<div class="sn-form-row">' +
            '<div class="form-group">' +
              '<label for="snDateTime">Dato og tid</label>' +
              '<input type="datetime-local" id="snDateTime" value="' + toLocalDatetime(ev.start_time || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="snDuration">Varighet (min)</label>' +
              '<input type="number" id="snDuration" min="10" max="180" value="' + (ev.duration_minutes || 60) + '">' +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snLocation">Sted <span style="font-weight:400;color:var(--text-400);">(valgfritt)</span></label>' +
            '<input type="text" id="snLocation" placeholder="F.eks. Guldbergaunet" maxlength="100" autocomplete="off" value="' + escapeHtml(ev.location || '') + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snNotes">Notat <span style="font-weight:400;color:var(--text-400);">(valgfritt)</span></label>' +
            '<textarea id="snNotes" placeholder="Ekstra info, m\u00f8tetid, utstyr\u2026" rows="2">' + escapeHtml(ev.notes || '') + '</textarea>' +
          '</div>' +
          '<div class="sn-form-buttons">' +
            '<button class="btn-secondary" id="snCancelEvent">Avbryt</button>' +
            '<button class="btn-primary" id="snSaveEvent">' + (isEdit ? 'Lagre' : 'Legg til') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.innerHTML = html;

    // Type toggle: show/hide match fields
    $('snEventType').addEventListener('change', function() {
      var isM = (this.value === 'match' || this.value === 'cup_match');
      $('snMatchFields').style.display = isM ? '' : 'none';
    });

    // Home/away toggle
    var toggleBtns = root.querySelectorAll('.sn-toggle-btn');
    for (var t = 0; t < toggleBtns.length; t++) {
      toggleBtns[t].addEventListener('click', function() {
        for (var j = 0; j < toggleBtns.length; j++) toggleBtns[j].classList.remove('active');
        this.classList.add('active');
      });
    }

    $('snBackFromEvent').addEventListener('click', goToDashboard);
    $('snCancelEvent').addEventListener('click', goToDashboard);

    $('snSaveEvent').addEventListener('click', async function() {
      var dateVal = ($('snDateTime').value || '').trim();
      if (!dateVal) {
        notify('Velg dato og tid.', 'warning');
        $('snDateTime').focus();
        return;
      }

      var btn = $('snSaveEvent');
      btn.disabled = true;
      btn.textContent = isEdit ? 'Lagrer\u2026' : 'Legger til\u2026';

      var typeVal = $('snEventType').value;
      var isMatchNow = (typeVal === 'match' || typeVal === 'cup_match');
      var activeToggle = root.querySelector('.sn-toggle-btn.active');
      var isHomeVal = activeToggle ? (activeToggle.getAttribute('data-val') === 'true') : true;

      var fields = {
        type: typeVal,
        title: $('snTitle').value || null,
        start_time: new Date(dateVal).toISOString(),
        duration_minutes: parseInt($('snDuration').value) || 60,
        location: $('snLocation').value || null,
        opponent: isMatchNow ? ($('snOpponent').value || null) : null,
        is_home: isMatchNow ? isHomeVal : null,
        notes: $('snNotes').value || null
      };

      var result;
      if (isEdit) {
        result = await updateEvent(existing.id, fields);
      } else {
        result = await createEvent(currentSeason.id, fields);
      }

      if (result) {
        await loadEvents(currentSeason.id);
        snView = 'dashboard';
        render();
      } else {
        btn.disabled = false;
        btn.textContent = isEdit ? 'Lagre' : 'Legg til';
      }
    });
  }

  function renderCreateEvent(root) {
    renderEventForm(root, null);
  }

  function renderEditEvent(root) {
    renderEventForm(root, editingEvent);
  }

  // =========================================================================
  //  VIEW: EVENT DETAIL
  // =========================================================================

  function renderEventDetail(root) {
    var ev = editingEvent;
    if (!ev) { goToDashboard(); return; }

    var isMatch = (ev.type === 'match' || ev.type === 'cup_match');

    var title = ev.title || ev.opponent || typeLabel(ev.type);
    if (isMatch && ev.opponent && !ev.title) {
      title = (ev.is_home ? 'Hjemme' : 'Borte') + ' vs ' + ev.opponent;
    }

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromDetail">\u2190</button>' +
          '<span class="sn-dash-title">' + typeIcon(ev.type) + ' ' + escapeHtml(title) + '</span>' +
        '</div>' +
        '<div style="margin-top:12px;">';

    // Detail rows
    html += detailRow('Type', typeLabel(ev.type));
    html += detailRow('Dato', formatDateLong(ev.start_time));
    html += detailRow('Klokkeslett', formatTime(ev.start_time));
    html += detailRow('Varighet', (ev.duration_minutes || 60) + ' min');

    if (isMatch && ev.opponent) html += detailRow('Motstander', ev.opponent);
    if (isMatch) html += detailRow('Hjemme/Borte', ev.is_home ? 'Hjemme' : 'Borte');
    if (ev.location) html += detailRow('Sted', ev.location);
    if (ev.format) html += detailRow('Format', formatLabel(ev.format));
    if (ev.notes) html += detailRow('Notat', ev.notes);

    html += '</div>';

    // Action buttons
    if (isMatch) {
      html +=
        '<button class="btn-primary" id="snOpenKampdag" style="width:100%;margin-top:20px;">' +
          '<i class="fas fa-clipboard-list" style="margin-right:6px;"></i>\u00C5pne i Kampdag' +
        '</button>';
    }

    html +=
      '<div class="sn-detail-actions">' +
        '<button class="btn-secondary" id="snEditEvent"><i class="fas fa-pen" style="margin-right:5px;"></i>Rediger</button>' +
        '<button class="sn-btn-danger" id="snDeleteEvent"><i class="fas fa-trash" style="margin-right:5px;"></i>Slett</button>' +
      '</div>';

    html += '</div>';

    root.innerHTML = html;

    $('snBackFromDetail').addEventListener('click', goToDashboard);

    if ($('snOpenKampdag')) {
      $('snOpenKampdag').addEventListener('click', function() {
        openInKampdag(ev);
      });
    }

    $('snEditEvent').addEventListener('click', function() {
      snView = 'edit-event';
      render();
    });

    $('snDeleteEvent').addEventListener('click', async function() {
      if (!confirm('Slett denne hendelsen?')) return;

      var btn = $('snDeleteEvent');
      btn.disabled = true;
      btn.textContent = 'Sletter\u2026';

      var ok = await deleteEvent(ev.id);
      if (ok) {
        editingEvent = null;
        await loadEvents(currentSeason.id);
        snView = 'dashboard';
        render();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash" style="margin-right:5px;"></i>Slett';
      }
    });
  }

  function detailRow(label, value) {
    return '<div class="sn-detail-row">' +
      '<div class="sn-detail-label">' + escapeHtml(label) + '</div>' +
      '<div class="sn-detail-value">' + escapeHtml(value) + '</div>' +
    '</div>';
  }

  // =========================================================================
  //  KAMPDAG INTEGRATION (steg 7)
  // =========================================================================

  function openInKampdag(ev) {
    var players = window.players || [];
    var playerIds = players.map(function(p) { return p.id; });

    window.kampdagPrefill({
      format: ev.format || (currentSeason ? currentSeason.format : 7),
      minutes: ev.duration_minutes || 60,
      playerIds: playerIds
    });

    if (window.__BF_switchTab) window.__BF_switchTab('kampdag');
  }

  // =========================================================================
  //  NAVIGATION HELPERS
  // =========================================================================

  function goToList() {
    currentSeason = null;
    events = [];
    editingEvent = null;
    snView = 'list';
    loadSeasons();
  }

  function goToDashboard() {
    editingEvent = null;
    snView = 'dashboard';
    render();
  }

  async function openSeason(seasonId) {
    var s = seasons.find(function(x) { return x.id === seasonId; });
    if (!s) return;
    currentSeason = s;
    await loadEvents(seasonId);
    snView = 'dashboard';
    render();
  }

})();
