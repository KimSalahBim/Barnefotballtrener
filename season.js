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
  var seasonPlayers = [];
  var dashTab = 'calendar'; // 'calendar' | 'roster' | 'stats'
  var snView = 'list'; // 'list' | 'create-season' | 'dashboard' | 'create-event' | 'edit-event' | 'event-detail' | 'roster-import'
  var editingEvent = null; // event object when editing
  var editingSeasonPlayer = null; // season player object when editing
  var embeddedKampdagEvent = null; // event for embedded kampdag
  var embeddedKampdagTropp = null; // tropp players for embedded kampdag

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

  // NFF standard kampvarighet per format
  function defaultMatchMinutes(format) {
    return { 3: 20, 5: 40, 7: 60, 9: 70, 11: 80 }[format] || 60;
  }

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

  // Build a local date string for input[type=date]
  function toLocalDate(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    } catch (e) { return ''; }
  }

  // Build a local time string for input[type=time]
  function toLocalTime(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      var h = String(d.getHours()).padStart(2, '0');
      var min = String(d.getMinutes()).padStart(2, '0');
      return h + ':' + min;
    } catch (e) { return ''; }
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

      // Dashboard tabs
      '.sn-tabs { display:flex; gap:0; margin:12px 0 4px; border-bottom:2px solid var(--border); }',
      '.sn-tab { flex:1; padding:10px 8px; border:none; background:none; font-size:14px; font-weight:600; color:var(--text-400); cursor:pointer; font-family:inherit; position:relative; transition:color 0.15s; }',
      '.sn-tab.active { color:var(--primary, #2563eb); }',
      '.sn-tab.active::after { content:""; position:absolute; bottom:-2px; left:0; right:0; height:2px; background:var(--primary, #2563eb); border-radius:2px 2px 0 0; }',
      '.sn-tab:hover:not(.active) { color:var(--text-600); }',

      // Roster
      '.sn-roster-item { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); }',
      '.sn-roster-item:last-child { border-bottom:none; }',
      '.sn-roster-name { flex:1; font-size:15px; font-weight:600; color:var(--text-800); }',
      '.sn-roster-badges { display:flex; gap:4px; align-items:center; }',
      '.sn-badge { display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700; line-height:1.4; }',
      '.sn-badge-keeper { background:rgba(234,179,8,0.15); color:#a16207; }',
      '.sn-badge-pos { background:rgba(59,130,246,0.1); color:#2563eb; }',
      '.sn-badge-skill { background:rgba(34,197,94,0.1); color:#16a34a; }',
      '.sn-roster-remove { background:none; border:none; color:var(--text-300); cursor:pointer; padding:4px 8px; font-size:16px; border-radius:var(--radius-sm); }',
      '.sn-roster-remove:hover { color:var(--error); background:var(--error-dim, #fef2f2); }',
      '.sn-roster-count { font-size:13px; color:var(--text-400); margin-left:4px; }',
      '.sn-roster-empty { text-align:center; padding:32px 20px; color:var(--text-400); }',

      // Attendance
      '.sn-att-list { padding:0; }',
      '.sn-att-item { display:flex; align-items:center; gap:10px; padding:11px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); cursor:pointer; -webkit-tap-highlight-color:transparent; }',
      '.sn-att-item:last-child { border-bottom:none; }',
      '.sn-att-item.absent { opacity:0.45; }',
      '.sn-att-check { width:22px; height:22px; border-radius:6px; border:2px solid var(--border); display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.15s; font-size:13px; color:transparent; }',
      '.sn-att-item.present .sn-att-check { background:var(--success, #22c55e); border-color:var(--success, #22c55e); color:#fff; }',
      '.sn-att-name { flex:1; font-size:15px; font-weight:500; }',
      '.sn-att-summary { padding:12px 14px; font-size:14px; color:var(--text-600); font-weight:600; text-align:center; border-top:2px solid var(--border-light, #f1f5f9); }',
      '.sn-att-badge { width:20px; height:20px; border-radius:50%; background:var(--success, #22c55e); color:#fff; font-size:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }',
      '.sn-att-reason { display:flex; gap:4px; padding:2px 14px 10px 46px; }',
      '.sn-reason-btn { padding:4px 10px; border-radius:12px; border:1px solid var(--border); background:var(--bg); font-size:11px; color:var(--text-400); cursor:pointer; font-family:inherit; transition:all 0.15s; }',
      '.sn-reason-btn.active { background:var(--error-dim, #fef2f2); border-color:var(--error, #ef4444); color:var(--error, #ef4444); font-weight:600; }',

      // Stats
      '.sn-stats-cards { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }',
      '.sn-stat-card { background:var(--bg-card); border:1px solid var(--border-light, #f1f5f9); border-radius:var(--radius-lg); padding:14px; text-align:center; }',
      '.sn-stat-num { font-size:24px; font-weight:700; color:var(--text-800); }',
      '.sn-stat-label { font-size:11px; color:var(--text-400); margin-top:2px; text-transform:uppercase; letter-spacing:0.5px; }',
      '.sn-stat-table { width:100%; border-collapse:collapse; font-size:13px; }',
      '.sn-stat-table th { text-align:left; padding:8px 10px; font-weight:600; color:var(--text-400); font-size:11px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid var(--border); }',
      '.sn-stat-table td { padding:10px 10px; border-bottom:1px solid var(--border-light, #f1f5f9); }',
      '.sn-stat-table tr:last-child td { border-bottom:none; }',
      '.sn-stat-table .sn-pname { font-weight:600; color:var(--text-800); }',
      '.sn-stat-table td:not(:first-child) { text-align:center; }',
      '.sn-stat-table th:not(:first-child) { text-align:center; }',
      '.sn-bar-wrap { height:6px; background:var(--border-light, #e2e8f0); border-radius:3px; margin-top:4px; overflow:hidden; }',
      '.sn-bar-fill { height:100%; border-radius:3px; transition:width 0.3s; }',
      '.sn-fair-badge { display:inline-block; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600; }',
      '.sn-fair-good { background:rgba(34,197,94,0.12); color:#16a34a; }',
      '.sn-fair-ok { background:rgba(234,179,8,0.12); color:#a16207; }',
      '.sn-fair-bad { background:rgba(239,68,68,0.12); color:#dc2626; }',
      '.sn-player-stat-row { cursor:pointer; }',
      '.sn-player-stat-row:active { background:var(--bg-hover, #f8fafc); }',

      // Tropp
      '.sn-tropp-hint { font-size:11px; color:var(--text-300); margin-left:auto; white-space:nowrap; }',
      '.sn-tropp-low { color:var(--error, #ef4444); font-weight:600; }',

      // Result
      '.sn-result-box { display:flex; align-items:center; justify-content:center; gap:12px; padding:16px; }',
      '.sn-score-input { width:56px; height:56px; text-align:center; font-size:28px; font-weight:700; border:2px solid var(--border); border-radius:var(--radius-lg); background:var(--bg); color:var(--text-800); font-family:inherit; }',
      '.sn-score-input:focus { border-color:var(--primary, #2563eb); outline:none; }',
      '.sn-score-dash { font-size:28px; font-weight:300; color:var(--text-300); }',
      '.sn-score-label { font-size:11px; color:var(--text-400); text-align:center; margin-top:2px; }',
      '.sn-result-display { display:flex; align-items:center; justify-content:center; gap:12px; padding:12px; }',
      '.sn-result-num { font-size:32px; font-weight:800; color:var(--text-800); }',
      '.sn-result-dash { font-size:24px; color:var(--text-300); }',
      '.sn-nff-warning { padding:12px 14px; margin:10px 0; border-radius:var(--radius-lg); background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.2); font-size:12px; line-height:1.5; color:#92400e; }',
      '.sn-nff-warning i { margin-right:6px; }',
      '.sn-goal-item { display:flex; align-items:center; gap:8px; padding:8px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); font-size:14px; }',
      '.sn-goal-item:last-child { border-bottom:none; }',
      '.sn-goal-remove { background:none; border:none; color:var(--text-300); cursor:pointer; padding:4px; font-size:16px; }',
      '.sn-goal-dup { background:none; border:1px solid var(--border); color:var(--primary, #2563eb); cursor:pointer; padding:2px 8px; font-size:16px; font-weight:700; border-radius:6px; margin-left:auto; line-height:1; }',
      '.sn-goal-dup:active { background:var(--primary, #2563eb); color:#fff; }',
      '.sn-goal-add { display:flex; gap:6px; padding:10px 14px; align-items:flex-end; }',
      '.sn-goal-select { flex:1; padding:8px; border:1px solid var(--border); border-radius:var(--radius-sm); font-family:inherit; font-size:13px; background:var(--bg); }',
      '.sn-goal-min { width:50px; padding:8px; border:1px solid var(--border); border-radius:var(--radius-sm); font-family:inherit; font-size:13px; text-align:center; }',
      '.sn-goal-add-btn { padding:8px 12px; border:none; background:var(--primary, #2563eb); color:#fff; border-radius:var(--radius-sm); cursor:pointer; font-size:13px; font-weight:600; white-space:nowrap; }',
      '.sn-completed-badge { display:inline-block; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:600; background:rgba(34,197,94,0.12); color:#16a34a; margin-left:8px; }',

      // Import checkboxes
      '.sn-import-item { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); cursor:pointer; }',
      '.sn-import-item:hover { background:var(--bg-hover, #f8fafc); }',
      '.sn-import-cb { width:18px; height:18px; accent-color:var(--primary, #2563eb); cursor:pointer; }',

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
    // Clean up embedded kampdag if active
    if (window.sesongKampdag && window.sesongKampdag.isActive()) {
      window.sesongKampdag.destroy();
    }
    embeddedKampdagEvent = null;
    embeddedKampdagTropp = null;
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
        duration_minutes: parseInt(data.duration_minutes) || defaultMatchMinutes(currentSeason ? currentSeason.format : 7),
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
  //  CRUD: SEASON PLAYERS (Fase 2)
  // =========================================================================

  async function loadSeasonPlayers(seasonId) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !seasonId) { seasonPlayers = []; return; }

    try {
      var res = await sb.from('season_players')
        .select('*')
        .eq('season_id', seasonId)
        .eq('user_id', uid)
        .order('player_name', { ascending: true });
      if (res.error) throw res.error;
      seasonPlayers = (res.data || []).map(function(row) {
        return {
          id: row.id,
          season_id: row.season_id,
          player_id: row.player_id,
          name: row.player_name,
          skill: row.player_skill || 3,
          goalie: !!row.player_goalie,
          positions: row.player_positions || ['F','M','A'],
          active: row.active !== false
        };
      });
    } catch (e) {
      console.error('[season.js] loadSeasonPlayers error:', e);
      seasonPlayers = [];
    }
  }

  async function importPlayersToSeason(seasonId, players) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !seasonId || !players.length) return false;

    try {
      var rows = players.map(function(p) {
        return {
          season_id: seasonId,
          user_id: uid,
          player_id: p.id,
          player_name: p.name,
          player_skill: p.skill || 3,
          player_goalie: !!p.goalie,
          player_positions: p.positions || ['F','M','A'],
          active: true
        };
      });

      var res = await sb.from('season_players')
        .upsert(rows, { onConflict: 'season_id,player_id' });
      if (res.error) throw res.error;

      await loadSeasonPlayers(seasonId);
      notify(players.length + ' spiller' + (players.length === 1 ? '' : 'e') + ' importert.', 'success');
      return true;
    } catch (e) {
      console.error('[season.js] importPlayersToSeason error:', e);
      notify('Feil ved import av spillere.', 'error');
      return false;
    }
  }

  async function removeSeasonPlayer(rowId) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) return false;

    try {
      var res = await sb.from('season_players').delete().eq('id', rowId).eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[season.js] removeSeasonPlayer error:', e);
      notify('Feil ved fjerning.', 'error');
      return false;
    }
  }

  async function updateSeasonPlayer(rowId, fields) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) return false;

    try {
      var res = await sb.from('season_players')
        .update(fields)
        .eq('id', rowId)
        .eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[season.js] updateSeasonPlayer error:', e);
      notify('Feil ved oppdatering.', 'error');
      return false;
    }
  }

  // =========================================================================
  //  CRUD: TRAINING SERIES (Fase 2, Steg 3)
  // =========================================================================

  var DAY_NAMES = ['S\u00f8ndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'L\u00f8rdag'];

  // Generate all dates for a given day-of-week between start and end (inclusive)
  function generateSeriesDates(dayOfWeek, startDate, endDate) {
    var dates = [];
    var d = new Date(startDate + 'T00:00:00');
    var end = new Date(endDate + 'T23:59:59');

    // Advance to first occurrence of dayOfWeek
    while (d.getDay() !== dayOfWeek && d <= end) {
      d.setDate(d.getDate() + 1);
    }

    while (d <= end) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
    return dates;
  }

  async function createTrainingSeries(seasonId, data) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !seasonId) return false;

    try {
      // 1. Insert the series record
      var seriesRes = await sb.from('training_series').insert({
        season_id: seasonId,
        user_id: uid,
        title: data.title || (DAY_NAMES[data.day_of_week] + 'strening'),
        day_of_week: data.day_of_week,
        start_time: data.start_time,
        duration_minutes: data.duration_minutes || 90,
        location: data.location || null,
        start_date: data.start_date,
        end_date: data.end_date
      }).select('id').single();

      if (seriesRes.error) throw seriesRes.error;
      var seriesId = seriesRes.data.id;

      // 2. Generate individual events
      var dates = generateSeriesDates(data.day_of_week, data.start_date, data.end_date);
      if (dates.length === 0) {
        notify('Ingen treningsdatoer i valgt periode.', 'warning');
        return false;
      }

      var title = data.title || (DAY_NAMES[data.day_of_week] + 'strening');
      var eventRows = dates.map(function(dt) {
        // Combine date with time
        var parts = data.start_time.split(':');
        dt.setHours(parseInt(parts[0]) || 17, parseInt(parts[1]) || 0, 0, 0);

        return {
          season_id: seasonId,
          user_id: uid,
          type: 'training',
          title: title,
          start_time: dt.toISOString(),
          duration_minutes: data.duration_minutes || 90,
          location: data.location || null,
          series_id: seriesId
        };
      });

      // Insert in batches of 50 (Supabase limit)
      for (var i = 0; i < eventRows.length; i += 50) {
        var batch = eventRows.slice(i, i + 50);
        var batchRes = await sb.from('events').insert(batch);
        if (batchRes.error) throw batchRes.error;
      }

      notify(dates.length + ' treninger opprettet.', 'success');
      return true;
    } catch (e) {
      console.error('[season.js] createTrainingSeries error:', e);
      notify('Feil ved oppretting av treningsserie.', 'error');
      return false;
    }
  }

  // =========================================================================
  //  CRUD: EVENT PLAYERS / ATTENDANCE (Fase 2, Steg 4)
  // =========================================================================

  var eventAttendance = []; // loaded per event
  var seasonStats = [];     // all event_players for the season
  var registeredEventIds = {}; // { event_id: true } for events with saved attendance
  var matchGoals = [];          // goals for current event

  async function loadEventAttendance(eventId) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !eventId) { eventAttendance = []; return; }

    try {
      var res = await sb.from('event_players')
        .select('*')
        .eq('event_id', eventId)
        .eq('user_id', uid);
      if (res.error) throw res.error;
      eventAttendance = res.data || [];
    } catch (e) {
      console.error('[season.js] loadEventAttendance error:', e);
      eventAttendance = [];
    }
  }

  async function saveAttendance(eventId, seasonId, attendanceMap, reasonMap, squadList) {
    // attendanceMap = { player_id: true/false }
    // reasonMap = { player_id: 'syk'|'skade'|'borte'|null } (optional)
    // squadList = ['player_id', ...] or null (for matches)
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !eventId || !seasonId) return false;

    var squadSet = {};
    if (squadList) {
      for (var q = 0; q < squadList.length; q++) squadSet[squadList[q]] = true;
    }

    try {
      var rows = [];
      var playerIds = Object.keys(attendanceMap);
      for (var i = 0; i < playerIds.length; i++) {
        var pid = playerIds[i];
        var row = {
          event_id: eventId,
          season_id: seasonId,
          user_id: uid,
          player_id: pid,
          attended: attendanceMap[pid]
        };
        if (squadList) {
          row.in_squad = !!squadSet[pid];
        }
        if (reasonMap && reasonMap[pid] && !attendanceMap[pid]) {
          row.absence_reason = reasonMap[pid];
        }
        rows.push(row);
      }

      var res = await sb.from('event_players')
        .upsert(rows, { onConflict: 'event_id,player_id' });
      if (res.error) throw res.error;

      // Mark this event as registered
      registeredEventIds[eventId] = true;

      notify('Oppm\u00f8te lagret.', 'success');
      return true;
    } catch (e) {
      console.error('[season.js] saveAttendance error:', e);
      notify('Feil ved lagring av oppm\u00f8te.', 'error');
      return false;
    }
  }

  async function loadRegisteredEventIds(seasonId) {
    var sb = getSb();
    var uid = getUserId();
    registeredEventIds = {};
    if (!sb || !uid || !seasonId) return;

    try {
      // Get distinct event_ids that have attendance data
      var res = await sb.from('event_players')
        .select('event_id')
        .eq('season_id', seasonId)
        .eq('user_id', uid);
      if (res.error) throw res.error;
      var rows = res.data || [];
      for (var i = 0; i < rows.length; i++) {
        registeredEventIds[rows[i].event_id] = true;
      }
    } catch (e) {
      console.error('[season.js] loadRegisteredEventIds error:', e);
    }
  }

  // =========================================================================
  //  CRUD: MATCH RESULT & GOALS (Fase 2, Steg 6)
  // =========================================================================

  async function loadMatchGoals(eventId) {
    var sb = getSb();
    var uid = getUserId();
    matchGoals = [];
    if (!sb || !uid || !eventId) return;

    try {
      var res = await sb.from('match_events')
        .select('*')
        .eq('event_id', eventId)
        .eq('user_id', uid)
        .order('minute', { ascending: true, nullsFirst: false });
      if (res.error) throw res.error;
      matchGoals = res.data || [];
    } catch (e) {
      console.error('[season.js] loadMatchGoals error:', e);
      matchGoals = [];
    }
  }

  async function saveMatchResult(eventId, resultHome, resultAway, status) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !eventId) return false;

    try {
      var fields = { status: status || 'completed' };
      if (resultHome !== null && resultHome !== '') fields.result_home = parseInt(resultHome);
      if (resultAway !== null && resultAway !== '') fields.result_away = parseInt(resultAway);

      var res = await sb.from('events')
        .update(fields)
        .eq('id', eventId)
        .eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[season.js] saveMatchResult error:', e);
      notify('Feil ved lagring av resultat.', 'error');
      return false;
    }
  }

  async function addMatchEvent(eventId, playerId, playerName, eventType) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !eventId) return false;

    try {
      var row = {
        event_id: eventId,
        user_id: uid,
        player_id: playerId,
        player_name: playerName,
        type: eventType || 'goal'
      };

      var res = await sb.from('match_events').insert(row);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[season.js] addMatchEvent error:', e);
      notify('Feil ved registrering.', 'error');
      return false;
    }
  }

  async function removeMatchGoal(goalId) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !goalId) return false;

    try {
      var res = await sb.from('match_events')
        .delete()
        .eq('id', goalId)
        .eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[season.js] removeMatchGoal error:', e);
      return false;
    }
  }

  function isBarnefotball() {
    var fmt = (editingEvent && editingEvent.format) || (currentSeason && currentSeason.format) || 7;
    return fmt <= 9; // 3v3, 5v5, 7v7, 9v9 = barnefotball (under 13)
  }

  async function loadSeasonStats(seasonId) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !seasonId) { seasonStats = []; return; }

    try {
      var res = await sb.from('event_players')
        .select('*')
        .eq('season_id', seasonId)
        .eq('user_id', uid);
      if (res.error) throw res.error;
      seasonStats = res.data || [];
    } catch (e) {
      console.error('[season.js] loadSeasonStats error:', e);
      seasonStats = [];
    }
  }

  var seasonGoals = []; // all match_events for the season

  async function loadSeasonGoals(seasonId) {
    var sb = getSb();
    var uid = getUserId();
    seasonGoals = [];
    if (!sb || !uid || !seasonId) return;

    try {
      // Get all goals for events in this season
      var eventIds = events
        .filter(function(e) { return e.type === 'match' || e.type === 'cup_match'; })
        .map(function(e) { return e.id; });

      if (eventIds.length === 0) return;

      var res = await sb.from('match_events')
        .select('*')
        .in('event_id', eventIds)
        .eq('user_id', uid);
      if (res.error) throw res.error;
      seasonGoals = res.data || [];
    } catch (e) {
      console.error('[season.js] loadSeasonGoals error:', e);
      seasonGoals = [];
    }
  }

  function computeStats() {
    var players = seasonPlayers.filter(function(p) { return p.active; });

    // Categorize events
    var matchEvts = events.filter(function(e) { return e.type === 'match' || e.type === 'cup_match'; });
    var trainingEvts = events.filter(function(e) { return e.type === 'training'; });

    // Registered events
    var regIds = {};
    for (var s = 0; s < seasonStats.length; s++) {
      regIds[seasonStats[s].event_id] = true;
    }
    var registeredMatches = matchEvts.filter(function(e) { return regIds[e.id]; });
    var registeredTrainings = trainingEvts.filter(function(e) { return regIds[e.id]; });

    // Completed matches with results
    var completedMatches = matchEvts.filter(function(e) {
      return e.status === 'completed' && e.result_home !== null && e.result_home !== undefined;
    });
    var wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    for (var cm = 0; cm < completedMatches.length; cm++) {
      var m = completedMatches[cm];
      var ourGoals = m.is_home ? m.result_home : m.result_away;
      var theirGoals = m.is_home ? m.result_away : m.result_home;
      goalsFor += (ourGoals || 0);
      goalsAgainst += (theirGoals || 0);
      if (ourGoals > theirGoals) wins++;
      else if (ourGoals < theirGoals) losses++;
      else draws++;
    }

    // Per-player lookup
    var playerMap = {};
    for (var i = 0; i < players.length; i++) {
      playerMap[players[i].player_id] = {
        player: players[i],
        matchesAttended: 0,
        trainingsAttended: 0,
        minutesPlayed: 0,
        totalEvents: 0,
        goals: 0,
        assists: 0
      };
    }

    // Event type map
    var eventTypeMap = {};
    for (var e = 0; e < events.length; e++) {
      eventTypeMap[events[e].id] = events[e].type;
    }

    // Attendance
    for (var j = 0; j < seasonStats.length; j++) {
      var row = seasonStats[j];
      if (!playerMap[row.player_id]) continue;
      if (row.attended !== true) continue;

      var evType = eventTypeMap[row.event_id];
      if (evType === 'match' || evType === 'cup_match') {
        playerMap[row.player_id].matchesAttended++;
      } else if (evType === 'training') {
        playerMap[row.player_id].trainingsAttended++;
      }
      playerMap[row.player_id].totalEvents++;
      if (row.minutes_played) {
        playerMap[row.player_id].minutesPlayed += row.minutes_played;
      }
    }

    // Goals & assists from seasonGoals (by type field)
    for (var g = 0; g < seasonGoals.length; g++) {
      var me = seasonGoals[g];
      if (!playerMap[me.player_id]) continue;
      if (me.type === 'goal') {
        playerMap[me.player_id].goals++;
      } else if (me.type === 'assist') {
        playerMap[me.player_id].assists++;
      }
    }

    // Convert to sorted array
    var result = [];
    for (var pid in playerMap) {
      result.push(playerMap[pid]);
    }

    result.sort(function(a, b) {
      if (b.totalEvents !== a.totalEvents) return b.totalEvents - a.totalEvents;
      return a.player.name.localeCompare(b.player.name);
    });

    // Top scorers (sorted by goals desc)
    var topScorers = result.filter(function(p) { return p.goals > 0; });
    topScorers.sort(function(a, b) {
      if (b.goals !== a.goals) return b.goals - a.goals;
      if (b.assists !== a.assists) return b.assists - a.assists;
      return a.player.name.localeCompare(b.player.name);
    });

    var topAssisters = result.filter(function(p) { return p.assists > 0; });
    topAssisters.sort(function(a, b) {
      if (b.assists !== a.assists) return b.assists - a.assists;
      if (b.goals !== a.goals) return b.goals - a.goals;
      return a.player.name.localeCompare(b.player.name);
    });

    var totalGoalsCount = 0;
    var totalAssists = 0;
    for (var ta = 0; ta < seasonGoals.length; ta++) {
      if (seasonGoals[ta].type === 'goal') totalGoalsCount++;
      else if (seasonGoals[ta].type === 'assist') totalAssists++;
    }

    return {
      players: result,
      totalMatches: registeredMatches.length,
      totalTrainings: registeredTrainings.length,
      allMatches: matchEvts.length,
      allTrainings: trainingEvts.length,
      completedMatches: completedMatches.length,
      wins: wins,
      draws: draws,
      losses: losses,
      goalsFor: goalsFor,
      goalsAgainst: goalsAgainst,
      topScorers: topScorers,
      topAssisters: topAssisters,
      totalGoals: totalGoalsCount,
      totalAssists: totalAssists
    };
  }

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
      case 'roster-import':  renderRosterImport(root); break;
      case 'roster-add-manual': renderManualPlayerAdd(root); break;
      case 'roster-edit-player': renderEditPlayer(root); break;
      case 'create-series': renderCreateSeries(root); break;
      case 'player-stats': renderPlayerStats(root); break;
      case 'embedded-kampdag': renderEmbeddedKampdag(root); break;
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

    var rosterCount = seasonPlayers.filter(function(p) { return p.active; }).length;

    var html =
      '<div class="settings-card" style="margin-bottom:0; border-radius:var(--radius-lg) var(--radius-lg) 0 0; padding-bottom:0;">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromDash">\u2190</button>' +
          '<span class="sn-dash-title">' + escapeHtml(s.name) + '</span>' +
        '</div>' +
        '<div class="sn-dash-meta">' + escapeHtml(metaParts.join(' \u00B7 ')) + '</div>' +
        '<div class="sn-tabs">' +
          '<button class="sn-tab' + (dashTab === 'calendar' ? ' active' : '') + '" data-dtab="calendar"><i class="fas fa-calendar-alt" style="margin-right:4px;"></i>Kalender</button>' +
          '<button class="sn-tab' + (dashTab === 'roster' ? ' active' : '') + '" data-dtab="roster"><i class="fas fa-users" style="margin-right:4px;"></i>Stall' + (rosterCount > 0 ? ' <span class="sn-roster-count">(' + rosterCount + ')</span>' : '') + '</button>' +
          '<button class="sn-tab' + (dashTab === 'stats' ? ' active' : '') + '" data-dtab="stats"><i class="fas fa-chart-bar" style="margin-right:4px;"></i>Statistikk</button>' +
        '</div>' +
      '</div>';

    // Tab content
    if (dashTab === 'calendar') {
      html += renderCalendarTab();
    } else if (dashTab === 'roster') {
      html += renderRosterTab();
    } else if (dashTab === 'stats') {
      html += renderStatsTab();
    }

    root.innerHTML = html;

    // Bind tab clicks
    var tabs = root.querySelectorAll('.sn-tab');
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener('click', async function() {
        var newTab = this.getAttribute('data-dtab');
        if (newTab === 'stats' && dashTab !== 'stats') {
          await Promise.all([loadSeasonStats(currentSeason.id), loadSeasonGoals(currentSeason.id)]);
        }
        dashTab = newTab;
        render();
      });
    }

    // Bind back button
    $('snBackFromDash').addEventListener('click', goToList);

    // Bind tab-specific handlers
    if (dashTab === 'calendar') {
      bindCalendarHandlers(root);
    } else if (dashTab === 'roster') {
      bindRosterHandlers(root);
    } else if (dashTab === 'stats') {
      bindStatsHandlers(root);
    }
  }

  // =========================================================================
  //  DASHBOARD TAB: KALENDER
  // =========================================================================

  function renderCalendarTab() {
    var s = currentSeason;
    var html =
      '<div class="settings-card" style="margin-top:0; border-radius:0 0 var(--radius-lg) var(--radius-lg); padding-top:12px;">' +
        '<div class="sn-actions">' +
          '<button class="btn-primary" id="snAddMatch"><i class="fas fa-futbol" style="margin-right:5px;"></i>Legg til kamp</button>' +
          '<button class="btn-secondary" id="snAddTraining"><i class="fas fa-dumbbell" style="margin-right:5px;"></i>Legg til trening</button>' +
        '</div>' +
        '<div style="margin-top:8px;">' +
          '<button class="btn-secondary" id="snAddSeries" style="width:100%; font-size:13px;"><i class="fas fa-redo" style="margin-right:5px;"></i>Opprett treningsserie</button>' +
        '</div>' +
      '</div>';

    // Split events
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

    return html;
  }

  function bindCalendarHandlers(root) {
    var addMatch = $('snAddMatch');
    if (addMatch) addMatch.addEventListener('click', function() {
      editingEvent = null;
      snView = 'create-event';
      render();
      setTimeout(function() { var el = $('snEventType'); if (el) { el.value = 'match'; el.dispatchEvent(new Event('change')); } }, 20);
    });

    var addTraining = $('snAddTraining');
    if (addTraining) addTraining.addEventListener('click', function() {
      editingEvent = null;
      snView = 'create-event';
      render();
      setTimeout(function() { var el = $('snEventType'); if (el) { el.value = 'training'; el.dispatchEvent(new Event('change')); } }, 20);
    });

    var addSeries = $('snAddSeries');
    if (addSeries) addSeries.addEventListener('click', function() {
      snView = 'create-series';
      render();
    });

    var delBtn = $('snDeleteSeason');
    if (delBtn) delBtn.addEventListener('click', async function() {
      var s = currentSeason;
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
        seasonPlayers = [];
        snView = 'list';
        await loadSeasons();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash" style="margin-right:6px;"></i>Slett sesong';
      }
    });

    bindEventItemClicks(root);
  }

  // =========================================================================
  //  DASHBOARD TAB: SPILLERSTALL
  // =========================================================================

  function renderRosterTab() {
    var active = seasonPlayers.filter(function(p) { return p.active; });

    var html =
      '<div class="settings-card" style="margin-top:0; border-radius:0 0 var(--radius-lg) var(--radius-lg); padding-top:12px;">' +
        '<div class="sn-actions">' +
          '<button class="btn-primary" id="snImportPlayers" style="flex:1;"><i class="fas fa-download" style="margin-right:5px;"></i>Importer fra Spillere</button>' +
          '<button class="btn-secondary" id="snAddManualPlayer" style="flex:0 0 auto;"><i class="fas fa-plus"></i></button>' +
        '</div>' +
      '</div>';

    if (active.length === 0) {
      html +=
        '<div class="sn-roster-empty">' +
          '<div style="font-size:36px; margin-bottom:12px;">👥</div>' +
          '<div style="font-weight:600; margin-bottom:6px;">Ingen spillere i sesongen</div>' +
          '<div>Importer spillere fra Spillere-fanen for \u00e5 komme i gang.</div>' +
        '</div>';
    } else {
      html += '<div class="sn-section">Spillere (' + active.length + ')</div>';
      html += '<div class="settings-card" style="padding:0;">';

      for (var i = 0; i < active.length; i++) {
        var p = active[i];
        var posLabels = (p.positions || []).join('/');
        html +=
          '<div class="sn-roster-item" data-spid="' + p.id + '" style="cursor:pointer;">' +
            '<div class="sn-roster-name">' + escapeHtml(p.name) + '</div>' +
            '<div class="sn-roster-badges">' +
              (p.goalie ? '<span class="sn-badge sn-badge-keeper">Kan stå i mål</span>' : '') +
              '<span class="sn-badge sn-badge-pos">' + escapeHtml(posLabels) + '</span>' +
              '<span class="sn-badge sn-badge-skill">' + p.skill + '</span>' +
            '</div>' +
            '<div class="sn-event-arrow">\u203A</div>' +
          '</div>';
      }

      html += '</div>';
    }

    return html;
  }

  function bindRosterHandlers(root) {
    var importBtn = $('snImportPlayers');
    if (importBtn) importBtn.addEventListener('click', function() {
      snView = 'roster-import';
      render();
    });

    // Manual add
    var addBtn = $('snAddManualPlayer');
    if (addBtn) addBtn.addEventListener('click', function() {
      snView = 'roster-add-manual';
      render();
    });

    // Click on player to edit
    var items = root.querySelectorAll('.sn-roster-item[data-spid]');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', (function(spid) {
        return async function() {
          editingSeasonPlayer = seasonPlayers.find(function(p) { return p.id === spid; });
          if (editingSeasonPlayer) {
            var loads = [];
            if (seasonStats.length === 0) loads.push(loadSeasonStats(currentSeason.id));
            if (seasonGoals.length === 0) loads.push(loadSeasonGoals(currentSeason.id));
            if (loads.length > 0) await Promise.all(loads);
            snView = 'player-stats';
            render();
          }
        };
      })(items[i].getAttribute('data-spid')));
    }
  }

  // =========================================================================
  //  DASHBOARD TAB: STATISTIKK
  // =========================================================================

  function renderStatsTab() {
    var stats = computeStats();
    var p = stats.players;
    var barnefotball = isBarnefotball();

    var html =
      '<div class="settings-card" style="margin-top:0; border-radius:0 0 var(--radius-lg) var(--radius-lg); padding-top:16px;">';

    // Summary cards row 1: Activity
    html += '<div class="sn-stats-cards">';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + stats.totalTrainings + '<span style="font-size:14px; color:var(--text-400);">/' + stats.allTrainings + '</span></div>' +
        '<div class="sn-stat-label">Treninger reg.</div>' +
      '</div>';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + stats.completedMatches + '<span style="font-size:14px; color:var(--text-400);">/' + stats.allMatches + '</span></div>' +
        '<div class="sn-stat-label">Kamper spilt</div>' +
      '</div>';
    html += '</div>';

    // Match record (only if completed matches exist)
    if (stats.completedMatches > 0) {
      html += '<div class="sn-stats-cards" style="margin-top:8px;">';
      html +=
        '<div class="sn-stat-card">' +
          '<div class="sn-stat-num" style="font-size:18px;">' +
            '<span style="color:var(--success, #22c55e);">' + stats.wins + 'S</span> ' +
            '<span style="color:var(--text-400);">' + stats.draws + 'U</span> ' +
            '<span style="color:var(--error, #ef4444);">' + stats.losses + 'T</span>' +
          '</div>' +
          '<div class="sn-stat-label">Seier / Uavgjort / Tap</div>' +
        '</div>';
      html +=
        '<div class="sn-stat-card">' +
          '<div class="sn-stat-num">' + stats.goalsFor + '<span style="font-size:14px; color:var(--text-400);"> \u2013 ' + stats.goalsAgainst + '</span></div>' +
          '<div class="sn-stat-label">M\u00e5l for / mot</div>' +
        '</div>';
      html += '</div>';
    }

    // Fairness indicator
    if (p.length > 0 && (stats.totalTrainings + stats.totalMatches) > 0) {
      var attendances = p.map(function(x) { return x.totalEvents; });
      var avg = attendances.reduce(function(a, b) { return a + b; }, 0) / attendances.length;

      if (avg > 0) {
        var maxDev = 0;
        for (var f = 0; f < attendances.length; f++) {
          var dev = Math.abs(attendances[f] - avg) / avg;
          if (dev > maxDev) maxDev = dev;
        }

        var fairClass, fairText;
        if (maxDev <= 0.15) {
          fairClass = 'sn-fair-good';
          fairText = '\u2705 Jevnt fordelt oppm\u00f8te';
        } else if (maxDev <= 0.30) {
          fairClass = 'sn-fair-ok';
          fairText = '\u26a0\ufe0f Noe ujevnt oppm\u00f8te';
        } else {
          fairClass = 'sn-fair-bad';
          fairText = '\u26a0\ufe0f Skjevt fordelt \u2014 noen spillere faller etter';
        }

        html += '<div style="text-align:center; margin:10px 0;"><span class="sn-fair-badge ' + fairClass + '">' + fairText + '</span></div>';
      }
    }

    html += '</div>';

    // No data state
    if (p.length === 0 || (stats.totalTrainings + stats.totalMatches + stats.completedMatches) === 0) {
      html +=
        '<div class="sn-roster-empty">' +
          '<div style="font-size:36px; margin-bottom:12px;">\uD83D\uDCCA</div>' +
          '<div style="font-weight:600; margin-bottom:6px;">Ingen data enn\u00e5</div>' +
          '<div>Registrer oppm\u00f8te og fullf\u00f8r kamper for \u00e5 se statistikk.</div>' +
        '</div>';
      return html;
    }

    // Top scorers
    if (stats.topScorers.length > 0) {
      html += '<div class="sn-section">Toppscorere</div>';

      if (barnefotball) {
        html +=
          '<div class="sn-nff-warning" style="margin:0 0 8px;">' +
            '<i class="fas fa-shield-alt"></i>' +
            'NFF: Kun til intern bruk. Skal ikke deles eller brukes til rangering (6\u201312 \u00e5r).' +
          '</div>';
      }

      html += '<div class="settings-card" style="padding:0;">';
      for (var ts = 0; ts < stats.topScorers.length; ts++) {
        var sc = stats.topScorers[ts];
        html +=
          '<div class="sn-roster-item sn-player-stat-row" data-spid="' + escapeHtml(sc.player.id) + '">' +
            '<div style="font-size:16px; width:24px; text-align:center;">\u26BD</div>' +
            '<div style="flex:1;">' +
              '<div style="font-weight:600;">' + escapeHtml(sc.player.name) + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:10px; align-items:center;">' +
              '<div style="text-align:center;">' +
                '<div style="font-weight:700; font-size:16px;">' + sc.goals + '</div>' +
                '<div style="font-size:10px; color:var(--text-400);">m\u00e5l</div>' +
              '</div>' +
              (sc.assists > 0
                ? '<div style="text-align:center;">' +
                    '<div style="font-weight:700; font-size:16px; color:var(--text-600);">' + sc.assists + '</div>' +
                    '<div style="font-size:10px; color:var(--text-400);">assist</div>' +
                  '</div>'
                : '') +
            '</div>' +
            '<div class="sn-event-arrow">\u203A</div>' +
          '</div>';
      }
      html += '</div>';
    }

    // Top assisters
    if (stats.topAssisters.length > 0) {
      html += '<div class="sn-section">M\u00e5lgivende</div>';
      html += '<div class="settings-card" style="padding:0;">';
      for (var ta = 0; ta < stats.topAssisters.length; ta++) {
        var as = stats.topAssisters[ta];
        html +=
          '<div class="sn-roster-item sn-player-stat-row" data-spid="' + escapeHtml(as.player.id) + '">' +
            '<div style="font-size:14px; width:24px; text-align:center; font-weight:800; color:var(--primary, #2563eb);">A</div>' +
            '<div style="flex:1;">' +
              '<div style="font-weight:600;">' + escapeHtml(as.player.name) + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:10px; align-items:center;">' +
              '<div style="text-align:center;">' +
                '<div style="font-weight:700; font-size:16px;">' + as.assists + '</div>' +
                '<div style="font-size:10px; color:var(--text-400);">assist</div>' +
              '</div>' +
              (as.goals > 0
                ? '<div style="text-align:center;">' +
                    '<div style="font-weight:700; font-size:16px; color:var(--text-600);">' + as.goals + '</div>' +
                    '<div style="font-size:10px; color:var(--text-400);">m\u00e5l</div>' +
                  '</div>'
                : '') +
            '</div>' +
            '<div class="sn-event-arrow">\u203A</div>' +
          '</div>';
      }
      html += '</div>';
    }

    // Player attendance table
    html += '<div class="sn-section">Oppm\u00f8te</div>';
    html += '<div class="settings-card" style="padding:0; overflow-x:auto;">';
    html += '<table class="sn-stat-table">';
    html += '<thead><tr>' +
      '<th>Spiller</th>' +
      '<th>Tr</th>' +
      '<th>Ka</th>' +
      (stats.totalGoals > 0 ? '<th>\u26BD</th>' : '') +
      '<th>Oppm.</th>' +
    '</tr></thead>';
    html += '<tbody>';

    for (var i = 0; i < p.length; i++) {
      var pl = p[i];
      var totalPossible = stats.totalTrainings + stats.totalMatches;
      var pct = totalPossible > 0 ? Math.round((pl.totalEvents / totalPossible) * 100) : 0;

      var barColor;
      if (pct >= 80) barColor = 'var(--success, #22c55e)';
      else if (pct >= 50) barColor = '#eab308';
      else barColor = 'var(--error, #ef4444)';

      html += '<tr class="sn-player-stat-row" data-spid="' + escapeHtml(pl.player.id) + '">' +
        '<td class="sn-pname">' + escapeHtml(pl.player.name) + '</td>' +
        '<td>' + pl.trainingsAttended + '</td>' +
        '<td>' + pl.matchesAttended + '</td>' +
        (stats.totalGoals > 0 ? '<td>' + (pl.goals > 0 ? pl.goals : '') + '</td>' : '') +
        '<td>' +
          '<div style="font-weight:600;">' + pct + '%</div>' +
          '<div class="sn-bar-wrap"><div class="sn-bar-fill" style="width:' + pct + '%; background:' + barColor + ';"></div></div>' +
        '</td>' +
      '</tr>';
    }

    html += '</tbody></table></div>';

    return html;
  }

  function bindStatsHandlers(root) {
    var rows = root.querySelectorAll('.sn-player-stat-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].addEventListener('click', (function(spid) {
        return async function() {
          var sp = seasonPlayers.find(function(p) { return p.id === spid; });
          if (sp) {
            editingSeasonPlayer = sp;
            snView = 'player-stats';
            render();
          }
        };
      })(rows[i].getAttribute('data-spid')));
    }
  }

  // =========================================================================
  //  VIEW: PLAYER STATS (individ)
  // =========================================================================

  function renderPlayerStats(root) {
    var sp = editingSeasonPlayer;
    if (!sp) { snView = 'dashboard'; dashTab = 'stats'; render(); return; }

    var stats = computeStats();
    var ps = stats.players.find(function(x) { return x.player.id === sp.id; });
    if (!ps) ps = { matchesAttended: 0, trainingsAttended: 0, minutesPlayed: 0, totalEvents: 0, goals: 0, assists: 0 };

    var totalPossible = stats.totalTrainings + stats.totalMatches;
    var pct = totalPossible > 0 ? Math.round((ps.totalEvents / totalPossible) * 100) : 0;

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromPlayerStats">\u2190</button>' +
          '<span class="sn-dash-title">' + escapeHtml(sp.name) + '</span>' +
        '</div>';

    // Badges
    var posLabels = (sp.positions || []).join('/');
    html += '<div style="margin:8px 0 16px; display:flex; gap:6px;">';
    if (sp.goalie) html += '<span class="sn-badge sn-badge-keeper">Kan st\u00e5 i m\u00e5l</span>';
    html += '<span class="sn-badge sn-badge-pos">' + escapeHtml(posLabels) + '</span>';
    html += '<span class="sn-badge sn-badge-skill">' + sp.skill + '</span>';
    html += '</div>';

    // Stats cards - row 1: attendance
    html += '<div class="sn-stats-cards">';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + ps.trainingsAttended + '<span style="font-size:14px; color:var(--text-400);">/' + stats.totalTrainings + '</span></div>' +
        '<div class="sn-stat-label">Treninger</div>' +
      '</div>';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + ps.matchesAttended + '<span style="font-size:14px; color:var(--text-400);">/' + stats.totalMatches + '</span></div>' +
        '<div class="sn-stat-label">Kamper</div>' +
      '</div>';
    html += '</div>';

    // Stats cards - row 2: performance
    html += '<div class="sn-stats-cards" style="margin-top:8px;">';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + pct + '%</div>' +
        '<div class="sn-stat-label">Oppm\u00f8te</div>' +
      '</div>';
    if (ps.goals > 0 || ps.assists > 0) {
      html +=
        '<div class="sn-stat-card">' +
          '<div class="sn-stat-num">' + ps.goals + (ps.assists > 0 ? '<span style="font-size:14px; color:var(--text-400);"> + ' + ps.assists + 'a</span>' : '') + '</div>' +
          '<div class="sn-stat-label">M\u00e5l' + (ps.assists > 0 ? ' + assist' : '') + '</div>' +
        '</div>';
    } else {
      html +=
        '<div class="sn-stat-card">' +
          '<div class="sn-stat-num">' + (ps.minutesPlayed || 0) + '</div>' +
          '<div class="sn-stat-label">Spilletid (min)</div>' +
        '</div>';
    }
    html += '</div>';

    // Event-by-event history
    html += '<div class="sn-section">Hendelseslogg</div>';

    // Build history from seasonStats for this player
    var playerEvents = seasonStats.filter(function(row) { return row.player_id === sp.player_id; });
    var eventMap = {};
    for (var e = 0; e < events.length; e++) { eventMap[events[e].id] = events[e]; }

    // Build goal/assist lookup for this player per event
    var playerGoalMap = {}; // { event_id: { goals: N, assists: N } }
    for (var sg = 0; sg < seasonGoals.length; sg++) {
      var sGoal = seasonGoals[sg];
      if (sGoal.player_id === sp.player_id) {
        if (!playerGoalMap[sGoal.event_id]) playerGoalMap[sGoal.event_id] = { goals: 0, assists: 0 };
        playerGoalMap[sGoal.event_id].goals++;
      }
      if (sGoal.assist_player_id === sp.player_id) {
        if (!playerGoalMap[sGoal.event_id]) playerGoalMap[sGoal.event_id] = { goals: 0, assists: 0 };
        playerGoalMap[sGoal.event_id].assists++;
      }
    }

    // Sort by event date
    playerEvents.sort(function(a, b) {
      var evA = eventMap[a.event_id];
      var evB = eventMap[b.event_id];
      if (!evA || !evB) return 0;
      return new Date(evB.start_time) - new Date(evA.start_time);
    });

    if (playerEvents.length === 0) {
      html += '<div style="text-align:center; padding:20px; color:var(--text-400); font-size:13px;">Ingen registrert oppm\u00f8te enn\u00e5.</div>';
    } else {
      html += '<div class="settings-card" style="padding:0;">';
      for (var h = 0; h < playerEvents.length; h++) {
        var row = playerEvents[h];
        var ev = eventMap[row.event_id];
        if (!ev) continue;

        var evTitle = ev.title || ev.opponent || typeLabel(ev.type);
        var attended = row.attended === true;
        var reasonText = '';
        if (!attended && row.absence_reason) {
          var reasonLabels = { syk: 'Syk', skade: 'Skade', borte: 'Borte' };
          reasonText = ' \u00B7 ' + (reasonLabels[row.absence_reason] || row.absence_reason);
        }

        // Goal/assist badges for this event
        var goalBadge = '';
        var pgm = playerGoalMap[ev.id];
        if (pgm) {
          var parts = [];
          if (pgm.goals > 0) parts.push('\u26BD' + (pgm.goals > 1 ? '\u00d7' + pgm.goals : ''));
          if (pgm.assists > 0) parts.push('<span style="font-weight:800; color:var(--primary, #2563eb);">A</span>' + (pgm.assists > 1 ? '\u00d7' + pgm.assists : ''));
          if (parts.length > 0) goalBadge = '<div style="font-size:12px; white-space:nowrap;">' + parts.join(' ') + '</div>';
        }

        // Match score
        var scoreText = '';
        if ((ev.type === 'match' || ev.type === 'cup_match') && ev.status === 'completed' && ev.result_home !== null && ev.result_home !== undefined) {
          scoreText = '<div style="font-size:13px; font-weight:700; color:var(--text-500);">' + ev.result_home + '\u2013' + ev.result_away + '</div>';
        }

        html +=
          '<div class="sn-roster-item" style="cursor:default;">' +
            '<div style="font-size:16px; width:24px; text-align:center;">' + (attended ? '\u2705' : '\u274c') + '</div>' +
            '<div style="flex:1;">' +
              '<div style="font-weight:600; font-size:14px;">' + escapeHtml(evTitle) + '</div>' +
              '<div style="font-size:12px; color:var(--text-400);">' + formatDateLong(ev.start_time) + (attended ? '' : reasonText) + '</div>' +
            '</div>' +
            goalBadge +
            scoreText +
            '<div style="font-size:12px; color:var(--text-400);">' + typeIcon(ev.type) + '</div>' +
          '</div>';
      }
      html += '</div>';
    }

    // Edit player link
    html +=
      '<button class="btn-secondary" id="snEditFromStats" style="width:100%; margin-top:16px;">' +
        '<i class="fas fa-pen" style="margin-right:5px;"></i>Rediger spiller' +
      '</button>';

    html += '</div>';

    root.innerHTML = html;

    $('snBackFromPlayerStats').addEventListener('click', function() {
      editingSeasonPlayer = null;
      snView = 'dashboard';
      // Return to wherever we came from (stats or roster)
      render();
    });

    var editBtn = $('snEditFromStats');
    if (editBtn) editBtn.addEventListener('click', function() {
      snView = 'roster-edit-player';
      render();
    });
  }

  // =========================================================================
  //  VIEW: ROSTER IMPORT
  // =========================================================================

  function renderRosterImport(root) {
    var players = window.players || [];
    if (!players.length) {
      root.innerHTML =
        '<div class="settings-card">' +
          '<div class="sn-dash-header">' +
            '<button class="sn-back" id="snBackFromImport">\u2190</button>' +
            '<span class="sn-dash-title">Importer spillere</span>' +
          '</div>' +
          '<div class="sn-roster-empty" style="padding:24px;">' +
            '<div>Ingen spillere funnet. G\u00e5 til <b>Spillere</b>-fanen og legg til spillere f\u00f8rst.</div>' +
          '</div>' +
        '</div>';
      $('snBackFromImport').addEventListener('click', function() {
        snView = 'dashboard';
        dashTab = 'roster';
        render();
      });
      return;
    }

    // Figure out which players are already in the season
    var existingIds = {};
    for (var e = 0; e < seasonPlayers.length; e++) {
      existingIds[seasonPlayers[e].player_id] = true;
    }

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromImport">\u2190</button>' +
          '<span class="sn-dash-title">Importer spillere</span>' +
        '</div>' +
        '<div style="padding:4px 0 12px; color:var(--text-400); font-size:13px;">' +
          'Velg spillere fra <b>' + escapeHtml(document.querySelector('.team-name')?.textContent || 'aktivt lag') + '</b> (' + players.length + ' spillere)' +
        '</div>' +
        '<div style="margin-bottom:12px; display:flex; gap:8px;">' +
          '<button class="btn-secondary" id="snSelectAll" style="font-size:12px; padding:6px 12px;">Velg alle</button>' +
          '<button class="btn-secondary" id="snSelectNone" style="font-size:12px; padding:6px 12px;">Velg ingen</button>' +
        '</div>';

    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p.active && p.active !== undefined) continue; // skip inactive
      var already = existingIds[p.id];
      var posLabels = (p.positions || ['F','M','A']).join('/');

      html +=
        '<label class="sn-import-item"' + (already ? ' style="opacity:0.5;"' : '') + '>' +
          '<input type="checkbox" class="sn-import-cb" value="' + p.id + '"' +
            (already ? ' checked disabled title="Allerede i sesongen"' : ' checked') + '>' +
          '<div class="sn-roster-name">' + escapeHtml(p.name) + '</div>' +
          '<div class="sn-roster-badges">' +
            (p.goalie ? '<span class="sn-badge sn-badge-keeper">Kan stå i mål</span>' : '') +
            '<span class="sn-badge sn-badge-pos">' + escapeHtml(posLabels) + '</span>' +
          '</div>' +
        '</label>';
    }

    html +=
        '<div class="sn-actions" style="margin-top:16px;">' +
          '<button class="btn-secondary" id="snCancelImport">Avbryt</button>' +
          '<button class="btn-primary" id="snConfirmImport"><i class="fas fa-check" style="margin-right:5px;"></i>Importer valgte</button>' +
        '</div>' +
      '</div>';

    root.innerHTML = html;

    // Bind handlers
    $('snBackFromImport').addEventListener('click', function() {
      snView = 'dashboard';
      dashTab = 'roster';
      render();
    });

    $('snCancelImport').addEventListener('click', function() {
      snView = 'dashboard';
      dashTab = 'roster';
      render();
    });

    $('snSelectAll').addEventListener('click', function() {
      var cbs = root.querySelectorAll('.sn-import-cb:not([disabled])');
      for (var c = 0; c < cbs.length; c++) cbs[c].checked = true;
    });

    $('snSelectNone').addEventListener('click', function() {
      var cbs = root.querySelectorAll('.sn-import-cb:not([disabled])');
      for (var c = 0; c < cbs.length; c++) cbs[c].checked = false;
    });

    $('snConfirmImport').addEventListener('click', async function() {
      var cbs = root.querySelectorAll('.sn-import-cb:not([disabled]):checked');
      var selectedIds = {};
      for (var c = 0; c < cbs.length; c++) selectedIds[cbs[c].value] = true;

      var toImport = players.filter(function(p) {
        return selectedIds[p.id] && !existingIds[p.id];
      });

      if (toImport.length === 0) {
        notify('Ingen nye spillere \u00e5 importere.', 'info');
        return;
      }

      var btn = $('snConfirmImport');
      btn.disabled = true;
      btn.textContent = 'Importerer\u2026';

      var ok = await importPlayersToSeason(currentSeason.id, toImport);
      if (ok) {
        snView = 'dashboard';
        dashTab = 'roster';
        render();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check" style="margin-right:5px;"></i>Importer valgte';
      }
    });
  }

  // =========================================================================
  //  VIEW: MANUAL PLAYER ADD
  // =========================================================================

  function renderManualPlayerAdd(root) {
    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromManual">\u2190</button>' +
          '<span class="sn-dash-title">Legg til spiller</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snManualName">Navn</label>' +
            '<input type="text" id="snManualName" placeholder="Fornavn" maxlength="40" autocomplete="off">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Kan st\u00e5 i m\u00e5l?</label>' +
            '<div class="sn-toggle-group" style="max-width:200px;">' +
              '<button class="sn-toggle-btn active" data-val="false" id="snManualGkNo">Nei</button>' +
              '<button class="sn-toggle-btn" data-val="true" id="snManualGkYes">Ja</button>' +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snManualSkill">Ferdighetsniv\u00e5 (1\u20136)</label>' +
            '<input type="number" id="snManualSkill" min="1" max="6" value="3">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Posisjoner</label>' +
            '<div style="display:flex; gap:6px;">' +
              '<button class="sn-toggle-btn snManualPos active" data-pos="F" type="button" style="flex:1; border-radius:var(--radius-sm);">Forsvar</button>' +
              '<button class="sn-toggle-btn snManualPos active" data-pos="M" type="button" style="flex:1; border-radius:var(--radius-sm);">Midtbane</button>' +
              '<button class="sn-toggle-btn snManualPos active" data-pos="A" type="button" style="flex:1; border-radius:var(--radius-sm);">Angrep</button>' +
            '</div>' +
          '</div>' +
          '<div class="sn-actions" style="margin-top:16px;">' +
            '<button class="btn-secondary" id="snCancelManual">Avbryt</button>' +
            '<button class="btn-primary" id="snConfirmManual"><i class="fas fa-plus" style="margin-right:5px;"></i>Legg til</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.innerHTML = html;

    // Keeper toggle (radio-style: only one active)
    var gkNo = $('snManualGkNo');
    var gkYes = $('snManualGkYes');
    if (gkNo) gkNo.addEventListener('click', function() { gkNo.classList.add('active'); gkYes.classList.remove('active'); });
    if (gkYes) gkYes.addEventListener('click', function() { gkYes.classList.add('active'); gkNo.classList.remove('active'); });

    // Position toggles (multi-select: each toggles independently)
    var manualPosBtns = root.querySelectorAll('.snManualPos');
    for (var mp = 0; mp < manualPosBtns.length; mp++) {
      manualPosBtns[mp].addEventListener('click', function() { this.classList.toggle('active'); });
    }

    function goBackToRoster() {
      snView = 'dashboard';
      dashTab = 'roster';
      render();
    }

    $('snBackFromManual').addEventListener('click', goBackToRoster);
    $('snCancelManual').addEventListener('click', goBackToRoster);

    $('snConfirmManual').addEventListener('click', async function() {
      var name = ($('snManualName').value || '').trim();
      if (!name) {
        notify('Skriv inn et navn.', 'warning');
        $('snManualName').focus();
        return;
      }

      var goalie = $('snManualGkYes').classList.contains('active');
      var skill = parseInt($('snManualSkill').value) || 3;
      skill = Math.max(1, Math.min(6, skill));

      var activePosBtns = root.querySelectorAll('.snManualPos.active');
      var positions = [];
      for (var p = 0; p < activePosBtns.length; p++) positions.push(activePosBtns[p].getAttribute('data-pos'));
      if (positions.length === 0) positions = ['F', 'M', 'A'];

      // Generate a unique player_id (not linked to Spillere-fanen)
      var playerId = 'sp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

      var btn = $('snConfirmManual');
      btn.disabled = true;
      btn.textContent = 'Legger til\u2026';

      var ok = await importPlayersToSeason(currentSeason.id, [{
        id: playerId,
        name: name,
        skill: skill,
        goalie: goalie,
        positions: positions
      }]);

      if (ok) {
        goBackToRoster();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus" style="margin-right:5px;"></i>Legg til';
      }
    });
  }

  // =========================================================================
  //  VIEW: CREATE TRAINING SERIES
  // =========================================================================

  function renderCreateSeries(root) {
    if (!currentSeason) { goToList(); return; }

    // Default dates from season
    var defaultStart = currentSeason.start_date || '';
    var defaultEnd = currentSeason.end_date || '';

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromSeries">\u2190</button>' +
          '<span class="sn-dash-title">Opprett treningsserie</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snSeriesTitle">Tittel</label>' +
            '<input type="text" id="snSeriesTitle" placeholder="Mandagstrening" maxlength="60" autocomplete="off">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Ukedag</label>' +
            '<div style="display:flex; gap:4px; flex-wrap:wrap;">' +
              '<button class="sn-toggle-btn snDayBtn" data-day="1" type="button" style="flex:1; min-width:0; border-radius:var(--radius-sm); padding:8px 2px; font-size:13px;">Man</button>' +
              '<button class="sn-toggle-btn snDayBtn" data-day="2" type="button" style="flex:1; min-width:0; border-radius:var(--radius-sm); padding:8px 2px; font-size:13px;">Tir</button>' +
              '<button class="sn-toggle-btn snDayBtn" data-day="3" type="button" style="flex:1; min-width:0; border-radius:var(--radius-sm); padding:8px 2px; font-size:13px;">Ons</button>' +
              '<button class="sn-toggle-btn snDayBtn" data-day="4" type="button" style="flex:1; min-width:0; border-radius:var(--radius-sm); padding:8px 2px; font-size:13px;">Tor</button>' +
              '<button class="sn-toggle-btn snDayBtn" data-day="5" type="button" style="flex:1; min-width:0; border-radius:var(--radius-sm); padding:8px 2px; font-size:13px;">Fre</button>' +
              '<button class="sn-toggle-btn snDayBtn" data-day="6" type="button" style="flex:1; min-width:0; border-radius:var(--radius-sm); padding:8px 2px; font-size:13px;">L\u00f8r</button>' +
              '<button class="sn-toggle-btn snDayBtn" data-day="0" type="button" style="flex:1; min-width:0; border-radius:var(--radius-sm); padding:8px 2px; font-size:13px;">S\u00f8n</button>' +
            '</div>' +
          '</div>' +
          '<div class="sn-form-row">' +
            '<div class="form-group" style="flex:1;">' +
              '<label for="snSeriesTime">Klokkeslett</label>' +
              '<input type="time" id="snSeriesTime" value="17:00">' +
            '</div>' +
            '<div class="form-group" style="flex:1;">' +
              '<label for="snSeriesDuration">Varighet (min)</label>' +
              '<input type="number" id="snSeriesDuration" value="90" min="15" max="180" step="15">' +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snSeriesLocation">Sted</label>' +
            '<input type="text" id="snSeriesLocation" placeholder="Bane / hall" maxlength="100">' +
          '</div>' +
          '<div class="sn-form-row">' +
            '<div class="form-group" style="flex:1;">' +
              '<label for="snSeriesStart">Fra dato</label>' +
              '<input type="date" id="snSeriesStart" value="' + defaultStart + '">' +
            '</div>' +
            '<div class="form-group" style="flex:1;">' +
              '<label for="snSeriesEnd">Til dato</label>' +
              '<input type="date" id="snSeriesEnd" value="' + defaultEnd + '">' +
            '</div>' +
          '</div>' +
          '<div id="snSeriesPreview" style="padding:10px 0; font-size:13px; color:var(--text-400);"></div>' +
          '<div class="sn-actions" style="margin-top:8px;">' +
            '<button class="btn-secondary" id="snCancelSeries">Avbryt</button>' +
            '<button class="btn-primary" id="snConfirmSeries"><i class="fas fa-check" style="margin-right:5px;"></i>Opprett</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.innerHTML = html;

    var selectedDay = null;

    // Day toggles (radio)
    var dayBtns = root.querySelectorAll('.snDayBtn');
    for (var d = 0; d < dayBtns.length; d++) {
      dayBtns[d].addEventListener('click', function() {
        for (var b = 0; b < dayBtns.length; b++) dayBtns[b].classList.remove('active');
        this.classList.add('active');
        selectedDay = parseInt(this.getAttribute('data-day'));
        updatePreview();
      });
    }

    function updatePreview() {
      var preview = $('snSeriesPreview');
      if (!preview) return;
      if (selectedDay === null) { preview.textContent = ''; return; }

      var startVal = $('snSeriesStart').value;
      var endVal = $('snSeriesEnd').value;
      if (!startVal || !endVal) { preview.textContent = ''; return; }

      var dates = generateSeriesDates(selectedDay, startVal, endVal);
      if (dates.length === 0) {
        preview.innerHTML = '\u26a0\ufe0f Ingen ' + DAY_NAMES[selectedDay].toLowerCase() + 'er i valgt periode.';
      } else {
        preview.innerHTML = '\u2192 <b>' + dates.length + ' treninger</b> blir opprettet (' + DAY_NAMES[selectedDay].toLowerCase() + 'er fra ' + formatDate(startVal) + ' til ' + formatDate(endVal) + ')';
      }
    }

    // Update preview on date changes
    var startInput = $('snSeriesStart');
    var endInput = $('snSeriesEnd');
    if (startInput) startInput.addEventListener('change', updatePreview);
    if (endInput) endInput.addEventListener('change', updatePreview);

    // Auto-fill title from day selection
    function autoTitle() {
      var titleInput = $('snSeriesTitle');
      if (!titleInput || titleInput.value.trim()) return;
      if (selectedDay !== null) {
        titleInput.placeholder = DAY_NAMES[selectedDay] + 'strening';
      }
    }

    // Navigation
    $('snBackFromSeries').addEventListener('click', goToDashboard);
    $('snCancelSeries').addEventListener('click', goToDashboard);

    $('snConfirmSeries').addEventListener('click', async function() {
      if (selectedDay === null) {
        notify('Velg en ukedag.', 'warning');
        return;
      }

      var startVal = $('snSeriesStart').value;
      var endVal = $('snSeriesEnd').value;
      if (!startVal || !endVal) {
        notify('Velg fra- og til-dato.', 'warning');
        return;
      }

      if (endVal < startVal) {
        notify('Til-dato m\u00e5 v\u00e6re etter fra-dato.', 'warning');
        return;
      }

      var dates = generateSeriesDates(selectedDay, startVal, endVal);
      if (dates.length === 0) {
        notify('Ingen treningsdatoer i valgt periode.', 'warning');
        return;
      }

      var titleVal = ($('snSeriesTitle').value || '').trim() || (DAY_NAMES[selectedDay] + 'strening');
      var timeVal = $('snSeriesTime').value || '17:00';
      var durationVal = parseInt($('snSeriesDuration').value) || 90;
      var locationVal = ($('snSeriesLocation').value || '').trim();

      var btn = $('snConfirmSeries');
      btn.disabled = true;
      btn.textContent = 'Oppretter ' + dates.length + ' treninger\u2026';

      var ok = await createTrainingSeries(currentSeason.id, {
        title: titleVal,
        day_of_week: selectedDay,
        start_time: timeVal,
        duration_minutes: durationVal,
        location: locationVal,
        start_date: startVal,
        end_date: endVal
      });

      if (ok) {
        await loadEvents(currentSeason.id);
        goToDashboard();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check" style="margin-right:5px;"></i>Opprett';
      }
    });
  }

  // =========================================================================
  //  VIEW: EDIT SEASON PLAYER
  // =========================================================================

  function renderEditPlayer(root) {
    var sp = editingSeasonPlayer;
    if (!sp) { snView = 'dashboard'; dashTab = 'roster'; render(); return; }

    var posF = (sp.positions || []).indexOf('F') >= 0;
    var posM = (sp.positions || []).indexOf('M') >= 0;
    var posA = (sp.positions || []).indexOf('A') >= 0;

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromEdit">\u2190</button>' +
          '<span class="sn-dash-title">Rediger spiller</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snEditName">Navn</label>' +
            '<input type="text" id="snEditName" value="' + escapeHtml(sp.name) + '" maxlength="40" autocomplete="off">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Kan st\u00e5 i m\u00e5l?</label>' +
            '<div class="sn-toggle-group" style="max-width:200px;">' +
              '<button class="sn-toggle-btn' + (!sp.goalie ? ' active' : '') + '" data-val="false" id="snEditGkNo">Nei</button>' +
              '<button class="sn-toggle-btn' + (sp.goalie ? ' active' : '') + '" data-val="true" id="snEditGkYes">Ja</button>' +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snEditSkill">Ferdighetsniv\u00e5 (1\u20136)</label>' +
            '<input type="number" id="snEditSkill" min="1" max="6" value="' + sp.skill + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Posisjoner</label>' +
            '<div style="display:flex; gap:6px;">' +
              '<button class="sn-toggle-btn snEditPos' + (posF ? ' active' : '') + '" data-pos="F" type="button" style="flex:1; border-radius:var(--radius-sm);">Forsvar</button>' +
              '<button class="sn-toggle-btn snEditPos' + (posM ? ' active' : '') + '" data-pos="M" type="button" style="flex:1; border-radius:var(--radius-sm);">Midtbane</button>' +
              '<button class="sn-toggle-btn snEditPos' + (posA ? ' active' : '') + '" data-pos="A" type="button" style="flex:1; border-radius:var(--radius-sm);">Angrep</button>' +
            '</div>' +
          '</div>' +
          '<div class="sn-actions" style="margin-top:16px;">' +
            '<button class="btn-secondary" id="snCancelEdit">Avbryt</button>' +
            '<button class="btn-primary" id="snSaveEdit"><i class="fas fa-check" style="margin-right:5px;"></i>Lagre</button>' +
          '</div>' +
          '<div style="margin-top:24px; padding-top:16px; border-top:1px solid var(--border);">' +
            '<button class="sn-btn-danger" id="snRemovePlayer" style="width:100%;">' +
              '<i class="fas fa-trash" style="margin-right:6px;"></i>Fjern fra sesongen' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.innerHTML = html;

    // Keeper toggle (radio-style)
    var editGkNo = $('snEditGkNo');
    var editGkYes = $('snEditGkYes');
    if (editGkNo) editGkNo.addEventListener('click', function() { editGkNo.classList.add('active'); editGkYes.classList.remove('active'); });
    if (editGkYes) editGkYes.addEventListener('click', function() { editGkYes.classList.add('active'); editGkNo.classList.remove('active'); });

    // Position toggles (multi-select)
    var editPosBtns = root.querySelectorAll('.snEditPos');
    for (var ep = 0; ep < editPosBtns.length; ep++) {
      editPosBtns[ep].addEventListener('click', function() { this.classList.toggle('active'); });
    }

    function goBackFromEdit() {
      // Return to player-stats view (keeps editingSeasonPlayer)
      snView = 'player-stats';
      render();
    }

    $('snBackFromEdit').addEventListener('click', goBackFromEdit);
    $('snCancelEdit').addEventListener('click', goBackFromEdit);

    $('snSaveEdit').addEventListener('click', async function() {
      var name = ($('snEditName').value || '').trim();
      if (!name) {
        notify('Navn kan ikke v\u00e6re tomt.', 'warning');
        $('snEditName').focus();
        return;
      }

      var goalie = $('snEditGkYes').classList.contains('active');
      var skill = parseInt($('snEditSkill').value) || 3;
      skill = Math.max(1, Math.min(6, skill));

      var activeEditPos = root.querySelectorAll('.snEditPos.active');
      var positions = [];
      for (var p = 0; p < activeEditPos.length; p++) positions.push(activeEditPos[p].getAttribute('data-pos'));
      if (positions.length === 0) positions = ['F', 'M', 'A'];

      var btn = $('snSaveEdit');
      btn.disabled = true;
      btn.textContent = 'Lagrer\u2026';

      var ok = await updateSeasonPlayer(sp.id, {
        player_name: name,
        player_goalie: goalie,
        player_skill: skill,
        player_positions: positions
      });

      if (ok) {
        notify('Spiller oppdatert.', 'success');
        await loadSeasonPlayers(currentSeason.id);
        editingSeasonPlayer = seasonPlayers.find(function(p) { return p.id === sp.id; });
        goBackFromEdit();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check" style="margin-right:5px;"></i>Lagre';
      }
    });

    $('snRemovePlayer').addEventListener('click', async function() {
      if (!confirm('Fjerne ' + sp.name + ' fra sesongen?\n\nEventuell statistikk for denne spilleren beholdes ikke.')) return;

      var btn = $('snRemovePlayer');
      btn.disabled = true;
      btn.textContent = 'Fjerner\u2026';

      var ok = await removeSeasonPlayer(sp.id);
      if (ok) {
        notify(sp.name + ' fjernet.', 'success');
        await loadSeasonPlayers(currentSeason.id);
        editingSeasonPlayer = null;
        snView = 'dashboard';
        dashTab = 'roster';
        render();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash" style="margin-right:6px;"></i>Fjern fra sesongen';
      }
    });
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

      var regBadge = registeredEventIds[ev.id]
        ? '<div class="sn-att-badge" title="Oppm\u00f8te registrert">\u2713</div>'
        : '';

      // Score badge for completed matches
      var scoreBadge = '';
      if ((ev.type === 'match' || ev.type === 'cup_match') && ev.status === 'completed' && ev.result_home !== null && ev.result_home !== undefined) {
        scoreBadge = '<div style="font-size:13px; font-weight:700; color:var(--text-600); white-space:nowrap;">' + ev.result_home + '\u2013' + ev.result_away + '</div>';
        regBadge = ''; // Don't show both
      }

      html +=
        '<div class="sn-event-item" data-eid="' + ev.id + '">' +
          '<div class="sn-event-icon">' + typeIcon(ev.type) + '</div>' +
          '<div class="sn-event-info">' +
            '<div class="sn-event-title">' + escapeHtml(title) + '</div>' +
            '<div class="sn-event-meta">' + escapeHtml(meta) + '</div>' +
          '</div>' +
          scoreBadge +
          regBadge +
          '<div class="sn-event-arrow">\u203A</div>' +
        '</div>';
    }
    return html;
  }

  function bindEventItemClicks(root) {
    var items = root.querySelectorAll('.sn-event-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', (function(eid) {
        return async function() {
          var ev = events.find(function(e) { return e.id === eid; });
          if (ev) {
            editingEvent = ev;
            var loads = [loadEventAttendance(ev.id)];
            // Load season stats for match tropp hints + match goals
            if (ev.type === 'match' || ev.type === 'cup_match') {
              loads.push(loadMatchGoals(ev.id));
              if (seasonStats.length === 0) loads.push(loadSeasonStats(currentSeason.id));
            }
            await Promise.all(loads);
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
              '<label for="snDate">Dato</label>' +
              '<input type="date" id="snDate" value="' + toLocalDate(ev.start_time || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="snTime">Klokkeslett</label>' +
              '<input type="time" id="snTime" value="' + (toLocalTime(ev.start_time || '') || '17:30') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="snDuration">Varighet (min)</label>' +
              '<input type="number" id="snDuration" min="10" max="180" value="' + (ev.duration_minutes || defaultMatchMinutes(currentSeason ? currentSeason.format : 7)) + '">' +
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
      // Auto-set duration based on type (only for new events)
      if (!isEdit) {
        var durEl = $('snDuration');
        if (durEl) {
          durEl.value = isM ? defaultMatchMinutes(currentSeason ? currentSeason.format : 7) : 90;
        }
      }
    });

    // Home/away toggle
    var toggleBtns = root.querySelectorAll('.sn-toggle-btn');
    for (var t = 0; t < toggleBtns.length; t++) {
      toggleBtns[t].addEventListener('click', function() {
        for (var j = 0; j < toggleBtns.length; j++) toggleBtns[j].classList.remove('active');
        this.classList.add('active');
      });
    }

    function goBackFromForm() {
      if (isEdit && editingEvent) {
        snView = 'event-detail';
      } else {
        snView = 'dashboard';
      }
      render();
    }

    $('snBackFromEvent').addEventListener('click', goBackFromForm);
    $('snCancelEvent').addEventListener('click', goBackFromForm);

    $('snSaveEvent').addEventListener('click', async function() {
      var dateVal = ($('snDate').value || '').trim();
      if (!dateVal) {
        notify('Velg dato.', 'warning');
        $('snDate').focus();
        return;
      }
      var timeVal = ($('snTime').value || '17:30').trim();

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
        start_time: new Date(dateVal + 'T' + timeVal).toISOString(),
        duration_minutes: parseInt($('snDuration').value) || defaultMatchMinutes(currentSeason ? currentSeason.format : 7),
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
        if (isEdit) {
          // Update editingEvent with fresh data
          editingEvent = events.find(function(e) { return e.id === existing.id; }) || editingEvent;
          var detailLoads = [loadEventAttendance(editingEvent.id)];
          if (editingEvent.type === 'match' || editingEvent.type === 'cup_match') {
            detailLoads.push(loadMatchGoals(editingEvent.id));
          }
          await Promise.all(detailLoads);
          snView = 'event-detail';
        } else {
          snView = 'dashboard';
        }
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
    html += detailRow('Varighet', (ev.duration_minutes || defaultMatchMinutes(ev.format || (currentSeason ? currentSeason.format : 7))) + ' min');

    if (isMatch && ev.opponent) html += detailRow('Motstander', ev.opponent);
    if (isMatch) html += detailRow('Hjemme/Borte', ev.is_home ? 'Hjemme' : 'Borte');
    if (ev.location) html += detailRow('Sted', ev.location);
    if (ev.format) html += detailRow('Format', formatLabel(ev.format));
    if (ev.notes) html += detailRow('Notat', ev.notes);

    html += '</div>';

    // Edit/delete
    html +=
      '<div class="sn-detail-actions">' +
        '<button class="btn-secondary" id="snEditEvent"><i class="fas fa-pen" style="margin-right:5px;"></i>Rediger</button>' +
        '<button class="sn-btn-danger" id="snDeleteEvent"><i class="fas fa-trash" style="margin-right:5px;"></i>Slett</button>' +
      '</div>';

    html += '</div>';

    // --- ABSENCE REASONS (shared) ---
    var ABSENCE_REASONS = [
      { key: 'syk', label: 'Syk' },
      { key: 'skade', label: 'Skade' },
      { key: 'borte', label: 'Borte' }
    ];

    var activePlayers = seasonPlayers.filter(function(p) { return p.active; });

    if (activePlayers.length > 0) {
      // Build lookups from existing data
      var attMap = {};
      var squadMap = {};
      var reasonLookup = {};
      for (var a = 0; a < eventAttendance.length; a++) {
        var row = eventAttendance[a];
        attMap[row.player_id] = row.attended;
        squadMap[row.player_id] = row.in_squad;
        if (row.absence_reason) reasonLookup[row.player_id] = row.absence_reason;
      }
      var hasExistingData = eventAttendance.length > 0;

      // Compute playing time per player (for tropp hints)
      var playTimeMap = {};
      if (isMatch) {
        for (var st = 0; st < seasonStats.length; st++) {
          var sr = seasonStats[st];
          if (!playTimeMap[sr.player_id]) playTimeMap[sr.player_id] = { matches: 0, minutes: 0 };
          if (sr.in_squad) playTimeMap[sr.player_id].matches++;
          if (sr.minutes_played) playTimeMap[sr.player_id].minutes += sr.minutes_played;
        }
      }

      var presentCount = 0;
      var playerHtml = '';

      for (var i = 0; i < activePlayers.length; i++) {
        var p = activePlayers[i];
        var isPresent;
        if (hasExistingData) {
          isPresent = isMatch ? (squadMap[p.player_id] === true) : (attMap[p.player_id] === true);
        } else {
          isPresent = isMatch ? false : true; // Matches: default nobody selected. Trainings: default all present.
        }
        if (isPresent) presentCount++;

        var existingReason = reasonLookup[p.player_id] || '';

        // Playing time hint for matches
        var hintHtml = '';
        if (isMatch) {
          var pt = playTimeMap[p.player_id];
          if (pt && pt.matches > 0) {
            hintHtml = '<div class="sn-tropp-hint">' + pt.matches + ' k</div>';
          } else {
            hintHtml = '<div class="sn-tropp-hint sn-tropp-low">0 k</div>';
          }
        }

        playerHtml +=
          '<div class="sn-att-item ' + (isPresent ? 'present' : 'absent') + '" data-pid="' + escapeHtml(p.player_id) + '">' +
            '<div class="sn-att-check">\u2713</div>' +
            '<div class="sn-att-name">' + escapeHtml(p.name) + '</div>' +
            hintHtml +
          '</div>';

        // Reason buttons (visible only when absent, and only for non-match or for match absent)
        var reasonHtml = '<div class="sn-att-reason" data-rpid="' + escapeHtml(p.player_id) + '" style="' + (isPresent || (isMatch && !hasExistingData) ? 'display:none;' : '') + '">';
        for (var r = 0; r < ABSENCE_REASONS.length; r++) {
          var ar = ABSENCE_REASONS[r];
          reasonHtml += '<button class="sn-reason-btn' + (existingReason === ar.key ? ' active' : '') + '" data-reason="' + ar.key + '" type="button">' + ar.label + '</button>';
        }
        reasonHtml += '</div>';
        playerHtml += reasonHtml;
      }

      var sectionTitle = isMatch ? 'Tropp' : 'Oppm\u00f8te';
      var summaryText = isMatch
        ? presentCount + ' av ' + activePlayers.length + ' i troppen'
        : presentCount + ' av ' + activePlayers.length + ' til stede';

      html +=
        '<div class="sn-section">' + sectionTitle + '</div>' +
        '<div class="settings-card" style="padding:0;">' +
          '<div class="sn-att-list">' + playerHtml + '</div>' +
          '<div class="sn-att-summary" id="snAttSummary">' + summaryText + '</div>' +
        '</div>';

      if (isMatch) {
        html +=
          '<button class="btn-primary" id="snSaveAttendance" style="width:100%; margin-top:12px;">' +
            '<i class="fas fa-check" style="margin-right:5px;"></i>Lagre tropp' +
          '</button>' +
          '<button class="btn-primary" id="snOpenKampdag" style="width:100%; margin-top:8px; background:var(--text-700);">' +
            '<i class="fas fa-wand-magic-sparkles" style="margin-right:6px;"></i>Generer bytteplan' +
          '</button>';
      } else {
        html +=
          '<button class="btn-primary" id="snSaveAttendance" style="width:100%; margin-top:12px;">' +
            '<i class="fas fa-check" style="margin-right:5px;"></i>Lagre oppm\u00f8te' +
          '</button>';
      }
    } else {
      html +=
        '<div style="margin-top:16px; padding:16px; text-align:center; color:var(--text-400); font-size:13px;">' +
          'Legg til spillere i spillerstallen for \u00e5 registrere ' + (isMatch ? 'tropp' : 'oppm\u00f8te') + '.' +
        '</div>';
    }

    // --- MATCH RESULT SECTION ---
    if (isMatch) {
      var isCompleted = (ev.status === 'completed');
      var hasResult = (ev.result_home !== null && ev.result_home !== undefined);
      var barnefotball = isBarnefotball();

      if (isCompleted && hasResult) {
        html +=
          '<div class="sn-section">Resultat <span class="sn-completed-badge">Fullf\u00f8rt</span></div>' +
          '<div class="settings-card">' +
            '<div class="sn-result-display">' +
              '<div>' +
                '<div class="sn-result-num">' + (ev.result_home !== null ? ev.result_home : '-') + '</div>' +
                '<div class="sn-score-label">' + (ev.is_home ? 'Oss' : 'Borte') + '</div>' +
              '</div>' +
              '<div class="sn-result-dash">\u2013</div>' +
              '<div>' +
                '<div class="sn-result-num">' + (ev.result_away !== null ? ev.result_away : '-') + '</div>' +
                '<div class="sn-score-label">' + (ev.is_home ? 'Motstander' : 'Oss') + '</div>' +
              '</div>' +
            '</div>';

        var completedGoals = matchGoals.filter(function(x) { return x.type === 'goal'; });
        var completedAssists = matchGoals.filter(function(x) { return x.type === 'assist'; });

        if (completedGoals.length > 0 || completedAssists.length > 0) {
          html += '<div style="border-top:1px solid var(--border-light, #f1f5f9); padding-top:8px;">';
          for (var g = 0; g < completedGoals.length; g++) {
            html += matchEventItemHtml(completedGoals[g], true);
          }
          for (var ga2 = 0; ga2 < completedAssists.length; ga2++) {
            html += matchEventItemHtml(completedAssists[ga2], true);
          }
          html += '</div>';
        }

        html +=
          '<div style="padding:10px 14px;">' +
            '<button class="btn-secondary" id="snReopenMatch" style="width:100%; font-size:13px;"><i class="fas fa-pen" style="margin-right:5px;"></i>Endre resultat</button>' +
          '</div></div>';

      } else {
        html += '<div class="sn-section">Resultat</div><div class="settings-card">';

        html +=
          '<div class="sn-result-box">' +
            '<div>' +
              '<input type="number" class="sn-score-input" id="snScoreHome" min="0" max="99" inputmode="numeric" value="' + (ev.result_home !== null && ev.result_home !== undefined ? ev.result_home : '') + '" placeholder="-">' +
              '<div class="sn-score-label">' + (ev.is_home ? 'Oss' : 'Borte') + '</div>' +
            '</div>' +
            '<div class="sn-score-dash">\u2013</div>' +
            '<div>' +
              '<input type="number" class="sn-score-input" id="snScoreAway" min="0" max="99" inputmode="numeric" value="' + (ev.result_away !== null && ev.result_away !== undefined ? ev.result_away : '') + '" placeholder="-">' +
              '<div class="sn-score-label">' + (ev.is_home ? 'Motstander' : 'Oss') + '</div>' +
            '</div>' +
          '</div>';

        if (barnefotball) {
          html +=
            '<div class="sn-nff-warning">' +
              '<i class="fas fa-shield-alt"></i>' +
              '<strong>NFF barnefotball:</strong> M\u00e5lscorere er kun til intern bruk for treneren. ' +
              'Skal ikke deles offentlig eller brukes til rangering av enkeltspillere (alder 6\u201312).' +
            '</div>';
        }

        // Build tropp player list for dropdowns
        var troppForGoals = [];
        for (var tp = 0; tp < activePlayers.length; tp++) {
          var inSquadForGoal = hasExistingData ? squadMap[activePlayers[tp].player_id] : true;
          if (inSquadForGoal) troppForGoals.push(activePlayers[tp]);
        }

        // Split existing match events
        var editGoals = matchGoals.filter(function(x) { return x.type === 'goal'; });
        var editAssists = matchGoals.filter(function(x) { return x.type === 'assist'; });

        // --- MÅLSCORERE ---
        html += '<div style="padding:8px 14px 4px; font-size:12px; font-weight:600; color:var(--text-400); text-transform:uppercase; letter-spacing:0.5px;">M\u00e5lscorere (valgfritt)</div>';

        for (var eg = 0; eg < editGoals.length; eg++) {
          html += matchEventItemHtml(editGoals[eg], true);
        }

        if (troppForGoals.length > 0) {
          html +=
            '<div class="sn-goal-add">' +
              '<select class="sn-goal-select" id="snGoalPlayer" style="flex:1;">';
          for (var gp = 0; gp < troppForGoals.length; gp++) {
            html += '<option value="' + escapeHtml(troppForGoals[gp].player_id) + '">' + escapeHtml(troppForGoals[gp].name) + '</option>';
          }
          html +=
              '</select>' +
              '<button class="sn-goal-add-btn" id="snAddGoal">+M\u00e5l</button>' +
            '</div>';
        }

        // --- MÅLGIVENDE ---
        html += '<div style="padding:8px 14px 4px; margin-top:4px; font-size:12px; font-weight:600; color:var(--text-400); text-transform:uppercase; letter-spacing:0.5px; border-top:1px solid var(--border-light, #f1f5f9);">M\u00e5lgivende (valgfritt)</div>';

        for (var ea = 0; ea < editAssists.length; ea++) {
          html += matchEventItemHtml(editAssists[ea], true);
        }

        if (troppForGoals.length > 0) {
          html +=
            '<div class="sn-goal-add">' +
              '<select class="sn-goal-select" id="snAssistPlayer" style="flex:1;">';
          for (var ap = 0; ap < troppForGoals.length; ap++) {
            html += '<option value="' + escapeHtml(troppForGoals[ap].player_id) + '">' + escapeHtml(troppForGoals[ap].name) + '</option>';
          }
          html +=
              '</select>' +
              '<button class="sn-goal-add-btn" id="snAddAssist" style="background:var(--text-600, #475569);">+Assist</button>' +
            '</div>';
        }

        html +=
          '<div style="padding:10px 14px;">' +
            '<button class="btn-primary" id="snCompleteMatch" style="width:100%;">' +
              '<i class="fas fa-check" style="margin-right:5px;"></i>Fullf\u00f8r kamp' +
            '</button>' +
          '</div></div>';
      }
    }

    root.innerHTML = html;

    // --- BIND HANDLERS ---
    $('snBackFromDetail').addEventListener('click', goToDashboard);

    if ($('snOpenKampdag')) {
      $('snOpenKampdag').addEventListener('click', function() {
        // Get tropp players from UI state
        var troppItems = root.querySelectorAll('.sn-att-item.present');
        if (troppItems.length === 0) {
          notify('Velg minst \u00e9n spiller i troppen f\u00f8rst.', 'warning');
          return;
        }
        var troppIds = new Set();
        for (var t = 0; t < troppItems.length; t++) {
          troppIds.add(troppItems[t].getAttribute('data-pid'));
        }
        // Build player objects for embedded kampdag
        var troppPlayers = [];
        for (var ap = 0; ap < activePlayers.length; ap++) {
          if (troppIds.has(activePlayers[ap].player_id)) {
            var sp = activePlayers[ap];
            troppPlayers.push({
              id: sp.player_id,
              name: sp.name,
              goalie: sp.goalie || false,
              positions: sp.positions || ['F','M','A'],
              skill: sp.skill || 3
            });
          }
        }
        embeddedKampdagEvent = ev;
        embeddedKampdagTropp = troppPlayers;
        snView = 'embedded-kampdag';
        render();
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

    // --- ATTENDANCE INTERACTION ---
    var attItems = root.querySelectorAll('.sn-att-item');
    for (var ai = 0; ai < attItems.length; ai++) {
      attItems[ai].addEventListener('click', function() {
        var pid = this.getAttribute('data-pid');
        this.classList.toggle('present');
        this.classList.toggle('absent');

        // Show/hide reason row
        var reasonRow = root.querySelector('.sn-att-reason[data-rpid="' + pid + '"]');
        if (reasonRow) {
          if (this.classList.contains('absent')) {
            reasonRow.style.display = 'flex';
          } else {
            reasonRow.style.display = 'none';
            // Clear reason selection when marking present
            var rBtns = reasonRow.querySelectorAll('.sn-reason-btn');
            for (var rb = 0; rb < rBtns.length; rb++) rBtns[rb].classList.remove('active');
          }
        }
        updateAttSummary();
      });
    }

    // Reason buttons
    var reasonBtns = root.querySelectorAll('.sn-reason-btn');
    for (var ri = 0; ri < reasonBtns.length; ri++) {
      reasonBtns[ri].addEventListener('click', function(e) {
        e.stopPropagation();
        // Toggle: click same reason deselects, click different selects
        var siblings = this.parentElement.querySelectorAll('.sn-reason-btn');
        var wasActive = this.classList.contains('active');
        for (var sb = 0; sb < siblings.length; sb++) siblings[sb].classList.remove('active');
        if (!wasActive) this.classList.add('active');
      });
    }

    function updateAttSummary() {
      var summary = $('snAttSummary');
      if (!summary) return;
      var count = root.querySelectorAll('.sn-att-item.present').length;
      var total = root.querySelectorAll('.sn-att-item').length;
      summary.textContent = isMatch
        ? count + ' av ' + total + ' i troppen'
        : count + ' av ' + total + ' til stede';
    }

    var saveAttBtn = $('snSaveAttendance');
    if (saveAttBtn) saveAttBtn.addEventListener('click', async function() {
      var items = root.querySelectorAll('.sn-att-item');
      var map = {};
      var reasonMap = {};
      var squadList = [];
      for (var s = 0; s < items.length; s++) {
        var pid = items[s].getAttribute('data-pid');
        map[pid] = items[s].classList.contains('present');
        if (isMatch && map[pid]) squadList.push(pid);

        // Get reason for absent players
        if (!map[pid]) {
          var reasonRow = root.querySelector('.sn-att-reason[data-rpid="' + pid + '"]');
          if (reasonRow) {
            var activeReason = reasonRow.querySelector('.sn-reason-btn.active');
            if (activeReason) {
              reasonMap[pid] = activeReason.getAttribute('data-reason');
            }
          }
        }
      }

      saveAttBtn.disabled = true;
      saveAttBtn.textContent = 'Lagrer\u2026';

      var ok = await saveAttendance(ev.id, currentSeason.id, map, reasonMap, isMatch ? squadList : null);
      if (ok) {
        await loadEventAttendance(ev.id);
      }
      saveAttBtn.disabled = false;
      saveAttBtn.innerHTML = isMatch
        ? '<i class="fas fa-check" style="margin-right:5px;"></i>Lagre tropp'
        : '<i class="fas fa-check" style="margin-right:5px;"></i>Lagre oppm\u00f8te';
    });

    // --- MATCH RESULT HANDLERS ---
    // Add goal
    var addGoalBtn = $('snAddGoal');
    if (addGoalBtn) addGoalBtn.addEventListener('click', async function() {
      var playerSel = $('snGoalPlayer');
      if (!playerSel) return;
      addGoalBtn.disabled = true;
      var ok = await addMatchEvent(ev.id, playerSel.value, playerSel.options[playerSel.selectedIndex].text, 'goal');
      if (ok) { await loadMatchGoals(ev.id); render(); }
      else { addGoalBtn.disabled = false; }
    });

    var addAssistBtn = $('snAddAssist');
    if (addAssistBtn) addAssistBtn.addEventListener('click', async function() {
      var playerSel = $('snAssistPlayer');
      if (!playerSel) return;
      addAssistBtn.disabled = true;
      var ok = await addMatchEvent(ev.id, playerSel.value, playerSel.options[playerSel.selectedIndex].text, 'assist');
      if (ok) { await loadMatchGoals(ev.id); render(); }
      else { addAssistBtn.disabled = false; }
    });

    // Remove goals/assists
    var removeGoalBtns = root.querySelectorAll('.sn-goal-remove');
    for (var rg = 0; rg < removeGoalBtns.length; rg++) {
      removeGoalBtns[rg].addEventListener('click', (function(gid) {
        return async function(e) {
          e.stopPropagation();
          var ok = await removeMatchGoal(gid);
          if (ok) {
            await loadMatchGoals(ev.id);
            render();
          }
        };
      })(removeGoalBtns[rg].getAttribute('data-gid')));
    }

    // Duplicate (+)
    var dupGoalBtns = root.querySelectorAll('.sn-goal-dup');
    for (var dg = 0; dg < dupGoalBtns.length; dg++) {
      dupGoalBtns[dg].addEventListener('click', (function(btn) {
        return async function(e) {
          e.stopPropagation();
          btn.disabled = true;
          var pid = btn.getAttribute('data-pid');
          var pName = btn.getAttribute('data-pname');
          var typ = btn.getAttribute('data-type') || 'goal';
          var ok = await addMatchEvent(ev.id, pid, pName, typ);
          if (ok) { await loadMatchGoals(ev.id); render(); }
          else { btn.disabled = false; }
        };
      })(dupGoalBtns[dg]));
    }

    // Complete match
    var completeBtn = $('snCompleteMatch');
    if (completeBtn) completeBtn.addEventListener('click', async function() {
      var homeVal = $('snScoreHome') ? $('snScoreHome').value : null;
      var awayVal = $('snScoreAway') ? $('snScoreAway').value : null;

      completeBtn.disabled = true;
      completeBtn.textContent = 'Lagrer\u2026';

      var ok = await saveMatchResult(ev.id, homeVal, awayVal, 'completed');
      if (ok) {
        // Update local event data
        ev.status = 'completed';
        if (homeVal !== '' && homeVal !== null) ev.result_home = parseInt(homeVal);
        if (awayVal !== '' && awayVal !== null) ev.result_away = parseInt(awayVal);
        editingEvent = ev;
        await loadEvents(currentSeason.id);
        editingEvent = events.find(function(e) { return e.id === ev.id; }) || editingEvent;
        render();
      } else {
        completeBtn.disabled = false;
        completeBtn.innerHTML = '<i class="fas fa-check" style="margin-right:5px;"></i>Fullf\u00f8r kamp';
      }
    });

    // Reopen match for editing
    var reopenBtn = $('snReopenMatch');
    if (reopenBtn) reopenBtn.addEventListener('click', async function() {
      var ok = await saveMatchResult(ev.id, ev.result_home, ev.result_away, 'planned');
      if (ok) {
        ev.status = 'planned';
        editingEvent = ev;
        await loadEvents(currentSeason.id);
        editingEvent = events.find(function(e) { return e.id === ev.id; }) || editingEvent;
        render();
      }
    });
  }

  function matchEventItemHtml(item, showActions) {
    var isAssist = item.type === 'assist';
    var icon = isAssist
      ? '<span style="font-weight:800; color:var(--primary, #2563eb); font-size:14px; width:20px; text-align:center;">A</span>'
      : '<span>\u26BD</span>';
    var actions = '';
    if (showActions) {
      actions =
        '<button class="sn-goal-dup" data-pid="' + escapeHtml(item.player_id) + '" data-pname="' + escapeHtml(item.player_name || '') + '" data-type="' + (item.type || 'goal') + '" title="Legg til en til">+</button>' +
        '<button class="sn-goal-remove" data-gid="' + item.id + '" title="Fjern">\u00d7</button>';
    }
    return '<div class="sn-goal-item">' +
      icon +
      '<span style="font-weight:600;">' + escapeHtml(item.player_name || 'Ukjent') + '</span>' +
      actions +
    '</div>';
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
  //  EMBEDDED KAMPDAG
  // =========================================================================

  function renderEmbeddedKampdag(root) {
    if (!embeddedKampdagEvent || !embeddedKampdagTropp) {
      snView = 'dashboard';
      render();
      return;
    }
    var ev = embeddedKampdagEvent;
    var fmt = ev.format || (currentSeason ? currentSeason.format : 7);
    var mins = ev.duration_minutes || defaultMatchMinutes(fmt);

    root.innerHTML = '<div id="snKampdagContainer"></div>';
    var container = document.getElementById('snKampdagContainer');
    if (!container || !window.sesongKampdag) {
      root.innerHTML = '<div style="padding:20px; text-align:center;">Feil: sesong-kampdag.js ikke lastet.</div>';
      return;
    }

    window.sesongKampdag.init(container, embeddedKampdagTropp, {
      format: fmt,
      minutes: mins,
      eventId: ev.id,
      seasonId: ev.season_id,
      opponent: ev.opponent || '',
      isHome: ev.is_home !== false,
      onSave: function(planJson, minutesMap) {
        return saveKampdagToSesong(ev, planJson, minutesMap);
      },
      onBack: function() {
        window.sesongKampdag.destroy();
        embeddedKampdagEvent = null;
        embeddedKampdagTropp = null;
        snView = 'event-detail';
        render();
      }
    });
  }

  async function saveKampdagToSesong(ev, planJson, minutesMap) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) { notify('Ikke innlogget.', 'error'); return; }

    try {
      // 1. Save plan_json to event
      var evRes = await sb.from('events')
        .update({ plan_json: planJson })
        .eq('id', ev.id)
        .eq('user_id', uid);
      if (evRes.error) throw evRes.error;

      // Update local event object so event-detail reflects the saved plan
      ev.plan_json = planJson;
      if (editingEvent && editingEvent.id === ev.id) editingEvent.plan_json = planJson;

      // 2. Batch upsert minutes_played per player to event_players
      var playerIds = Object.keys(minutesMap);
      if (playerIds.length > 0) {
        var rows = [];
        for (var i = 0; i < playerIds.length; i++) {
          rows.push({
            event_id: ev.id,
            season_id: ev.season_id,
            user_id: uid,
            player_id: playerIds[i],
            minutes_played: minutesMap[playerIds[i]],
            in_squad: true,
            attended: true
          });
        }
        var epRes = await sb.from('event_players')
          .upsert(rows, { onConflict: 'event_id,player_id' });
        if (epRes.error) throw epRes.error;
      }

      notify('Spilletid lagret!', 'success');

      // Clean up and return to event detail
      window.sesongKampdag.destroy();
      embeddedKampdagEvent = null;
      embeddedKampdagTropp = null;

      // Invalidate stats cache so stats tab shows updated data
      seasonStats = [];
      seasonGoals = [];

      snView = 'event-detail';
      render();
    } catch (e) {
      console.error('[season.js] saveKampdagToSesong error:', e);
      notify('Feil ved lagring av spilletid.', 'error');
      // Re-enable save button so user can retry
      var retryBtn = document.getElementById('skdSavePlan');
      if (retryBtn) { retryBtn.disabled = false; retryBtn.innerHTML = '<i class="fas fa-save" style="margin-right:4px;"></i>Lagre spilletid til sesong'; }
    }
  }

  // =========================================================================
  //  KAMPDAG LEGACY (standalone)
  // =========================================================================

  function openInKampdag(ev) {
    var players = window.players || [];
    var playerIds = players.map(function(p) { return p.id; });

    window.kampdagPrefill({
      format: ev.format || (currentSeason ? currentSeason.format : 7),
      minutes: ev.duration_minutes || defaultMatchMinutes(ev.format || (currentSeason ? currentSeason.format : 7)),
      playerIds: playerIds
    });

    if (window.__BF_switchTab) window.__BF_switchTab('kampdag');
  }

  function openInKampdagWithTropp(ev, troppPlayerIds) {
    // Temporarily set window.players to only tropp players with season data
    var originalPlayers = window.players;

    var troppPlayers = [];
    for (var i = 0; i < troppPlayerIds.length; i++) {
      var sp = seasonPlayers.find(function(p) { return p.player_id === troppPlayerIds[i]; });
      if (sp) {
        troppPlayers.push({
          id: sp.player_id,
          name: sp.name,
          skill: sp.skill,
          goalie: sp.goalie,
          positions: sp.positions,
          active: true
        });
      }
    }

    window.players = troppPlayers;

    window.kampdagPrefill({
      format: ev.format || (currentSeason ? currentSeason.format : 7),
      minutes: ev.duration_minutes || defaultMatchMinutes(ev.format || (currentSeason ? currentSeason.format : 7)),
      playerIds: troppPlayers.map(function(p) { return p.id; })
    });

    if (window.__BF_switchTab) window.__BF_switchTab('kampdag');

    // Restore original players after a short delay (kampdag has already read them)
    setTimeout(function() { window.players = originalPlayers; }, 500);
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
    dashTab = 'calendar';
    await Promise.all([loadEvents(seasonId), loadSeasonPlayers(seasonId), loadRegisteredEventIds(seasonId)]);
    snView = 'dashboard';
    render();
  }

})();
