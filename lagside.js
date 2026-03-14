// © 2026 Barnefotballtrener.no. All rights reserved.
// lagside.js — Parent-facing team page (standalone, no app dependencies)
(() => {
  'use strict';

  var root = document.getElementById('lagside-root');
  var pathParts = window.location.pathname.split('/');
  var token = pathParts[2] || '';

  if (!token || token.length < 8) {
    showError('Ugyldig lenke', 'Denne lenken ser ikke riktig ut. Sjekk at du har fått riktig adresse fra treneren.');
    return;
  }

  var STORAGE_KEY = 'bf_lagside_' + token;
  var selectedPlayerId = null;
  var pageData = null;

  try { selectedPlayerId = localStorage.getItem(STORAGE_KEY); } catch (_) {}

  // ========================================
  // Helpers
  // ========================================

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    var days = ['sondag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lordag'];
    return {
      day: days[d.getDay()],
      dayShort: days[d.getDay()].slice(0, 3),
      num: d.getDate(),
      month: d.getMonth(),
      time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      date: d,
      iso: iso,
    };
  }

  var monthNames = ['januar', 'februar', 'mars', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'desember'];

  function isUpcoming(e) {
    return e.status !== 'completed' && e.status !== 'cancelled' &&
      new Date(e.start_time) > new Date(Date.now() - 3 * 60 * 60 * 1000);
  }

  function isCompleted(e) { return e.status === 'completed'; }

  function nffCategoryColor(cat) {
    var colors = {
      sjef_over_ballen: '#2563eb',
      spille_med_og_mot: '#7c3aed',
      smalagsspill: '#059669',
      scoringstrening: '#dc2626',
    };
    return colors[cat] || '#94a3b8';
  }

  // ========================================
  // Data fetching
  // ========================================

  async function loadData() {
    try {
      var url = '/api/team-page-read?token=' + encodeURIComponent(token);
      if (selectedPlayerId) url += '&player_id=' + encodeURIComponent(selectedPlayerId);

      var res = await fetch(url);
      if (res.status === 404) {
        showError('Lagsiden finnes ikke', 'Lenken er ugyldig eller deaktivert. Be treneren om en ny lenke.');
        return;
      }
      if (!res.ok) {
        showError('Noe gikk galt', 'Kunne ikke laste lagsiden. Prøv igjen om litt.');
        return;
      }

      pageData = await res.json();

      // Validate stored player - might have been removed from season
      if (selectedPlayerId && pageData.players) {
        var stillExists = pageData.players.some(function (p) { return p.id === selectedPlayerId; });
        if (!stillExists) {
          selectedPlayerId = null;
          try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        }
      }

      if (!selectedPlayerId && pageData.players && pageData.players.length > 0) {
        showPlayerPicker(pageData.players);
      } else {
        render();
      }
    } catch (err) {
      console.error('[lagside] Load error:', err);
      showError('Noe gikk galt', 'Sjekk internettforbindelsen og prøv igjen.');
    }
  }

  // ========================================
  // Attendance
  // ========================================

  var _attendBusy = false;

  function showToast(msg) {
    var existing = document.getElementById('lsToast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'lsToast';
    el.className = 'ls-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  async function submitAttendance(eventId, status) {
    if (_attendBusy) return;
    _attendBusy = true;
    // Disable all attendance buttons immediately
    root.querySelectorAll('.ls-att-btn[data-eid]').forEach(function (b) {
      b.classList.add('disabled');
    });
    try {
      var res = await fetch('/api/team-page-attend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          event_id: eventId,
          player_id: selectedPlayerId,
          status: status,
        }),
      });
      // Always reload regardless of success/failure.
      // On failure (e.g. event completed while page was open), the re-render
      // shows current state. On success, it shows the updated attendance.
      if (!res.ok) {
        try {
          var errData = await res.json();
          showToast(errData.error || 'Kunne ikke registrere oppmoete');
        } catch (_) {
          showToast('Kunne ikke registrere oppmoete');
        }
      }
      await loadData();
    } catch (err) {
      console.error('[lagside] Attendance error:', err);
      showToast('Ingen internettforbindelse. Proev igjen.');
      // Network error — re-enable buttons so user can retry
      _attendBusy = false;
      root.querySelectorAll('.ls-att-btn.disabled').forEach(function (b) {
        b.classList.remove('disabled');
      });
    } finally {
      _attendBusy = false;
    }
  }

  // ========================================
  // Player picker
  // ========================================

  function showPlayerPicker(players, allowClose) {
    // Guard: remove any existing picker overlay first
    var existingOverlay = document.getElementById('lsPickerOverlay');
    if (existingOverlay) existingOverlay.remove();

    var html = '<div class="ls-picker-overlay" id="lsPickerOverlay">' +
      '<div class="ls-picker-sheet">' +
      '<div class="ls-picker-title">Hvem er du forelder til?</div>';

    players.forEach(function (p) {
      var isActive = p.id === selectedPlayerId;
      html += '<button class="ls-picker-item' + (isActive ? ' active' : '') + '" data-pid="' + esc(p.id) + '">' +
        '<div class="ls-player-avatar">' + esc((p.name || '?').charAt(0).toUpperCase()) + '</div>' +
        esc(p.name) +
        '</button>';
    });

    if (allowClose) {
      html += '<button class="ls-picker-item" style="color:var(--ls-text-secondary);margin-top:8px" id="lsPickerClose">' +
        '<i class="fa-solid fa-xmark" style="width:26px;text-align:center"></i> Lukk</button>';
    }

    html += '</div></div>';

    // Append to root (don't replace content)
    var overlay = document.createElement('div');
    overlay.innerHTML = html;
    var el = overlay.firstChild;
    document.body.appendChild(el);

    // Bind clicks
    el.querySelectorAll('.ls-picker-item[data-pid]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedPlayerId = btn.getAttribute('data-pid');
        try { localStorage.setItem(STORAGE_KEY, selectedPlayerId); } catch (_) {}
        el.remove();
        loadData();
      });
    });

    var closeBtn = el.querySelector('#lsPickerClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { el.remove(); });

    // Close on overlay tap (not sheet)
    el.addEventListener('click', function (e) {
      if (e.target === el && allowClose) el.remove();
    });
  }

  // ========================================
  // Error display
  // ========================================

  function showError(title, message) {
    root.innerHTML = '<div class="ls-error">' +
      '<h2>' + esc(title) + '</h2>' +
      '<p>' + esc(message || '') + '</p>' +
      '</div>';
  }

  // ========================================
  // Render
  // ========================================

  function render() {
    if (!pageData) return;
    var d = pageData;
    var html = '';

    // Find selected player name
    var playerName = '';
    if (selectedPlayerId && d.players) {
      var found = d.players.find(function (p) { return p.id === selectedPlayerId; });
      if (found) playerName = found.name;
    }

    // Header
    html += '<div class="ls-header">' +
      '<h1>' + esc(d.team.name) + '</h1>';
    if (d.season) {
      html += '<div class="ls-header-sub">' + esc(d.season.name || '');
      if (d.nff) html += ' &middot; ' + esc(d.nff.age_class);
      html += '</div>';
    }
    if (playerName) {
      html += '<button class="ls-player-pill" id="lsPlayerSwitch">' +
        '<div class="ls-player-avatar">' + esc(playerName.charAt(0).toUpperCase()) + '</div>' +
        esc(playerName) +
        ' <i class="fa-solid fa-chevron-down"></i>' +
        '</button>';
    }
    html += '</div>';

    // Content
    html += '<div class="ls-content">';

    if (!d.season || !d.events || d.events.length === 0) {
      html += '<div class="ls-card"><p style="color:var(--ls-text-secondary);font-size:14px;text-align:center;padding:20px 0">' +
        'Ingen hendelser enda. Treneren har ikke lagt til kamper eller treninger.' +
        '</p></div>';
    } else {
      // Split events
      var upcoming = d.events.filter(isUpcoming);
      var completed = d.events.filter(isCompleted).reverse(); // newest first

      // Hero: next upcoming event
      if (upcoming.length > 0) {
        html += renderHeroEvent(upcoming[0]);
      } else {
        html += '<div class="ls-card" style="text-align:center;padding:20px 14px">' +
          '<div style="font-size:14px;font-weight:600;margin-bottom:4px">Ingen kommende hendelser</div>' +
          '<div style="font-size:13px;color:var(--ls-text-secondary)">Treneren har ikke lagt til nye kamper eller treninger enda.</div>' +
          '</div>';
      }

      // Most recent completed match (with result)
      var lastMatch = completed.find(function (e) {
        return (e.type === 'match' || e.type === 'cup_match') && e.result_home != null;
      });
      if (lastMatch) {
        html += renderResultCard(lastMatch);
      }

      // Most recent completed training
      var lastTraining = completed.find(function (e) { return e.type === 'training'; });
      if (lastTraining) {
        html += renderPreviousTraining(lastTraining);
      }

      // Calendar: upcoming events (skip the hero)
      var calEvents = upcoming.slice(1);
      if (calEvents.length > 0) {
        html += '<div class="ls-section-title">Kommende</div>';
        html += '<div class="ls-card" style="padding:4px 14px">';
        calEvents.forEach(function (e) {
          html += renderCalendarItem(e);
        });
        html += '</div>';
      }

      // Month summary
      if (upcoming.length > 0) {
        var monthGroups = {};
        upcoming.forEach(function (e) {
          var m = new Date(e.start_time).getMonth();
          if (!monthGroups[m]) monthGroups[m] = { training: 0, match: 0 };
          if (e.type === 'training') monthGroups[m].training++;
          else monthGroups[m].match++;
        });

        var months = Object.keys(monthGroups).sort(function (a, b) { return a - b; });
        months.forEach(function (mKey) {
          var mIdx = parseInt(mKey, 10);
          var mg = monthGroups[mKey];
          html += '<div class="ls-section-title">' +
            esc(monthNames[mIdx].charAt(0).toUpperCase() + monthNames[mIdx].slice(1)) +
            '</div>';
          html += '<div class="ls-card">';
          html += '<div class="ls-month-summary">';
          if (mg.training > 0) html += '<span>' + mg.training + ' treninger</span>';
          if (mg.match > 0) html += '<span>' + mg.match + ' kamper</span>';
          html += '</div>';
          html += '</div>';
        });
      }
    }

    // Training schedule (from training_series)
    if (d.training_info && d.training_info.length > 0) {
      html += '<div class="ls-section-title">Faste treninger</div>';
      html += '<div class="ls-card">';
      d.training_info.forEach(function (t) {
        html += '<div style="font-size:13px;padding:4px 0">';
        html += esc(t.day.charAt(0).toUpperCase() + t.day.slice(1));
        if (t.time) html += ' kl ' + esc(t.time);
        if (t.duration) html += ' (' + t.duration + ' min)';
        if (t.location) html += '<br><span style="color:var(--ls-text-secondary);font-size:12px">' + esc(t.location) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // NFF info
    if (d.nff) {
      html += '<div class="ls-nff-info">' +
        'Aldersgruppe ' + esc(d.nff.age_class) + ': ' + d.nff.duration + ' min treninger. ' +
        esc(d.nff.description) +
        '</div>';
    }

    html += '</div>'; // .ls-content

    // Footer
    html += '<div class="ls-footer">' +
      '<a href="https://barnefotballtrener.no">barnefotballtrener.no</a>' +
      '</div>';

    root.innerHTML = html;

    // Bind player switch
    var switchBtn = document.getElementById('lsPlayerSwitch');
    if (switchBtn && d.players) {
      switchBtn.addEventListener('click', function () {
        showPlayerPicker(d.players, true);
      });
    }

    // Bind attendance buttons (hero + expanded calendar items)
    root.querySelectorAll('.ls-att-btn[data-eid]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (btn.classList.contains('disabled')) return;
        var eid = btn.getAttribute('data-eid');
        var status = btn.getAttribute('data-status');
        submitAttendance(eid, status);
      });
    });

    // Bind calendar item tap-to-expand (toggle attendance row)
    root.querySelectorAll('.ls-cal-item[data-cal-eid]').forEach(function (item) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', function () {
        var eid = item.getAttribute('data-cal-eid');
        var expandEl = document.getElementById('lsCalExpand_' + eid);
        if (!expandEl) return;
        // Collapse any other expanded items
        root.querySelectorAll('.ls-cal-expand').forEach(function (el) {
          if (el !== expandEl) el.style.display = 'none';
        });
        // Toggle this one
        expandEl.style.display = expandEl.style.display === 'none' ? '' : 'none';
      });
    });
  }

  // ========================================
  // Render: Hero event card
  // ========================================

  function renderHeroEvent(e) {
    var f = formatDate(e.start_time);
    var isMatch = e.type === 'match' || e.type === 'cup_match';
    var html = '<div class="ls-card">';

    // Badge
    if (isMatch) {
      var isToday = new Date(e.start_time).toDateString() === new Date().toDateString();
      html += '<div class="ls-badge ls-badge-match">' + (isToday ? 'Kamp i dag' : 'Neste kamp') + '</div>';
    } else {
      html += '<div class="ls-badge ls-badge-training">Neste trening</div>';
    }

    // Title
    if (isMatch && e.opponent) {
      html += '<div class="ls-hero-title">' + esc(e.title || (pageData.team.name + ' vs ' + e.opponent)) + '</div>';
    } else if (isMatch) {
      html += '<div class="ls-hero-title">' + esc(e.title || 'Kamp ' + f.day) + '</div>';
    } else {
      html += '<div class="ls-hero-title">' + esc(e.title || 'Trening ' + f.day) + '</div>';
    }

    // Meta
    html += '<div class="ls-hero-meta">';
    html += esc(f.day.charAt(0).toUpperCase() + f.day.slice(1)) + ' ' + f.num + '. ' +
      esc(monthNames[f.month]) + ' kl ' + f.time;
    if (e.location) html += '<br>' + esc(e.location);
    if (isMatch && e.is_home != null) html += ' (' + (e.is_home ? 'hjemme' : 'borte') + ')';
    if (e.duration_minutes) html += '<br>' + e.duration_minutes + ' min';
    html += '</div>';

    // Attendance buttons
    if (selectedPlayerId) {
      var myStatus = e.attendance ? e.attendance.my_status : null;
      html += '<div class="ls-att-row">';
      html += '<button class="ls-att-btn' + (myStatus === 'yes' ? ' selected-yes' : '') + '" data-eid="' + esc(e.id) + '" data-status="yes">Kommer</button>';
      html += '<button class="ls-att-btn' + (myStatus === 'no' ? ' selected-no' : '') + '" data-eid="' + esc(e.id) + '" data-status="no">Kan ikke</button>';
      html += '<button class="ls-att-btn' + (myStatus === 'maybe' ? ' selected-maybe' : '') + '" data-eid="' + esc(e.id) + '" data-status="maybe">Usikker</button>';
      html += '</div>';
    }

    // Attendance count
    if (e.attendance) {
      var att = e.attendance;
      var parts = [];
      if (att.confirmed > 0) parts.push(att.confirmed + ' bekreftet');
      if (att.maybe > 0) parts.push(att.maybe + ' usikker');
      if (att.declined > 0) parts.push(att.declined + ' kan ikke');
      if (att.not_responded > 0) parts.push(att.not_responded + ' ikke svart');
      if (parts.length > 0) {
        html += '<div class="ls-att-count">' + parts.join(' &middot; ') + '</div>';
      }
    }

    html += '</div>';

    // Coach message
    if (e.parent_message) {
      html += '<div class="ls-card"><div class="ls-message">' +
        '<i class="fa-solid fa-bullhorn"></i>' + esc(e.parent_message) +
        '</div></div>';
    }

    // Workout info (if shared)
    if (e.workout) {
      html += renderWorkoutCard(e.workout);
    }

    return html;
  }

  // ========================================
  // Render: Result card
  // ========================================

  function renderResultCard(e) {
    var f = formatDate(e.start_time);
    var html = '<div class="ls-card ls-result">';
    html += '<div class="ls-result-label">Forrige kamp ' + f.num + '. ' + esc(monthNames[f.month]) + '</div>';
    html += '<div class="ls-result-score">' + (e.result_home != null ? e.result_home : '?') +
      ' - ' + (e.result_away != null ? e.result_away : '?') + '</div>';

    var teamName = pageData.team.name || '';
    var opponent = e.opponent || '';
    if (opponent) {
      html += '<div class="ls-result-teams">' + esc(teamName) + ' vs ' + esc(opponent);
    } else {
      html += '<div class="ls-result-teams">' + esc(teamName);
    }
    if (e.is_home != null) html += ' (' + (e.is_home ? 'hjemme' : 'borte') + ')';
    html += '</div>';

    // Fairness (opt-in by coach, no minutes shown)
    if (e.fairness) {
      html += '<div class="ls-result-fairness">' +
        e.fairness.playersParticipated + ' spillere deltok' +
        '</div>';
    }

    // Coach comment
    if (e.share_comment) {
      html += '<div style="margin-top:10px;font-size:13px;color:var(--ls-text-secondary);text-align:left">' +
        esc(e.share_comment) + '</div>';
    }

    html += '</div>';
    return html;
  }

  // ========================================
  // Render: Previous training (compact)
  // ========================================

  function renderPreviousTraining(e) {
    var f = formatDate(e.start_time);
    var html = '<div class="ls-card">';
    html += '<div class="ls-prev-label">Forrige trening ' + f.num + '. ' + esc(monthNames[f.month]) + '</div>';
    html += '<div class="ls-prev-title">' + esc(e.title || 'Trening') + '</div>';

    var meta = [];
    if (e.attendance && e.attendance.confirmed > 0) {
      var total = (pageData.players || []).length;
      meta.push(e.attendance.confirmed + ' av ' + total + ' til stede');
    }
    if (e.duration_minutes) meta.push(e.duration_minutes + ' min');
    if (meta.length > 0) {
      html += '<div class="ls-prev-meta">' + meta.join(' &middot; ') + '</div>';
    }

    html += '</div>';

    // Workout info for previous training (if shared)
    if (e.workout) {
      html += renderWorkoutCard(e.workout);
    }

    return html;
  }

  // ========================================
  // Render: Workout card
  // ========================================

  function renderWorkoutCard(w) {
    var html = '<div class="ls-card">';
    html += '<div class="ls-workout-title">';
    if (w.theme) {
      html += esc(w.theme);
    } else {
      html += 'Treningsinnhold';
    }
    html += '</div>';

    if (w.blocks && w.blocks.length > 0) {
      html += '<div class="ls-workout-list">';
      w.blocks.forEach(function (b) {
        html += '<div class="ls-workout-item">' +
          '<div class="ls-workout-cat" style="background:' + nffCategoryColor(b.nffCategory) + '"></div>' +
          esc(b.exerciseName) +
          (b.minutes > 0 ? '<div class="ls-workout-min">' + b.minutes + ' min</div>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    if (w.learningGoals && w.learningGoals.length > 0) {
      html += '<div class="ls-workout-goals">Laeringsmal: ' +
        w.learningGoals.map(esc).join('. ') + '</div>';
    }

    html += '</div>';
    return html;
  }

  // ========================================
  // Render: Calendar item
  // ========================================

  function renderCalendarItem(e) {
    var f = formatDate(e.start_time);
    var isMatch = e.type === 'match' || e.type === 'cup_match';

    var html = '<div class="ls-cal-item" data-cal-eid="' + esc(e.id) + '">';

    // Date
    html += '<div class="ls-cal-date">' +
      '<div class="ls-cal-day">' + esc(f.dayShort) + '</div>' +
      '<div class="ls-cal-num">' + f.num + '</div>' +
      '</div>';

    // Dot
    html += '<div class="ls-cal-dot ' + (isMatch ? 'ls-cal-dot-match' : 'ls-cal-dot-training') + '"></div>';

    // Info
    html += '<div class="ls-cal-info">';
    if (isMatch && e.opponent) {
      html += '<div class="ls-cal-info-title">vs ' + esc(e.opponent) + '</div>';
    } else if (isMatch) {
      html += '<div class="ls-cal-info-title">' + esc(e.title || 'Kamp') + '</div>';
    } else {
      html += '<div class="ls-cal-info-title">' + esc(e.title || 'Trening') + '</div>';
    }
    var sub = f.time;
    if (e.location) sub += ' &middot; ' + esc(e.location);
    html += '<div class="ls-cal-info-sub">' + sub + '</div>';
    html += '</div>';

    // My attendance status
    if (e.attendance && e.attendance.my_status) {
      var st = e.attendance.my_status;
      var cls = st === 'yes' ? 'ls-cal-att-yes' : (st === 'no' ? 'ls-cal-att-no' : 'ls-cal-att-none');
      var label = st === 'yes' ? 'Kommer' : (st === 'no' ? 'Kan ikke' : 'Usikker');
      html += '<div class="ls-cal-att ' + cls + '">' + label + '</div>';
    } else {
      html += '<div class="ls-cal-att ls-cal-att-none">-</div>';
    }

    html += '</div>';

    // Expandable attendance row (hidden by default)
    if (selectedPlayerId) {
      var myStatus = e.attendance ? e.attendance.my_status : null;
      html += '<div class="ls-cal-expand" id="lsCalExpand_' + esc(e.id) + '" style="display:none">';
      html += '<div class="ls-att-row" style="margin:0">';
      html += '<button class="ls-att-btn' + (myStatus === 'yes' ? ' selected-yes' : '') + '" data-eid="' + esc(e.id) + '" data-status="yes">Kommer</button>';
      html += '<button class="ls-att-btn' + (myStatus === 'no' ? ' selected-no' : '') + '" data-eid="' + esc(e.id) + '" data-status="no">Kan ikke</button>';
      html += '<button class="ls-att-btn' + (myStatus === 'maybe' ? ' selected-maybe' : '') + '" data-eid="' + esc(e.id) + '" data-status="maybe">Usikker</button>';
      html += '</div></div>';
    }

    return html;
  }

  // ========================================
  // Boot
  // ========================================

  loadData();
})();
