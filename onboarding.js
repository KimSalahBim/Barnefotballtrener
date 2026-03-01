// © 2026 Barnefotballtrener.no. All rights reserved.
// onboarding.js — First-time user onboarding wizard (v5)
// ================================================
// 3-step wizard: (1) Team + age class (2) Bulk add players (3) Demo substitution plan
// Triggered from core.js after loadPlayersFromSupabase via window.__BF_checkOnboarding().
// Saves via window.__BF_onboarding bridge API exposed by core.js.

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  //  NFF age rules (self-contained subset)
  // ══════════════════════════════════════════════════════════════
  var NFF_RULES = {
    6:  { format: 3,  minutes: 20, label: '3er, 2\u00d710 min' },
    7:  { format: 3,  minutes: 20, label: '3er, 2\u00d710 min' },
    8:  { format: 5,  minutes: 30, label: '5er, 2\u00d715 min' },
    9:  { format: 5,  minutes: 40, label: '5er, 2\u00d720 min' },
    10: { format: 5,  minutes: 40, label: '5er, 2\u00d720 min' },
    11: { format: 7,  minutes: 50, label: '7er, 2\u00d725 min' },
    12: { format: 9,  minutes: 60, label: '9er, 2\u00d730 min' },
    13: { format: 11, minutes: 60, label: '11er, 2\u00d730 min' }
  };

  var AGE_OPTIONS = [
    'G6','G7','G8','G9','G10','G11','G12','G13',
    'J6','J7','J8','J9','J10','J11','J12','J13'
  ];

  // Example names for the "skip player input" path
  var EXAMPLE_NAMES = [
    'Emma', 'Ola', 'Sofia', 'Liam', 'Nora',
    'Jakob', 'Ingrid', 'Lucas', 'Hedda', 'Oscar',
    'Maja', 'Aksel', 'Thea', 'Noah'
  ];

  // ══════════════════════════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════════════════════════
  function $(id) { return document.getElementById(id); }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function safeLS(action, key, val) {
    try {
      if (action === 'get') return localStorage.getItem(key);
      if (action === 'set') localStorage.setItem(key, val);
    } catch (_) { return null; }
  }

  function parseAge(cls) {
    if (!cls) return null;
    var n = parseInt(String(cls).replace(/[^0-9]/g, ''));
    return (n >= 6 && n <= 13) ? n : null;
  }

  function getRule(cls) {
    var age = parseAge(cls);
    return (age && NFF_RULES[age]) ? NFF_RULES[age] : null;
  }

  function detectAgeClass(name) {
    if (!name) return '';
    var match = name.match(/\b([GJgj]\d{1,2})\b/);
    if (!match) return '';
    var cls = match[1].toUpperCase();
    return AGE_OPTIONS.indexOf(cls) !== -1 ? cls : '';
  }

  // ══════════════════════════════════════════════════════════════
  //  Analytics: lightweight funnel tracking
  // ══════════════════════════════════════════════════════════════
  var _events = [];

  function trackEvent(action, extra) {
    var evt = { a: action, t: Date.now() };
    if (extra) evt.d = extra;
    _events.push(evt);
  }

  function flushEvents() {
    if (_events.length === 0) return;
    try {
      if (window._bftCloud && window._bftCloud.save) {
        window._bftCloud.save('onboarding_events', JSON.stringify(_events));
      }
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════
  //  Name parser (Spond, Excel, numbered lists, bullets)
  // ══════════════════════════════════════════════════════════════
  function parseNames(text) {
    if (!text || !text.trim()) return [];
    var raw = String(text).split(/[\n\r,;\t]+/);
    var names = [];
    var seen = {};
    for (var i = 0; i < raw.length; i++) {
      var n = raw[i].trim();
      n = n.replace(/^\d+[.\)\-\s]+/, '').trim();
      n = n.replace(/^[\-\*\u2022\u2013\u2014]\s*/, '').trim();
      if (!n || n.length < 2 || n.length > 50) continue;
      // Skip junk from multi-column paste (Spond, Excel)
      if (n.indexOf('@') !== -1) continue;          // email
      if (/^\+?\d[\d\s\-]{6,}$/.test(n)) continue;  // phone number
      if (/^https?:\/\//.test(n)) continue;           // URL
      if (/^\d{4}[\-\/]\d{2}/.test(n)) continue;     // date (2024-01-15)
      var key = n.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      names.push(n);
    }
    return names;
  }

  // ══════════════════════════════════════════════════════════════
  //  Demo substitution plan (greedy rotation with seeded shuffle)
  // ══════════════════════════════════════════════════════════════
  function seededShuffle(arr, seed) {
    var out = arr.slice();
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
    for (var j = out.length - 1; j > 0; j--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      var k = s % (j + 1);
      var tmp = out[j]; out[j] = out[k]; out[k] = tmp;
    }
    return out;
  }

  function generateDemoPlan(playerNames, ageClass, teamName) {
    var rule = getRule(ageClass);
    var format = rule ? rule.format : 7;
    var totalMinutes = rule ? rule.minutes : 50;
    var N = playerNames.length;
    var P = Math.min(format, N);
    if (P < 1) return null;

    var benchSize = N - P;
    var numPeriods;
    if (benchSize === 0) numPeriods = 2;
    else if (benchSize <= 2) numPeriods = 3;
    else numPeriods = Math.min(4, Math.max(3, Math.ceil(N / P)));
    var periodLen = Math.round(totalMinutes / numPeriods);

    var shuffled = seededShuffle(
      Array.from({ length: N }, function (_, i) { return i; }),
      teamName || 'lag'
    );
    var minutesPlayed = new Array(N);
    for (var i = 0; i < N; i++) minutesPlayed[i] = 0;
    for (var si = 0; si < shuffled.length; si++) {
      minutesPlayed[shuffled[si]] = si * 0.001;
    }

    var keeperOrder = seededShuffle(
      Array.from({ length: N }, function (_, i) { return i; }),
      (teamName || '') + '_k'
    );
    var keeperCursor = 0;

    var periods = [];
    for (var p = 0; p < numPeriods; p++) {
      var indices = [];
      for (var j = 0; j < N; j++) indices.push(j);
      indices.sort(function (a, b) {
        return minutesPlayed[a] !== minutesPlayed[b]
          ? minutesPlayed[a] - minutesPlayed[b]
          : a - b;
      });

      var onField = indices.slice(0, P);
      var bench = indices.slice(P);

      for (var k = 0; k < onField.length; k++) {
        minutesPlayed[onField[k]] += periodLen;
      }

      var keeperIdx = -1; // -1 = no keeper (3er format has none)
      if (format > 3) {
        for (var kc = 0; kc < N; kc++) {
          var candidate = keeperOrder[(keeperCursor + kc) % N];
          if (onField.indexOf(candidate) !== -1) {
            keeperIdx = candidate;
            keeperCursor = (keeperCursor + kc + 1) % N;
            break;
          }
        }
      }

      var prevBenchSet = {};
      if (p > 0) {
        var prev = periods[p - 1].benchIndices;
        for (var b = 0; b < prev.length; b++) prevBenchSet[prev[b]] = true;
      }

      periods.push({
        start: p * periodLen,
        end: Math.min((p + 1) * periodLen, totalMinutes),
        onFieldIndices: onField,
        benchIndices: bench,
        keeperIdx: keeperIdx,
        prevBenchSet: prevBenchSet
      });
    }

    var intMinutes = minutesPlayed.map(function (m) { return Math.round(m); });
    var minVal = Math.min.apply(null, intMinutes);
    var maxVal = Math.max.apply(null, intMinutes);

    return {
      periods: periods,
      minutesPlayed: intMinutes,
      totalMinutes: totalMinutes,
      format: format,
      hasBench: benchSize > 0,
      fairnessDiff: maxVal - minVal,
      minMinutes: minVal,
      maxMinutes: maxVal,
      label: rule ? rule.label : format + 'er'
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  Confetti burst (canvas)
  // ══════════════════════════════════════════════════════════════
  function fireConfetti(originX, originY) {
    // Respect prefers-reduced-motion
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch (_) {}

    var canvas = document.createElement('canvas');
    canvas.className = 'ob-confetti';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var cx = typeof originX === 'number' ? originX : canvas.width * 0.5;
    var cy = typeof originY === 'number' ? originY : canvas.height * 0.6;

    var colors = ['#2563eb', '#059669', '#d97706', '#ec4899', '#8b5cf6', '#f59e0b'];
    var particles = [];
    for (var i = 0; i < 80; i++) {
      particles.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 16 - 3,
        size: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        opacity: 1
      });
    }

    var startTime = performance.now();
    var duration = 1400;

    function frame(now) {
      var elapsed = now - startTime;
      if (elapsed > duration) { canvas.remove(); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var progress = elapsed / duration;

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.vy += 0.35;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.opacity = Math.max(0, 1 - progress * 1.2);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ══════════════════════════════════════════════════════════════
  //  Wizard state
  // ══════════════════════════════════════════════════════════════
  var step = 1;
  var data = {
    teamName: '',
    ageClass: '',
    playerNames: [],
    rawPlayerText: '',
    usedExamples: false   // true when user chose "vis demo med eksempler"
  };
  var overlayEl = null;
  var busy = false;

  // ══════════════════════════════════════════════════════════════
  //  Public API
  // ══════════════════════════════════════════════════════════════

  // Main trigger (called by core.js after player load)
  window.__BF_checkOnboarding = function () {
    if (safeLS('get', 'bf_onboarding_done') === '1') return;

    // If user already has players, silently mark complete
    var players = window.players || [];
    if (players.length > 0) {
      markDone();
      return;
    }

    // Check skip counter: stop nagging after 3 dismissals
    var skips = parseInt(safeLS('get', 'bf_onboarding_skips') || '0', 10);
    if (skips >= 3) {
      markDone();
      return;
    }

    setTimeout(openWizard, 400);
  };

  // Re-entry: can be called from settings or help UI
  window.__BF_resetOnboarding = function () {
    safeLS('set', 'bf_onboarding_done', '0');
    safeLS('set', 'bf_onboarding_skips', '0');
  };

  // Wire up the re-run button in subscription modal (if it exists)
  function wireRerunButton() {
    var btn = document.getElementById('rerunOnboardingBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        window.__BF_resetOnboarding();
        // Close subscription modal
        var modal = document.getElementById('subscriptionModal');
        if (modal) modal.classList.add('hidden');
        // Open wizard immediately
        setTimeout(openWizard, 200);
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireRerunButton);
  } else {
    wireRerunButton();
  }

  function markDone() {
    safeLS('set', 'bf_onboarding_done', '1');
  }

  // ══════════════════════════════════════════════════════════════
  //  Open / Close
  // ══════════════════════════════════════════════════════════════
  function openWizard() {
    if (overlayEl) return;
    step = 1;
    var existingPlayers = (window.players && window.players.length > 0);
    data = {
      teamName: '',
      ageClass: '',
      playerNames: [],
      rawPlayerText: '',
      usedExamples: false,
      isRerun: existingPlayers  // true = team already has players, protect existing data
    };
    busy = false;
    _events = [];

    overlayEl = document.createElement('div');
    overlayEl.id = 'obOverlay';
    overlayEl.className = 'ob-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-labelledby', 'obTitle');
    document.body.appendChild(overlayEl);
    document.body.classList.add('ob-open');
    document.addEventListener('keydown', onEscKey);

    // Backdrop click = soft close (dismiss, don't mark done)
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) softClose();
    });

    // iOS: prevent body scroll-through behind modal
    // overflow:hidden on body is unreliable on iOS Safari
    overlayEl.addEventListener('touchmove', function (e) {
      // Allow scroll inside the card, block on backdrop
      var card = overlayEl.querySelector('.ob-card');
      if (card && card.contains(e.target)) return;
      e.preventDefault();
    }, { passive: false });

    trackEvent('opened');
    renderStep();

    // Focus trap: keep Tab cycling inside the dialog
    overlayEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var card = overlayEl.querySelector('.ob-card');
      if (!card) return;
      var focusable = card.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !card.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !card.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  function onEscKey(e) {
    if (e.key === 'Escape') softClose();
  }

  // Soft close: dismiss without marking done (user can come back)
  function softClose() {
    if (busy) return; // Don't dismiss while save is in progress
    trackEvent('skipped', { step: step });
    flushEvents();

    // Increment skip counter
    var skips = parseInt(safeLS('get', 'bf_onboarding_skips') || '0', 10);
    skips++;
    safeLS('set', 'bf_onboarding_skips', String(skips));

    // After 3 skips, mark done permanently
    if (skips >= 3) markDone();

    teardown();
  }

  // Hard close: wizard completed successfully
  function completeClose(callback) {
    trackEvent('completed', {
      players: data.playerNames.length,
      examples: data.usedExamples,
      ageClass: data.ageClass
    });
    flushEvents();

    markDone();

    // Cloud sync completion
    try {
      if (window._bftCloud && window._bftCloud.save) {
        window._bftCloud.save('onboarding', JSON.stringify({
          completed: true,
          ageClass: data.ageClass || null,
          usedExamples: data.usedExamples,
          ts: new Date().toISOString()
        }));
      }
    } catch (_) {}

    teardown(callback);
  }

  // Shared teardown: animate out and clean up DOM
  function teardown(callback) {
    if (!overlayEl) return;
    document.removeEventListener('keydown', onEscKey);

    overlayEl.classList.add('ob-closing');
    setTimeout(function () {
      if (overlayEl && overlayEl.parentNode) {
        overlayEl.parentNode.removeChild(overlayEl);
      }
      overlayEl = null;
      document.body.classList.remove('ob-open');
      if (typeof callback === 'function') setTimeout(callback, 60);
    }, 260);
  }

  // ══════════════════════════════════════════════════════════════
  //  Shared UI helpers
  // ══════════════════════════════════════════════════════════════
  function progressHTML(active) {
    var dots = '';
    for (var i = 1; i <= 3; i++) {
      var cls = i < active ? 'ob-dot done' : i === active ? 'ob-dot active' : 'ob-dot';
      dots += '<div class="' + cls + '"></div>';
    }
    return '<div class="ob-progress">' + dots +
      '<span class="ob-step-count">Steg ' + active + ' av 3</span></div>';
  }

  // ══════════════════════════════════════════════════════════════
  //  Step router
  // ══════════════════════════════════════════════════════════════
  function renderStep() {
    if (!overlayEl) return;
    if (step === 1) renderStep1();
    else if (step === 2) renderStep2();
    else if (step === 3) renderStep3();

    var card = overlayEl.querySelector('.ob-card');
    if (card) card.scrollTop = 0;
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 1: Team name + age class (both required)
  // ══════════════════════════════════════════════════════════════
  function renderStep1() {
    var gutterOpts = AGE_OPTIONS.slice(0, 8).map(function (c) {
      return '<option value="' + c + '"' + (data.ageClass === c ? ' selected' : '') + '>' + c + '</option>';
    }).join('');
    var jenteOpts = AGE_OPTIONS.slice(8).map(function (c) {
      return '<option value="' + c + '"' + (data.ageClass === c ? ' selected' : '') + '>' + c + '</option>';
    }).join('');

    // Re-run: pre-fill team name from current team, show as context
    var currentTeamName = '';
    if (data.isRerun) {
      try {
        var bridge = window.__BF_onboarding;
        if (bridge && bridge.getCurrentTeamName) currentTeamName = bridge.getCurrentTeamName();
      } catch (_) {}
    }

    var titleText = data.isRerun ? 'Oppdater aldersklasse' : 'Velkommen!';
    var subtitleText = data.isRerun
      ? 'Velg riktig aldersklasse for ' + esc(currentTeamName || 'laget ditt') + ', s\u00e5 justerer vi kampdag-innstillingene.'
      : 'Fortell oss litt om laget ditt, s\u00e5 setter vi opp alt for deg.';

    var teamNameField = data.isRerun
      ? '' // Skip team name on re-run
      : '<div class="ob-field">' +
          '<label class="ob-label" for="obTeamName">Hva heter laget?</label>' +
          '<input type="text" id="obTeamName" class="ob-input" placeholder="F.eks. Steinkjer G10" maxlength="40" value="' + esc(data.teamName) + '" autocomplete="off">' +
        '</div>';

    overlayEl.innerHTML =
      '<div class="ob-card">' +
        progressHTML(1) +
        '<div class="ob-header">' +
          '<div class="ob-emoji">\u26BD</div>' +
          '<h2 class="ob-title" id="obTitle">' + titleText + '</h2>' +
          '<p class="ob-subtitle">' + subtitleText + '</p>' +
        '</div>' +
        '<div class="ob-body"><div class="ob-step-inner">' +
          teamNameField +
          '<div class="ob-field">' +
            '<label class="ob-label" for="obAgeClass">Aldersklasse</label>' +
            '<select id="obAgeClass" class="ob-select">' +
              '<option value="">Velg aldersklasse</option>' +
              '<optgroup label="Gutter">' + gutterOpts + '</optgroup>' +
              '<optgroup label="Jenter">' + jenteOpts + '</optgroup>' +
            '</select>' +
            '<div id="obFormatHint" class="ob-format-hint"></div>' +
          '</div>' +
        '</div></div>' +
        '<div class="ob-footer">' +
          '<button type="button" class="ob-btn ob-btn-skip" id="obSkip">Ikke n\u00e5</button>' +
          '<button type="button" class="ob-btn ob-btn-primary" id="obNext">Neste \u2192</button>' +
        '</div>' +
      '</div>';

    var nameInput = $('obTeamName');
    var select = $('obAgeClass');
    var hint = $('obFormatHint');

    setTimeout(function () {
      if (nameInput) nameInput.focus();
      else if (select) select.focus();
    }, 180);

    function updateHint() {
      var rule = getRule(select ? select.value : '');
      if (rule && hint) {
        hint.textContent = '\u2192 ' + rule.label;
        hint.classList.add('visible');
      } else if (hint) {
        hint.classList.remove('visible');
      }
    }
    if (select) {
      select.addEventListener('change', function () {
        select._userChanged = true;
        select.classList.remove('ob-error');
        updateHint();
      });
      updateHint();
    }

    // Auto-detect age class from team name
    if (nameInput) {
      nameInput.addEventListener('input', function () {
        nameInput.classList.remove('ob-error');
        if (select && !select._userChanged) {
          var detected = detectAgeClass(nameInput.value);
          if (detected && select.value !== detected) {
            select.value = detected;
            select.classList.remove('ob-error');
            updateHint();
          }
        }
      });
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('obNext').click(); }
      });
    }

    // "Ikke nå" = soft close (wizard will return next login)
    $('obSkip').addEventListener('click', function () { softClose(); });

    // Next: validate fields
    $('obNext').addEventListener('click', function () {
      var name = (nameInput ? nameInput.value : '').trim();
      var age = select ? select.value : '';
      var valid = true;

      if (!data.isRerun && !name) {
        if (nameInput) nameInput.classList.add('ob-error');
        if (valid && nameInput) nameInput.focus();
        valid = false;
      }
      if (!age) {
        select.classList.add('ob-error');
        if (valid) select.focus();
        valid = false;
      }
      if (!valid) return;

      data.teamName = name;
      data.ageClass = age;
      trackEvent('step1', { ageClass: age, isRerun: !!data.isRerun });
      step = data.isRerun ? 3 : 2; // Skip player entry on re-run
      renderStep();
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 2: Bulk add players (with example path)
  // ══════════════════════════════════════════════════════════════
  function renderStep2() {
    var textareaVal = data.rawPlayerText
      || (data.playerNames.length > 0 && !data.usedExamples ? data.playerNames.join('\n') : '');

    overlayEl.innerHTML =
      '<div class="ob-card">' +
        progressHTML(2) +
        '<div class="ob-header">' +
          '<div class="ob-emoji">\uD83D\uDCCB</div>' +
          '<h2 class="ob-title" id="obTitle">Legg til spillere</h2>' +
          '<p class="ob-subtitle">Skriv ett fornavn per linje. Vi anbefaler kun fornavn for barnas personvern.</p>' +
        '</div>' +
        '<div class="ob-body"><div class="ob-step-inner">' +
          '<div class="ob-field">' +
            '<label class="ob-label">' + esc(data.teamName) + ' (' + esc(data.ageClass) + ')</label>' +
            '<textarea id="obPlayers" class="ob-textarea" placeholder="Emma\nOla\nSofia\nLiam\nNora\nJakob\nIngrid\nLucas\nHedda\nOscar">' + esc(textareaVal) + '</textarea>' +
            '<div id="obPlayerCount" class="ob-player-count"></div>' +
            '<div class="ob-hint">Tips: Du kan lime inn fra Spond, Excel eller notater</div>' +
            '<div class="ob-hint ob-hint-desktop">Hurtigtast: ' +
              (navigator.platform && /Mac/.test(navigator.platform) ? '\u2318' : 'Ctrl') +
              '+Enter for \u00e5 g\u00e5 videre</div>' +
          '</div>' +
          '<div class="ob-example-link">' +
            '<button type="button" class="ob-btn-link" id="obUseExamples">Har ikke lista klar? Vis demo med eksempelspillere \u2192</button>' +
          '</div>' +
        '</div></div>' +
        '<div class="ob-footer">' +
          '<button type="button" class="ob-btn ob-btn-back" id="obBack">\u2190 Tilbake</button>' +
          '<button type="button" class="ob-btn ob-btn-primary" id="obNext">Se bytteplan \u2192</button>' +
        '</div>' +
      '</div>';

    var textarea = $('obPlayers');
    var countEl = $('obPlayerCount');
    var nextBtn = $('obNext');

    function updateCount() {
      if (!textarea || !countEl) return;
      var names = parseNames(textarea.value);
      var count = names.length;
      countEl.classList.remove('ob-count-error');
      textarea.classList.remove('ob-error');
      if (count === 0) {
        countEl.innerHTML = '';
      } else {
        countEl.innerHTML = '<strong>' + count + '</strong> spiller' + (count === 1 ? '' : 'e') + ' funnet';
      }
      if (nextBtn) {
        nextBtn.textContent = count > 0 ? 'Se bytteplan (' + count + ') \u2192' : 'Se bytteplan \u2192';
      }
    }

    if (textarea) {
      textarea.addEventListener('input', updateCount);
      updateCount();
      setTimeout(function () {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      }, 180);
      textarea.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          nextBtn.click();
        }
      });
    }

    // "Vis demo med eksempler" button
    $('obUseExamples').addEventListener('click', function () {
      data.usedExamples = true;
      data.rawPlayerText = '';
      // Pick correct number of example names for the format
      var rule = getRule(data.ageClass);
      var count = rule ? Math.min(rule.format + 3, EXAMPLE_NAMES.length) : EXAMPLE_NAMES.length;
      data.playerNames = EXAMPLE_NAMES.slice(0, count);
      trackEvent('step2_examples', { count: count });
      step = 3;
      renderStep();
    });

    $('obBack').addEventListener('click', function () {
      if (textarea) data.rawPlayerText = textarea.value;
      step = 1;
      renderStep();
    });

    nextBtn.addEventListener('click', function () {
      var raw = textarea ? textarea.value : '';
      var names = parseNames(raw);
      if (names.length < 3) {
        if (textarea) textarea.classList.add('ob-error');
        if (countEl) {
          countEl.innerHTML = 'Legg til minst 3 spillere for \u00e5 se bytteplan';
          countEl.classList.add('ob-count-error');
        }
        if (textarea) textarea.focus();
        return;
      }
      if (names.length > 30) {
        if (countEl) {
          countEl.innerHTML = 'Maks 30 spillere om gangen';
          countEl.classList.add('ob-count-error');
        }
        return;
      }
      data.usedExamples = false;
      data.rawPlayerText = raw;
      data.playerNames = names;
      trackEvent('step2', { count: names.length });
      step = 3;
      renderStep();
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 3: Demo substitution plan (the WOW moment)
  // ══════════════════════════════════════════════════════════════
  function renderStep3() {
    // Re-run: use existing player names for demo
    var demoNames = data.playerNames;
    if (data.isRerun && demoNames.length === 0) {
      var existing = window.players || [];
      demoNames = existing.map(function (p) { return p.name; });
      if (demoNames.length === 0) {
        demoNames = EXAMPLE_NAMES.slice(0, getRule(data.ageClass) ? getRule(data.ageClass).format + 3 : 10);
      }
    }

    var plan = generateDemoPlan(demoNames, data.ageClass, data.teamName || 'lag');
    if (!plan) { step = 2; renderStep(); return; }

    var names = demoNames;

    // Build period cards
    var periodsHtml = '';
    for (var pi = 0; pi < plan.periods.length; pi++) {
      var per = plan.periods[pi];

      var fieldChips = '';
      for (var fi = 0; fi < per.onFieldIndices.length; fi++) {
        var idx = per.onFieldIndices[fi];
        var name = names[idx];
        var delay = 'style="animation-delay:' + (fi * 30) + 'ms"';
        if (idx === per.keeperIdx) {
          fieldChips += '<span class="ob-chip ob-chip-keeper" ' + delay + '>\uD83E\uDDE4 ' + esc(name) + '</span>';
        } else if (pi > 0 && per.prevBenchSet[idx]) {
          fieldChips += '<span class="ob-chip ob-chip-swapin" ' + delay + '>\u2191 ' + esc(name) + '</span>';
        } else {
          fieldChips += '<span class="ob-chip ob-chip-field" ' + delay + '>' + esc(name) + '</span>';
        }
      }

      var benchHtml = '';
      if (per.benchIndices.length > 0) {
        var benchChips = '';
        for (var bi = 0; bi < per.benchIndices.length; bi++) {
          benchChips += '<span class="ob-chip ob-chip-bench">' + esc(names[per.benchIndices[bi]]) + '</span>';
        }
        benchHtml = '<div class="ob-bench-label">Benk:</div><div class="ob-chips">' + benchChips + '</div>';
      }

      periodsHtml +=
        '<div class="ob-period">' +
          '<div class="ob-period-label">Minutt ' + per.start + '\u2013' + per.end +
            (per.benchIndices.length > 0 ? ' \u00B7 ' + per.onFieldIndices.length + ' p\u00e5 banen' : '') +
          '</div>' +
          '<div class="ob-chips">' + fieldChips + '</div>' +
          benchHtml +
        '</div>';
    }

    // Minutes bars
    var maxMin = 0;
    for (var m = 0; m < plan.minutesPlayed.length; m++) {
      if (plan.minutesPlayed[m] > maxMin) maxMin = plan.minutesPlayed[m];
    }
    var sorted = names.map(function (name, i) {
      return { name: name, minutes: plan.minutesPlayed[i] };
    }).sort(function (a, b) { return b.minutes - a.minutes; });

    var barsHtml = '';
    for (var si = 0; si < sorted.length; si++) {
      var pct = maxMin > 0 ? Math.round((sorted[si].minutes / maxMin) * 100) : 0;
      barsHtml +=
        '<div class="ob-bar-row">' +
          '<div class="ob-bar-name">' + esc(sorted[si].name) + '</div>' +
          '<div class="ob-bar-track"><div class="ob-bar-fill" data-pct="' + pct + '"></div></div>' +
          '<div class="ob-bar-val">' + sorted[si].minutes + ' min</div>' +
        '</div>';
    }

    // Legend
    var legendHtml = '';
    if (plan.hasBench) {
      var keeperLegend = plan.format > 3
        ? '<div class="ob-legend-item"><span class="ob-legend-dot lg-keeper"></span>Keeper</div>'
        : '';
      legendHtml =
        '<div class="ob-legend">' +
          '<div class="ob-legend-item"><span class="ob-legend-dot lg-field"></span>P\u00e5 banen</div>' +
          '<div class="ob-legend-item"><span class="ob-legend-dot lg-swapin"></span>Byttet inn</div>' +
          keeperLegend +
          '<div class="ob-legend-item"><span class="ob-legend-dot lg-bench"></span>Benk</div>' +
        '</div>';
    }

    // Fairness footer
    var fairnessText;
    if (plan.fairnessDiff === 0) {
      fairnessText = '\u2705 Perfekt! Alle f\u00e5r ' + plan.minMinutes + ' min spilletid';
    } else {
      fairnessText = '\u2705 Jevn spilletid: ' + plan.minMinutes + '\u2013' + plan.maxMinutes + ' min per spiller';
    }

    // Example players notice
    var exampleNotice = '';
    if (data.usedExamples) {
      exampleNotice =
        '<div class="ob-example-notice">' +
          '\uD83D\uDCA1 Dette er eksempelspillere. Legg til dine egne spillere i appen etterpå.' +
        '</div>';
    }

    // Subtitle
    var subtitleText = 'Automatisk bytteplan for ' + esc(data.teamName) + ' (' + plan.label + ')';

    // Button text changes if using examples
    var finishLabel = data.usedExamples
      ? '\uD83D\uDE80 Sett opp laget'
      : '\uD83D\uDE80 Start appen';

    overlayEl.innerHTML =
      '<div class="ob-card">' +
        progressHTML(3) +
        '<div class="ob-header">' +
          '<div class="ob-emoji">\u2728</div>' +
          '<h2 class="ob-title" id="obTitle">Slik fungerer det!</h2>' +
          '<p class="ob-subtitle">' + subtitleText + '</p>' +
        '</div>' +
        '<div class="ob-body ob-body-step3"><div class="ob-step-inner">' +
          exampleNotice +
          '<div class="ob-demo-wrap">' +
            '<div class="ob-demo-header">\u26BD Bytteplan \u00B7 ' + plan.format + 'er \u00B7 ' + plan.totalMinutes + ' min</div>' +
            periodsHtml +
            '<div class="ob-demo-footer">' + fairnessText + '</div>' +
          '</div>' +
          legendHtml +
          '<div class="ob-bars-section">' +
            '<div class="ob-label" style="margin:16px 0 8px;">Spilletid per spiller</div>' +
            barsHtml +
          '</div>' +
        '</div></div>' +
        '<div class="ob-footer ob-footer-sticky">' +
          '<button type="button" class="ob-btn ob-btn-back" id="obBack">\u2190 Tilbake</button>' +
          '<button type="button" class="ob-btn ob-btn-primary" id="obFinish">' + finishLabel + '</button>' +
        '</div>' +
      '</div>';

    // Animate bars
    setTimeout(function () {
      var fills = overlayEl ? overlayEl.querySelectorAll('.ob-bar-fill') : [];
      for (var f = 0; f < fills.length; f++) {
        (function (el, delay) {
          setTimeout(function () { el.style.width = el.getAttribute('data-pct') + '%'; }, delay);
        })(fills[f], f * 40);
      }
    }, 120);

    $('obBack').addEventListener('click', function () {
      step = data.isRerun ? 1 : 2;
      renderStep();
    });

    // Finish
    $('obFinish').addEventListener('click', async function () {
      if (busy) return;
      busy = true;
      var btn = $('obFinish');
      if (!btn) return;
      btn.disabled = true;
      btn.innerHTML = '<span class="ob-spinner"></span>Setter opp\u2026';

      try {
        await withTimeout(applyWizardData(), 12000);

        try {
          var rect = btn.getBoundingClientRect();
          fireConfetti(rect.left + rect.width / 2, rect.top);
        } catch (_) {}

        var msg;
        var shouldSwitchToKampdag = false;

        if (data.isRerun) {
          // Re-run: only age class was updated
          msg = 'Aldersklasse oppdatert til ' + data.ageClass + '! Kampdag-innstillinger er justert.';
          shouldSwitchToKampdag = true;
        } else if (data.usedExamples) {
          msg = data.teamName + ' er opprettet! Legg til spillerne dine i spillerlisten.';
        } else {
          msg = data.teamName + ' er klart! G\u00e5 til Kampdag for \u00e5 lage din f\u00f8rste bytteplan \u26BD';
          shouldSwitchToKampdag = data.playerNames.length >= 3;
        }

        completeClose(function () {
          // Switch to Kampdag tab if user added real players (they've seen the demo, now do it for real)
          if (shouldSwitchToKampdag && typeof window.__BF_switchTab === 'function') {
            window.__BF_switchTab('kampdag');

            // Kampdag DOMContentLoaded ran BEFORE wizard saved age class to localStorage,
            // so format/minutes are still at HTML defaults. Set them directly now.
            // Order matters: format change handler sets generic minutes, so we override after.
            var rule = getRule(data.ageClass);
            if (rule) {
              var fmtEl = document.getElementById('kdFormat');
              var minEl = document.getElementById('kdMinutes');
              if (fmtEl) {
                fmtEl.value = String(rule.format);
                fmtEl.dispatchEvent(new Event('change', { bubbles: true }));
                // ↑ triggers kampdag handler which sets generic minutes + refreshes keeper UI
              }
              if (minEl) {
                minEl.value = String(rule.minutes);
                minEl.dispatchEvent(new Event('input', { bubbles: true }));
                // ↑ overrides with correct NFF age-specific minutes + updates keeper allocation
              }
            }
          }
          if (typeof window.showNotification === 'function') {
            window.showNotification(msg, 'success');
          }
        });
      } catch (e) {
        console.error('[onboarding] Apply failed:', e);
        busy = false;
        btn.disabled = false;
        btn.innerHTML = data.usedExamples ? '\uD83D\uDE80 Sett opp laget' : '\uD83D\uDE80 Start appen';

        var errMsg = (e && e.message === 'timeout')
          ? 'Nettverket er tregt. Pr\u00f8v igjen.'
          : 'Noe gikk galt. Pr\u00f8v igjen.';
        if (typeof window.showNotification === 'function') {
          window.showNotification(errMsg, 'error');
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Timeout wrapper
  // ══════════════════════════════════════════════════════════════
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, ms);
      })
    ]);
  }

  // ══════════════════════════════════════════════════════════════
  //  Apply wizard data via core.js bridge
  // ══════════════════════════════════════════════════════════════
  var _applyGen = 0; // generation counter: prevents stale promises from duplicating work

  async function applyWizardData() {
    var gen = ++_applyGen;
    var bridge = window.__BF_onboarding;
    if (!bridge) throw new Error('Bridge API not available');

    // Re-run: don't touch existing team name or players
    if (!data.isRerun) {
      // 1. Rename team (async, can be slow on mobile)
      if (data.teamName) {
        await bridge.renameCurrentTeam(data.teamName);
      }

      // Bail if a newer attempt was started (timeout + retry scenario)
      if (gen !== _applyGen) return;

      // 2. Add players (only if user provided real names, not examples)
      if (!data.usedExamples && data.playerNames.length > 0) {
        bridge.bulkAddPlayers(data.playerNames);
      }
    }

    // 3. Store age class for kampdag/season defaults (always useful)
    if (data.ageClass) {
      safeLS('set', 'bf_ob_ageclass', data.ageClass);
      try {
        if (window._bftCloud && window._bftCloud.save) {
          window._bftCloud.save('age_class', JSON.stringify({ value: data.ageClass }));
        }
      } catch (_) {}
    }
  }

})();
