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
  var snView = 'list'; // 'list' | 'create-season' | 'edit-season' | 'dashboard' | 'create-event' | 'edit-event' | 'event-detail' | 'roster-import'
  var editingEvent = null; // event object when editing
  var editingSeasonPlayer = null; // season player object when editing
  var embeddedKampdagEvent = null; // event for embedded kampdag
  var embeddedKampdagTropp = null; // tropp players for embedded kampdag
  var subTeamFilter = null; // null = all, 1-5 = specific sub-team (for roster/stats tabs)

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

  // NFF standard kampvarighet per format (fallback when no age_class)
  function defaultMatchMinutes(format) {
    // If current season has age_class, use NFF per-age duration
    if (currentSeason && currentSeason.age_class) {
      var rule = getNffRule(currentSeason.age_class);
      if (rule) return rule.minutes;
    }
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

  // Is event in the future? Completed events are always past.
  function isFuture(ev) {
    if (ev.status === 'completed' || ev.status === 'cancelled') return false;
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

  // Sub-team helpers
  var SUB_TEAM_COLORS = ['#3b82f6', '#ea580c', '#059669', '#7c3aed', '#ec4899'];

  // NFF aldersklasse → format, varighet, barnefotball-status
  var NFF_AGE_RULES = {
    6:  { format: 3,  minutes: 20, barnefotball: true,  label: '3er, 2\u00d710 min' },
    7:  { format: 3,  minutes: 20, barnefotball: true,  label: '3er, 2\u00d710 min' },
    8:  { format: 5,  minutes: 30, barnefotball: true,  label: '5er, 2\u00d715 min' },
    9:  { format: 5,  minutes: 40, barnefotball: true,  label: '5er, 2\u00d720 min' },
    10: { format: 5,  minutes: 40, barnefotball: true,  label: '5er, 2\u00d720 min' },
    11: { format: 7,  minutes: 50, barnefotball: true,  label: '7er, 2\u00d725 min' },
    12: { format: 9,  minutes: 60, barnefotball: true,  label: '9er, 2\u00d730 min' },
    13: { format: 11, minutes: 60, barnefotball: false, label: '11er, 2\u00d730 min' }
  };

  // Parse age from age_class string: 'G10' → 10, 'J7' → 7
  function parseAgeFromClass(ageClass) {
    if (!ageClass) return null;
    var n = parseInt(String(ageClass).replace(/[^0-9]/g, ''));
    return (n >= 6 && n <= 19) ? n : null;
  }

  // Get NFF rule for age class string
  function getNffRule(ageClass) {
    var age = parseAgeFromClass(ageClass);
    if (!age) return null;
    return NFF_AGE_RULES[age] || (age >= 14 ? { format: 11, minutes: 70 + (age >= 16 ? 10 : 0), barnefotball: false, label: '11er' } : null);
  }

  function getSubTeamNames(season) {
    if (!season) return [];
    var count = season.sub_team_count || 1;
    if (count <= 1) return [];
    var names = season.sub_team_names || [];
    var result = [];
    for (var i = 0; i < count; i++) {
      result.push(names[i] || ('Lag ' + String.fromCharCode(65 + i)));
    }
    return result;
  }

  function getSubTeamName(season, idx) {
    var names = getSubTeamNames(season);
    return names[idx - 1] || ('Lag ' + String.fromCharCode(64 + idx));
  }

  function getSubTeamColor(idx) {
    return SUB_TEAM_COLORS[(idx - 1) % SUB_TEAM_COLORS.length] || '#64748b';
  }

  // =========================================================================
  //  iCAL EXPORT HELPERS
  // =========================================================================

  function icsDateUtc(isoStr) {
    // Convert ISO string to iCal UTC format: 20260315T170000Z
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) + 'Z';
  }

  function icsEscape(str) {
    // Escape special characters per RFC 5545
    if (!str) return '';
    return String(str)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function buildIcsEvent(ev, seasonName) {
    var isMatch = (ev.type === 'match' || ev.type === 'cup_match');
    var title = ev.title || ev.opponent || typeLabel(ev.type);
    if (isMatch && ev.opponent && !ev.title) {
      title = (ev.is_home ? 'Hjemme' : 'Borte') + ' vs ' + ev.opponent;
    }
    if (seasonName) title = seasonName + ': ' + title;

    var duration = ev.duration_minutes || defaultMatchMinutes(ev.format || (currentSeason ? currentSeason.format : 7));
    var startDate = new Date(ev.start_time);
    var endDate = new Date(startDate.getTime() + duration * 60000);

    var descParts = [];
    if (isMatch && ev.opponent) descParts.push('Motstander: ' + ev.opponent);
    if (isMatch) descParts.push(ev.is_home ? 'Hjemmekamp' : 'Bortekamp');
    if (ev.notes) descParts.push(ev.notes);
    descParts.push('barnefotballtrener.no');

    var lines = [
      'BEGIN:VEVENT',
      'UID:bft-' + ev.id + '@barnefotballtrener.no',
      'DTSTAMP:' + icsDateUtc(new Date().toISOString()),
      'DTSTART:' + icsDateUtc(ev.start_time),
      'DTEND:' + icsDateUtc(endDate.toISOString()),
      'SUMMARY:' + icsEscape(title),
    ];
    if (ev.location) lines.push('LOCATION:' + icsEscape(ev.location));
    if (descParts.length > 0) lines.push('DESCRIPTION:' + descParts.map(icsEscape).join('\\n'));
    lines.push('END:VEVENT');
    return lines.join('\r\n');
  }

  function buildIcsCalendar(evts, calName) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Barnefotballtrener//NO',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape(calName || 'Sesong')
    ];
    for (var i = 0; i < evts.length; i++) {
      lines.push(buildIcsEvent(evts[i], null));
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function downloadIcsFile(content, filename) {
    filename = filename || 'kalender.ics';

    // Detect iOS/iPadOS (iPadOS 13+ reports "Macintosh" in UA, so check touch)
    var isIOS = (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Tier 1: Web Share API with File (iOS 15.4+, Android 12+)
    // Opens native share sheet → user picks Calendar, Mail, etc.
    if (navigator.share && navigator.canShare) {
      try {
        var file = new File([content], filename, { type: 'text/calendar' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).then(function() {
            notify('Delt!', 'success');
          }).catch(function(err) {
            // AbortError = user cancelled share sheet (normal, no notification)
            if (err && err.name !== 'AbortError') {
              notify('Deling feilet. Prøv knappen på nytt.', 'error');
            }
          });
          return;
        }
      } catch (_) { /* File constructor not supported, fall through */ }
    }

    doDirectDownload(content, filename, isIOS);
  }

  function doDirectDownload(content, filename, isIOS) {
    if (isIOS) {
      // iOS/iPadOS: data URI with text/calendar triggers "Add to Calendar" dialog
      // Data URIs work in both Safari tabs and standalone PWA (unlike blob URLs)
      var dataUri = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(content);
      window.open(dataUri, '_blank');
      // Note: in standalone PWA on iOS < 16, this opens Safari outside the app.
      // No alternative exists — iOS does not allow programmatic calendar access from web.
      notify('Filen åpnes i Kalender.', 'success');
      return;
    }

    // Desktop + Android: standard blob download
    var blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
    notify('Kalender-fil lastet ned.', 'success');
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
      '.sn-card-meta { font-size:13px; color:var(--text-500); }',

      // Dashboard
      '.sn-dash-header { display:flex; align-items:center; gap:10px; margin-bottom:4px; }',
      '.sn-back { display:inline-flex; align-items:center; gap:4px; background:none; border:none; font-size:15px; font-weight:600; cursor:pointer; padding:6px 12px 6px 6px; color:var(--primary, #2563eb); border-radius:var(--radius-md); font-family:inherit; white-space:nowrap; }',
      '.sn-back:hover { background:var(--bg-hover, #f1f5f9); }',
      '.sn-back i { font-size:12px; }',
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

      // Roster
      '.sn-roster-item { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); }',
      '.sn-roster-item:last-child { border-bottom:none; }',
      '.sn-roster-name { flex:1; font-size:15px; font-weight:600; color:var(--text-800); }',
      '.sn-roster-badges { display:flex; gap:4px; align-items:center; }',
      '.sn-badge { display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700; line-height:1.4; }',
      '.sn-badge-format { background:var(--primary-dim); color:var(--primary); padding:3px 10px; border-radius:var(--radius-full); font-size:12px; }',
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

      // Spilletid (plan_confirmed)
      '.sn-playtime-list { padding:0; }',
      '.sn-playtime-row { display:flex; align-items:center; justify-content:space-between; padding:8px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); font-size:13px; }',
      '.sn-playtime-row:last-child { border-bottom:none; }',
      '.sn-playtime-name { font-weight:500; }',
      '.sn-playtime-min { font-variant-numeric:tabular-nums; font-weight:700; color:var(--text-600); }',
      '.sn-confirmed-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:600; background:rgba(34,197,94,0.12); color:#16a34a; margin-left:8px; }',
      '.sn-unconfirm-link { font-size:12px; color:var(--text-400); cursor:pointer; text-decoration:underline; margin-top:8px; text-align:center; }',

      // Import checkboxes
      '.sn-import-item { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); cursor:pointer; }',
      '.sn-import-item:hover { background:var(--bg-hover, #f8fafc); }',
      '.sn-import-cb { width:18px; height:18px; accent-color:var(--primary, #2563eb); cursor:pointer; }',

      // Responsive
      '@media (max-width:480px) { .sn-form-row { flex-direction:column; gap:0; } .sn-actions { flex-direction:column; } }',

      // NFF disclaimer modal
      '.sn-nff-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; }',
      '.sn-nff-modal { background:var(--bg-card, #fff); border-radius:var(--radius-lg, 16px); max-width:440px; width:100%; padding:28px 24px; box-shadow:0 20px 60px rgba(0,0,0,0.2); }',
      '.sn-nff-modal h3 { font-size:18px; font-weight:700; color:var(--text-800); margin:0 0 16px; }',
      '.sn-nff-modal p { font-size:14px; line-height:1.6; color:var(--text-600); margin:0 0 12px; }',
      '.sn-nff-modal ul { margin:0 0 16px; padding-left:20px; font-size:13px; line-height:1.7; color:var(--text-600); }',
      '.sn-nff-modal .sn-nff-source { font-size:11px; color:var(--text-400); margin-bottom:20px; }',
      '.sn-nff-accept { width:100%; padding:14px; border:none; border-radius:var(--radius-md, 12px); background:var(--primary, #2563eb); color:#fff; font-size:15px; font-weight:600; cursor:pointer; font-family:inherit; }',

      // Fotball.no import
      '.sn-import-teams { display:flex; flex-wrap:wrap; gap:4px; }',
      '.sn-import-team-btn { font-family:inherit; }',
      '.sn-import-list { border:1px solid var(--border); border-radius:var(--radius-md); overflow:hidden; }',
      '.sn-import-match { padding:10px 12px; border-bottom:1px solid var(--border); }',
      '.sn-import-match:last-child { border-bottom:none; }',

      // Sub-team: count toggle
      '.sn-count-toggle { display:flex; gap:0; }',
      '.sn-count-btn { flex:1; padding:11px 4px; border:2px solid var(--border); background:var(--bg-input, #fff); font-family:inherit; font-size:15px; font-weight:600; color:var(--text-500); cursor:pointer; transition:all 0.15s; text-align:center; }',
      '.sn-count-btn:first-child { border-radius:var(--radius-md) 0 0 var(--radius-md); }',
      '.sn-count-btn:last-child { border-radius:0 var(--radius-md) var(--radius-md) 0; }',
      '.sn-count-btn + .sn-count-btn { border-left:none; }',
      '.sn-count-btn.active { background:var(--primary-dim); border-color:var(--primary); color:var(--primary); }',

      // Sub-team: mode cards
      '.sn-mode-card { border:2px solid var(--border); border-radius:var(--radius-lg); padding:14px; margin-bottom:8px; cursor:pointer; transition:all 0.2s; display:flex; gap:12px; align-items:flex-start; }',
      '.sn-mode-card:hover { border-color:var(--text-300); }',
      '.sn-mode-card.selected { border-color:var(--primary); background:rgba(37,99,235,0.03); }',
      '.sn-mode-check { width:22px; height:22px; border:2px solid var(--border); border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s; margin-top:2px; font-size:10px; color:transparent; }',
      '.sn-mode-card.selected .sn-mode-check { border-color:var(--primary); background:var(--primary); color:#fff; }',
      '.sn-mode-title { font-size:15px; font-weight:700; margin-bottom:2px; }',
      '.sn-mode-desc { font-size:13px; color:var(--text-500); line-height:1.5; }',

      // Sub-team: filter tabs (roster + stats)
      '.sn-filter-tabs { display:flex; gap:0; margin-bottom:12px; border-radius:var(--radius-md); overflow:hidden; border:2px solid var(--border); }',
      '.sn-filter-tab { flex:1; padding:9px 4px; background:var(--bg-input, #fff); border:none; font-family:inherit; font-size:11.5px; font-weight:600; color:var(--text-400); cursor:pointer; text-align:center; border-right:1px solid var(--border); transition:all 0.15s; white-space:nowrap; }',
      '.sn-filter-tab:last-child { border-right:none; }',
      '.sn-filter-tab.active { background:var(--primary-dim); color:var(--primary); }',

      // Sub-team: player badges with colors
      '.sn-st-badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-full, 999px); font-size:11px; font-weight:700; }',
      '.sn-st-1 { background:rgba(37,99,235,0.12); color:#1d4ed8; }',
      '.sn-st-2 { background:rgba(234,88,12,0.12); color:#c2410c; }',
      '.sn-st-3 { background:rgba(16,185,129,0.12); color:#047857; }',
      '.sn-st-4 { background:rgba(147,51,234,0.12); color:#7c3aed; }',
      '.sn-st-5 { background:rgba(236,72,153,0.12); color:#be185d; }',

      // Sub-team: conditional section
      '.sn-cond-section { overflow:hidden; transition:max-height 0.3s, opacity 0.3s; }',
      '.sn-cond-section.hidden { max-height:0; opacity:0; margin:0; padding:0; border:none; pointer-events:none; }',

      // Sub-team: name input rows
      '.sn-name-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }',
      '.sn-color-dot { width:12px; height:12px; border-radius:50%; flex-shrink:0; }',
      '.sn-name-input { flex:1; padding:9px 12px; border:2px solid var(--border); border-radius:var(--radius-md); font-size:14px; font-family:inherit; color:var(--text-800); background:var(--bg-input, #fff); }',
      '.sn-name-input:focus { border-color:var(--primary); outline:none; }',
      '.sn-hint { font-size:12px; color:var(--text-400); margin-top:4px; line-height:1.4; }',

      // Sub-team: assignment view
      '.sn-assign-method { display:flex; gap:0; margin-bottom:16px; border-radius:var(--radius-md); overflow:hidden; border:2px solid var(--border); }',
      '.sn-assign-method-btn { flex:1; padding:11px 8px; background:var(--bg-input, #fff); border:none; font-family:inherit; font-size:13px; font-weight:600; color:var(--text-400); cursor:pointer; text-align:center; border-right:1px solid var(--border); transition:all 0.15s; }',
      '.sn-assign-method-btn:last-child { border-right:none; }',
      '.sn-assign-method-btn.active { background:var(--primary-dim); color:var(--primary); }',
      '.sn-assign-method-btn i { margin-right:4px; }',
      '.sn-assign-panel { display:none; }',
      '.sn-assign-panel.active { display:block; }',
      '.sn-counter-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }',
      '.sn-counter-chip { display:flex; align-items:center; gap:5px; padding:4px 10px; border-radius:var(--radius-full, 999px); font-size:12px; font-weight:600; background:var(--bg); }',
      '.sn-balance-bar { display:flex; gap:0; height:8px; border-radius:4px; overflow:hidden; margin:8px 0 4px; }',
      '.sn-balance-seg { transition:width 0.3s; }',
      '.sn-assign-row { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid var(--border-light, #f1f5f9); }',
      '.sn-assign-row:last-child { border-bottom:none; }',
      '.sn-assign-name { flex:1; min-width:0; display:flex; align-items:baseline; gap:4px; overflow:hidden; }',
      '.sn-assign-name .sn-pname { font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.sn-assign-name .sn-assign-meta { flex-shrink:0; font-size:11px; color:var(--text-400); }',
      '.sn-assign-select { flex:0 0 auto; padding:8px 10px; border:2px solid var(--border); border-radius:var(--radius-sm, 8px); font-size:13px; font-family:inherit; font-weight:600; color:var(--text-700); background:var(--bg-input, #fff); cursor:pointer; min-width:80px; max-width:110px; }',
      '.sn-assign-select:focus { border-color:var(--primary); outline:none; }',
      '.sn-assign-set-1 { border-color:#3b82f6; color:#1d4ed8; background:rgba(37,99,235,0.04); }',
      '.sn-assign-set-2 { border-color:#ea580c; color:#c2410c; background:rgba(234,88,12,0.04); }',
      '.sn-assign-set-3 { border-color:#059669; color:#047857; background:rgba(16,185,129,0.04); }',
      '.sn-assign-set-4 { border-color:#7c3aed; color:#7c3aed; background:rgba(147,51,234,0.04); }',
      '.sn-assign-set-5 { border-color:#ec4899; color:#be185d; background:rgba(236,72,153,0.04); }',
      '.sn-group-compact { background:var(--bg); border-radius:var(--radius-md); padding:10px 12px; margin-bottom:8px; }',
      '.sn-group-compact-header { display:flex; align-items:center; gap:6px; margin-bottom:4px; }',
      '.sn-group-compact-list { font-size:12px; color:var(--text-500); line-height:1.5; }',
      '.sn-keeper-ok { font-size:11px; color:var(--success, #22c55e); font-weight:500; margin-bottom:12px; }',
      '.sn-keeper-ok i { margin-right:3px; }',
      '.sn-unassigned-warn { background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.2); border-radius:var(--radius-md); padding:10px 14px; margin-bottom:12px; font-size:13px; color:#92400e; }',
      '.sn-unassigned-warn i { margin-right:4px; }',

      // Sub-team: player breakdown bar
      '.sn-breakdown { background:var(--bg); border-radius:var(--radius-md); padding:14px; margin:12px 0; }',
      '.sn-breakdown-title { font-size:12px; font-weight:600; color:var(--text-500); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; }',
      '.sn-breakdown-bar { display:flex; gap:2px; height:24px; border-radius:6px; overflow:hidden; margin-bottom:8px; }',
      '.sn-breakdown-seg { display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; color:#fff; min-width:20px; transition:width 0.3s; }',
      '.sn-breakdown-legend { display:flex; flex-wrap:wrap; gap:4px 10px; }',
      '.sn-breakdown-item { display:flex; align-items:center; gap:5px; font-size:12px; color:var(--text-600); }',
      '.sn-breakdown-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }',
      '.sn-loan-badge { display:inline-block; padding:1px 5px; border-radius:4px; font-size:9px; font-weight:700; background:rgba(234,179,8,0.15); color:#a16207; margin-left:4px; vertical-align:middle; }',
      '.sn-ev-team-badge { display:inline-block; padding:1px 6px; border-radius:var(--radius-full,999px); font-size:10px; font-weight:700; margin-right:4px; }',

      // Rotation distribution in event detail
      '.sn-dist-section { background:var(--bg-card, #fff); border:2px solid var(--border); border-radius:var(--radius-lg); padding:14px; margin-top:12px; }',
      '.sn-dist-title { font-weight:700; font-size:14px; margin-bottom:10px; display:flex; align-items:center; gap:6px; }',
      '.sn-dist-title i { color:var(--primary); }',
      '.sn-dist-actions { display:flex; gap:8px; margin-top:10px; }',
      '.sn-loan-suggestion { background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.2); border-radius:var(--radius-md); padding:10px 14px; margin-top:10px; font-size:13px; color:#92400e; }',
      '.sn-loan-suggestion strong { color:#78350f; }',
      '.sn-loan-suggestion button { margin-top:6px; padding:4px 10px; font-size:12px; }'
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
        // Skip re-render during team switch when players are briefly empty
        if ((window.players || []).length === 0) return;
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
    eventDistDraft = null;
    assignDraft = null;
    importState = { matches: null, allTeams: null, selectedTeam: null, selectedSubTeam: null, parsed: null };
    currentSeason = null;
    seasons = [];
    events = [];
    seasonPlayers = [];
    seasonStats = [];
    seasonGoals = [];
    eventAttendance = [];
    matchGoals = [];
    registeredEventIds = {};
    editingEvent = null;
    editingSeasonPlayer = null;
    dashTab = 'calendar';
    subTeamFilter = null;
    snView = 'list';
    _snInitialized = false;
    // players:updated follows immediately after team:changed
  });

  // Sync season nav when tab becomes active (dispatched from core.js switchTab)
  window.addEventListener('season:nav-sync', function() { updateSeasonNav(); });

  // =========================================================================
  //  CROSS-MODULE NAME SYNC: core.js → season tables
  // =========================================================================
  // When a player is renamed in Spillere-fanen (core.js), cascade to all
  // denormalized player_name fields in season_players, event_players, match_events.

  window.addEventListener('player:renamed', async function(e) {
    var detail = e.detail || {};
    var playerId = detail.playerId;
    var newName = detail.newName;
    if (!playerId || !newName) return;

    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) return;

    try {
      // 1. Update season_players (all seasons for this user)
      var spRes = await sb.from('season_players')
        .update({ player_name: newName })
        .eq('player_id', playerId)
        .eq('user_id', uid);
      if (spRes.error) console.warn('[season.js] player:renamed season_players sync:', spRes.error.message);

      // 2. Update event_players directly (player_id + user_id is sufficient, no .in() needed)
      await sb.from('event_players')
        .update({ player_name: newName })
        .eq('player_id', playerId)
        .eq('user_id', uid);

      // 3. Update match_events directly
      await sb.from('match_events')
        .update({ player_name: newName })
        .eq('player_id', playerId)
        .eq('user_id', uid);

      // 5. Refresh local state if a season is loaded
      if (currentSeason) {
        await loadSeasonPlayers(currentSeason.id);
        var el = $('sesong');
        if (el && el.classList.contains('active')) render();
      }

      console.log('[season.js] player:renamed sync complete for', playerId);
    } catch (err) {
      console.warn('[season.js] player:renamed sync error:', err.message || err);
    }
  });

  // =========================================================================
  //  SEASON BOTTOM NAV: wire tab buttons
  // =========================================================================

  (function wireSeasonNav() {
    var nav = document.getElementById('seasonNav');
    if (!nav) {
      // DOM not ready yet, defer
      document.addEventListener('DOMContentLoaded', wireSeasonNav);
      return;
    }
    var tabBtns = nav.querySelectorAll('.bottom-nav-btn[data-stab]');
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].addEventListener('click', (function(btn) {
        return async function() {
          var stab = btn.getAttribute('data-stab');
          if (!currentSeason) {
            // No season open – jump to list (or already there)
            if (snView !== 'list') { snView = 'list'; render(); }
            return;
          }
          // If in a sub-view, navigate back to dashboard first
          dashTab = stab;
          subTeamFilter = null; // reset filter when switching tabs
          eventDistDraft = null; // reset rotation draft when leaving event-detail
          editingEvent = null; // clean up event context
          snView = 'dashboard';
          if (stab === 'stats') {
            var needStats = seasonStats.length === 0;
            var needGoals = seasonGoals.length === 0;
            if (needStats || needGoals) {
              var loads = [];
              if (needStats) loads.push(loadSeasonStats(currentSeason.id));
              if (needGoals) loads.push(loadSeasonGoals(currentSeason.id));
              await Promise.all(loads);
              if (dashTab !== stab) return; // user changed tab while loading
            }
          }
          render();
          try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (_) { window.scrollTo(0, 0); }
        };
      })(tabBtns[i]));
    }
  })();

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
        end_date: data.end_date || null,
        age_class: data.age_class || null,
        sub_team_count: parseInt(data.sub_team_count) || 1,
        sub_team_mode: data.sub_team_mode || 'fixed',
        sub_team_names: data.sub_team_names || null
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

  async function updateSeason(id, fields) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) { notify('Kunne ikke koble til databasen.', 'error'); return null; }

    try {
      var res = await sb.from('seasons')
        .update(fields)
        .eq('id', id)
        .eq('user_id', uid)
        .select()
        .single();
      if (res.error) throw res.error;
      notify('Sesong oppdatert.', 'success');
      return res.data;
    } catch (e) {
      console.error('[season.js] updateSeason error:', e);
      notify('Feil ved oppdatering.', 'error');
      return null;
    }
  }

  async function deleteSeason(id) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid) return false;

    try {
      // Defensiv sletting: barn først, selv om CASCADE håndterer det.
      // Sikrer at sletting fungerer uavhengig av DB-constraint-endringer.

      // 1. Hent event-IDer (match_events mangler season_id)
      var evRes = await sb.from('events').select('id').eq('season_id', id).eq('user_id', uid);
      var eventIds = (evRes.data || []).map(function(e) { return e.id; });

      // 2. match_events (dypest barn, FK → events)
      if (eventIds.length > 0) {
        var r1 = await sb.from('match_events').delete().in('event_id', eventIds).eq('user_id', uid);
        if (r1.error) console.warn('[season.js] match_events cleanup:', r1.error.message);
      }

      // 3. event_players (FK → events + seasons)
      var r2 = await sb.from('event_players').delete().eq('season_id', id).eq('user_id', uid);
      if (r2.error) console.warn('[season.js] event_players cleanup:', r2.error.message);

      // 4. training_series (FK → seasons)
      var r3 = await sb.from('training_series').delete().eq('season_id', id).eq('user_id', uid);
      if (r3.error) console.warn('[season.js] training_series cleanup:', r3.error.message);

      // 5. season_players (FK → seasons)
      var r4 = await sb.from('season_players').delete().eq('season_id', id).eq('user_id', uid);
      if (r4.error) console.warn('[season.js] season_players cleanup:', r4.error.message);

      // 6. events (FK → seasons)
      var r5 = await sb.from('events').delete().eq('season_id', id).eq('user_id', uid);
      if (r5.error) console.warn('[season.js] events cleanup:', r5.error.message);

      // 7. Sesongen selv
      var res = await sb.from('seasons').delete().eq('id', id).eq('user_id', uid);
      if (res.error) throw res.error;

      notify('Sesong slettet.', 'success');
      return true;
    } catch (e) {
      console.error('[season.js] deleteSeason error:', e);
      notify('Feil ved sletting av sesong.', 'error');
      return false;
    }
  }

  async function duplicateSeason(sourceSeason) {
    var sb = getSb();
    var tid = getTeamId();
    var uid = getUserId();
    if (!sb || !tid || !uid) { notify('Kunne ikke koble til databasen.', 'error'); return null; }

    try {
      // 1. Create new season with same settings
      var newRow = {
        user_id: uid,
        team_id: tid,
        name: 'Kopi av ' + (sourceSeason.name || 'sesong'),
        format: sourceSeason.format || 7,
        start_date: null,
        end_date: null,
        age_class: sourceSeason.age_class || null,
        sub_team_count: sourceSeason.sub_team_count || 1,
        sub_team_mode: sourceSeason.sub_team_mode || 'fixed',
        sub_team_names: sourceSeason.sub_team_names || null
      };
      var res = await sb.from('seasons').insert(newRow).select().single();
      if (res.error) throw res.error;
      var newSeason = res.data;

      // 2. Copy season_players (with sub_team assignments, no events/attendance)
      var spRes = await sb.from('season_players')
        .select('*')
        .eq('season_id', sourceSeason.id)
        .eq('user_id', uid);

      if (!spRes.error && spRes.data && spRes.data.length > 0) {
        var newPlayers = spRes.data.map(function(sp) {
          return {
            season_id: newSeason.id,
            user_id: uid,
            player_id: sp.player_id,
            player_name: sp.player_name,
            player_skill: sp.player_skill,
            player_goalie: sp.player_goalie,
            player_positions: sp.player_positions,
            active: sp.active,
            sub_team: sp.sub_team
          };
        });
        var insertRes = await sb.from('season_players').insert(newPlayers);
        if (insertRes.error) {
          console.warn('[season.js] duplicateSeason players:', insertRes.error.message);
          notify('Sesong opprettet, men spillere ble ikke kopiert. Importer dem manuelt.', 'warning');
          return newSeason;
        }
      }

      notify('Sesong duplisert!', 'success');
      return newSeason;
    } catch (e) {
      console.error('[season.js] duplicateSeason error:', e);
      notify('Feil ved duplisering av sesong.', 'error');
      return null;
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
        notes: (data.notes || '').trim() || null,
        sub_team: data.sub_team ? parseInt(data.sub_team) : null
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
          active: row.active !== false,
          sub_team: row.sub_team || null
        };
      });

      // Reconcile: sync names from core.js players → season_players
      // Only for p_ players (imported from Spillere-fanen), not sp_ (season-only)
      reconcilePlayerNames(seasonId, sb, uid);
    } catch (e) {
      console.error('[season.js] loadSeasonPlayers error:', e);
      seasonPlayers = [];
    }
  }

  // Fire-and-forget reconciliation of core.js player names → season_players + downstream
  function reconcilePlayerNames(seasonId, sb, uid) {
    var corePlayers = window.players || [];
    if (!corePlayers.length || !seasonPlayers.length) return;

    var stale = [];
    for (var i = 0; i < seasonPlayers.length; i++) {
      var sp = seasonPlayers[i];
      if (!sp.player_id || sp.player_id.indexOf('p_') !== 0) continue;
      for (var c = 0; c < corePlayers.length; c++) {
        if (corePlayers[c].id === sp.player_id && corePlayers[c].name !== sp.name) {
          stale.push({ rowId: sp.id, playerId: sp.player_id, newName: corePlayers[c].name });
          sp.name = corePlayers[c].name; // Update local state immediately
          break;
        }
      }
    }

    if (stale.length === 0) return;

    console.log('[season.js] Reconciling ' + stale.length + ' player name(s) from Spillere-fanen');

    // Async cascade: season_players + event_players + match_events
    (async function() {
      try {
        // 1. Update season_players
        for (var u = 0; u < stale.length; u++) {
          await sb.from('season_players')
            .update({ player_name: stale[u].newName })
            .eq('id', stale[u].rowId)
            .eq('user_id', uid);
        }

        // 2. Cascade to event_players and match_events for this season
        var evRes = await sb.from('events').select('id').eq('season_id', seasonId).eq('user_id', uid);
        var evIds = (evRes.data || []).map(function(e) { return e.id; });
        if (evIds.length > 0) {
          for (var s = 0; s < stale.length; s++) {
            await sb.from('event_players')
              .update({ player_name: stale[s].newName })
              .in('event_id', evIds)
              .eq('player_id', stale[s].playerId)
              .eq('user_id', uid);
            await sb.from('match_events')
              .update({ player_name: stale[s].newName })
              .in('event_id', evIds)
              .eq('player_id', stale[s].playerId)
              .eq('user_id', uid);
          }
        }
      } catch (err) {
        console.warn('[season.js] reconcilePlayerNames cascade error:', err.message || err);
      }
    })();
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

  async function saveAttendance(eventId, seasonId, attendanceMap, reasonMap, squadList, subTeamMap) {
    // attendanceMap = { player_id: true/false }
    // reasonMap = { player_id: 'syk'|'skade'|'borte'|null } (optional)
    // squadList = ['player_id', ...] or null (for matches)
    // subTeamMap = { player_id: subTeamIdx } or null (rotation mode)
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !eventId || !seasonId) return false;

    var squadSet = {};
    if (squadList) {
      for (var q = 0; q < squadList.length; q++) squadSet[squadList[q]] = true;
    }

    try {
      // Build player name lookup from season players
      var nameMap = {};
      for (var n = 0; n < seasonPlayers.length; n++) {
        nameMap[seasonPlayers[n].player_id] = seasonPlayers[n].name;
      }

      var rows = [];
      var playerIds = Object.keys(attendanceMap);
      for (var i = 0; i < playerIds.length; i++) {
        var pid = playerIds[i];
        var row = {
          event_id: eventId,
          season_id: seasonId,
          user_id: uid,
          player_id: pid,
          attended: attendanceMap[pid],
          player_name: nameMap[pid] || null
        };
        if (squadList) {
          row.in_squad = !!squadSet[pid];
        }
        if (reasonMap && reasonMap[pid] && !attendanceMap[pid]) {
          row.absence_reason = reasonMap[pid];
        } else {
          row.absence_reason = null; // Clear stale reason on attend/no-reason
        }
        if (subTeamMap) {
          row.sub_team = subTeamMap[pid] || null;
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
        .eq('user_id', uid)
        .limit(5000);
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
    // Age class is the most accurate source
    if (currentSeason && currentSeason.age_class) {
      var rule = getNffRule(currentSeason.age_class);
      if (rule) return rule.barnefotball;
    }
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
        .eq('user_id', uid)
        .limit(5000);
      if (res.error) throw res.error;
      // Guard: discard if season changed while loading (race condition on team-switch)
      if (!currentSeason || currentSeason.id !== seasonId) {
        console.log('[season.js] loadSeasonStats: season changed during load, discarding');
        return;
      }
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
        .eq('user_id', uid)
        .limit(5000);
      if (res.error) throw res.error;
      // Guard: discard if season changed while loading
      if (!currentSeason || currentSeason.id !== seasonId) {
        console.log('[season.js] loadSeasonGoals: season changed during load, discarding');
        return;
      }
      seasonGoals = res.data || [];
    } catch (e) {
      console.error('[season.js] loadSeasonGoals error:', e);
      seasonGoals = [];
    }
  }

  function computeStats(filterSubTeam) {
    var players = seasonPlayers.filter(function(p) { return p.active; });

    // Optionally filter events by sub_team (only matches — trainings are shared across teams)
    var filteredEvents = events;
    if (filterSubTeam !== undefined && filterSubTeam !== null) {
      filteredEvents = events.filter(function(e) {
        if (e.type === 'training') return true;
        return e.sub_team === filterSubTeam;
      });
    }
    var filteredEventIds = {};
    for (var fe = 0; fe < filteredEvents.length; fe++) { filteredEventIds[filteredEvents[fe].id] = true; }

    // Categorize events
    var matchEvts = filteredEvents.filter(function(e) { return e.type === 'match' || e.type === 'cup_match'; });
    var trainingEvts = filteredEvents.filter(function(e) { return e.type === 'training'; });

    // Registered events
    var regIds = {};
    for (var s = 0; s < seasonStats.length; s++) {
      regIds[seasonStats[s].event_id] = true;
    }
    var registeredMatches = matchEvts.filter(function(e) { return regIds[e.id]; });
    var registeredTrainings = trainingEvts.filter(function(e) { return regIds[e.id]; });

    // Completed matches with results
    var completedMatches = matchEvts.filter(function(e) {
      return e.status === 'completed' && e.result_home !== null && e.result_home !== undefined && e.result_away !== null && e.result_away !== undefined;
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
        assists: 0,
        relevantMatches: 0,    // matches where player was in squad (or no tropp used)
        relevantTrainings: 0   // trainings where attendance was registered for player
      };
    }

    // Event type map
    var eventTypeMap = {};
    for (var e = 0; e < events.length; e++) {
      eventTypeMap[events[e].id] = events[e].type;
    }

    // Per-player relevant event counting (for fair denominator)
    for (var r = 0; r < seasonStats.length; r++) {
      var rrow = seasonStats[r];
      if (!playerMap[rrow.player_id]) continue;
      if (filterSubTeam !== undefined && filterSubTeam !== null && !filteredEventIds[rrow.event_id]) continue;
      var rType = eventTypeMap[rrow.event_id];
      if (!rType) continue;
      if (rType === 'match' || rType === 'cup_match') {
        // Skip matches where player was explicitly NOT in squad (two-team scenario)
        if (rrow.in_squad === false) continue;
        playerMap[rrow.player_id].relevantMatches++;
      } else if (rType === 'training') {
        playerMap[rrow.player_id].relevantTrainings++;
      }
    }

    // Attendance (only attended=true rows count)
    for (var j = 0; j < seasonStats.length; j++) {
      var row = seasonStats[j];
      if (!playerMap[row.player_id]) continue;
      if (row.attended !== true) continue;
      if (filterSubTeam !== undefined && filterSubTeam !== null && !filteredEventIds[row.event_id]) continue;

      var evType = eventTypeMap[row.event_id];
      if (!evType) continue; // Skip orphan rows for deleted events
      if ((evType === 'match' || evType === 'cup_match') && row.in_squad === false) continue; // two-team: skip matches player was not in squad for
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
      if (filterSubTeam !== undefined && filterSubTeam !== null && !filteredEventIds[me.event_id]) continue;
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
      if (filterSubTeam !== undefined && filterSubTeam !== null && !filteredEventIds[seasonGoals[ta].event_id]) continue;
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

  // =========================================================================
  //  SEASON BOTTOM NAV: sync active state
  // =========================================================================

  function updateSeasonNav() {
    var nav = document.getElementById('seasonNav');
    if (!nav) return;

    var btns = nav.querySelectorAll('.bottom-nav-btn[data-stab]');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');

    // Map current view to parent tab
    var activeTab = null;
    if (snView === 'dashboard') {
      activeTab = dashTab;
    } else if (snView === 'event-detail' || snView === 'create-event' || snView === 'edit-event' || snView === 'embedded-kampdag' || snView === 'create-series' || snView === 'fotball-import') {
      activeTab = 'calendar';
    } else if (snView === 'roster-import' || snView === 'roster-add-manual' || snView === 'roster-assign') {
      activeTab = 'roster';
    } else if (snView === 'roster-edit-player' || snView === 'player-stats') {
      activeTab = dashTab; // came from roster or stats tab
    }
    // list, create-season, edit-season → no tab active

    if (activeTab) {
      var btn = nav.querySelector('.bottom-nav-btn[data-stab="' + activeTab + '"]');
      if (btn) btn.classList.add('active');
    }
  }

  function render() {
    var root = $('snRoot');
    if (!root) return;

    // Clean up embedded kampdag if navigating away from it
    if (snView !== 'embedded-kampdag' && window.sesongKampdag && window.sesongKampdag.isActive()) {
      window.sesongKampdag.destroy();
      embeddedKampdagEvent = null;
      embeddedKampdagTropp = null;
    }

    updateSeasonNav();

    switch (snView) {
      case 'list':           renderSeasonList(root);   break;
      case 'create-season':  renderCreateSeason(root); break;
      case 'edit-season':    renderEditSeason(root);   break;
      case 'dashboard':      renderDashboard(root);    break;
      case 'create-event':   renderCreateEvent(root);  break;
      case 'edit-event':     renderEditEvent(root);    break;
      case 'event-detail':   renderEventDetail(root);  break;
      case 'roster-import':  renderRosterImport(root); break;
      case 'roster-add-manual': renderManualPlayerAdd(root); break;
      case 'roster-edit-player': renderEditPlayer(root); break;
      case 'roster-assign': renderRosterAssign(root); break;
      case 'create-series': renderCreateSeries(root); break;
      case 'player-stats': renderPlayerStats(root); break;
      case 'fotball-import': renderFotballImport(root); break;
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
            '<span class="sn-badge sn-badge-format">' + (s.age_class ? escapeHtml(s.age_class) + ' \u00B7 ' : '') + formatLabel(s.format) + ((s.sub_team_count || 1) > 1 ? ' \u00B7 ' + s.sub_team_count + ' lag' : '') + '</span>' +
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
          '<button class="sn-back" id="snBackFromCreate"><i class="fas fa-chevron-left"></i> Avbryt</button>' +
          '<span class="sn-dash-title">Ny sesong</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snSeasonName">Navn</label>' +
            '<input type="text" id="snSeasonName" placeholder="F.eks. V\u00e5r 2026" maxlength="60" autocomplete="off">' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snAgeClass">\u00c5rsklasse <span style="font-weight:400;color:var(--text-400);">(valgfritt)</span></label>' +
            '<select id="snAgeClass">' +
              '<option value="">Velg \u00e5rsklasse\u2026</option>' +
              '<optgroup label="Gutter">' +
                '<option value="G6">G6 (6 \u00e5r)</option><option value="G7">G7</option><option value="G8">G8</option><option value="G9">G9</option><option value="G10">G10</option><option value="G11">G11</option><option value="G12">G12</option><option value="G13">G13</option>' +
              '</optgroup>' +
              '<optgroup label="Jenter">' +
                '<option value="J6">J6 (6 \u00e5r)</option><option value="J7">J7</option><option value="J8">J8</option><option value="J9">J9</option><option value="J10">J10</option><option value="J11">J11</option><option value="J12">J12</option><option value="J13">J13</option>' +
              '</optgroup>' +
            '</select>' +
            '<div class="sn-hint" id="snAgeHint" style="display:none;"></div>' +
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

          // Sub-team count
          '<div style="border-top:2px solid var(--border);margin-top:18px;padding-top:16px;">' +
            '<div class="form-group">' +
              '<label>Antall lag i seriespillet</label>' +
              '<div class="sn-count-toggle" id="snSubTeamCount">' +
                '<button type="button" class="sn-count-btn active" data-val="1">1</button>' +
                '<button type="button" class="sn-count-btn" data-val="2">2</button>' +
                '<button type="button" class="sn-count-btn" data-val="3">3</button>' +
                '<button type="button" class="sn-count-btn" data-val="4">4</button>' +
                '<button type="button" class="sn-count-btn" data-val="5">5</button>' +
              '</div>' +
              '<div class="sn-hint">Velg 1 om alle spillerne spiller p\u00e5 samme lag</div>' +
            '</div>' +
          '</div>' +

          // Mode selection (hidden when count=1)
          '<div class="sn-cond-section hidden" id="snModeSection">' +
            '<div class="form-group" style="margin-bottom:10px;">' +
              '<label>Lagoppsett</label>' +
            '</div>' +
            '<div class="sn-mode-card selected" id="snModeFixed" data-mode="fixed">' +
              '<div class="sn-mode-check">\u2713</div>' +
              '<div>' +
                '<div class="sn-mode-title">Faste lag</div>' +
                '<div class="sn-mode-desc">Spillerne fordeles p\u00e5 lag og f\u00f8lger dem som hovedregel gjennom sesongen.</div>' +
              '</div>' +
            '</div>' +
            '<div class="sn-mode-card" id="snModeRotate" data-mode="rotate">' +
              '<div class="sn-mode-check">\u2713</div>' +
              '<div>' +
                '<div class="sn-mode-title">Rullering</div>' +
                '<div class="sn-mode-desc">Ny rettferdig fordeling per kamprunde. Alle spiller med alle over sesongen.</div>' +
              '</div>' +
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

    // Age class → auto-suggest format + show NFF hint
    $('snAgeClass').addEventListener('change', function() {
      var rule = getNffRule(this.value);
      var hint = $('snAgeHint');
      if (rule) {
        $('snSeasonFormat').value = String(rule.format);
        if (hint) {
          hint.style.display = 'block';
          hint.innerHTML = '<i class="fas fa-futbol" style="margin-right:4px;color:var(--primary);"></i>NFF anbefaler: ' + rule.label +
            (rule.barnefotball ? ' <span style="color:var(--text-400);">\u00B7 Barnefotball-regler gjelder</span>' : '');
        }
      } else if (hint) {
        hint.style.display = 'none';
      }
    });

    // Sub-team count toggle
    var countToggle = $('snSubTeamCount');
    if (countToggle) countToggle.addEventListener('click', function(e) {
      var btn = e.target.closest('.sn-count-btn');
      if (!btn) return;
      this.querySelectorAll('.sn-count-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var val = parseInt(btn.getAttribute('data-val'));
      var sec = $('snModeSection');
      if (sec) {
        if (val > 1) sec.classList.remove('hidden');
        else sec.classList.add('hidden');
      }
    });

    // Mode card selection
    var modeCards = root.querySelectorAll('.sn-mode-card');
    for (var m = 0; m < modeCards.length; m++) {
      modeCards[m].addEventListener('click', function() {
        for (var j = 0; j < modeCards.length; j++) { modeCards[j].classList.remove('selected'); }
        this.classList.add('selected');
      });
    }

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

      // Read sub-team settings
      var countEl = root.querySelector('.sn-count-btn.active');
      var subTeamCount = countEl ? parseInt(countEl.getAttribute('data-val')) : 1;
      var modeEl = root.querySelector('.sn-mode-card.selected');
      var subTeamMode = (modeEl && subTeamCount > 1) ? (modeEl.getAttribute('data-mode') || 'fixed') : 'fixed';

      var season = await createSeason({
        name: name,
        format: $('snSeasonFormat').value,
        start_date: $('snStartDate').value || null,
        end_date: $('snEndDate').value || null,
        age_class: $('snAgeClass').value || null,
        sub_team_count: subTeamCount,
        sub_team_mode: subTeamMode,
        sub_team_names: null
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
  //  VIEW: EDIT SEASON
  // =========================================================================

  function renderEditSeason(root) {
    if (!currentSeason) { goToList(); return; }
    var s = currentSeason;
    var stCount = s.sub_team_count || 1;
    var stMode = s.sub_team_mode || 'fixed';
    var stNames = getSubTeamNames(s);

    var countBtns = '';
    for (var c = 1; c <= 5; c++) {
      countBtns += '<button type="button" class="sn-count-btn' + (stCount === c ? ' active' : '') + '" data-val="' + c + '">' + c + '</button>';
    }

    // Team name inputs (only shown when count > 1)
    var nameInputs = '';
    if (stCount > 1) {
      for (var n = 0; n < stCount; n++) {
        nameInputs +=
          '<div class="sn-name-row">' +
            '<div class="sn-color-dot" style="background:' + getSubTeamColor(n + 1) + ';"></div>' +
            '<input class="sn-name-input" type="text" id="snTeamName' + n + '" value="' + escapeHtml(stNames[n] || '') + '" placeholder="Lag ' + String.fromCharCode(65 + n) + '" maxlength="30">' +
          '</div>';
      }
    }

    root.innerHTML =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromEditSeason"><i class="fas fa-chevron-left"></i> Tilbake</button>' +
          '<span class="sn-dash-title">Rediger sesong</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snEditSeasonName">Navn</label>' +
            '<input type="text" id="snEditSeasonName" placeholder="F.eks. V\u00e5r 2026" maxlength="60" autocomplete="off" value="' + escapeHtml(s.name) + '">' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snEditAgeClass">\u00c5rsklasse <span style="font-weight:400;color:var(--text-400);">(valgfritt)</span></label>' +
            '<select id="snEditAgeClass">' +
              '<option value="">Ingen valgt</option>' +
              '<optgroup label="Gutter">' +
                '<option value="G6"' + (s.age_class === 'G6' ? ' selected' : '') + '>G6</option>' +
                '<option value="G7"' + (s.age_class === 'G7' ? ' selected' : '') + '>G7</option>' +
                '<option value="G8"' + (s.age_class === 'G8' ? ' selected' : '') + '>G8</option>' +
                '<option value="G9"' + (s.age_class === 'G9' ? ' selected' : '') + '>G9</option>' +
                '<option value="G10"' + (s.age_class === 'G10' ? ' selected' : '') + '>G10</option>' +
                '<option value="G11"' + (s.age_class === 'G11' ? ' selected' : '') + '>G11</option>' +
                '<option value="G12"' + (s.age_class === 'G12' ? ' selected' : '') + '>G12</option>' +
                '<option value="G13"' + (s.age_class === 'G13' ? ' selected' : '') + '>G13</option>' +
              '</optgroup>' +
              '<optgroup label="Jenter">' +
                '<option value="J6"' + (s.age_class === 'J6' ? ' selected' : '') + '>J6</option>' +
                '<option value="J7"' + (s.age_class === 'J7' ? ' selected' : '') + '>J7</option>' +
                '<option value="J8"' + (s.age_class === 'J8' ? ' selected' : '') + '>J8</option>' +
                '<option value="J9"' + (s.age_class === 'J9' ? ' selected' : '') + '>J9</option>' +
                '<option value="J10"' + (s.age_class === 'J10' ? ' selected' : '') + '>J10</option>' +
                '<option value="J11"' + (s.age_class === 'J11' ? ' selected' : '') + '>J11</option>' +
                '<option value="J12"' + (s.age_class === 'J12' ? ' selected' : '') + '>J12</option>' +
                '<option value="J13"' + (s.age_class === 'J13' ? ' selected' : '') + '>J13</option>' +
              '</optgroup>' +
            '</select>' +
            '<div class="sn-hint" id="snEditAgeHint" style="' + (s.age_class ? '' : 'display:none;') + '">' +
              (function() { var r = getNffRule(s.age_class); return r ? '<i class="fas fa-futbol" style="margin-right:4px;color:var(--primary);"></i>NFF: ' + r.label + (r.barnefotball ? ' \u00B7 Barnefotball-regler' : '') : ''; })() +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="snEditSeasonFormat">Kampformat</label>' +
            '<select id="snEditSeasonFormat">' +
              '<option value="3"' + (s.format === 3 ? ' selected' : '') + '>3er</option>' +
              '<option value="5"' + (s.format === 5 ? ' selected' : '') + '>5er</option>' +
              '<option value="7"' + (s.format === 7 ? ' selected' : '') + '>7er</option>' +
              '<option value="9"' + (s.format === 9 ? ' selected' : '') + '>9er</option>' +
              '<option value="11"' + (s.format === 11 ? ' selected' : '') + '>11er</option>' +
            '</select>' +
          '</div>' +
          '<div class="sn-form-row">' +
            '<div class="form-group">' +
              '<label for="snEditStartDate">Startdato</label>' +
              '<input type="date" id="snEditStartDate" value="' + (s.start_date || '') + '">' +
            '</div>' +
            '<div class="form-group">' +
              '<label for="snEditEndDate">Sluttdato</label>' +
              '<input type="date" id="snEditEndDate" value="' + (s.end_date || '') + '">' +
            '</div>' +
          '</div>' +

          // Sub-team count
          '<div style="border-top:2px solid var(--border);margin-top:18px;padding-top:16px;">' +
            '<div class="form-group">' +
              '<label>Antall lag</label>' +
              '<div class="sn-count-toggle" id="snEditSubTeamCount">' + countBtns + '</div>' +
            '</div>' +
          '</div>' +

          // Mode selection (hidden when count=1)
          '<div class="sn-cond-section' + (stCount <= 1 ? ' hidden' : '') + '" id="snEditModeSection">' +
            '<div class="form-group" style="margin-bottom:10px;">' +
              '<label>Lagoppsett</label>' +
            '</div>' +
            '<div class="sn-mode-card' + (stMode === 'fixed' ? ' selected' : '') + '" data-mode="fixed">' +
              '<div class="sn-mode-check">\u2713</div>' +
              '<div>' +
                '<div class="sn-mode-title">Faste lag</div>' +
                '<div class="sn-mode-desc">Spillerne fordeles p\u00e5 lag og f\u00f8lger dem gjennom sesongen.</div>' +
              '</div>' +
            '</div>' +
            '<div class="sn-mode-card' + (stMode === 'rotate' ? ' selected' : '') + '" data-mode="rotate">' +
              '<div class="sn-mode-check">\u2713</div>' +
              '<div>' +
                '<div class="sn-mode-title">Rullering</div>' +
                '<div class="sn-mode-desc">Ny rettferdig fordeling per kamprunde.</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Team names (hidden when count=1)
          '<div class="sn-cond-section' + (stCount <= 1 ? ' hidden' : '') + '" id="snEditNamesSection" style="border-top:2px solid var(--border);margin-top:14px;padding-top:16px;">' +
            '<div class="form-group">' +
              '<label>Lagnavn</label>' +
              '<div class="sn-hint" style="margin-bottom:8px;">Valgfritt. Brukes i stall, kamper og statistikk.</div>' +
              '<div id="snTeamNameInputs">' + nameInputs + '</div>' +
            '</div>' +
          '</div>' +

          '<div class="sn-form-buttons">' +
            '<button class="btn-secondary" id="snCancelEditSeason">Avbryt</button>' +
            '<button class="btn-primary" id="snSaveEditSeason">Lagre</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    $('snBackFromEditSeason').addEventListener('click', goToDashboard);
    $('snCancelEditSeason').addEventListener('click', goToDashboard);

    // Age class → auto-suggest format
    $('snEditAgeClass').addEventListener('change', function() {
      var rule = getNffRule(this.value);
      var hint = $('snEditAgeHint');
      if (rule) {
        $('snEditSeasonFormat').value = String(rule.format);
        if (hint) {
          hint.style.display = 'block';
          hint.innerHTML = '<i class="fas fa-futbol" style="margin-right:4px;color:var(--primary);"></i>NFF: ' + rule.label +
            (rule.barnefotball ? ' \u00B7 Barnefotball-regler' : '');
        }
      } else if (hint) {
        hint.style.display = 'none';
      }
    });

    // Count toggle
    var editCountToggle = $('snEditSubTeamCount');
    if (editCountToggle) editCountToggle.addEventListener('click', function(e) {
      var btn = e.target.closest('.sn-count-btn');
      if (!btn) return;
      this.querySelectorAll('.sn-count-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var val = parseInt(btn.getAttribute('data-val'));
      var modeSec = $('snEditModeSection');
      var namesSec = $('snEditNamesSection');
      if (modeSec) { if (val > 1) modeSec.classList.remove('hidden'); else modeSec.classList.add('hidden'); }
      if (namesSec) { if (val > 1) namesSec.classList.remove('hidden'); else namesSec.classList.add('hidden'); }
      // Rebuild name inputs
      var container = $('snTeamNameInputs');
      if (container && val > 1) {
        var html = '';
        for (var i = 0; i < val; i++) {
          var existing = stNames[i] || '';
          html +=
            '<div class="sn-name-row">' +
              '<div class="sn-color-dot" style="background:' + getSubTeamColor(i + 1) + ';"></div>' +
              '<input class="sn-name-input" type="text" id="snTeamName' + i + '" value="' + escapeHtml(existing) + '" placeholder="Lag ' + String.fromCharCode(65 + i) + '" maxlength="30">' +
            '</div>';
        }
        container.innerHTML = html;
      }
    });

    // Mode cards
    var editModeCards = root.querySelectorAll('.sn-mode-card');
    for (var mc = 0; mc < editModeCards.length; mc++) {
      editModeCards[mc].addEventListener('click', function() {
        for (var j = 0; j < editModeCards.length; j++) editModeCards[j].classList.remove('selected');
        this.classList.add('selected');
      });
    }

    $('snSaveEditSeason').addEventListener('click', async function() {
      var name = ($('snEditSeasonName').value || '').trim();
      if (!name) {
        notify('Gi sesongen et navn.', 'warning');
        $('snEditSeasonName').focus();
        return;
      }
      var btn = $('snSaveEditSeason');
      btn.disabled = true;
      btn.textContent = 'Lagrer\u2026';

      // Read sub-team settings
      var countEl = root.querySelector('#snEditSubTeamCount .sn-count-btn.active');
      var newCount = countEl ? parseInt(countEl.getAttribute('data-val')) : 1;
      var modeEl = root.querySelector('.sn-mode-card.selected');
      var newMode = (modeEl && newCount > 1) ? (modeEl.getAttribute('data-mode') || 'fixed') : 'fixed';

      // Read team names
      var teamNames = null;
      if (newCount > 1) {
        teamNames = [];
        for (var tn = 0; tn < newCount; tn++) {
          var inp = $('snTeamName' + tn);
          teamNames.push(inp ? (inp.value || '').trim() : '');
        }
        // Only save if at least one name is non-empty
        if (teamNames.every(function(n) { return !n; })) teamNames = null;
      }

      var fields = {
        name: name,
        format: parseInt($('snEditSeasonFormat').value) || s.format,
        start_date: $('snEditStartDate').value || null,
        end_date: $('snEditEndDate').value || null,
        age_class: $('snEditAgeClass').value || null,
        sub_team_count: newCount,
        sub_team_mode: newMode,
        sub_team_names: teamNames
      };

      var updated = await updateSeason(s.id, fields);
      if (updated) {
        // L1 fix: Clean stale sub_team data when count decreases or mode changes
        var oldCount = s.sub_team_count || 1;
        var oldMode = s.sub_team_mode || 'fixed';
        if (newCount < oldCount || (newCount <= 1 && oldCount > 1) || (newMode !== oldMode)) {
          var sb = getSb();
          var uid = getUserId();
          if (sb && uid) {
            // Nullify sub_team values: all if going to 1 or mode change, else only above new count
            var cleanupThreshold = (newCount <= 1 || newMode !== oldMode) ? 0 : newCount;
            try {
              await sb.from('season_players')
                .update({ sub_team: null })
                .eq('season_id', s.id)
                .eq('user_id', uid)
                .gt('sub_team', cleanupThreshold);
              await sb.from('event_players')
                .update({ sub_team: null })
                .eq('season_id', s.id)
                .eq('user_id', uid)
                .gt('sub_team', cleanupThreshold);
              // Also update local state
              for (var cl = 0; cl < seasonPlayers.length; cl++) {
                if (seasonPlayers[cl].sub_team && seasonPlayers[cl].sub_team > cleanupThreshold) {
                  seasonPlayers[cl].sub_team = null;
                }
              }
            } catch (cleanErr) {
              console.warn('[season.js] sub_team cleanup:', cleanErr.message || cleanErr);
            }
          }
        }

        // Update local state
        currentSeason = updated;
        // Refresh seasons list for when we go back
        var idx = seasons.findIndex(function(x) { return x.id === updated.id; });
        if (idx !== -1) seasons[idx] = Object.assign(seasons[idx], updated);
        goToDashboard();
      } else {
        btn.disabled = false;
        btn.textContent = 'Lagre';
      }
    });

    setTimeout(function() { var el = $('snEditSeasonName'); if (el) el.focus(); }, 50);
  }

  // =========================================================================
  //  VIEW: DASHBOARD (season detail with events)
  // =========================================================================

  function renderDashboard(root) {
    if (!currentSeason) { goToList(); return; }
    var s = currentSeason;

    var range = formatDateRange(s.start_date, s.end_date);
    var metaParts = [];
    if (s.age_class) metaParts.push(s.age_class);
    metaParts.push(formatLabel(s.format));
    if (range) metaParts.push(range);
    if ((s.sub_team_count || 1) > 1) {
      var stLabel = (s.sub_team_count || 1) + ' lag (' + (s.sub_team_mode === 'rotate' ? 'rullering' : 'fast') + ')';
      metaParts.push(stLabel);
    }

    var html =
      '<div class="settings-card" style="margin-bottom:12px;">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromDash"><i class="fas fa-chevron-left"></i> Sesonger</button>' +
          '<button style="background:none; border:none; font-size:16px; color:var(--text-400); cursor:pointer; padding:6px 8px; margin-left:auto; border-radius:var(--radius-sm);" id="snEditSeason" title="Rediger sesong"><i class="fas fa-pen"></i></button>' +
        '</div>' +
        '<div class="sn-dash-title" style="font-size:22px; font-weight:700; margin:4px 0 2px;">' + escapeHtml(s.name) + '</div>' +
        '<div class="sn-dash-meta">' + escapeHtml(metaParts.join(' \u00B7 ')) + '</div>' +
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

    // Show NFF disclaimer overlay if stats tab and not yet accepted
    if (dashTab === 'stats' && !hasAcceptedNffDisclaimer()) {
      root.insertAdjacentHTML('beforeend', renderNffDisclaimer());
      var acceptBtn = $('snNffAccept');
      if (acceptBtn) acceptBtn.addEventListener('click', function() {
        acceptNffDisclaimer();
        var overlay = $('snNffOverlay');
        if (overlay) overlay.remove();
      });
    }

    // Bind back button
    $('snBackFromDash').addEventListener('click', goToList);

    // Edit season button
    var editSeasonBtn = $('snEditSeason');
    if (editSeasonBtn) editSeasonBtn.addEventListener('click', function() {
      snView = 'edit-season';
      render();
    });

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
      '<div class="settings-card" style="padding-top:12px;">' +
        '<div class="sn-actions">' +
          '<button class="btn-primary" id="snAddMatch"><i class="fas fa-futbol" style="margin-right:5px;"></i>Legg til kamp</button>' +
          '<button class="btn-secondary" id="snAddTraining"><i class="fas fa-dumbbell" style="margin-right:5px;"></i>Legg til trening</button>' +
        '</div>' +
        '<div style="margin-top:8px; display:flex; gap:8px;">' +
          '<button class="btn-secondary" id="snAddSeries" style="flex:1; font-size:13px;"><i class="fas fa-redo" style="margin-right:5px;"></i>Treningsserie</button>' +
          '<button class="btn-secondary" id="snImportFotball" style="flex:1; font-size:13px;"><i class="fas fa-file-import" style="margin-right:5px;"></i>Importer kamper</button>' +
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
      html += renderEventItems(past.reverse());
    }

    // Delete season button
    html +=
      '<div style="margin-top:32px; padding-top:16px; border-top:1px solid var(--border); margin-bottom:32px;">' +
        (events.length > 0
          ? '<button class="btn-secondary" id="snExportIcal" style="width:100%; margin-bottom:8px;">' +
              '<i class="fas fa-calendar-alt" style="margin-right:6px;"></i>Eksporter til kalender (.ics)' +
            '</button>'
          : '') +
        '<button class="btn-secondary" id="snDuplicateSeason" style="width:100%; margin-bottom:8px;">' +
          '<i class="fas fa-copy" style="margin-right:6px;"></i>Dupliser sesong' +
        '</button>' +
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

    var importBtn = $('snImportFotball');
    if (importBtn) importBtn.addEventListener('click', function() {
      snView = 'fotball-import';
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
        seasonStats = [];
        seasonGoals = [];
        eventAttendance = [];
        matchGoals = [];
        registeredEventIds = {};
        editingEvent = null;
        editingSeasonPlayer = null;
        eventDistDraft = null;
        importState = { matches: null, allTeams: null, selectedTeam: null, selectedSubTeam: null, parsed: null };
        subTeamFilter = null;
        dashTab = 'calendar';
        snView = 'list';
        await loadSeasons();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash" style="margin-right:6px;"></i>Slett sesong';
      }
    });

    bindEventItemClicks(root);

    // iCal export
    var icalBtn = $('snExportIcal');
    if (icalBtn) icalBtn.addEventListener('click', function() {
      var s = currentSeason;
      if (!s || events.length === 0) return;
      var ics = buildIcsCalendar(events, s.name);
      var safeName = (s.name || 'sesong').replace(/[^a-zA-Z0-9\u00e6\u00f8\u00e5\u00c6\u00d8\u00c5 _-]/g, '').replace(/\s+/g, '_') || 'sesong';
      downloadIcsFile(ics, safeName + '.ics');
    });

    // Duplicate season
    var dupBtn = $('snDuplicateSeason');
    if (dupBtn) dupBtn.addEventListener('click', async function() {
      var s = currentSeason;
      if (!s) return;
      if (!confirm('Dupliser sesongen \u00AB' + s.name + '\u00BB?\n\nStall og laginnstillinger kopieres.\nKamper og treninger kopieres ikke.')) return;

      dupBtn.disabled = true;
      dupBtn.textContent = 'Dupliserer\u2026';

      var newSeason = await duplicateSeason(s);
      if (newSeason) {
        await loadSeasons();
        openSeason(newSeason.id);
      } else {
        dupBtn.disabled = false;
        dupBtn.innerHTML = '<i class="fas fa-copy" style="margin-right:6px;"></i>Dupliser sesong';
      }
    });
  }

  // =========================================================================
  //  DASHBOARD TAB: SPILLERSTALL
  // =========================================================================

  function renderRosterTab() {
    var active = seasonPlayers.filter(function(p) { return p.active; });
    var stCount = (currentSeason && currentSeason.sub_team_count) || 1;
    var hasSubTeams = stCount > 1 && (currentSeason.sub_team_mode === 'fixed');

    var html =
      '<div class="settings-card" style="padding-top:12px;">' +
        '<div class="sn-actions">' +
          '<button class="btn-primary" id="snImportPlayers" style="flex:1;"><i class="fas fa-download" style="margin-right:5px;"></i>Importer fra Spillere</button>' +
          '<button class="btn-secondary" id="snAddManualPlayer" style="flex:0 0 auto;"><i class="fas fa-plus"></i></button>' +
        '</div>' +
        (hasSubTeams && active.length >= 2 ?
          '<button class="btn-secondary" id="snAssignPlayers" style="width:100%;margin-top:8px;font-size:13px;"><i class="fas fa-random" style="margin-right:5px;"></i>Fordel spillere p\u00e5 lag</button>' : '') +
      '</div>';

    // Filter tabs (only for fixed sub-teams)
    if (hasSubTeams) {
      var stNames = getSubTeamNames(currentSeason);
      html += '<div class="sn-filter-tabs" id="snRosterFilterTabs">';
      html += '<button class="sn-filter-tab' + (subTeamFilter === null ? ' active' : '') + '" data-stf="all" style="flex:1.2;">Alle (' + active.length + ')</button>';
      for (var ft = 0; ft < stCount; ft++) {
        var ftIdx = ft + 1;
        var ftCount = active.filter(function(p) { return p.sub_team === ftIdx; }).length;
        html += '<button class="sn-filter-tab' + (subTeamFilter === ftIdx ? ' active' : '') + '" data-stf="' + ftIdx + '" style="color:' + getSubTeamColor(ftIdx) + ';">' + escapeHtml(stNames[ft] || String.fromCharCode(65 + ft)) + ' (' + ftCount + ')</button>';
      }
      var unassignedCount = active.filter(function(p) { return !p.sub_team; }).length;
      if (unassignedCount > 0) {
        html += '<button class="sn-filter-tab' + (subTeamFilter === 0 ? ' active' : '') + '" data-stf="0" style="color:var(--text-400);">? (' + unassignedCount + ')</button>';
      }
      html += '</div>';
    }

    // Filter players
    var displayed = active;
    if (hasSubTeams && subTeamFilter !== null) {
      if (subTeamFilter === 0) {
        displayed = active.filter(function(p) { return !p.sub_team; });
      } else {
        displayed = active.filter(function(p) { return p.sub_team === subTeamFilter; });
      }
    }

    if (displayed.length === 0 && active.length === 0) {
      html +=
        '<div class="sn-roster-empty">' +
          '<div style="font-size:36px; margin-bottom:12px;">\uD83D\uDC65</div>' +
          '<div style="font-weight:600; margin-bottom:6px;">Ingen spillere i sesongen</div>' +
          '<div>Importer spillere fra Spillere-fanen for \u00e5 komme i gang.</div>' +
        '</div>';
    } else if (displayed.length === 0) {
      html +=
        '<div class="sn-roster-empty">' +
          '<div style="font-size:36px; margin-bottom:12px;">\uD83D\uDD0D</div>' +
          '<div>Ingen spillere i denne gruppen.</div>' +
        '</div>';
    } else {
      html += '<div class="sn-section">Spillere (' + displayed.length + ')</div>';
      html += '<div class="settings-card" style="padding:0;">';

      for (var i = 0; i < displayed.length; i++) {
        var p = displayed[i];
        var posLabels = (p.positions || []).join('/');
        var stBadge = '';
        if (hasSubTeams && p.sub_team) {
          stBadge = '<span class="sn-st-badge sn-st-' + p.sub_team + '">' + escapeHtml(getSubTeamName(currentSeason, p.sub_team)) + '</span>';
        } else if (hasSubTeams && !p.sub_team) {
          stBadge = '<span class="sn-st-badge" style="background:var(--border);color:var(--text-400);">Ikke fordelt</span>';
        }
        html +=
          '<div class="sn-roster-item" data-spid="' + p.id + '" style="cursor:pointer;">' +
            '<div class="sn-roster-name">' + escapeHtml(p.name) + '</div>' +
            '<div class="sn-roster-badges">' +
              stBadge +
              (p.goalie ? '<span class="sn-badge sn-badge-keeper">Kan st\u00e5 i m\u00e5l</span>' : '') +
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
    // Sub-team filter tabs
    var filterTabs = $('snRosterFilterTabs');
    if (filterTabs) filterTabs.addEventListener('click', function(e) {
      var tab = e.target.closest('.sn-filter-tab');
      if (!tab) return;
      var val = tab.getAttribute('data-stf');
      if (val === 'all') {
        subTeamFilter = null;
      } else {
        subTeamFilter = parseInt(val);
      }
      render();
    });

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

    // Assign players to sub-teams
    var assignBtn = $('snAssignPlayers');
    if (assignBtn) assignBtn.addEventListener('click', function() {
      snView = 'roster-assign';
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
            if (loads.length > 0) {
              var viewBefore = snView;
              await Promise.all(loads);
              // Guard: if user navigated away while loading, don't force-navigate back
              if (snView !== viewBefore) return;
            }
            snView = 'player-stats';
            render();
          }
        };
      })(items[i].getAttribute('data-spid')));
    }
  }

  // =========================================================================
  //  VIEW: ROSTER ASSIGN (Fase 2 — fordel spillere på lag)
  // =========================================================================

  // Temp state for assignment view
  var assignDraft = null; // { assignments: { playerId: subTeamIdx }, method: 'auto'|'manual' }
  var eventDistDraft = null; // { assignments: { playerId: subTeamIdx } } — per-event rotation

  function buildCounters(assignments, stCount, scopePlayerIds) {
    var counts = {};
    var sums = {};
    for (var t = 1; t <= stCount; t++) { counts[t] = 0; sums[t] = 0; }
    counts[0] = 0; sums[0] = 0;
    var active = seasonPlayers.filter(function(p) { return p.active; });
    // If scope provided (rotation mode), only count players in scope
    if (scopePlayerIds) {
      var scopeSet = {};
      for (var si = 0; si < scopePlayerIds.length; si++) scopeSet[scopePlayerIds[si]] = true;
      active = active.filter(function(p) { return scopeSet[p.player_id]; });
    }
    for (var i = 0; i < active.length; i++) {
      var st = assignments[active[i].player_id] || 0;
      counts[st] = (counts[st] || 0) + 1;
      sums[st] = (sums[st] || 0) + (active[i].skill || 3);
    }
    return { counts: counts, sums: sums };
  }

  function buildBalanceBar(assignments, stCount, scopePlayerIds) {
    var active = seasonPlayers.filter(function(p) { return p.active; });
    if (scopePlayerIds) {
      var scopeSet = {};
      for (var si = 0; si < scopePlayerIds.length; si++) scopeSet[scopePlayerIds[si]] = true;
      active = active.filter(function(p) { return scopeSet[p.player_id]; });
    }
    var total = active.length || 1;
    var c = buildCounters(assignments, stCount, scopePlayerIds);
    var html = '<div class="sn-balance-bar">';
    for (var t = 1; t <= stCount; t++) {
      var pct = Math.round((c.counts[t] / total) * 100);
      html += '<div class="sn-balance-seg" style="width:' + pct + '%;background:' + getSubTeamColor(t) + ';"></div>';
    }
    if (c.counts[0] > 0) {
      var pct0 = Math.round((c.counts[0] / total) * 100);
      html += '<div class="sn-balance-seg" style="width:' + pct0 + '%;background:var(--border);"></div>';
    }
    html += '</div>';
    return html;
  }

  function buildCounterChips(assignments, stCount, scopePlayerIds) {
    var c = buildCounters(assignments, stCount, scopePlayerIds);
    var stNames = getSubTeamNames(currentSeason);
    var html = '<div class="sn-counter-row">';
    for (var t = 1; t <= stCount; t++) {
      var avg = c.counts[t] > 0 ? (c.sums[t] / c.counts[t]).toFixed(1) : '0';
      html += '<div class="sn-counter-chip" style="border:2px solid ' + getSubTeamColor(t) + ';color:' + getSubTeamColor(t) + ';">' +
        escapeHtml(stNames[t - 1] || String.fromCharCode(64 + t)) + ': ' + c.counts[t] + ' <span style="opacity:0.6;font-size:11px;">(snitt ' + avg + ')</span></div>';
    }
    if (c.counts[0] > 0) {
      html += '<div class="sn-counter-chip" style="border:2px solid var(--border);color:var(--text-400);">Ikke fordelt: ' + c.counts[0] + '</div>';
    }
    html += '</div>';
    return html;
  }

  function runSnakeDraft() {
    var active = seasonPlayers.filter(function(p) { return p.active; });
    var stCount = (currentSeason && currentSeason.sub_team_count) || 2;
    if (!window.Grouping || !window.Grouping.makeEvenTeams) {
      notify('Grupperingsmodulen er ikke lastet.', 'error');
      return null;
    }
    var result = window.Grouping.makeEvenTeams(active, stCount, true);
    var assignments = {};
    for (var t = 0; t < result.teams.length; t++) {
      for (var p = 0; p < result.teams[t].players.length; p++) {
        var pid = result.teams[t].players[p].player_id || result.teams[t].players[p].id;
        // season_players use .player_id, grouping uses the object as-is
        // find matching season player
        var sp = active.find(function(s) { return s.player_id === pid || s.id === pid; });
        if (sp) assignments[sp.player_id] = t + 1;
      }
    }
    return assignments;
  }

  function runSnakeDraftUnassignedOnly(existing) {
    var active = seasonPlayers.filter(function(p) { return p.active; });
    var unassigned = active.filter(function(p) { return !existing[p.player_id]; });
    if (unassigned.length === 0) return existing;

    var stCount = (currentSeason && currentSeason.sub_team_count) || 2;
    if (!window.Grouping || !window.Grouping.makeEvenTeams) return existing;

    // Count how many already assigned per team for weighting
    var teamCounts = {};
    for (var t = 1; t <= stCount; t++) teamCounts[t] = 0;
    for (var pid in existing) { if (existing[pid]) teamCounts[existing[pid]]++; }

    var result = window.Grouping.makeEvenTeams(unassigned, stCount, true);
    var copy = {};
    for (var k in existing) copy[k] = existing[k];

    // Assign to teams with fewest players first
    var teamOrder = [];
    for (var ti = 1; ti <= stCount; ti++) teamOrder.push({ idx: ti, count: teamCounts[ti] });
    teamOrder.sort(function(a, b) { return a.count - b.count; });

    for (var dt = 0; dt < result.teams.length; dt++) {
      var targetTeam = teamOrder[dt] ? teamOrder[dt].idx : (dt + 1);
      for (var dp = 0; dp < result.teams[dt].players.length; dp++) {
        var dpid = result.teams[dt].players[dp].player_id || result.teams[dt].players[dp].id;
        var dsp = active.find(function(s) { return s.player_id === dpid || s.id === dpid; });
        if (dsp) copy[dsp.player_id] = targetTeam;
      }
    }
    return copy;
  }

  async function saveSubTeamAssignments(assignments) {
    var sb = getSb();
    var uid = getUserId();
    if (!sb || !uid || !currentSeason) { notify('Feil: mangler tilkobling.', 'error'); return false; }

    try {
      var active = seasonPlayers.filter(function(p) { return p.active; });
      var updates = [];
      for (var i = 0; i < active.length; i++) {
        var sp = active[i];
        var newSt = assignments[sp.player_id] || null;
        if (sp.sub_team !== newSt) {
          updates.push({ id: sp.id, sub_team: newSt });
        }
      }

      if (updates.length === 0) {
        notify('Ingen endringer \u00e5 lagre.', 'info');
        return true;
      }

      // Batch update — Supabase doesn't support bulk with different values, so loop
      for (var u = 0; u < updates.length; u++) {
        var res = await sb.from('season_players')
          .update({ sub_team: updates[u].sub_team })
          .eq('id', updates[u].id)
          .eq('user_id', uid);
        if (res.error) throw res.error;
      }

      // Update local state
      for (var j = 0; j < active.length; j++) {
        active[j].sub_team = assignments[active[j].player_id] || null;
      }

      notify(updates.length + ' spiller' + (updates.length === 1 ? '' : 'e') + ' fordelt!', 'success');
      return true;
    } catch (e) {
      console.error('[season.js] saveSubTeamAssignments error:', e);
      notify('Feil ved lagring av lagfordeling.', 'error');
      return false;
    }
  }

  function renderRosterAssign(root) {
    if (!currentSeason || (currentSeason.sub_team_count || 1) <= 1) {
      dashTab = 'roster'; snView = 'dashboard'; render(); return;
    }

    var active = seasonPlayers.filter(function(p) { return p.active; });
    var stCount = currentSeason.sub_team_count;
    var stNames = getSubTeamNames(currentSeason);

    // Initialize draft if needed
    if (!assignDraft) {
      assignDraft = { assignments: {}, method: 'auto' };
      // Pre-populate from existing assignments
      for (var i = 0; i < active.length; i++) {
        if (active[i].sub_team) assignDraft.assignments[active[i].player_id] = active[i].sub_team;
      }
    }

    var asgn = assignDraft.assignments;
    var method = assignDraft.method;

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromAssign"><i class="fas fa-chevron-left"></i> Stall</button>' +
          '<span class="sn-dash-title">Fordel spillere</span>' +
        '</div>' +

        // Method toggle
        '<div class="sn-assign-method" id="snAssignMethod">' +
          '<button class="sn-assign-method-btn' + (method === 'auto' ? ' active' : '') + '" data-method="auto"><i class="fas fa-magic"></i>Jevne lag</button>' +
          '<button class="sn-assign-method-btn' + (method === 'manual' ? ' active' : '') + '" data-method="manual"><i class="fas fa-hand-pointer"></i>Manuell</button>' +
        '</div>' +

        // Balance indicators (shared)
        '<div id="snAssignCounters">' + buildCounterChips(asgn, stCount) + '</div>' +
        '<div id="snAssignBalance">' + buildBalanceBar(asgn, stCount) + '</div>' +
      '</div>';

    // === AUTO PANEL ===
    html += '<div class="sn-assign-panel' + (method === 'auto' ? ' active' : '') + '" id="snAutoPanel">';

    // Check keeper distribution
    var keeperCheck = '';
    if (active.some(function(p) { return p.goalie; })) {
      var keeperTeams = {};
      for (var ki = 0; ki < active.length; ki++) {
        if (active[ki].goalie && asgn[active[ki].player_id]) {
          keeperTeams[asgn[active[ki].player_id]] = true;
        }
      }
      var keeperCount = Object.keys(keeperTeams).length;
      if (keeperCount >= stCount) {
        keeperCheck = '<div class="sn-keeper-ok"><i class="fas fa-check-circle"></i>Keeper p\u00e5 alle lag</div>';
      } else if (keeperCount > 0) {
        keeperCheck = '<div class="sn-unassigned-warn"><i class="fas fa-exclamation-triangle"></i>Keeper mangler p\u00e5 ' + (stCount - keeperCount) + ' lag</div>';
      }
    }

    html += keeperCheck;

    // Compact group lists
    for (var gt = 1; gt <= stCount; gt++) {
      var teamPlayers = active.filter(function(p) { return asgn[p.player_id] === gt; });
      var nameList = teamPlayers.map(function(p) {
        return escapeHtml(p.name) + (p.goalie ? ' \uD83E\uDDE4' : '');
      }).join(', ');
      html +=
        '<div class="sn-group-compact">' +
          '<div class="sn-group-compact-header">' +
            '<div class="sn-color-dot" style="background:' + getSubTeamColor(gt) + ';"></div>' +
            '<strong style="font-size:14px;">' + escapeHtml(stNames[gt - 1]) + '</strong>' +
            '<span style="font-size:12px;color:var(--text-400);margin-left:auto;">' + teamPlayers.length + ' spillere</span>' +
          '</div>' +
          '<div class="sn-group-compact-list">' + (nameList || '<em style="color:var(--text-300);">Ingen spillere</em>') + '</div>' +
        '</div>';
    }

    // Unassigned
    var unassignedAuto = active.filter(function(p) { return !asgn[p.player_id]; });
    if (unassignedAuto.length > 0) {
      html += '<div class="sn-unassigned-warn"><i class="fas fa-exclamation-triangle"></i>' + unassignedAuto.length + ' spiller' + (unassignedAuto.length === 1 ? '' : 'e') + ' ikke fordelt</div>';
    }

    html +=
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="btn-secondary" id="snRedraft" style="flex:1;"><i class="fas fa-redo" style="margin-right:4px;"></i>Trekk p\u00e5 nytt</button>' +
        '<button class="btn-secondary" id="snSwitchToManual" style="flex:1;">Juster manuelt</button>' +
      '</div>';

    html += '</div>'; // end auto panel

    // === MANUAL PANEL ===
    html += '<div class="sn-assign-panel' + (method === 'manual' ? ' active' : '') + '" id="snManualPanel">';
    html += '<div class="settings-card" style="padding:0;">';

    // Sort: keepers first, then by name
    var sortedActive = active.slice().sort(function(a, b) {
      if (a.goalie && !b.goalie) return -1;
      if (!a.goalie && b.goalie) return 1;
      return a.name.localeCompare(b.name, 'nb');
    });

    for (var mi = 0; mi < sortedActive.length; mi++) {
      var mp = sortedActive[mi];
      var currentVal = asgn[mp.player_id] || 0;
      var selectClass = currentVal > 0 ? ' sn-assign-set-' + currentVal : '';

      var optionsHtml = '<option value="0"' + (currentVal === 0 ? ' selected' : '') + '>\u2013</option>';
      for (var ot = 1; ot <= stCount; ot++) {
        optionsHtml += '<option value="' + ot + '"' + (currentVal === ot ? ' selected' : '') + '>' + escapeHtml(stNames[ot - 1]) + '</option>';
      }

      html +=
        '<div class="sn-assign-row">' +
          '<div class="sn-assign-name">' +
            '<span class="sn-pname">' + escapeHtml(mp.name) + '</span>' +
            (mp.goalie ? '<span class="sn-assign-meta">\uD83E\uDDE4</span>' : '') +
            '<span class="sn-assign-meta">' + mp.skill + '</span>' +
          '</div>' +
          '<select class="sn-assign-select' + selectClass + '" data-apid="' + escapeHtml(mp.player_id) + '">' + optionsHtml + '</select>' +
        '</div>';
    }

    html += '</div>';

    // Unassigned check for manual
    var manualUnassigned = sortedActive.filter(function(p) { return !asgn[p.player_id]; });
    if (manualUnassigned.length > 0 && manualUnassigned.length < sortedActive.length) {
      html +=
        '<button class="btn-secondary" id="snFillRest" style="width:100%;margin-top:10px;font-size:13px;">' +
          '<i class="fas fa-magic" style="margin-right:4px;"></i>Fyll resten jevnt (' + manualUnassigned.length + ' spillere)' +
        '</button>';
    }

    html += '</div>'; // end manual panel

    // Save button (shared)
    html +=
      '<div style="margin-top:16px;display:flex;gap:8px;">' +
        '<button class="btn-primary" id="snSaveAssign" style="flex:1;"><i class="fas fa-save" style="margin-right:5px;"></i>Lagre fordeling</button>' +
      '</div>';

    root.innerHTML = html;

    // === BIND EVENTS ===

    // Back
    $('snBackFromAssign').addEventListener('click', function() {
      assignDraft = null;
      dashTab = 'roster'; snView = 'dashboard'; render();
    });

    // Method toggle
    $('snAssignMethod').addEventListener('click', function(e) {
      var btn = e.target.closest('.sn-assign-method-btn');
      if (!btn) return;
      var m = btn.getAttribute('data-method');
      assignDraft.method = m;
      render();
    });

    // Auto: re-draft
    var redraftBtn = $('snRedraft');
    if (redraftBtn) redraftBtn.addEventListener('click', function() {
      var newAsgn = runSnakeDraft();
      if (newAsgn) {
        assignDraft.assignments = newAsgn;
        render();
      }
    });

    // Auto: switch to manual
    var switchBtn = $('snSwitchToManual');
    if (switchBtn) switchBtn.addEventListener('click', function() {
      assignDraft.method = 'manual';
      render();
    });

    // Manual: dropdown changes
    var selects = root.querySelectorAll('.sn-assign-select');
    for (var si = 0; si < selects.length; si++) {
      selects[si].addEventListener('change', function() {
        var pid = this.getAttribute('data-apid');
        var val = parseInt(this.value);
        if (val > 0) {
          assignDraft.assignments[pid] = val;
        } else {
          delete assignDraft.assignments[pid];
        }
        // Update color class
        this.className = 'sn-assign-select' + (val > 0 ? ' sn-assign-set-' + val : '');
        // Update counters and balance bar without full re-render
        var countersEl = $('snAssignCounters');
        var balanceEl = $('snAssignBalance');
        if (countersEl) countersEl.innerHTML = buildCounterChips(assignDraft.assignments, stCount);
        if (balanceEl) balanceEl.innerHTML = buildBalanceBar(assignDraft.assignments, stCount);
      });
    }

    // Manual: fill rest
    var fillBtn = $('snFillRest');
    if (fillBtn) fillBtn.addEventListener('click', function() {
      var filled = runSnakeDraftUnassignedOnly(assignDraft.assignments);
      assignDraft.assignments = filled;
      render();
    });

    // Save
    $('snSaveAssign').addEventListener('click', async function() {
      var btn = $('snSaveAssign');
      btn.disabled = true;
      btn.textContent = 'Lagrer\u2026';

      var ok = await saveSubTeamAssignments(assignDraft.assignments);
      if (ok) {
        assignDraft = null;
        dashTab = 'roster'; snView = 'dashboard'; render();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save" style="margin-right:5px;"></i>Lagre fordeling';
      }
    });

    // Auto-run draft if entering auto mode with no assignments
    if (method === 'auto' && active.length >= 2) {
      var hasAny = Object.keys(asgn).length > 0;
      if (!hasAny) {
        var initialDraft = runSnakeDraft();
        if (initialDraft && Object.keys(initialDraft).length > 0) {
          assignDraft.assignments = initialDraft;
          render();
          return;
        }
      }
    }
  }

  // =========================================================================
  //  DASHBOARD TAB: STATISTIKK
  // =========================================================================

  // =========================================================================
  //  NFF STATISTICS DISCLAIMER
  // =========================================================================
  function getNffDisclaimerKey() {
    try { var uid = getUserId(); return 'sn_nff_stats_accepted_' + (uid || 'default'); }
    catch(e) { return 'sn_nff_stats_accepted_default'; }
  }

  function hasAcceptedNffDisclaimer() {
    try { return localStorage.getItem(getNffDisclaimerKey()) === 'true'; }
    catch(e) { return false; }
  }

  function acceptNffDisclaimer() {
    try { localStorage.setItem(getNffDisclaimerKey(), 'true'); }
    catch(e) { /* silent */ }
  }

  function renderNffDisclaimer() {
    return '<div class="sn-nff-overlay" id="snNffOverlay">' +
      '<div class="sn-nff-modal">' +
        '<h3>\u26BD Statistikk \u2013 viktig informasjon</h3>' +
        '<p>Norges Fotballforbund (NFF) har klare retningslinjer for barnefotball (6\u201312 \u00e5r). Statistikken i denne appen er laget som et <b>internt trenerverkt\u00f8y</b> for \u00e5 sikre rettferdig spilletid og god oppf\u00f8lging.</p>' +
        '<p>Ved \u00e5 bruke statistikkfunksjonen bekrefter du at:</p>' +
        '<ul>' +
          '<li>Statistikken brukes kun til intern planlegging</li>' +
          '<li>Data skal <b>ikke</b> deles offentlig eller med spillere/foresatte som rangering</li>' +
          '<li>Statistikken skal <b>ikke</b> brukes til \u00e5 rangere enkeltspillere opp mot hverandre</li>' +
          '<li>Form\u00e5let er \u00e5 sikre lik spilletid og god spillerutvikling for alle</li>' +
        '</ul>' +
        '<div class="sn-nff-source">Kilde: NFF Handlingsplan barnefotball \u2013 Retningslinjer for aktivitet 6\u201312 \u00e5r</div>' +
        '<button class="sn-nff-accept" id="snNffAccept">\u2713 Jeg har lest og forst\u00e5tt</button>' +
      '</div>' +
    '</div>';
  }

  function renderStatsTab() {
    var stCount = (currentSeason && currentSeason.sub_team_count) || 1;
    var hasSubTeams = stCount > 1 && (currentSeason.sub_team_mode === 'fixed');

    // Filter tabs
    var tabsHtml = '';
    if (hasSubTeams) {
      var stNames = getSubTeamNames(currentSeason);
      tabsHtml = '<div class="sn-filter-tabs" id="snStatsFilterTabs" style="margin-bottom:12px;">';
      tabsHtml += '<button class="sn-filter-tab' + (subTeamFilter === null ? ' active' : '') + '" data-stf="all" style="flex:1.2;">Alle</button>';
      for (var ft = 0; ft < stCount; ft++) {
        var ftIdx = ft + 1;
        tabsHtml += '<button class="sn-filter-tab' + (subTeamFilter === ftIdx ? ' active' : '') + '" data-stf="' + ftIdx + '" style="color:' + getSubTeamColor(ftIdx) + ';">' + escapeHtml(stNames[ft] || String.fromCharCode(65 + ft)) + '</button>';
      }
      tabsHtml += '</div>';
    }

    var stats = computeStats(subTeamFilter);
    var p = stats.players;
    var barnefotball = isBarnefotball();

    var html =
      tabsHtml +
      '<div class="settings-card" style="padding-top:16px;">';

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

    // Combined goals & assists table
    var scorersAndAssisters = stats.players.filter(function(p) { return p.goals > 0 || p.assists > 0; });
    scorersAndAssisters.sort(function(a, b) {
      var totalA = a.goals + a.assists;
      var totalB = b.goals + b.assists;
      if (totalB !== totalA) return totalB - totalA;
      if (b.goals !== a.goals) return b.goals - a.goals;
      return a.player.name.localeCompare(b.player.name);
    });

    if (scorersAndAssisters.length > 0) {
      html += '<div class="sn-section">M\u00e5l og m\u00e5lgivende</div>';

      if (barnefotball) {
        html +=
          '<div class="sn-nff-warning" style="margin:0 0 8px;">' +
            '<i class="fas fa-shield-alt"></i>' +
            'NFF: Kun til intern bruk. Skal ikke deles eller brukes til rangering (6\u201312 \u00e5r).' +
          '</div>';
      }

      html += '<div class="settings-card" style="padding:0;">';
      for (var sc_i = 0; sc_i < scorersAndAssisters.length; sc_i++) {
        var sc = scorersAndAssisters[sc_i];
        html +=
          '<div class="sn-roster-item sn-player-stat-row" data-spid="' + escapeHtml(sc.player.id) + '">' +
            '<div style="flex:1;">' +
              '<div style="font-weight:600;">' + escapeHtml(sc.player.name) + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:10px; align-items:center;">' +
              (sc.goals > 0
                ? '<div style="text-align:center;">' +
                    '<div style="font-weight:700; font-size:16px;">' + sc.goals + '</div>' +
                    '<div style="font-size:10px; color:var(--text-400);">m\u00e5l</div>' +
                  '</div>'
                : '') +
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

    // Player attendance table
    html += '<div class="sn-section">Oppm\u00f8te</div>';
    html += '<div class="settings-card" style="padding:0; overflow-x:auto;">';
    html += '<table class="sn-stat-table">';
    html += '<thead><tr>' +
      '<th>Spiller</th>' +
      '<th>Tr</th>' +
      '<th>Ka</th>' +
      '<th>Min</th>' +
      '<th>Oppm.</th>' +
    '</tr></thead>';
    html += '<tbody>';

    for (var i = 0; i < p.length; i++) {
      var pl = p[i];
      var totalPossible = pl.relevantTrainings + pl.relevantMatches;
      var pct = totalPossible > 0 ? Math.round((pl.totalEvents / totalPossible) * 100) : 0;

      var barColor;
      if (pct >= 80) barColor = 'var(--success, #22c55e)';
      else if (pct >= 50) barColor = '#eab308';
      else barColor = 'var(--error, #ef4444)';

      var statStBadge = '';
      if (hasSubTeams && pl.player.sub_team) {
        statStBadge = ' <span class="sn-st-badge sn-st-' + pl.player.sub_team + '" style="font-size:9px;padding:1px 5px;">' + escapeHtml(getSubTeamName(currentSeason, pl.player.sub_team)) + '</span>';
      }

      html += '<tr class="sn-player-stat-row" data-spid="' + escapeHtml(pl.player.id) + '">' +
        '<td class="sn-pname">' + escapeHtml(pl.player.name) + statStBadge + '</td>' +
        '<td>' + pl.trainingsAttended + '</td>' +
        '<td>' + pl.matchesAttended + '</td>' +
        '<td>' + (pl.minutesPlayed || 0) + '</td>' +
        '<td>' +
          '<div style="font-weight:600;">' + pct + '%</div>' +
          '<div class="sn-bar-wrap"><div class="sn-bar-fill" style="width:' + pct + '%; background:' + barColor + ';"></div></div>' +
        '</td>' +
      '</tr>';
    }

    html += '</tbody></table></div>';

    // PDF export button
    if (stats.players.length > 0 && (stats.totalTrainings + stats.totalMatches + stats.completedMatches) > 0) {
      html +=
        '<button class="btn-secondary" id="snDownloadReport" style="width:100%;margin-top:16px;">' +
          '<i class="fas fa-file-pdf" style="margin-right:6px;color:#e74c3c;"></i>Last ned sesongrapport (PDF)' +
        '</button>';
    }

    return html;
  }

  function bindStatsHandlers(root) {
    // Sub-team filter tabs
    var statsFilterTabs = $('snStatsFilterTabs');
    if (statsFilterTabs) statsFilterTabs.addEventListener('click', function(e) {
      var tab = e.target.closest('.sn-filter-tab');
      if (!tab) return;
      var val = tab.getAttribute('data-stf');
      subTeamFilter = (val === 'all') ? null : parseInt(val);
      render();
    });

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

    // PDF export
    var pdfBtn = $('snDownloadReport');
    if (pdfBtn) pdfBtn.addEventListener('click', function() { generateSeasonReportPDF(); });
  }

  // =========================================================================
  //  SEASON REPORT PDF
  // =========================================================================

  function loadJsPdf(cb) {
    if (window.jspdf && window.jspdf.jsPDF) { cb(); return; }
    var s1 = document.createElement('script');
    s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
    s1.onload = function() {
      var s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js';
      s2.onload = cb;
      s2.onerror = function() { notify('Kunne ikke laste PDF-bibliotek.', 'error'); };
      document.head.appendChild(s2);
    };
    s1.onerror = function() { notify('Kunne ikke laste PDF-bibliotek. Sjekk internett.', 'error'); };
    document.head.appendChild(s1);
  }

  function generateSeasonReportPDF() {
    var btn = $('snDownloadReport');
    if (btn) { btn.disabled = true; btn.textContent = 'Genererer PDF\u2026'; }

    loadJsPdf(function() {
      try {
        buildSeasonPDF();
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-pdf" style="margin-right:6px;color:#e74c3c;"></i>Last ned sesongrapport (PDF)'; }
      } catch (err) {
        console.error('[season.js] PDF error:', err);
        notify('Feil ved PDF-generering: ' + (err.message || err), 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-pdf" style="margin-right:6px;color:#e74c3c;"></i>Last ned sesongrapport (PDF)'; }
      }
    });
  }

  function buildSeasonPDF() {
    var jsPDF = window.jspdf.jsPDF;
    var s = currentSeason;
    if (!s) return;

    var stats = computeStats(subTeamFilter);
    var p = stats.players;
    var barnefotball = isBarnefotball();
    var teamName = '';
    try { var tn = document.querySelector('.team-switcher-name'); if (tn) teamName = tn.textContent.trim(); } catch (_) {}

    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var pw = 210, ph = 297;
    var ml = 15, mr = 15, mt = 15;
    var cw = pw - ml - mr;
    var y = mt;

    // Colors
    var primary = [34, 139, 34]; // Forest green
    var dark = [30, 30, 30];
    var mid = [100, 100, 100];
    var light = [200, 200, 200];

    // ---- HEADER ----
    doc.setFillColor(primary[0], primary[1], primary[2]);
    doc.rect(0, 0, pw, 38, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(escapeForPdf(s.name), ml, 16);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    var subParts = [];
    if (teamName) subParts.push(teamName);
    if (s.age_class) subParts.push(s.age_class);
    subParts.push(formatLabel(s.format));
    if (s.start_date || s.end_date) subParts.push(formatDateRange(s.start_date, s.end_date));
    doc.text(subParts.join('  \u00B7  '), ml, 24);

    var stCount = (s.sub_team_count || 1);
    if (stCount > 1) {
      var modeLabel = s.sub_team_mode === 'rotate' ? 'Rullering' : 'Faste lag';
      doc.text(stCount + ' lag (' + modeLabel + ')' + (subTeamFilter ? ' \u2014 filtrert p\u00e5 lag ' + subTeamFilter : ''), ml, 31);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text('Generert ' + new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }), pw - mr, 10, { align: 'right' });
    doc.text('Barnefotballtrener.no', pw - mr, 15, { align: 'right' });

    y = 46;

    // ---- SUMMARY BOXES ----
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Oversikt', ml, y);
    y += 7;

    var boxW = (cw - 6) / 3;
    var boxes = [
      { val: stats.totalTrainings + '/' + stats.allTrainings, label: 'Treninger reg.' },
      { val: stats.completedMatches + '/' + stats.allMatches, label: 'Kamper spilt' },
      { val: p.length + '', label: 'Spillere' }
    ];

    for (var bi = 0; bi < boxes.length; bi++) {
      var bx = ml + bi * (boxW + 3);
      doc.setFillColor(245, 247, 250);
      doc.roundedRect(bx, y, boxW, 18, 2, 2, 'F');
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(dark[0], dark[1], dark[2]);
      doc.text(boxes[bi].val, bx + boxW / 2, y + 9, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(mid[0], mid[1], mid[2]);
      doc.text(boxes[bi].label, bx + boxW / 2, y + 15, { align: 'center' });
    }
    y += 24;

    // Match record row
    if (stats.completedMatches > 0) {
      var recBoxes = [
        { val: stats.wins + 'S  ' + stats.draws + 'U  ' + stats.losses + 'T', label: 'Kamprekord' },
        { val: stats.goalsFor + ' \u2013 ' + stats.goalsAgainst, label: 'M\u00e5l for / mot' }
      ];
      var rbW = (cw - 3) / 2;
      for (var ri = 0; ri < recBoxes.length; ri++) {
        var rx = ml + ri * (rbW + 3);
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(rx, y, rbW, 18, 2, 2, 'F');
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(dark[0], dark[1], dark[2]);
        doc.text(recBoxes[ri].val, rx + rbW / 2, y + 9, { align: 'center' });
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(mid[0], mid[1], mid[2]);
        doc.text(recBoxes[ri].label, rx + rbW / 2, y + 15, { align: 'center' });
      }
      y += 24;
    }

    // ---- FAIRNESS ----
    if (stats.completedMatches > 0) {
      var minArr = p.filter(function(x) { return x.minutesPlayed > 0; }).map(function(x) { return x.minutesPlayed; });
      if (minArr.length >= 2) {
        var avg = minArr.reduce(function(a, b) { return a + b; }, 0) / minArr.length;
        var maxDev = 0;
        for (var fd = 0; fd < minArr.length; fd++) {
          var dev = Math.abs(minArr[fd] - avg) / avg;
          if (dev > maxDev) maxDev = dev;
        }
        var fairLabel, fairColor;
        if (maxDev <= 0.15) { fairLabel = 'Jevnt fordelt spilletid'; fairColor = [34, 197, 94]; }
        else if (maxDev <= 0.30) { fairLabel = 'Noe ujevn fordeling'; fairColor = [234, 179, 8]; }
        else { fairLabel = 'Skjev fordeling'; fairColor = [239, 68, 68]; }

        doc.setFillColor(fairColor[0], fairColor[1], fairColor[2]);
        doc.roundedRect(ml, y, cw, 10, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(fairLabel + '  (maks avvik: ' + Math.round(maxDev * 100) + '%)', ml + cw / 2, y + 6.5, { align: 'center' });
        y += 15;
      }
    }

    // ---- ATTENDANCE & PLAYING TIME TABLE ----
    doc.setTextColor(dark[0], dark[1], dark[2]);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Spilleroversikt', ml, y);
    y += 3;

    var hasMinutes = p.some(function(x) { return x.minutesPlayed > 0; });
    var hasGoals = p.some(function(x) { return x.goals > 0 || x.assists > 0; });

    var tHead = ['Spiller', 'Treninger', 'Kamper', 'Oppm\u00f8te'];
    if (hasMinutes) tHead.push('Spilletid');
    if (hasGoals) tHead.push('M\u00e5l', 'Ass.');

    var tBody = [];
    for (var ti = 0; ti < p.length; ti++) {
      var pl = p[ti];
      var totalPoss = pl.relevantTrainings + pl.relevantMatches;
      var attPct = totalPoss > 0 ? Math.round((pl.totalEvents / totalPoss) * 100) + '%' : '-';
      var avgMin = pl.matchesAttended > 0 ? Math.round(pl.minutesPlayed / pl.matchesAttended) : 0;

      var row = [
        pl.player.player_name || pl.player.name || '?',
        pl.trainingsAttended + '/' + pl.relevantTrainings,
        pl.matchesAttended + '/' + pl.relevantMatches,
        attPct
      ];
      if (hasMinutes) row.push(pl.minutesPlayed + ' min (\u00f8' + avgMin + ')');
      if (hasGoals) { row.push(pl.goals || ''); row.push(pl.assists || ''); }
      tBody.push(row);
    }

    doc.autoTable({
      startY: y,
      margin: { left: ml, right: mr },
      head: [tHead],
      body: tBody,
      theme: 'grid',
      headStyles: {
        fillColor: [primary[0], primary[1], primary[2]],
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 8,
        textColor: dark,
        cellPadding: 2
      },
      columnStyles: {
        0: { halign: 'left', fontStyle: 'bold', cellWidth: 38 },
        1: { halign: 'center' },
        2: { halign: 'center' },
        3: { halign: 'center' }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didDrawPage: function(data) {
        // Footer on every page
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text('Barnefotballtrener.no \u2014 Sesongrapport', ml, ph - 8);
        doc.text('Side ' + doc.internal.getNumberOfPages(), pw - mr, ph - 8, { align: 'right' });
      }
    });

    y = doc.lastAutoTable.finalY + 8;

    // ---- NFF DISCLAIMER ----
    if (barnefotball) {
      // Check if we need a new page
      if (y > ph - 40) { doc.addPage(); y = mt; }
      doc.setFillColor(255, 248, 225);
      doc.roundedRect(ml, y, cw, 16, 2, 2, 'F');
      doc.setDrawColor(234, 179, 8);
      doc.roundedRect(ml, y, cw, 16, 2, 2, 'S');
      doc.setFontSize(7);
      doc.setTextColor(120, 80, 0);
      doc.setFont('helvetica', 'bold');
      doc.text('NFF Barnefotball', ml + 3, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.text('Statistikk og m\u00e5lscorere er kun til intern bruk for treneren.', ml + 3, y + 9);
      doc.text('Skal ikke deles offentlig eller brukes til rangering av enkeltspillere (alder 6\u201312).', ml + 3, y + 13);
    }

    // Save
    var filename = (s.name || 'sesong').replace(/[^a-zA-Z0-9\u00e6\u00f8\u00e5\u00c6\u00d8\u00c5 _-]/g, '').replace(/\s+/g, '-');
    doc.save('Sesongrapport-' + filename + '.pdf');
    notify('Sesongrapport lastet ned!', 'success');
  }

  // Escape special chars for PDF text (strip HTML entities)
  function escapeForPdf(str) {
    return String(str == null ? '' : str)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");
  }

  // =========================================================================
  //  VIEW: PLAYER STATS (individ)
  // =========================================================================

  function renderPlayerStats(root) {
    var sp = editingSeasonPlayer;
    if (!sp) { snView = 'dashboard'; dashTab = 'stats'; render(); return; }

    var stats = computeStats();
    var ps = stats.players.find(function(x) { return x.player.id === sp.id; });
    if (!ps) ps = { matchesAttended: 0, trainingsAttended: 0, minutesPlayed: 0, totalEvents: 0, goals: 0, assists: 0, relevantMatches: 0, relevantTrainings: 0 };

    var totalPossible = ps.relevantTrainings + ps.relevantMatches;
    var pct = totalPossible > 0 ? Math.round((ps.totalEvents / totalPossible) * 100) : 0;

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromPlayerStats"><i class="fas fa-chevron-left"></i> ' + (dashTab === 'roster' ? 'Stall' : 'Statistikk') + '</button>' +
          '<span class="sn-dash-title">' + escapeHtml(sp.name) + '</span>' +
        '</div>';

    // Badges
    var posLabels = (sp.positions || []).join('/');
    var psStCount = (currentSeason && currentSeason.sub_team_count) || 1;
    var psHasSubTeams = psStCount > 1;
    html += '<div style="margin:8px 0 16px; display:flex; gap:6px; flex-wrap:wrap;">';
    if (psHasSubTeams && sp.sub_team) {
      html += '<span class="sn-st-badge sn-st-' + sp.sub_team + '">' + escapeHtml(getSubTeamName(currentSeason, sp.sub_team)) + '</span>';
    }
    if (sp.goalie) html += '<span class="sn-badge sn-badge-keeper">Kan st\u00e5 i m\u00e5l</span>';
    html += '<span class="sn-badge sn-badge-pos">' + escapeHtml(posLabels) + '</span>';
    html += '<span class="sn-badge sn-badge-skill">' + sp.skill + '</span>';
    html += '</div>';

    // Stats cards - row 1: attendance
    html += '<div class="sn-stats-cards">';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + ps.trainingsAttended + '<span style="font-size:14px; color:var(--text-400);">/' + ps.relevantTrainings + '</span></div>' +
        '<div class="sn-stat-label">Treninger</div>' +
      '</div>';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + ps.matchesAttended + '<span style="font-size:14px; color:var(--text-400);">/' + ps.relevantMatches + '</span></div>' +
        '<div class="sn-stat-label">Kamper</div>' +
      '</div>';
    html += '</div>';

    // Stats cards - row 2: attendance + minutes
    html += '<div class="sn-stats-cards" style="margin-top:8px;">';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + pct + '%</div>' +
        '<div class="sn-stat-label">Oppm\u00f8te</div>' +
      '</div>';
    html +=
      '<div class="sn-stat-card">' +
        '<div class="sn-stat-num">' + (ps.minutesPlayed || 0) + '</div>' +
        '<div class="sn-stat-label">Spilletid (min)</div>' +
      '</div>';
    html += '</div>';

    // Stats cards - row 3: goals + assists (only if any exist)
    if (ps.goals > 0 || ps.assists > 0) {
      html += '<div class="sn-stats-cards" style="margin-top:8px;">';
      html +=
        '<div class="sn-stat-card">' +
          '<div class="sn-stat-num">' + ps.goals + (ps.assists > 0 ? '<span style="font-size:14px; color:var(--text-400);"> + ' + ps.assists + 'a</span>' : '') + '</div>' +
          '<div class="sn-stat-label">M\u00e5l' + (ps.assists > 0 ? ' + assist' : '') + '</div>' +
        '</div>';
      html += '</div>';
    }

    // Sub-team breakdown (only when sub-teams exist and player has match data)
    if (psHasSubTeams && ps.minutesPlayed > 0) {
      var stNames = getSubTeamNames(currentSeason);
      // Compute minutes per sub-team from seasonStats
      var bdEventMap = {};
      for (var em = 0; em < events.length; em++) { bdEventMap[events[em].id] = events[em]; }

      var breakdownMinutes = {}; // { subTeam: minutes }
      var breakdownMatches = {}; // { subTeam: count }
      for (var bi = 0; bi < seasonStats.length; bi++) {
        var bRow = seasonStats[bi];
        if (bRow.player_id !== sp.player_id || !bRow.minutes_played || bRow.minutes_played <= 0) continue;
        var bEv = bdEventMap[bRow.event_id];
        if (!bEv || (bEv.type !== 'match' && bEv.type !== 'cup_match')) continue;
        // Fixed mode: team from event. Rotation mode: team from event_players row.
        var bSt = bEv.sub_team || bRow.sub_team || 0;
        breakdownMinutes[bSt] = (breakdownMinutes[bSt] || 0) + bRow.minutes_played;
        breakdownMatches[bSt] = (breakdownMatches[bSt] || 0) + 1;
      }

      var bdKeys = Object.keys(breakdownMinutes);
      if (bdKeys.length > 0) {
        var totalMin = ps.minutesPlayed;
        html += '<div class="sn-breakdown">';
        html += '<div class="sn-breakdown-title">Spilletid per lag</div>';
        html += '<div class="sn-breakdown-bar">';
        for (var bk = 0; bk < bdKeys.length; bk++) {
          var bKey = parseInt(bdKeys[bk]);
          var bMin = breakdownMinutes[bKey];
          var bPct = Math.round((bMin / totalMin) * 100);
          var bColor = bKey > 0 ? getSubTeamColor(bKey) : 'var(--border)';
          html += '<div class="sn-breakdown-seg" style="width:' + bPct + '%;background:' + bColor + ';">' + (bPct >= 15 ? bMin + 'm' : '') + '</div>';
        }
        html += '</div>';
        html += '<div class="sn-breakdown-legend">';
        for (var bl = 0; bl < bdKeys.length; bl++) {
          var blKey = parseInt(bdKeys[bl]);
          var blMin = breakdownMinutes[blKey];
          var blCount = breakdownMatches[blKey] || 0;
          var blName = blKey > 0 ? (stNames[blKey - 1] || 'Lag ' + blKey) : 'Uten lag';
          var blColor = blKey > 0 ? getSubTeamColor(blKey) : '#94a3b8';
          var isLoan = sp.sub_team && blKey > 0 && blKey !== sp.sub_team;
          html += '<div class="sn-breakdown-item">' +
            '<div class="sn-breakdown-dot" style="background:' + blColor + ';"></div>' +
            escapeHtml(blName) + ': ' + blMin + ' min (' + blCount + ' kamp' + (blCount !== 1 ? 'er' : '') + ')' +
            (isLoan ? '<span class="sn-loan-badge">l\u00e5n</span>' : '') +
          '</div>';
        }
        html += '</div>';
        html += '</div>';
      }
    }

    // Event-by-event history
    html += '<div class="sn-section">Hendelseslogg</div>';

    // Build history from seasonStats for this player
    var playerEvents = seasonStats.filter(function(row) { return row.player_id === sp.player_id; });
    var eventMapH = {};
    for (var e = 0; e < events.length; e++) { eventMapH[events[e].id] = events[e]; }

    // Build goal/assist lookup for this player per event
    var playerGoalMap = {}; // { event_id: { goals: N, assists: N } }
    for (var sg = 0; sg < seasonGoals.length; sg++) {
      var sGoal = seasonGoals[sg];
      if (sGoal.player_id === sp.player_id) {
        if (!playerGoalMap[sGoal.event_id]) playerGoalMap[sGoal.event_id] = { goals: 0, assists: 0 };
        if (sGoal.type === 'assist') {
          playerGoalMap[sGoal.event_id].assists++;
        } else {
          playerGoalMap[sGoal.event_id].goals++;
        }
      }
    }

    // Sort by event date
    playerEvents.sort(function(a, b) {
      var evA = eventMapH[a.event_id];
      var evB = eventMapH[b.event_id];
      if (!evA || !evB) return 0;
      return new Date(evB.start_time) - new Date(evA.start_time);
    });

    if (playerEvents.length === 0) {
      html += '<div style="text-align:center; padding:20px; color:var(--text-400); font-size:13px;">Ingen registrert oppm\u00f8te enn\u00e5.</div>';
    } else {
      html += '<div class="settings-card" style="padding:0;">';
      for (var h = 0; h < playerEvents.length; h++) {
        var row = playerEvents[h];
        var ev = eventMapH[row.event_id];
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

        // Match score (our perspective)
        var scoreText = '';
        if ((ev.type === 'match' || ev.type === 'cup_match') && ev.status === 'completed' && ev.result_home !== null && ev.result_home !== undefined) {
          var ourScore = ev.is_home ? ev.result_home : ev.result_away;
          var theirScore = ev.is_home ? ev.result_away : ev.result_home;
          scoreText = '<div style="font-size:13px; font-weight:700; color:var(--text-500);">' + ourScore + '\u2013' + theirScore + '</div>';
        }

        // Per-event minutes badge
        var minutesBadge = '';
        if (attended && row.minutes_played && row.minutes_played > 0) {
          minutesBadge = '<div style="font-size:11px; color:var(--text-400); white-space:nowrap;">' + row.minutes_played + 'min</div>';
        }

        // Sub-team badge + loan indicator
        var evTeamHtml = '';
        var effectiveSubTeam = ev.sub_team || row.sub_team; // fixed: event-level, rotation: player-level
        if (psHasSubTeams && effectiveSubTeam) {
          var evStColor = getSubTeamColor(effectiveSubTeam);
          var evStName = getSubTeamName(currentSeason, effectiveSubTeam);
          var evIsLoan = sp.sub_team && effectiveSubTeam !== sp.sub_team;
          evTeamHtml = '<span class="sn-ev-team-badge" style="color:' + evStColor + ';background:' + evStColor + '15;">' + escapeHtml(evStName) + '</span>' +
            (evIsLoan ? '<span class="sn-loan-badge">l\u00e5n</span>' : '');
        }

        html +=
          '<div class="sn-roster-item" style="cursor:default;">' +
            '<div style="font-size:16px; width:24px; text-align:center;">' + (attended ? '\u2705' : '\u274c') + '</div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-weight:600; font-size:14px;">' + evTeamHtml + escapeHtml(evTitle) + '</div>' +
              '<div style="font-size:12px; color:var(--text-400);">' + formatDateLong(ev.start_time) + (attended ? '' : reasonText) + '</div>' +
            '</div>' +
            minutesBadge +
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
            '<button class="sn-back" id="snBackFromImport"><i class="fas fa-chevron-left"></i> Stall</button>' +
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
          '<button class="sn-back" id="snBackFromImport"><i class="fas fa-chevron-left"></i> Stall</button>' +
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
          '<button class="sn-back" id="snBackFromManual"><i class="fas fa-chevron-left"></i> Stall</button>' +
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
      if (name.length > 50) {
        notify('Spillernavn m\u00e5 v\u00e6re maks 50 tegn (kun fornavn anbefales).', 'warning');
        return;
      }

      // PRIVACY: Warn if name contains space (might be full name)
      if (name.indexOf(' ') !== -1) {
        var ok = confirm(
          'Navnet inneholder mellomrom og kan v\u00e6re et fullt navn.\n\n' +
          'For \u00e5 beskytte barns personvern b\u00f8r du KUN bruke fornavn.\n\n' +
          'Vil du fortsette med dette navnet likevel?'
        );
        if (!ok) {
          $('snManualName').focus();
          return;
        }
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
          '<button class="sn-back" id="snBackFromSeries"><i class="fas fa-chevron-left"></i> Kalender</button>' +
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
        autoTitle();
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
          '<button class="sn-back" id="snBackFromEdit"><i class="fas fa-chevron-left"></i> Tilbake</button>' +
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
      if (name.length > 50) {
        notify('Spillernavn m\u00e5 v\u00e6re maks 50 tegn (kun fornavn anbefales).', 'warning');
        return;
      }

      // PRIVACY: Warn if name contains space (might be full name)
      if (name.indexOf(' ') !== -1) {
        var ok = confirm(
          'Navnet inneholder mellomrom og kan v\u00e6re et fullt navn.\n\n' +
          'For \u00e5 beskytte barns personvern b\u00f8r du KUN bruke fornavn.\n\n' +
          'Vil du fortsette med dette navnet likevel?'
        );
        if (!ok) {
          $('snEditName').focus();
          return;
        }
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

      // Sync player_name in match_events AND event_players if name changed
      if (ok && name !== sp.name && currentSeason) {
        try {
          var syncSb = getSb();
          var syncUid = getUserId();
          // Get all event IDs for this season
          var evRes = await syncSb.from('events').select('id').eq('season_id', currentSeason.id).eq('user_id', syncUid);
          var evIds = (evRes.data || []).map(function(e) { return e.id; });
          if (evIds.length > 0) {
            // Sync match_events (goals/assists)
            await syncSb.from('match_events')
              .update({ player_name: name })
              .in('event_id', evIds)
              .eq('player_id', sp.player_id)
              .eq('user_id', syncUid);
            // Sync event_players (attendance/minutes)
            await syncSb.from('event_players')
              .update({ player_name: name })
              .in('event_id', evIds)
              .eq('player_id', sp.player_id)
              .eq('user_id', syncUid);
          }
        } catch (syncErr) {
          console.warn('[season.js] player_name sync:', syncErr.message || syncErr);
        }

        // Reverse sync: update core.js player (Spillere-fanen) if this is an imported player
        if (sp.player_id && sp.player_id.indexOf('p_') === 0) {
          var corePlayers = window.players || [];
          for (var ci = 0; ci < corePlayers.length; ci++) {
            if (corePlayers[ci].id === sp.player_id) {
              corePlayers[ci].name = name;
              corePlayers[ci].goalie = goalie;
              corePlayers[ci].skill = skill;
              // Persist to localStorage + Supabase
              if (window.__BF_saveState) window.__BF_saveState();
              // Defer publish to avoid mid-handler DOM replacement
              setTimeout(function() { if (window.__BF_publishPlayers) window.__BF_publishPlayers(); }, 0);
              break;
            }
          }
        }
      }

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
      if (!confirm('Fjerne ' + sp.name + ' fra sesongen?\n\nSpilleren kan importeres p\u00e5 nytt senere.')) return;

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
      if ((ev.type === 'match' || ev.type === 'cup_match') && ev.opponent && !ev.title) {
        title = (ev.is_home ? 'Hjemme' : 'Borte') + ' vs ' + ev.opponent;
      }
      var meta = formatDateLong(ev.start_time);
      var time = formatTime(ev.start_time);
      if (time) meta += ', kl. ' + time;
      if (ev.location) meta += ' \u00B7 ' + ev.location;

      // Sub-team badge for events
      var stEvBadge = '';
      if (ev.sub_team && currentSeason && (currentSeason.sub_team_count || 1) > 1) {
        stEvBadge = ' <span class="sn-st-badge sn-st-' + ev.sub_team + '" style="font-size:10px;padding:1px 6px;">' + escapeHtml(getSubTeamName(currentSeason, ev.sub_team)) + '</span>';
      }

      var regBadge = registeredEventIds[ev.id]
        ? '<div class="sn-att-badge" title="Oppm\u00f8te registrert">\u2713</div>'
        : '';

      // Score badge for completed matches
      var scoreBadge = '';
      if ((ev.type === 'match' || ev.type === 'cup_match') && ev.status === 'completed' && ev.result_home !== null && ev.result_home !== undefined) {
        var ourScore = ev.is_home ? ev.result_home : ev.result_away;
        var theirScore = ev.is_home ? ev.result_away : ev.result_home;
        scoreBadge = '<div style="font-size:13px; font-weight:700; color:var(--text-600); white-space:nowrap;">' + ourScore + '\u2013' + theirScore + '</div>';
        regBadge = ''; // Don't show both
      }

      html +=
        '<div class="sn-event-item" data-eid="' + ev.id + '">' +
          '<div class="sn-event-icon">' + typeIcon(ev.type) + '</div>' +
          '<div class="sn-event-info">' +
            '<div class="sn-event-title">' + escapeHtml(title) + '</div>' +
            '<div class="sn-event-meta">' + escapeHtml(meta) + stEvBadge + '</div>' +
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
            eventDistDraft = null; // Reset rotation draft — each event has its own
            var viewBefore = snView;
            var loads = [loadEventAttendance(ev.id)];
            // Load season stats for match tropp hints + match goals
            if (ev.type === 'match' || ev.type === 'cup_match') {
              loads.push(loadMatchGoals(ev.id));
              if (seasonStats.length === 0) loads.push(loadSeasonStats(currentSeason.id));
            }
            await Promise.all(loads);
            // Guard: if user navigated away while loading, don't force-navigate
            if (snView !== viewBefore) return;
            snView = 'event-detail';
            render();
          }
        };
      })(items[i].getAttribute('data-eid')));
    }
  }

  // =========================================================================
  //  VIEW: FOTBALL.NO IMPORT
  // =========================================================================

  var importState = { matches: null, allTeams: null, selectedTeam: null, selectedSubTeam: null, parsed: null };

  function loadSheetJS(cb) {
    if (window.XLSX) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = cb;
    s.onerror = function() { notify('Kunne ikke laste importverkt\u00f8yet. Sjekk at du er p\u00e5 nett og pr\u00f8v igjen.', 'error'); };
    document.head.appendChild(s);
  }

  function parseFotballNoXlsx(data) {
    var wb = window.XLSX.read(data, { type: 'array', cellDates: true });
    var sheet = wb.Sheets[wb.SheetNames[0]];
    var rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return null;

    // Detect columns (fotball.no format)
    var first = rows[0];
    if (!('Hjemmelag' in first) || !('Bortelag' in first)) return null;

    var teams = {};
    var matches = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var home = String(r['Hjemmelag'] || '').trim();
      var away = String(r['Bortelag'] || '').trim();
      if (!home || !away) continue;

      teams[home] = true;
      teams[away] = true;

      // Parse format from Spillform: "9 MOT 9" → 9
      var sfmt = String(r['Spillform'] || '');
      var fmtMatch = sfmt.match(/(\d+)\s*MOT\s*\d+/i);
      var format = fmtMatch ? parseInt(fmtMatch[1]) : null;

      // Parse date — combine date-part from Dato with time from Tid to avoid TZ issues
      var dato = r['Dato'];
      var tid = String(r['Tid'] || '').trim();
      var startTime = null;

      // Extract date-only string (YYYY-MM-DD)
      var dateStr = null;
      if (dato instanceof Date && !isNaN(dato.getTime())) {
        // SheetJS dates are in UTC — use UTC getters to get the "local" values
        var yy = dato.getUTCFullYear();
        var mm = String(dato.getUTCMonth() + 1).padStart(2, '0');
        var dd = String(dato.getUTCDate()).padStart(2, '0');
        dateStr = yy + '-' + mm + '-' + dd;
      } else if (dato) {
        var dParse = String(dato).match(/(\d{4})-?(\d{2})-?(\d{2})/);
        if (dParse) dateStr = dParse[1] + '-' + dParse[2] + '-' + dParse[3];
      }

      // Combine date + time (Tid column is always local Norwegian time)
      if (dateStr) {
        var tMatch = tid.match(/^(\d{1,2}):(\d{2})/);
        var localStr = tMatch
          ? dateStr + 'T' + tMatch[1].padStart(2, '0') + ':' + tMatch[2] + ':00'
          : dateStr + 'T12:00:00';
        // new Date(localStr) interprets as local timezone → .toISOString() gives UTC
        var localDate = new Date(localStr);
        if (!isNaN(localDate.getTime())) {
          startTime = localDate.toISOString();
        }
      }

      // Parse age class from Turnering: "G13 1. div avd. 01 vår" → "G13"
      var turn = String(r['Turnering'] || '');
      var ageMatch = turn.match(/^([GJ]\d{1,2})\b/i);
      var ageClass = ageMatch ? ageMatch[1].toUpperCase() : null;

      matches.push({
        round: r['Runde'] || '',
        startTime: startTime,
        day: String(r['Dag'] || '').trim(),
        time: String(r['Tid'] || '').trim(),
        home: home,
        away: away,
        result: String(r['Resultat'] || '').trim(),
        location: String(r['Bane'] || '').trim(),
        tournament: turn,
        kampnummer: String(r['Kampnummer'] || ''),
        format: format,
        ageClass: ageClass
      });
    }

    return { matches: matches, teams: Object.keys(teams).sort() };
  }

  function renderFotballImport(root) {
    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromImport"><i class="fas fa-chevron-left"></i> Tilbake</button>' +
          '<span class="sn-dash-title">Importer fra fotball.no</span>' +
        '</div>';

    if (!importState.parsed) {
      // Step 1: File upload
      html +=
        '<div style="padding:16px 0;">' +
          '<div style="text-align:center; margin-bottom:16px;">' +
            '<i class="fas fa-file-excel" style="font-size:40px; color:#217346; margin-bottom:8px;"></i>' +
            '<div style="font-weight:600; margin-bottom:8px;">Importer seriekamper fra fotball.no</div>' +
          '</div>' +
          '<div style="font-size:13px; color:var(--text-500); margin-bottom:16px; line-height:1.6;">' +
            '<div style="font-weight:600; margin-bottom:4px;">Slik henter du filen:</div>' +
            '<div style="padding-left:4px;">' +
              '1. \u00c5pne <b>fotball.no</b> og finn lagets side<br>' +
              '2. Klikk p\u00e5 <b>Kamper</b>-fanen<br>' +
              '3. Trykk <b>\u00abLast ned til Excel\u00bb</b>' +
            '</div>' +
          '</div>' +
          '<label class="btn-primary" style="display:block; text-align:center; cursor:pointer;">' +
            '<i class="fas fa-upload" style="margin-right:6px;"></i>Velg kampfil (.xlsx)' +
            '<input type="file" id="snImportFile" accept=".xlsx,.xls" style="display:none;">' +
          '</label>' +
          '<div id="snImportStatus" style="text-align:center; margin-top:12px; font-size:13px; color:var(--text-400);"></div>' +
          '<div style="font-size:11px; color:var(--text-300); margin-top:12px; text-align:center;">Dato, tidspunkt, bane og motstander hentes automatisk fra filen.</div>' +
        '</div>';
    } else if (!importState.selectedTeam) {
      // Step 2: Team selection
      var tm = importState.parsed.teams;
      var ageInfo = importState.parsed.matches[0] ? importState.parsed.matches[0].ageClass : null;
      var fmtInfo = importState.parsed.matches[0] ? importState.parsed.matches[0].format : null;

      html +=
        '<div style="padding:12px 0;">' +
          '<div style="margin-bottom:12px;">' +
            '<div style="font-weight:600;"><i class="fas fa-check-circle" style="color:var(--success, #22c55e); margin-right:6px;"></i>Fant ' + importState.parsed.matches.length + ' kamper i filen</div>' +
            '<div style="font-size:13px; color:var(--text-400); margin-top:2px;">' +
              (importState.parsed.matches[0] ? escapeHtml(importState.parsed.matches[0].tournament) : '') +
              (fmtInfo ? ' \u00B7 ' + fmtInfo + 'er-fotball' : '') +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label style="font-weight:600;">Velg ditt lag</label>' +
            '<div style="font-size:12px; color:var(--text-400); margin-bottom:8px;">Filen inneholder kamper for ' + tm.length + ' lag. Trykk p\u00e5 ditt for \u00e5 se kampene som importeres.</div>' +
            '<div class="sn-import-teams" id="snTeamPicker">';

      // Detect prefix matches for highlighting
      var appTeamName = '';
      try { var atn = document.querySelector('.team-switcher-name'); if (atn) appTeamName = atn.textContent.trim().toLowerCase(); } catch (_) {}

      for (var t = 0; t < tm.length; t++) {
        var isPrefix = appTeamName && tm[t].toLowerCase().indexOf(appTeamName) === 0;
        html += '<button class="btn-secondary sn-import-team-btn" data-team="' + escapeHtml(tm[t]) + '" style="margin:3px; font-size:13px;' + (isPrefix ? ' border-color:var(--primary); font-weight:600;' : '') + '">' + escapeHtml(tm[t]) + '</button>';
      }
      html +=
            '</div>' +
          '</div>' +
        '</div>';
    } else {
      // Step 3: Preview & import
      var myTeam = importState.selectedTeam;
      var myMatches = importState.parsed.matches.filter(function(m) { return m.home === myTeam || m.away === myTeam; });
      var hasSubTeams = currentSeason && (currentSeason.sub_team_count || 1) > 1;

      // Build lookup: kampnummer → existing event
      var existingByUid = {};
      for (var e = 0; e < events.length; e++) {
        if (events[e].external_uid) existingByUid[events[e].external_uid] = events[e];
      }

      // Classify matches: new, changed, unchanged
      var newMatches = [];
      var changedMatches = [];
      var unchangedCount = 0;

      for (var mc = 0; mc < myMatches.length; mc++) {
        var m = myMatches[mc];
        var existing = existingByUid[m.kampnummer];
        if (!existing) {
          newMatches.push(m);
        } else {
          // Compare start_time, location and opponent
          var fileDate = m.startTime ? m.startTime.substring(0, 16) : '';
          var dbDate = existing.start_time ? existing.start_time.substring(0, 16) : '';
          var fileLoc = (m.location || '').toLowerCase();
          var dbLoc = (existing.location || '').toLowerCase();
          var fileIsH = m.home === myTeam;
          var fileOpp = fileIsH ? m.away : m.home;
          var oppChanged = fileOpp !== existing.opponent;
          if (fileDate !== dbDate || fileLoc !== dbLoc || oppChanged) {
            changedMatches.push({ file: m, existing: existing });
          } else {
            unchangedCount++;
          }
        }
      }

      var totalActions = newMatches.length + changedMatches.length;

      html +=
        '<div style="padding:12px 0;">' +
          '<div style="margin-bottom:12px;">' +
            '<div style="font-weight:600;">' + escapeHtml(myTeam) + '</div>' +
            '<div style="font-size:13px; color:var(--text-400); margin-top:2px;">' +
              myMatches.length + ' kamper i filen' +
              (unchangedCount > 0 ? ' \u00B7 ' + unchangedCount + ' uendret' : '') +
              (newMatches.length > 0 ? ' \u00B7 <b>' + newMatches.length + ' nye</b>' : '') +
              (changedMatches.length > 0 ? ' \u00B7 <span style="color:var(--warning, #f59e0b);">' + changedMatches.length + ' endret</span>' : '') +
            '</div>' +
          '</div>';

      // Sub-team selector for flerlag seasons
      if (hasSubTeams) {
        var stNames = getSubTeamNames(currentSeason);
        var stCount = currentSeason.sub_team_count;
        html +=
          '<div class="form-group" style="margin-bottom:12px; padding:10px 12px; background:var(--bg-hover, #f8fafc); border-radius:var(--radius-md);">' +
            '<label style="font-weight:600; font-size:13px;">Hvilket lag gjelder disse kampene?</label>' +
            '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">';
        for (var si = 1; si <= stCount; si++) {
          var stLabel = stNames[si - 1] || ('Lag ' + si);
          var stActive = importState.selectedSubTeam === si;
          html += '<button class="btn-secondary sn-import-subteam-btn' + (stActive ? ' active' : '') + '" data-st="' + si + '" style="flex:1; font-size:13px; min-width:60px;' + (stActive ? ' background:var(--primary); color:white; border-color:var(--primary);' : '') + '">' + escapeHtml(stLabel) + '</button>';
        }
        html +=
            '</div>' +
            '<div style="font-size:11px; color:var(--text-400); margin-top:6px; line-height:1.5;">' +
              'Kampene legges i kalenderen under valgt lag. Har klubben flere lag i serien? Importer \u00e9n Excel-fil per lag.' +
            '</div>' +
          '</div>';
      }

      if (totalActions === 0) {
        html +=
          '<div style="text-align:center; padding:20px; color:var(--text-400);">' +
            '<i class="fas fa-check-circle" style="font-size:32px; color:var(--success, #22c55e); margin-bottom:8px;"></i>' +
            '<div style="font-weight:600; color:var(--text-600);">Alt er oppdatert!</div>' +
            '<div style="font-size:13px; margin-top:4px;">Alle ' + myMatches.length + ' kamper fra filen stemmer med kalenderen.</div>' +
          '</div>';
      } else {
        // Changed matches section
        if (changedMatches.length > 0) {
          html +=
            '<div style="margin-bottom:12px;">' +
              '<div style="font-weight:600; font-size:13px; color:var(--warning, #f59e0b); margin-bottom:6px;">' +
                '<i class="fas fa-sync-alt" style="margin-right:5px;"></i>' + changedMatches.length + ' kamp' + (changedMatches.length === 1 ? '' : 'er') + ' med endringer' +
              '</div>' +
              '<div class="sn-import-list">';
          for (var ci = 0; ci < changedMatches.length; ci++) {
            var ch = changedMatches[ci];
            var chHome = ch.file.home === myTeam;
            var chOpp = chHome ? ch.file.away : ch.file.home;
            var chNewDate = ch.file.startTime ? formatDate(ch.file.startTime) : '';
            var chNewTime = ch.file.time || '';
            var chOldDate = ch.existing.start_time ? formatDate(ch.existing.start_time) : '';
            var chOldTime = ch.existing.start_time ? new Date(ch.existing.start_time).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '';
            var chOldLoc = ch.existing.location || '';
            var chNewLoc = ch.file.location || '';
            var dateChanged = (ch.file.startTime || '').substring(0, 16) !== (ch.existing.start_time || '').substring(0, 16);
            var locChanged = chNewLoc.toLowerCase() !== chOldLoc.toLowerCase();
            var chOppChanged = chOpp !== (ch.existing.opponent || '');

            html +=
              '<div class="sn-import-match" style="border-left:3px solid var(--warning, #f59e0b);">' +
                '<div style="display:flex; align-items:center; gap:8px;">' +
                  '<span class="sn-badge" style="font-size:10px; padding:2px 6px;">' + (chHome ? 'H' : 'B') + '</span>' +
                  (chOppChanged
                    ? '<span style="color:var(--text-300); text-decoration:line-through; font-weight:500;">' + escapeHtml(ch.existing.opponent || '?') + '</span>' +
                      ' <i class="fas fa-arrow-right" style="font-size:10px; color:var(--warning, #f59e0b); margin:0 4px;"></i> ' +
                      '<span style="font-weight:600;">' + escapeHtml(chOpp) + '</span>'
                    : '<span style="font-weight:600;">' + escapeHtml(chOpp) + '</span>') +
                '</div>';
            if (dateChanged) {
              html +=
                '<div style="font-size:12px; margin-top:2px;">' +
                  '<span style="color:var(--text-300); text-decoration:line-through;">' + escapeHtml(chOldDate + (chOldTime ? ' kl. ' + chOldTime : '')) + '</span>' +
                  ' <i class="fas fa-arrow-right" style="font-size:10px; color:var(--warning, #f59e0b); margin:0 4px;"></i> ' +
                  '<span style="color:var(--text-600); font-weight:500;">' + escapeHtml(chNewDate + (chNewTime ? ' kl. ' + chNewTime : '')) + '</span>' +
                '</div>';
            }
            if (locChanged) {
              html +=
                '<div style="font-size:12px; margin-top:2px;">' +
                  (chOldLoc ? '<span style="color:var(--text-300); text-decoration:line-through;">' + escapeHtml(chOldLoc) + '</span>' : '<span style="color:var(--text-300);">Ingen bane</span>') +
                  ' <i class="fas fa-arrow-right" style="font-size:10px; color:var(--warning, #f59e0b); margin:0 4px;"></i> ' +
                  '<span style="color:var(--text-600); font-weight:500;">' + escapeHtml(chNewLoc || 'Ingen bane') + '</span>' +
                '</div>';
            }
            html += '</div>';
          }
          html += '</div></div>';
        }

        // New matches section
        if (newMatches.length > 0) {
          html +=
            '<div style="margin-bottom:4px;">' +
              (changedMatches.length > 0 ? '<div style="font-weight:600; font-size:13px; color:var(--success, #22c55e); margin-bottom:6px;"><i class="fas fa-plus-circle" style="margin-right:5px;"></i>' + newMatches.length + ' nye kamper</div>' : '');
          html += '<div class="sn-import-list">';
          for (var mi = 0; mi < newMatches.length; mi++) {
            var nm = newMatches[mi];
            var isHome = nm.home === myTeam;
            var opp = isHome ? nm.away : nm.home;
            var dateStr = nm.startTime ? formatDate(nm.startTime) : '';
            var timeStr = nm.time || '';
            html +=
              '<div class="sn-import-match">' +
                '<div style="display:flex; align-items:center; gap:8px;">' +
                  '<span class="sn-badge" style="font-size:10px; padding:2px 6px;">' + (isHome ? 'H' : 'B') + '</span>' +
                  '<span style="font-weight:600;">' + escapeHtml(opp) + '</span>' +
                '</div>' +
                '<div style="font-size:12px; color:var(--text-400);">' +
                  escapeHtml(dateStr + (timeStr ? ' kl. ' + timeStr : '')) + (nm.location ? ' \u00B7 ' + escapeHtml(nm.location) : '') +
                '</div>' +
              '</div>';
          }
          html += '</div>';
          if (changedMatches.length > 0) html += '</div>';
        }
        html += '</div>';

        html +=
          '<div style="font-size:11px; color:var(--text-300); margin-top:8px; line-height:1.5;">' +
            (changedMatches.length > 0 ? 'Endrede kamper oppdateres med ny dato, tid og bane. ' : '') +
            'Trygt \u00e5 importere samme fil flere ganger \u2014 duplikater hoppes over.' +
          '</div>';

        var btnLabel = '';
        if (newMatches.length > 0 && changedMatches.length > 0) {
          btnLabel = 'Legg til ' + newMatches.length + ' nye + oppdater ' + changedMatches.length + ' endrede';
        } else if (changedMatches.length > 0) {
          btnLabel = 'Oppdater ' + changedMatches.length + ' kamp' + (changedMatches.length === 1 ? '' : 'er');
        } else {
          btnLabel = 'Legg til ' + newMatches.length + ' kamper i kalenderen';
        }

        html +=
          '<button class="btn-primary" id="snDoImport" style="width:100%; margin-top:12px;">' +
            '<i class="fas fa-file-import" style="margin-right:6px;"></i>' + btnLabel +
          '</button>';
      }

      html +=
          '<button class="btn-secondary" id="snImportChangeTeam" style="width:100%; margin-top:8px; font-size:13px;"><i class="fas fa-exchange-alt" style="margin-right:5px;"></i>Bytt lag</button>' +
        '</div>';
    }

    html += '</div>';
    root.innerHTML = html;

    // Bind handlers
    $('snBackFromImport').addEventListener('click', function() {
      importState = { matches: null, allTeams: null, selectedTeam: null, selectedSubTeam: null, parsed: null };
      goToDashboard();
    });

    var fileInput = $('snImportFile');
    if (fileInput) fileInput.addEventListener('change', function(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var status = $('snImportStatus');
      if (status) status.textContent = 'Leser fil\u2026';

      loadSheetJS(function() {
        var reader = new FileReader();
        reader.onload = function(evt) {
          try {
            var data = new Uint8Array(evt.target.result);
            var parsed = parseFotballNoXlsx(data);
            if (!parsed || !parsed.matches.length) {
              if (status) { status.textContent = 'Fant ingen kamper i filen. Sjekk at det er en kampfil fra fotball.no med kolonnene Hjemmelag og Bortelag.'; status.style.color = 'var(--error, #ef4444)'; }
              return;
            }
            importState.parsed = parsed;

            // Auto-select team if name matches
            var teamName = '';
            try { var tn = document.querySelector('.team-switcher-name'); if (tn) teamName = tn.textContent.trim(); } catch (_) {}
            if (teamName) {
              var lower = teamName.toLowerCase();
              // Exact match first
              var match = parsed.teams.find(function(t) { return t.toLowerCase() === lower; });
              if (match) {
                importState.selectedTeam = match;
              } else {
                // Prefix match: "Steinkjer" matches "Steinkjer 1" / "Steinkjer 2"
                var prefixMatches = parsed.teams.filter(function(t) { return t.toLowerCase().indexOf(lower) === 0; });
                // Only auto-select if exactly one prefix match (unambiguous)
                if (prefixMatches.length === 1) importState.selectedTeam = prefixMatches[0];
              }
            }

            render();
          } catch (err) {
            console.error('[season.js] Import parse error:', err);
            if (status) { status.textContent = 'Kunne ikke lese filen. Pr\u00f8v \u00e5 laste ned en ny kopi fra fotball.no.'; status.style.color = 'var(--error, #ef4444)'; }
          }
        };
        reader.readAsArrayBuffer(file);
      });
    });

    var teamPicker = $('snTeamPicker');
    if (teamPicker) teamPicker.addEventListener('click', function(e) {
      var btn = e.target.closest('.sn-import-team-btn');
      if (!btn) return;
      importState.selectedTeam = btn.getAttribute('data-team');
      render();
    });

    var changeTeam = $('snImportChangeTeam');
    if (changeTeam) changeTeam.addEventListener('click', function() {
      importState.selectedTeam = null;
      importState.selectedSubTeam = null;
      render();
    });

    // Sub-team selector for flerlag
    var subTeamBtns = root.querySelectorAll('.sn-import-subteam-btn');
    for (var stb = 0; stb < subTeamBtns.length; stb++) {
      subTeamBtns[stb].addEventListener('click', function() {
        var val = parseInt(this.getAttribute('data-st'));
        importState.selectedSubTeam = (importState.selectedSubTeam === val) ? null : val;
        render();
      });
    }

    var doImport = $('snDoImport');
    if (doImport) doImport.addEventListener('click', async function() {
      var btn = $('snDoImport');
      btn.disabled = true;
      btn.textContent = 'Importerer\u2026';

      var myTeam = importState.selectedTeam;
      var myMatches = importState.parsed.matches.filter(function(m) { return m.home === myTeam || m.away === myTeam; });

      // Build lookup: kampnummer → existing event
      var existingByUid = {};
      for (var e = 0; e < events.length; e++) {
        if (events[e].external_uid) existingByUid[events[e].external_uid] = events[e];
      }

      // Classify: new vs changed
      var newMatches = [];
      var changedMatches = [];
      for (var mc = 0; mc < myMatches.length; mc++) {
        var m = myMatches[mc];
        var existing = existingByUid[m.kampnummer];
        if (!existing) {
          newMatches.push(m);
        } else {
          var fileDate = m.startTime ? m.startTime.substring(0, 16) : '';
          var dbDate = existing.start_time ? existing.start_time.substring(0, 16) : '';
          var fileLoc = (m.location || '').toLowerCase();
          var dbLoc = (existing.location || '').toLowerCase();
          var fileIsH = m.home === myTeam;
          var fileOpp = fileIsH ? m.away : m.home;
          var oppChanged = fileOpp !== existing.opponent;
          if (fileDate !== dbDate || fileLoc !== dbLoc || oppChanged) {
            changedMatches.push({ file: m, existing: existing });
          }
        }
      }

      if (newMatches.length === 0 && changedMatches.length === 0) {
        notify('Alle kamper fra filen stemmer med kalenderen.', 'info');
        btn.disabled = false;
        btn.textContent = 'Alt oppdatert';
        return;
      }

      var sb = getSb();
      var uid = getUserId();
      var sid = currentSeason.id;
      if (!sb || !uid || !sid) { notify('Feil: mangler tilkobling.', 'error'); btn.disabled = false; btn.textContent = 'Pr\u00f8v igjen'; return; }

      try {
        var insertedCount = 0;
        var updatedCount = 0;

        // --- INSERT new matches ---
        if (newMatches.length > 0) {
          var firstMatch = newMatches[0];
          var importFormat = firstMatch.format || (currentSeason ? currentSeason.format : 7);
          var importDuration = { 3: 20, 5: 40, 7: 60, 9: 70, 11: 80 }[importFormat] || 60;

          var rows = [];
          for (var i = 0; i < newMatches.length; i++) {
            var nm = newMatches[i];
            var isHome = nm.home === myTeam;
            rows.push({
              season_id: sid,
              user_id: uid,
              type: 'match',
              title: null,
              start_time: nm.startTime,
              duration_minutes: importDuration,
              location: nm.location || null,
              opponent: isHome ? nm.away : nm.home,
              is_home: isHome,
              format: nm.format || importFormat,
              notes: nm.tournament ? 'Runde ' + nm.round + ' \u00B7 ' + nm.tournament : null,
              external_source: 'fotball.no',
              external_uid: nm.kampnummer,
              sub_team: importState.selectedSubTeam || null
            });
          }

          // Filter out null start_times
          rows = rows.filter(function(r) { return r.start_time; });
          if (rows.length > 0) {
            var res = await sb.from('events').insert(rows).select();
            if (res.error) throw res.error;
            var created = res.data || [];
            for (var c = 0; c < created.length; c++) events.push(created[c]);
            insertedCount = created.length;
          }
        }

        // --- UPDATE changed matches (parallel) ---
        if (changedMatches.length > 0) {
          var updatePromises = changedMatches.map(function(ch) {
            var fields = {};
            if (ch.file.startTime) fields.start_time = ch.file.startTime;
            if (ch.file.location !== undefined) fields.location = ch.file.location || null;
            // Only update notes if they were auto-generated by a previous import (starts with 'Runde ')
            // Preserves any notes the user has manually written
            var existingNotes = ch.existing.notes || '';
            var isAutoNotes = !existingNotes || existingNotes.indexOf('Runde ') === 0;
            if (isAutoNotes && ch.file.tournament) {
              fields.notes = 'Runde ' + ch.file.round + ' \u00B7 ' + ch.file.tournament;
            }
            // Update opponent if changed (e.g. team withdrawal/replacement)
            var fileIsHome = ch.file.home === myTeam;
            var fileOpp = fileIsHome ? ch.file.away : ch.file.home;
            if (fileOpp !== ch.existing.opponent) {
              fields.opponent = fileOpp;
              fields.is_home = fileIsHome;
            }
            return sb.from('events')
              .update(fields)
              .eq('id', ch.existing.id)
              .eq('user_id', uid)
              .select()
              .single()
              .then(function(upd) { return { id: ch.existing.id, data: upd.data, error: upd.error }; });
          });

          var results = await Promise.allSettled(updatePromises);
          for (var u = 0; u < results.length; u++) {
            var r = results[u];
            if (r.status === 'fulfilled' && r.value && !r.value.error && r.value.data) {
              var evIdx = events.findIndex(function(ev) { return ev.id === r.value.id; });
              if (evIdx > -1) events[evIdx] = r.value.data;
              updatedCount++;
            } else {
              var errId = r.value ? r.value.id : changedMatches[u].existing.id;
              console.warn('[season.js] Update failed for event ' + errId, r.value ? r.value.error : r.reason);
            }
          }
        }

        // Auto-set season age_class
        var anyMatch = newMatches[0] || (changedMatches[0] ? changedMatches[0].file : null);
        if (anyMatch && !currentSeason.age_class && anyMatch.ageClass) {
          await updateSeason(sid, { age_class: anyMatch.ageClass });
          currentSeason.age_class = anyMatch.ageClass;
        }

        // Build notification
        var stNote = '';
        if (importState.selectedSubTeam && currentSeason) {
          var stNms = getSubTeamNames(currentSeason);
          stNote = ' (' + (stNms[importState.selectedSubTeam - 1] || 'Lag ' + importState.selectedSubTeam) + ')';
        }
        var parts = [];
        if (insertedCount > 0) parts.push(insertedCount + ' lagt til');
        if (updatedCount > 0) parts.push(updatedCount + ' oppdatert');
        notify(parts.join(', ') + stNote + '!', 'success');

        importState = { matches: null, allTeams: null, selectedTeam: null, selectedSubTeam: null, parsed: null };
        goToDashboard();
      } catch (err) {
        console.error('[season.js] Import error:', err);
        notify('Noe gikk galt under import. Pr\u00f8v igjen.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-import" style="margin-right:6px;"></i>Pr\u00f8v igjen';
      }
    });
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

    // Build sub-team dropdown if season has multiple sub-teams
    var stCount = (currentSeason && currentSeason.sub_team_count) || 1;
    var hasSubTeams = stCount > 1;
    var isRotate = hasSubTeams && ((currentSeason && currentSeason.sub_team_mode) || 'fixed') === 'rotate';
    var subTeamSelect = '';
    if (hasSubTeams) {
      var stNames = getSubTeamNames(currentSeason);
      var opts = '';
      if (isRotate) {
        opts += '<option value="0"' + (!ev.sub_team ? ' selected' : '') + '>Alle lag</option>';
      }
      for (var st = 0; st < stCount; st++) {
        var stIdx = st + 1;
        opts += '<option value="' + stIdx + '"' + (ev.sub_team === stIdx ? ' selected' : '') + '>' + escapeHtml(stNames[st]) + '</option>';
      }
      var hint = isRotate
        ? 'Valgfritt. Troppen kan justeres i kampdetalj.'
        : 'Troppen foresl\u00e5s fra dette laget.';
      subTeamSelect =
        '<div class="form-group" id="snSubTeamGroup" style="' + (isMatch ? '' : 'display:none;') + '">' +
          '<label for="snSubTeam">Lag</label>' +
          '<select id="snSubTeam">' + opts + '</select>' +
          '<div class="sn-hint">' + hint + '</div>' +
        '</div>';
    }

    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="snBackFromEvent"><i class="fas fa-chevron-left"></i> Tilbake</button>' +
          '<span class="sn-dash-title">' + title + '</span>' +
        '</div>' +
        '<div class="sn-form">' +
          '<div class="form-group">' +
            '<label for="snEventType">Type</label>' +
            '<select id="snEventType">' +
              '<option value="match"' + (type === 'match' ? ' selected' : '') + '>Kamp</option>' +
              '<option value="cup_match"' + (type === 'cup_match' ? ' selected' : '') + '>Cupkamp</option>' +
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
          subTeamSelect +
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
      // Show/hide sub-team dropdown
      var stGroup = $('snSubTeamGroup');
      if (stGroup) stGroup.style.display = isM ? '' : 'none';
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
        notes: $('snNotes').value || null,
        sub_team: (isMatchNow && $('snSubTeam') && parseInt($('snSubTeam').value)) ? parseInt($('snSubTeam').value) : null
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
          '<button class="sn-back" id="snBackFromDetail"><i class="fas fa-chevron-left"></i> Kalender</button>' +
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
    if (ev.sub_team && currentSeason && (currentSeason.sub_team_count || 1) > 1) {
      html += '<div class="sn-detail-row"><div class="sn-detail-label">' + escapeHtml('Lag') + '</div><div class="sn-detail-value"><span class="sn-st-badge sn-st-' + ev.sub_team + '">' + escapeHtml(getSubTeamName(currentSeason, ev.sub_team)) + '</span></div></div>';
    }
    if (ev.notes) html += detailRow('Notat', ev.notes);

    html += '</div>';

    // Edit/delete
    html +=
      '<div class="sn-detail-actions">' +
        '<button class="btn-secondary" id="snEditEvent"><i class="fas fa-pen" style="margin-right:5px;"></i>Rediger</button>' +
        '<button class="btn-secondary" id="snIcalEvent" style="flex:0 0 auto; padding:14px 14px;" title="Last ned til kalender (.ics)"><i class="fas fa-calendar-plus"></i></button>' +
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
        '<div class="sn-section" style="display:flex; align-items:center; justify-content:space-between;">' +
          '<span>' + sectionTitle + '</span>' +
          '<div style="display:flex; gap:6px;">' +
            '<button class="btn-secondary" id="snTroppAll" style="font-size:11px; padding:4px 10px;">Velg alle</button>' +
            '<button class="btn-secondary" id="snTroppNone" style="font-size:11px; padding:4px 10px;">Velg ingen</button>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card" style="padding:0;">' +
          '<div class="sn-att-list">' + playerHtml + '</div>' +
          '<div class="sn-att-summary" id="snAttSummary">' + summaryText + '</div>' +
        '</div>';

      // Rotation mode distribution section
      var isRotation = currentSeason && (currentSeason.sub_team_mode === 'rotate') && (currentSeason.sub_team_count || 1) > 1;
      if (isMatch && isRotation) {
        var rotStCount = currentSeason.sub_team_count;
        var rotStNames = getSubTeamNames(currentSeason);

        // Initialize eventDistDraft from existing event_players data
        if (!eventDistDraft) {
          eventDistDraft = { assignments: {} };
          for (var edi = 0; edi < eventAttendance.length; edi++) {
            if (eventAttendance[edi].sub_team) {
              eventDistDraft.assignments[eventAttendance[edi].player_id] = eventAttendance[edi].sub_team;
            }
          }
        }

        var distAsgn = eventDistDraft.assignments;
        var hasDistribution = Object.keys(distAsgn).length > 0;

        html += '<div class="sn-dist-section">';
        html += '<div class="sn-dist-title"><i class="fas fa-random"></i>Lagfordeling (rullering)</div>';

        if (hasDistribution) {
          // Show counters (scope to tropp players only, not entire roster)
          var troppScope = Object.keys(distAsgn);
          html += buildCounterChips(distAsgn, rotStCount, troppScope);
          html += buildBalanceBar(distAsgn, rotStCount, troppScope);

          // Compact team lists
          for (var dgt = 1; dgt <= rotStCount; dgt++) {
            var distTeamPlayers = activePlayers.filter(function(p) {
              return distAsgn[p.player_id] === dgt;
            });
            var distNameList = distTeamPlayers.map(function(p) {
              return escapeHtml(p.name) + (p.goalie ? ' \uD83E\uDDE4' : '');
            }).join(', ');
            html +=
              '<div class="sn-group-compact">' +
                '<div class="sn-group-compact-header">' +
                  '<div class="sn-color-dot" style="background:' + getSubTeamColor(dgt) + ';"></div>' +
                  '<strong style="font-size:13px;">' + escapeHtml(rotStNames[dgt - 1]) + '</strong>' +
                  '<span style="font-size:12px;color:var(--text-400);margin-left:auto;">' + distTeamPlayers.length + '</span>' +
                '</div>' +
                '<div class="sn-group-compact-list">' + (distNameList || '<em style="color:var(--text-300);">Ingen</em>') + '</div>' +
              '</div>';
          }

          // Loan suggestion: check if any tropp-selected player is in a team that's short
          var troppPids = [];
          var troppAbsentPids = [];
          var absentCheckItems = root ? root.querySelectorAll('.sn-att-item') : [];
          // (at render time we count from playerHtml)
          var distCounts = {};
          for (var dc = 1; dc <= rotStCount; dc++) distCounts[dc] = 0;
          for (var dck in distAsgn) { if (distAsgn[dck]) distCounts[distAsgn[dck]] = (distCounts[distAsgn[dck]] || 0) + 1; }
          var ideal = Math.ceil(presentCount / rotStCount);
          var distUnassigned = activePlayers.filter(function(p) { return !distAsgn[p.player_id]; });
          if (distUnassigned.length > 0) {
            html += '<div class="sn-unassigned-warn"><i class="fas fa-exclamation-triangle"></i>' +
              distUnassigned.length + ' i troppen er ikke fordelt p\u00e5 lag</div>';
          }
        }

        html += '<div class="sn-dist-actions">';
        html += '<button class="btn-secondary" id="snRotateDraft" style="flex:1;"><i class="fas fa-magic" style="margin-right:4px;"></i>' +
          (hasDistribution ? 'Trekk p\u00e5 nytt' : 'Fordel p\u00e5 lag') + '</button>';
        if (hasDistribution) {
          html += '<button class="btn-secondary" id="snRotateManual" style="flex:1;"><i class="fas fa-hand-pointer" style="margin-right:4px;"></i>Juster</button>';
        }
        html += '</div>';

        // Manual adjustment (inline dropdowns, hidden by default)
        if (hasDistribution) {
          html += '<div id="snRotateManualPanel" style="display:none;margin-top:10px;">';
          html += '<div class="settings-card" style="padding:0;">';
          var rotSorted = activePlayers.slice().sort(function(a, b) {
            if (a.goalie && !b.goalie) return -1;
            if (!a.goalie && b.goalie) return 1;
            return a.name.localeCompare(b.name, 'nb');
          });
          for (var ri = 0; ri < rotSorted.length; ri++) {
            var rp = rotSorted[ri];
            var rVal = distAsgn[rp.player_id] || 0;
            var rSelClass = rVal > 0 ? ' sn-assign-set-' + rVal : '';
            var rOpts = '<option value="0"' + (rVal === 0 ? ' selected' : '') + '>\u2013</option>';
            for (var rot = 1; rot <= rotStCount; rot++) {
              rOpts += '<option value="' + rot + '"' + (rVal === rot ? ' selected' : '') + '>' + escapeHtml(rotStNames[rot - 1]) + '</option>';
            }
            html +=
              '<div class="sn-assign-row">' +
                '<div class="sn-assign-name">' + escapeHtml(rp.name) +
                  (rp.goalie ? ' <small>\uD83E\uDDE4</small>' : '') +
                '</div>' +
                '<select class="sn-assign-select sn-rot-select' + rSelClass + '" data-rpid="' + escapeHtml(rp.player_id) + '">' + rOpts + '</select>' +
              '</div>';
          }
          html += '</div></div>';
        }

        html += '</div>'; // end sn-dist-section
      }

      if (isMatch) {
        var saveTroppLabel = isRotation ? 'Lagre tropp og lagfordeling' : 'Lagre tropp';
        html +=
          '<button class="btn-primary" id="snSaveAttendance" style="width:100%; margin-top:12px;">' +
            '<i class="fas fa-check" style="margin-right:5px;"></i>' + saveTroppLabel +
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

    // --- SPILLETID SECTION (only for matches with saved bytteplan) ---
    if (isMatch && ev.plan_json) {
      var isConfirmed = !!ev.plan_confirmed;

      // Build minutes map from eventAttendance
      var minutesRows = [];
      for (var mi = 0; mi < eventAttendance.length; mi++) {
        var mrow = eventAttendance[mi];
        if (mrow.in_squad && mrow.minutes_played != null && mrow.minutes_played > 0) {
          // Resolve name from seasonPlayers
          var mname = mrow.player_name || '';
          if (!mname) {
            for (var sp2 = 0; sp2 < seasonPlayers.length; sp2++) {
              if (seasonPlayers[sp2].player_id === mrow.player_id) { mname = seasonPlayers[sp2].name; break; }
            }
          }
          minutesRows.push({ name: mname || 'Ukjent', minutes: mrow.minutes_played });
        }
      }
      minutesRows.sort(function(a, b) { return b.minutes - a.minutes; });

      if (minutesRows.length > 0) {
        var totalMins = minutesRows.reduce(function(s, r) { return s + r.minutes; }, 0);
        var avgMins = Math.round(totalMins / minutesRows.length);

        html +=
          '<div class="sn-section">Spilletid' +
            (isConfirmed ? ' <span class="sn-confirmed-badge"><i class="fas fa-check-circle"></i>Bekreftet</span>' : '') +
          '</div>' +
          '<div class="settings-card" style="padding:0;">' +
            '<div class="sn-playtime-list">';

        for (var mr = 0; mr < minutesRows.length; mr++) {
          html += '<div class="sn-playtime-row"><span class="sn-playtime-name">' + escapeHtml(minutesRows[mr].name) + '</span><span class="sn-playtime-min">' + minutesRows[mr].minutes + ' min</span></div>';
        }

        html +=
            '</div>' +
            '<div style="padding:8px 14px; border-top:1px solid var(--border-light, #f1f5f9); font-size:12px; color:var(--text-400); display:flex; justify-content:space-between;">' +
              '<span>' + minutesRows.length + ' spillere</span>' +
              '<span>Snitt: ' + avgMins + ' min</span>' +
            '</div>' +
          '</div>';

        if (isConfirmed) {
          html += '<div class="sn-unconfirm-link" id="snUnconfirmPlan">Angre bekreftelse</div>';
        } else {
          html +=
            '<button class="btn-primary" id="snConfirmPlan" style="width:100%; margin-top:10px; background:#16a34a;">' +
              '<i class="fas fa-check-circle" style="margin-right:5px;"></i>Bekreft spilletid' +
            '</button>';
        }
      }
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
                '<div class="sn-score-label">' + (ev.is_home ? 'Oss' : 'Motstander') + '</div>' +
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
            '<button class="btn-secondary" id="snReopenMatch" style="width:100%; font-size:13px;"><i class="fas fa-lock-open" style="margin-right:5px;"></i>Gjen\u00e5pne kamp</button>' +
          '</div></div>';

      } else {
        html += '<div class="sn-section">Resultat</div><div class="settings-card">';

        html +=
          '<div class="sn-result-box">' +
            '<div>' +
              '<input type="number" class="sn-score-input" id="snScoreHome" min="0" max="99" inputmode="numeric" value="' + (ev.result_home !== null && ev.result_home !== undefined ? ev.result_home : '') + '" placeholder="-">' +
              '<div class="sn-score-label">' + (ev.is_home ? 'Oss' : 'Motstander') + '</div>' +
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

        var canComplete = !!(ev.plan_confirmed);

        html +=
          '<div style="padding:10px 14px;">' +
            (canComplete
              ? '<button class="btn-primary" id="snCompleteMatch" style="width:100%;">' +
                  '<i class="fas fa-check" style="margin-right:5px;"></i>Fullf\u00f8r kamp' +
                '</button>'
              : '<button class="btn-primary" disabled style="width:100%; opacity:0.5; cursor:not-allowed;">' +
                  '<i class="fas fa-lock" style="margin-right:5px;"></i>Fullf\u00f8r kamp' +
                '</button>' +
                '<div style="text-align:center; font-size:12px; color:var(--text-400); margin-top:6px;">' +
                  (ev.plan_json ? 'Bekreft spilletid f\u00f8rst' : 'Generer og bekreft bytteplan f\u00f8rst') +
                '</div>'
            ) +
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

    var icalEvBtn = $('snIcalEvent');
    if (icalEvBtn) icalEvBtn.addEventListener('click', function() {
      var ics = buildIcsCalendar([ev], currentSeason ? currentSeason.name : null);
      var evTitle = ev.title || ev.opponent || typeLabel(ev.type);
      var safeName = evTitle.replace(/[^a-zA-Z0-9\u00e6\u00f8\u00e5\u00c6\u00d8\u00c5 _-]/g, '').replace(/\s+/g, '_') || 'hendelse';
      downloadIcsFile(ics, safeName + '.ics');
    });

    $('snDeleteEvent').addEventListener('click', async function() {
      if (!confirm('Slett denne hendelsen?')) return;

      var btn = $('snDeleteEvent');
      btn.disabled = true;
      btn.textContent = 'Sletter\u2026';

      var ok = await deleteEvent(ev.id);
      if (ok) {
        editingEvent = null;
        seasonStats = [];
        seasonGoals = [];
        await loadEvents(currentSeason.id);
        snView = 'dashboard';
        render();
      } else {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash" style="margin-right:5px;"></i>Slett';
      }
    });

    // --- PLAN CONFIRMED TOGGLE ---
    var confirmBtn = $('snConfirmPlan');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async function() {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Bekrefter\u2026';
        var sb = getSb();
        var uid = getUserId();
        if (sb && uid) {
          var res = await sb.from('events')
            .update({ plan_confirmed: true })
            .eq('id', ev.id)
            .eq('user_id', uid);
          if (!res.error) {
            ev.plan_confirmed = true;
            if (editingEvent && editingEvent.id === ev.id) editingEvent.plan_confirmed = true;
            render();
            return;
          }
        }
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check-circle" style="margin-right:5px;"></i>Bekreft spilletid';
      });
    }

    var unconfirmLink = $('snUnconfirmPlan');
    if (unconfirmLink) {
      unconfirmLink.addEventListener('click', async function() {
        var sb = getSb();
        var uid = getUserId();
        if (sb && uid) {
          var res = await sb.from('events')
            .update({ plan_confirmed: false })
            .eq('id', ev.id)
            .eq('user_id', uid);
          if (!res.error) {
            ev.plan_confirmed = false;
            if (editingEvent && editingEvent.id === ev.id) editingEvent.plan_confirmed = false;
            render();
          }
        }
      });
    }

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

    // Velg alle / Velg ingen buttons
    var troppAllBtn = $('snTroppAll');
    if (troppAllBtn) troppAllBtn.addEventListener('click', function() {
      var items = root.querySelectorAll('.sn-att-item');
      for (var ti = 0; ti < items.length; ti++) {
        items[ti].classList.add('present');
        items[ti].classList.remove('absent');
        var pid = items[ti].getAttribute('data-pid');
        var reasonRow = root.querySelector('.sn-att-reason[data-rpid="' + pid + '"]');
        if (reasonRow) {
          reasonRow.style.display = 'none';
          var rBtns = reasonRow.querySelectorAll('.sn-reason-btn');
          for (var rb = 0; rb < rBtns.length; rb++) rBtns[rb].classList.remove('active');
        }
      }
      updateAttSummary();
    });
    var troppNoneBtn = $('snTroppNone');
    if (troppNoneBtn) troppNoneBtn.addEventListener('click', function() {
      var items = root.querySelectorAll('.sn-att-item');
      for (var ti = 0; ti < items.length; ti++) {
        items[ti].classList.remove('present');
        items[ti].classList.add('absent');
        var pid = items[ti].getAttribute('data-pid');
        var reasonRow = root.querySelector('.sn-att-reason[data-rpid="' + pid + '"]');
        if (reasonRow && reasonRow.style.display !== 'flex') {
          reasonRow.style.display = 'flex';
        }
      }
      updateAttSummary();
    });

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

      // Build rotation sub-team map if applicable
      var rotSubTeamMap = null;
      if (isRotation && eventDistDraft && Object.keys(eventDistDraft.assignments).length > 0) {
        rotSubTeamMap = eventDistDraft.assignments;
      }

      var ok = await saveAttendance(ev.id, currentSeason.id, map, reasonMap, isMatch ? squadList : null, rotSubTeamMap);
      if (ok) {
        eventDistDraft = null; // Reset after save
        seasonStats = []; // Invalidate so stats tab reloads
        await loadEventAttendance(ev.id);
      }
      saveAttBtn.disabled = false;
      var saveLabelText = (isRotation ? 'Lagre tropp og lagfordeling' : (isMatch ? 'Lagre tropp' : 'Lagre oppm\u00f8te'));
      saveAttBtn.innerHTML = '<i class="fas fa-check" style="margin-right:5px;"></i>' + saveLabelText;
    });

    // --- ROTATION DISTRIBUTION HANDLERS ---
    var rotDraftBtn = $('snRotateDraft');
    if (rotDraftBtn) rotDraftBtn.addEventListener('click', function() {
      // Get currently selected tropp
      var troppItems = root.querySelectorAll('.sn-att-item.present');
      var troppPlayers = [];
      for (var ti = 0; ti < troppItems.length; ti++) {
        var tpid = troppItems[ti].getAttribute('data-pid');
        var tsp = seasonPlayers.find(function(p) { return p.player_id === tpid; });
        if (tsp) troppPlayers.push(tsp);
      }
      if (troppPlayers.length < 2) {
        notify('Velg minst 2 spillere i troppen f\u00f8rst.', 'info');
        return;
      }
      var rotStCount = currentSeason.sub_team_count;
      if (window.Grouping && window.Grouping.makeEvenTeams) {
        var result = window.Grouping.makeEvenTeams(troppPlayers, rotStCount, true);
        var newDist = {};
        for (var rt = 0; rt < result.teams.length; rt++) {
          for (var rp = 0; rp < result.teams[rt].players.length; rp++) {
            var rpObj = result.teams[rt].players[rp];
            var rpid = rpObj.player_id || rpObj.id;
            var rsp = seasonPlayers.find(function(p) { return p.player_id === rpid || p.id === rpid; });
            if (rsp) newDist[rsp.player_id] = rt + 1;
          }
        }
        eventDistDraft = { assignments: newDist };
        render();
      }
    });

    var rotManualBtn = $('snRotateManual');
    if (rotManualBtn) rotManualBtn.addEventListener('click', function() {
      var panel = $('snRotateManualPanel');
      if (panel) {
        var isHidden = panel.style.display === 'none';
        panel.style.display = isHidden ? 'block' : 'none';
        rotManualBtn.innerHTML = isHidden
          ? '<i class="fas fa-hand-pointer" style="margin-right:4px;"></i>Skjul'
          : '<i class="fas fa-hand-pointer" style="margin-right:4px;"></i>Juster';
      }
    });

    // Manual rotation selects
    var rotSelects = root.querySelectorAll('.sn-rot-select');
    for (var rsi = 0; rsi < rotSelects.length; rsi++) {
      rotSelects[rsi].addEventListener('change', function() {
        var rpid = this.getAttribute('data-rpid');
        var rval = parseInt(this.value);
        if (!eventDistDraft) eventDistDraft = { assignments: {} };
        if (rval > 0) {
          eventDistDraft.assignments[rpid] = rval;
        } else {
          delete eventDistDraft.assignments[rpid];
        }
        this.className = 'sn-assign-select sn-rot-select' + (rval > 0 ? ' sn-assign-set-' + rval : '');
      });
    }

    // --- MATCH RESULT HANDLERS ---
    // Add goal
    // Helper: persist score inputs to ev object before re-render
    function persistScoreToEvent() {
      var sh = $('snScoreHome'), sa = $('snScoreAway');
      if (sh && sh.value !== '') ev.result_home = parseInt(sh.value);
      if (sa && sa.value !== '') ev.result_away = parseInt(sa.value);
      if (editingEvent && editingEvent.id === ev.id) {
        if (sh && sh.value !== '') editingEvent.result_home = parseInt(sh.value);
        if (sa && sa.value !== '') editingEvent.result_away = parseInt(sa.value);
      }
    }

    var addGoalBtn = $('snAddGoal');
    if (addGoalBtn) addGoalBtn.addEventListener('click', async function() {
      var playerSel = $('snGoalPlayer');
      if (!playerSel) return;
      addGoalBtn.disabled = true;
      var ok = await addMatchEvent(ev.id, playerSel.value, playerSel.options[playerSel.selectedIndex].text, 'goal');
      if (ok) { persistScoreToEvent(); seasonGoals = []; await loadMatchGoals(ev.id); render(); }
      else { addGoalBtn.disabled = false; }
    });

    var addAssistBtn = $('snAddAssist');
    if (addAssistBtn) addAssistBtn.addEventListener('click', async function() {
      var playerSel = $('snAssistPlayer');
      if (!playerSel) return;
      addAssistBtn.disabled = true;
      var ok = await addMatchEvent(ev.id, playerSel.value, playerSel.options[playerSel.selectedIndex].text, 'assist');
      if (ok) { persistScoreToEvent(); seasonGoals = []; await loadMatchGoals(ev.id); render(); }
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
            persistScoreToEvent();
            seasonGoals = [];
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
          if (ok) { persistScoreToEvent(); seasonGoals = []; await loadMatchGoals(ev.id); render(); }
          else { btn.disabled = false; }
        };
      })(dupGoalBtns[dg]));
    }

    // Complete match
    var completeBtn = $('snCompleteMatch');
    if (completeBtn) completeBtn.addEventListener('click', async function() {
      var homeVal = $('snScoreHome') ? $('snScoreHome').value : null;
      var awayVal = $('snScoreAway') ? $('snScoreAway').value : null;

      // Validate: both scores must be filled
      if (homeVal === '' || homeVal === null || awayVal === '' || awayVal === null) {
        notify('Fyll inn begge resultat f\u00f8r du fullf\u00f8rer kampen.', 'warning');
        return;
      }

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
      if (!confirm('Gjenåpne kampen? Du kan endre resultat, spilletid og bytteplan.')) return;
      reopenBtn.disabled = true;
      reopenBtn.textContent = 'Gjenåpner\u2026';

      var sb = getSb();
      var uid = getUserId();
      if (sb && uid) {
        // Reset status and plan_confirmed so coach can redo everything
        var res = await sb.from('events')
          .update({ status: 'planned', plan_confirmed: false })
          .eq('id', ev.id)
          .eq('user_id', uid);
        if (!res.error) {
          ev.status = 'planned';
          ev.plan_confirmed = false;
          if (editingEvent && editingEvent.id === ev.id) {
            editingEvent.status = 'planned';
            editingEvent.plan_confirmed = false;
          }
          await loadEvents(currentSeason.id);
          editingEvent = events.find(function(e) { return e.id === ev.id; }) || editingEvent;
          render();
          return;
        }
      }
      reopenBtn.disabled = false;
      reopenBtn.innerHTML = '<i class="fas fa-lock-open" style="margin-right:5px;"></i>Gjen\u00e5pne kamp';
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
        .update({ plan_json: planJson, plan_confirmed: false })
        .eq('id', ev.id)
        .eq('user_id', uid);
      if (evRes.error) throw evRes.error;

      // Update local event object so event-detail reflects the saved plan
      ev.plan_json = planJson;
      ev.plan_confirmed = false;
      if (editingEvent && editingEvent.id === ev.id) {
        editingEvent.plan_json = planJson;
        editingEvent.plan_confirmed = false;
      }

      // 2. Batch upsert minutes_played per player to event_players
      var playerIds = Object.keys(minutesMap);
      if (playerIds.length > 0) {
        // Build name lookup from season players
        var nameMap = {};
        for (var n = 0; n < seasonPlayers.length; n++) {
          nameMap[seasonPlayers[n].player_id] = seasonPlayers[n].name;
        }

        // Build sub_team lookup from existing event attendance (preserve rotation assignments)
        var stMap = {};
        for (var stl = 0; stl < eventAttendance.length; stl++) {
          if (eventAttendance[stl].sub_team) {
            stMap[eventAttendance[stl].player_id] = eventAttendance[stl].sub_team;
          }
        }

        var rows = [];
        for (var i = 0; i < playerIds.length; i++) {
          var kRow = {
            event_id: ev.id,
            season_id: ev.season_id,
            user_id: uid,
            player_id: playerIds[i],
            minutes_played: minutesMap[playerIds[i]],
            in_squad: true,
            attended: true,
            player_name: nameMap[playerIds[i]] || null
          };
          if (stMap[playerIds[i]]) kRow.sub_team = stMap[playerIds[i]];
          rows.push(kRow);
        }
        var epRes = await sb.from('event_players')
          .upsert(rows, { onConflict: 'event_id,player_id' });
        if (epRes.error) throw epRes.error;
      }

      notify('Spilletid lagret!', 'success');

      // Mark event as having attendance data
      registeredEventIds[ev.id] = true;

      // Invalidate goals cache (stats reloaded below)
      seasonGoals = [];

      // Reload attendance + stats so event-detail has fresh minutes_played AND tropp-hints
      try {
        await Promise.all([
          loadEventAttendance(ev.id),
          loadSeasonStats(ev.season_id)
        ]);
      } catch (reloadErr) {
        console.warn('[season.js] Stats reload after save failed (data was saved):', reloadErr);
      }

      // Clean up and return to event detail (AFTER reload so tropp is available for name lookup)
      window.sesongKampdag.destroy();
      embeddedKampdagEvent = null;
      embeddedKampdagTropp = null;

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
    seasonPlayers = [];
    seasonStats = [];
    seasonGoals = [];
    eventAttendance = [];
    matchGoals = [];
    editingEvent = null;
    editingSeasonPlayer = null;
    eventDistDraft = null;
    importState = { matches: null, allTeams: null, selectedTeam: null, selectedSubTeam: null, parsed: null };
    registeredEventIds = {};
    subTeamFilter = null;
    dashTab = 'calendar';
    snView = 'list';
    loadSeasons();
  }

  async function goToDashboard() {
    editingEvent = null;
    eventDistDraft = null;
    snView = 'dashboard';
    // Ensure stats data is fresh if returning to stats tab
    if (dashTab === 'stats' && currentSeason) {
      var loads = [];
      if (seasonStats.length === 0) loads.push(loadSeasonStats(currentSeason.id));
      if (seasonGoals.length === 0) loads.push(loadSeasonGoals(currentSeason.id));
      if (loads.length > 0) await Promise.all(loads);
    }
    render();
  }

  async function openSeason(seasonId) {
    var s = seasons.find(function(x) { return x.id === seasonId; });
    if (!s) return;
    // Clear previous season's caches
    seasonStats = [];
    seasonGoals = [];
    eventAttendance = [];
    matchGoals = [];
    editingEvent = null;
    editingSeasonPlayer = null;
    eventDistDraft = null;
    importState = { matches: null, allTeams: null, selectedTeam: null, selectedSubTeam: null, parsed: null };
    subTeamFilter = null;
    currentSeason = s;
    dashTab = 'calendar';
    await Promise.all([loadEvents(seasonId), loadSeasonPlayers(seasonId), loadRegisteredEventIds(seasonId)]);
    snView = 'dashboard';
    render();
  }

})();
