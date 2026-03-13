// © 2026 Barnefotballtrener.no. All rights reserved.
// sesong-workout.js — Innebygd treningsøkt-editor for Sesong-modulen.
// Full feature-paritet med workout.js via window._woShared.
// Eksporterer window.sesongWorkout = { init, destroy, isActive }
//
// API: window.sesongWorkout.init(container, players, opts)
//   opts = { ageGroup, existingTheme, title, date, eventId, seasonId,
//            existingDbId, existingBlocks, minutes, onSave, onBack }
//   onSave(payload) → Promise<{ id }>
//   onBack(finalDbId) → void
//
// Bugfikser [1-9] alle inkludert.
// Spillervalg + gruppeinndeling (window.Grouping + window.GroupDragDrop).

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════
  // State
  // ══════════════════════════════════════════════════════════
  var _swActive      = false;
  var _swBlocks      = [];
  var _swDbId        = null;
  var _swSaving      = false;
  var _swDirty       = false;
  var _swSaveTimer   = null;    // [Bug 1]
  var _swContainer   = null;
  var _swPlayers     = [];
  var _swSelected    = new Set();
  var _swGroupsCache = new Map();
  var _swParPickB    = new Map();
  var _swExpandedId  = null;
  var _swCallbacks   = { onSave: null, onBack: null };
  var _swUseSkill    = false;
  var _swMeta        = {
    ageGroup: null, theme: null, title: '', date: '',
    eventId: null, seasonId: null, duration: 60,
  };

  var _PC_COLORS = [
    '#93c5fd','#a5b4fc','#f9a8d4','#fcd34d','#6ee7b7',
    '#fca5a5','#67e8f9','#c4b5fd','#f0abfc','#5eead4',
    '#fdba74','#bef264','#fb7185','#7dd3fc','#d8b4fe',
    '#86efac','#fed7aa','#99f6e4',
  ];

  // ══════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════
  function sh()   { return window._woShared; }
  function esc(s) { return sh().escapeHtml(String(s == null ? '' : s)); }

  function clampInt(v, min, max, fb) {
    var n = parseInt(v, 10);
    return (isNaN(n) || n < min || n > max) ? fb : n;
  }

  function uid() {
    return 'sw_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function exMeta(key) { return sh().EX_BY_KEY.get(key); }

  function displayName(ex) {
    if (!ex) return '';
    if (ex.exerciseKey === 'custom')
      return (ex.customName || '').trim() || 'Egendefinert øvelse';
    var m = exMeta(ex.exerciseKey);
    return m ? m.label : 'Øvelse';
  }

  // ══════════════════════════════════════════════════════════
  // Block / exercise factory
  // ══════════════════════════════════════════════════════════
  function makeEx() {
    return { exerciseKey: 'tag', customName: '', minutes: 10,
             groupCount: 2, groupMode: 'even', comment: '',
             _groupCountManual: false };
  }

  function makeBlock(kind) {
    var id = uid();
    if (kind === 'parallel') {
      var exB = makeEx();
      exB.exerciseKey = 'keeper'; exB.minutes = 12;
      return { id: id, kind: 'parallel', a: makeEx(), b: exB };
    }
    return { id: id, kind: 'single', a: makeEx() };
  }

  function migrateEx(raw) {
    return {
      exerciseKey:       raw.exerciseKey || 'tag',
      customName:        String(raw.customName || ''),
      minutes:           clampInt(raw.minutes, 0, 300, 10),
      groupCount:        clampInt(raw.groupCount, 1, 20, 2),
      groupMode:         raw.groupMode || 'even',
      comment:           String(raw.comment || ''),
      _groupCountManual: !!raw._groupCountManual,
    };
  }

  function loadBlocks(raw) {
    if (!Array.isArray(raw) || !raw.length) return [makeBlock('single')];
    return raw.map(function(b) {
      var id = uid();
      if (b.kind === 'parallel')
        return { id: id, kind: 'parallel',
                 a: migrateEx(b.a || {}), b: migrateEx(b.b || {}) };
      return { id: id, kind: 'single', a: migrateEx(b.a || {}) };
    });
  }

  // ══════════════════════════════════════════════════════════
  // Save payload (feltnavn matcher season.js)
  // ══════════════════════════════════════════════════════════
  function totalMin() {
    var s = 0;
    for (var i = 0; i < _swBlocks.length; i++) {
      var b = _swBlocks[i];
      s += b.kind === 'parallel'
        ? Math.max(clampInt(b.a ? b.a.minutes : 0, 0, 300, 0),
                   clampInt(b.b ? b.b.minutes : 0, 0, 300, 0))
        : clampInt(b.a ? b.a.minutes : 0, 0, 300, 0);
    }
    return s;
  }

  function serEx(ex) {
    return {
      exerciseKey: ex.exerciseKey, customName: ex.customName,
      minutes: ex.minutes, groupCount: ex.groupCount,
      groupMode: ex.groupMode, comment: ex.comment,
      _groupCountManual: !!ex._groupCountManual,
    };
  }

  function buildPayload() {
    return {
      dbId:        _swDbId,
      title:       _swMeta.title    || '',
      date:        _swMeta.date     || null,
      ageGroup:    _swMeta.ageGroup || null,
      theme:       _swMeta.theme    || null,
      eventId:     _swMeta.eventId  || null,
      seasonId:    _swMeta.seasonId || null,
      duration:    totalMin()       || null,
      is_template: false,
      source:      'sesong',
      blocks: _swBlocks.map(function(b) {
        if (b.kind === 'parallel')
          return { kind: 'parallel', a: serEx(b.a), b: serEx(b.b) };
        return { kind: 'single', a: serEx(b.a) };
      }),
    };
  }

  // ══════════════════════════════════════════════════════════
  // Auto-save
  // ══════════════════════════════════════════════════════════
  function scheduleSave() {
    _swDirty = true;
    if (_swSaveTimer) clearTimeout(_swSaveTimer);
    _swSaveTimer = setTimeout(doAutoSave, 1500);
  }

  function doAutoSave() {
    if (!_swActive) return;
    if (_swSaving) { _swSaveTimer = setTimeout(doAutoSave, 600); return; } // [Bug 7]
    _swDirty  = false;
    _swSaving = true;
    var p = _swCallbacks.onSave ? _swCallbacks.onSave(buildPayload()) : Promise.resolve(null);
    Promise.resolve(p)
      .then(function(res) { if (res && res.id && !_swDbId) _swDbId = res.id; }) // [Bug 2]
      .catch(function(e) {
        console.warn('[sesong-workout] auto-save feilet:', e && e.message || e);
        _swDirty = true;
      })
      .finally(function() { _swSaving = false; });
  }

  // ══════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════
  function render() {
    if (!_swContainer) return;
    _swContainer.innerHTML = buildHTML();
    bindAll();
  }

  function buildHTML() {
    return '<div class="sw-root">' +
      buildHeader() +
      '<div id="swNffBar">' + buildNffBar() + '</div>' +
      buildPlayersPanel() +
      buildGenPanel() +
      '<div id="swBlocks" class="sw-blocks"></div>' +
      '<div class="sw-add-row">' +
        '<button type="button" class="btn-secondary sw-add-btn" id="swAddBtn">' +
          '<i class="fas fa-plus"></i> Legg til øvelse</button>' +
        '<button type="button" class="btn-secondary sw-add-btn" id="swAddParBtn">' +
          '<i class="fas fa-code-branch"></i> Parallelt</button>' +
      '</div>' +
      '<div class="sw-footer-actions">' +
        '<button type="button" class="btn-primary" id="swSaveManBtn">' +
          '<i class="fas fa-save"></i> Lagre</button>' +
        '<button type="button" class="btn-secondary" id="swExportBtn">' +
          '<i class="fas fa-file-pdf"></i> PDF</button>' +
      '</div>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-500,#64748b);margin-top:6px;cursor:pointer;">' +
        '<input type="checkbox" id="swExportDetailToggle" checked> Inkluder beskrivelser og diagrammer</label>' +
    '</div>';
  }

  function buildHeader() {
    var ageBadge = _swMeta.ageGroup
      ? '<span class="sw-meta-age">' + esc(_swMeta.ageGroup) + ' år</span>' : '';
    return '<div class="sw-header">' +
      '<div class="sw-header-top">' +
        '<button type="button" class="sw-back-btn" id="swBackBtn" title="Tilbake">' +
          '<i class="fas fa-arrow-left"></i></button>' +
        '<div class="sw-header-info">' +
          '<div class="sw-header-title">' + esc(_swMeta.title || 'Treningøkt') + '</div>' +
          '<div class="sw-header-sub">' +
            (_swMeta.date ? esc(_swMeta.date) + ' &middot; ' : '') +
            '<strong id="swTotalMin">' + totalMin() + '</strong> min ' +
            ageBadge + '<span id="swHeaderTheme"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildThemePill() {
    var themeMeta = _swMeta.theme ? sh().NFF_THEME_BY_ID[_swMeta.theme] : null;
    if (!themeMeta) return '';
    return '<span class="sw-meta-theme">' +
      esc(themeMeta.icon) + ' ' + esc(themeMeta.label) +
      ' <button type="button" class="sw-meta-theme-x" id="swThemeX" aria-label="Fjern tema">×</button>' +
    '</span>';
  }

  function buildNffBar() {
    var shared = sh();
    var bal = shared.calculateNffBalance(_swBlocks, _swMeta.ageGroup || '8-9');
    if (!bal || bal.totalMinutes <= 0) return '';
    var age  = _swMeta.ageGroup || '8-9';
    var html = '<div class="wo-meta-balance" style="margin:6px 0 10px;">';
    for (var ci = 0; ci < shared.NFF_CATEGORIES.length; ci++) {
      var cat = shared.NFF_CATEGORIES[ci];
      var b   = bal.balance[cat.id];
      if (!b) continue;
      var pct = bal.totalMinutes > 0 ? Math.round((b.minutes / bal.totalMinutes) * 100) : 0;
      html += '<div class="wo-meta-bal-seg" style="--bal-color:' + cat.color +
        ';--bal-pct:' + pct + '%"' +
        ' title="' + esc(shared.catShort(cat, age)) + ': ' + b.minutes + ' min (' + pct +
        '%) — anbefalt ' + (b.recommendedPct || 0) + '%">' +
        '<div class="wo-meta-bal-fill"></div>' +
        '<span class="wo-meta-bal-label">' + esc(shared.catShort(cat, age)) + '</span>' +
      '</div>';
    }
    return html + '</div>';
  }

  // ──────────────────────────────────────────────────────────
  // Spillerpanel
  // ──────────────────────────────────────────────────────────
  function buildPlayersPanel() {
    if (!_swPlayers || !_swPlayers.length) return '';
    return '<div class="sw-players-wrap">' +
      '<div id="swPlayersToggle" style="cursor:pointer;display:flex;align-items:center;' +
        'justify-content:space-between;padding:10px 0;border-bottom:1px solid #e2e8f0;margin-bottom:4px;">' +
        '<span style="font-weight:700;font-size:14px;">' +
          '<i class="fas fa-users" style="margin-right:6px;opacity:0.7;"></i>' +
          'Spillere til økten <span id="swPlayerCount">' + _swSelected.size + '</span>/' + _swPlayers.length +
        '</span>' +
        '<span id="swPlayersChevron" style="opacity:0.5;font-size:12px;">▼</span>' +
      '</div>' +
      '<div id="swPlayersBody" style="display:none;margin-bottom:12px;">' +
        buildPlayerList() +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;cursor:pointer;">' +
          '<input type="checkbox" id="swSkillToggle"' + (_swUseSkill ? ' checked' : '') + '>' +
          'Bruk ferdighetsnivå ved "Etter nivå"-inndeling' +
        '</label>' +
      '</div>' +
    '</div>';
  }

  function buildPlayerList() {
    var sorted = _swPlayers.slice().sort(function(a, b) {
      return (a.name || '').localeCompare(b.name || '', 'nb');
    });
    var html = '<div class="wo-pick-list" id="swPlayerList">';
    for (var i = 0; i < sorted.length; i++) {
      var p       = sorted[i];
      var checked = _swSelected.has(p.id) ? ' checked' : '';
      var color   = _PC_COLORS[i % _PC_COLORS.length];
      html += '<label class="player-checkbox" style="--pc-color:' + color + '">' +
        '<input type="checkbox" data-pid="' + esc(p.id) + '"' + checked + '>' +
        '<div class="pc-avatar">' + esc((p.name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div class="pc-info">' +
          '<div class="player-name">' + esc(p.name || '') + '</div>' +
          (p.goalie ? '<span class="pc-keeper">🧤 Keeper</span>' : '') +
        '</div>' +
        '<div class="pc-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"' +
          ' stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="20 6 9 17 4 12"/></svg></div>' +
      '</label>';
    }
    return html + '</div>';
  }

  function buildGenPanel() {
    return '<div class="sw-gen-wrap">' +
      '<button type="button" class="btn-primary sw-gen-toggle" id="swGenToggle" style="width:100%;font-size:15px;padding:13px 16px;">' +
        '<i class="fas fa-pencil-alt" style="margin-right:6px;"></i> Lag en treningsøkt for meg</button>' +
      '<div id="swGenPanelBody" style="display:none;"></div>' +
    '</div>';
  }

  function renderGenPanel() {
    var el = document.getElementById('swGenPanelBody');
    if (!el) return;

    var shared     = sh();
    var age        = _swMeta.ageGroup || '8-9';
    var themes     = (shared.NFF_THEMES_BY_AGE || {})[age] || [];
    var NFF_THEME_BY_ID = shared.NFF_THEME_BY_ID || {};
    var templates  = (shared.NFF_TEMPLATES || {})[age] || [];

    // ── Tema-pills ──────────────────────────────────────────
    var temaHtml = '<div class="wo-gen-label">Øktens tema</div>' +
      '<div class="wo-gen-themes">';
    for (var i = 0; i < themes.length; i++) {
      var t   = NFF_THEME_BY_ID[themes[i]];
      if (!t) continue;
      var sel = _swMeta.theme === themes[i] ? ' wo-gen-pill-sel' : '';
      temaHtml += '<button type="button" class="wo-gen-pill' + sel + '"' +
        ' data-swTheme="' + esc(themes[i]) + '">' +
        esc(t.icon) + ' ' + esc(t.label) + '</button>';
    }
    temaHtml += '</div>';

    // ── Læringsmål (kun når tema valgt) ─────────────────────
    var goalsHtml = '';
    if (_swMeta.theme && shared.getLearningGoals) {
      var goals = shared.getLearningGoals(_swMeta.theme, age);
      if (goals && goals.length) {
        goalsHtml = '<div class="wo-gen-goals">' +
          '<div class="wo-gen-goals-title">🎯 Læringsmål</div>' +
          goals.map(function(g) {
            return '<div class="wo-gen-goal">' + esc(g) + '</div>';
          }).join('') +
        '</div>';
      }
    }

    // ── Øktmaler ────────────────────────────────────────────
    var tplHtml = '';
    if (templates.length) {
      tplHtml = '<div style="border-top:1px solid var(--border,#e2e8f0);margin:10px 0 0;' +
        'padding-top:10px;">' +
        '<div class="wo-gen-label">Ferdige øktmaler</div>' +
        '<div class="wo-gen-themes">';
      for (var j = 0; j < templates.length; j++) {
        tplHtml += '<button type="button" class="wo-gen-pill" data-swTpl="' + j + '">' +
          '📋 ' + esc(templates[j].title) + '</button>';
      }
      tplHtml += '</div></div>';
    }

    el.innerHTML = temaHtml + goalsHtml + tplHtml;

    // ── Bindinger ───────────────────────────────────────────
    var themeBtns = el.querySelectorAll('[data-swTheme]');
    for (var k = 0; k < themeBtns.length; k++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.getAttribute('data-swTheme');
          _swMeta.theme = (_swMeta.theme === id) ? null : id;
          scheduleSave();
          updateHeader();
          renderGenPanel(); // re-render for sel-state + læringsmål
        });
      })(themeBtns[k]);
    }

    var tplBtns = el.querySelectorAll('[data-swTpl]');
    for (var m = 0; m < tplBtns.length; m++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          var idx  = parseInt(btn.getAttribute('data-swTpl'), 10);
          var tpls = (sh().NFF_TEMPLATES || {})[_swMeta.ageGroup || '8-9'] || [];
          if (tpls[idx]) loadTemplate(tpls[idx]);
          el.style.display = 'none';
        });
      })(tplBtns[m]);
    }
  }

  // ══════════════════════════════════════════════════════════
  // Blokk-rendering
  // ══════════════════════════════════════════════════════════
  function renderBlocks() {
    var el = document.getElementById('swBlocks');
    if (!el) return;

    if (!_swBlocks.length) {
      el.innerHTML = '<div class="sw-empty" style="padding:20px;text-align:center;color:#888;">' +
                     'Ingen øvelser ennå.</div>';
      updateHeader();
      return;
    }

    var html = '';
    for (var i = 0; i < _swBlocks.length; i++) {
      var b = _swBlocks[i];
      html += _swExpandedId === b.id ? renderExpanded(b) : renderCollapsed(b);
    }
    el.innerHTML = html;

    for (var j = 0; j < _swBlocks.length; j++) {
      (function(block) {
        if (_swExpandedId === block.id) {
          bindExpanded(block);
        } else {
          var card = el.querySelector('.sw-card[data-bid="' + block.id + '"]');
          if (card) {
            card.addEventListener('click', function(e) {
              if (e.target.closest && e.target.closest('.sw-mintap')) return;
              _swExpandedId = block.id;
              renderBlocks();
            });
          }
          var mintap = document.getElementById('sw_' + block.id + '_mintap');
          if (mintap) {
            mintap.addEventListener('click', function(e) {
              e.stopPropagation();
              inlineEditMin(block, mintap);
            });
          }
        }
      })(_swBlocks[j]);
    }

    updateHeader(); // [Bug 8]
  }

  function renderCollapsed(b) {
    var meta    = exMeta(b.a ? b.a.exerciseKey : 'tag');
    var cat     = meta ? sh().NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    var color   = cat ? cat.color : '#ccc';
    var name    = displayName(b.a);
    var isDrink = b.a && b.a.exerciseKey === 'drink';
    var minutes = b.kind === 'parallel'
      ? Math.max(clampInt(b.a ? b.a.minutes : 0, 0, 300, 0),
                 clampInt(b.b ? b.b.minutes : 0, 0, 300, 0))
      : clampInt(b.a ? b.a.minutes : 0, 0, 300, 0);

    var badges = '';
    if (b.kind === 'parallel')
      badges += '<span class="wo-h1-badge wo-h1-badge-par">∥ ' + esc(displayName(b.b)) + '</span>';
    if (b.a && b.a.groupMode !== 'none' && b.a.groupCount > 1 && _swSelected.size > 0)
      badges += '<span class="wo-h1-badge">👥 ' + b.a.groupCount + ' gr</span>';
    if (b.a && (b.a.comment || '').trim())
      badges += '<span class="wo-h1-badge">📝</span>';

    return '<div class="sw-card wo-h1-card wo-h1-collapsed" data-bid="' + b.id + '" style="--h1-color:' + color + '">' +
      '<div class="wo-h1-stripe"></div>' +
      '<div class="wo-h1-main">' +
        '<div class="wo-h1-name">' + (isDrink ? '💧 ' : '') + esc(name) + '</div>' +
        (badges ? '<div class="wo-h1-badges">' + badges + '</div>' : '') +
      '</div>' +
      '<div class="wo-h1-min sw-mintap" id="sw_' + b.id + '_mintap">' +
        minutes + '<span class="wo-h1-min-unit">min</span>' +
      '</div>' +
    '</div>';
  }

  function renderExpanded(b) {
    var meta  = exMeta(b.a ? b.a.exerciseKey : 'tag');
    var cat   = meta ? sh().NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    var color = cat ? cat.color : '#ccc';
    var isP   = b.kind === 'parallel';

    return '<div class="sw-card wo-h1-card wo-h1-expanded" data-bid="' + b.id + '" style="--h1-color:' + color + '">' +
      '<div class="wo-h1-stripe"></div>' +
      '<div class="wo-h1-exp-body">' +
        renderEditor(b, 'a') +
        (isP ? renderParallelSplit(b) : '') +
        (isP ? renderEditor(b, 'b') : '') +
        (isP ? '<div class="small-text" style="opacity:0.75;margin-top:4px;">Parallelt: teller lengste varighet.</div>' : '') +
        '<div class="wo-h1-actions">' +
          '<button class="btn-small" type="button" id="sw_' + b.id + '_up">↑</button>' +
          '<button class="btn-small" type="button" id="sw_' + b.id + '_down">↓</button>' +
          (!isP ? '<button class="btn-small" type="button" id="sw_' + b.id + '_mkpar">∥ Parallelt</button>' : '') +
          '<button class="btn-small btn-danger" type="button" id="sw_' + b.id + '_del">🗑 Slett</button>' +
          '<button class="btn-small" type="button" id="sw_' + b.id + '_close">▲ Lukk</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ──────────────────────────────────────────────────────────
  // Parallell spillerfordeling — alltid-synlig 2-kolonne
  // ──────────────────────────────────────────────────────────
  function renderParallelSplit(b) {
    var bid  = b.id;

    // Ingen spillere valgt → kompakt info-linje, ingen widget
    if (!_swSelected.size) {
      return '<div class="wo-parallel-pick" style="margin:10px 0;padding:10px 12px;' +
        'background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">' +
        '<div class="small-text" style="opacity:0.75;">Legg til spillere øverst for å fordele mellom øvelse A og B.</div>' +
      '</div>';
    }

    // Bygg sortert eligibleliste
    var map      = playerMap();
    var eligible = [];
    _swSelected.forEach(function(id) { var p = map.get(id); if (p) eligible.push(p); });
    eligible.sort(function(a, b) { return (a.name || '').localeCompare(b.name || '', 'nb'); });

    // Rens _swParPickB: fjern IDs som ikke lenger er i selected
    var validIds = new Set(eligible.map(function(p) { return p.id; }));
    var setB     = _swParPickB.get(bid) || new Set();
    var cleanB   = new Set();
    setB.forEach(function(id) { if (validIds.has(id)) cleanB.add(id); });
    _swParPickB.set(bid, cleanB);

    var countB   = cleanB.size;
    var countA   = eligible.length - countB;

    // Bygg spillerkort — klikk toggler mellom A og B
    var playersHtml = eligible.map(function(p, i) {
      var inB    = cleanB.has(p.id);
      var color  = _PC_COLORS[i % _PC_COLORS.length];
      var side   = inB ? 'B' : 'A';
      var bgB    = inB ? '#dbeafe' : '#f0fdf4';
      var border = inB ? '#93c5fd' : '#86efac';
      return '<button type="button" class="sw-split-chip" data-splitpid="' + esc(p.id) + '"' +
        ' data-bid="' + bid + '"' +
        ' style="background:' + bgB + ';border:1.5px solid ' + border + ';border-radius:20px;' +
        'padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;' +
        'display:inline-flex;align-items:center;gap:5px;--pc-color:' + color + '">' +
        '<span style="width:18px;height:18px;border-radius:50%;background:' + color + ';' +
          'display:inline-flex;align-items:center;justify-content:center;' +
          'font-size:9px;font-weight:900;color:#fff;">' +
          esc((p.name || '?').charAt(0).toUpperCase()) + '</span>' +
        esc(p.name) + (p.goalie ? ' 🧤' : '') +
        '<span style="font-size:10px;font-weight:900;opacity:0.6;margin-left:2px;">' + side + '</span>' +
      '</button>';
    }).join('');

    return '<div class="wo-parallel-pick" style="margin:10px 0;padding:10px 12px;' +
      'background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="font-weight:800;font-size:13px;">Spillerfordeling</span>' +
        '<span class="small-text" style="opacity:0.7;">Klikk en spiller for å bytte side</span>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:8px;">' +
        '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800;color:#166534;">' +
          'Øvelse A: <strong>' + countA + '</strong>' +
        '</div>' +
        '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800;color:#1e40af;">' +
          'Øvelse B: <strong>' + countB + '</strong>' +
        '</div>' +
        '<button type="button" class="btn-small" id="sw_' + bid + '_pickGoalies">Keepere → B</button>' +
        '<button type="button" class="btn-small" id="sw_' + bid + '_pickNone">Alle → A</button>' +
      '</div>' +
      '<div class="sw-split-chips" id="sw_' + bid + '_splitChips"' +
        ' style="display:flex;flex-wrap:wrap;gap:5px;">' +
        playersHtml +
      '</div>' +
    '</div>';
  }
  function renderEditor(b, track) {
    var ex         = track === 'a' ? b.a : b.b;
    var idp        = 'sw_' + b.id + '_' + track;
    var meta       = exMeta(ex.exerciseKey);
    var hasInfo    = meta && meta.description && meta.steps;
    var showCust   = ex.exerciseKey === 'custom';
    var mode       = ex.groupMode || 'even';
    var groupCount = clampInt(ex.groupCount, 1, 20, 2);
    var hasPl      = _swSelected.size > 0;
    var sgHint     = (meta && meta.suggestedGroupSize)
      ? '<span style="color:#2e8b57;">ℹ️ ' + meta.suggestedGroupSize + ' per gruppe</span>' : '';
    var parHint    = track === 'b' ? ' Parallelt: grupper av spillere til denne øvelsen.' : '';

    return '<div class="wo-subcard">' +
      '<div class="wo-subheader"><div class="wo-subtitle">' +
        (track === 'a' ? 'Øvelse' : 'Parallell øvelse') +
      '</div></div>' +
      '<div class="wo-row">' +
        '<div class="wo-field">' +
          '<label class="wo-label">Velg øvelse</label>' +
          '<div class="wo-select-row">' + sh().renderExerciseTrigger(b.id, track, ex) + '</div>' +
          (hasInfo
            ? '<button type="button" id="' + idp + '_infobtn" class="wo-info-expand">' +
              '<span class="wo-info-expand-text"><span class="wo-info-expand-icon">📖</span>' +
              ' Vis beskrivelse og trenertips</span><span class="wo-info-expand-chevron">▼</span></button>'
            : '') +
        '</div>' +
        '<div class="wo-field ' + (showCust ? '' : 'wo-hidden') + '" id="' + idp + '_cwrap">' +
          '<label class="wo-label">Navn (manuelt)</label>' +
          '<input id="' + idp + '_cname" class="input wo-input" type="text"' +
            ' value="' + esc(ex.customName || '') + '" placeholder="Skriv inn navn">' +
        '</div>' +
        '<div class="wo-field wo-minutes">' +
          '<label class="wo-label">Minutter</label>' +
          '<input id="' + idp + '_min" class="input wo-input" type="number" min="0" max="300"' +
            ' value="' + clampInt(ex.minutes, 0, 300, 10) + '">' +
        '</div>' +
      '</div>' +
      '<div id="' + idp + '_infopanel" class="wo-info-panel wo-hidden"></div>' +
      '<div class="wo-row">' +
        '<div class="wo-field wo-groups-settings">' +
          '<label class="wo-label">Grupper</label>' +
          '<div class="wo-inline">' +
            '<input id="' + idp + '_groups" class="input wo-input" type="number"' +
              ' min="1" max="20" value="' + groupCount + '" style="max-width:90px;">' +
            '<select id="' + idp + '_mode" class="input wo-input">' +
              '<option value="none"' + (mode === 'none' ? ' selected' : '') + '>Ingen inndeling</option>' +
              '<option value="even"' + (mode === 'even' ? ' selected' : '') + '>Jevne grupper</option>' +
              '<option value="diff"' + (mode === 'diff' ? ' selected' : '') + '>Etter nivå</option>' +
            '</select>' +
          '</div>' +
          ((sgHint || parHint)
            ? '<div class="small-text" style="opacity:0.85;margin-top:6px;">' + sgHint + parHint + '</div>'
            : '') +
        '</div>' +
        (hasPl
          ? '<div class="wo-field wo-group-actions">' +
              '<label class="wo-label">&nbsp;</label>' +
              '<div class="wo-inline" style="justify-content:flex-end;">' +
                '<button id="' + idp + '_make" class="btn-secondary" type="button">' +
                  '<i class="fas fa-users"></i> Lag grupper</button>' +
                '<button id="' + idp + '_refresh" class="btn-secondary" type="button">' +
                  '<i class="fas fa-rotate"></i> Refresh</button>' +
              '</div></div>'
          : '<div class="wo-field"><div class="small-text" style="opacity:0.7;padding-top:22px;">' +
              'Legg til spillere over for gruppeinndeling.</div></div>') +
      '</div>' +
      '<div class="wo-row">' +
        '<div class="wo-field">' +
          '<label class="wo-label">Kommentar</label>' +
          '<textarea id="' + idp + '_comment" class="input wo-input" rows="2">' +
            esc(ex.comment || '') + '</textarea>' +
        '</div>' +
      '</div>' +
      '<div id="' + idp + '_groupsOut" class="wo-groupsout"></div>' +
    '</div>';
  }

  // ══════════════════════════════════════════════════════════
  // Gruppeinndeling
  // ══════════════════════════════════════════════════════════
  function playerMap() {
    var map = new Map();
    for (var i = 0; i < _swPlayers.length; i++) map.set(_swPlayers[i].id, _swPlayers[i]);
    return map;
  }

  function getParticipantsFor(block, track) {
    if (!_swSelected.size) return [];
    var map = playerMap();
    var sel = [];
    _swSelected.forEach(function(id) { var p = map.get(id); if (p) sel.push(p); });

    if (block.kind !== 'parallel') return sel;

    var setB = _swParPickB.get(block.id) || new Set();
    if (track === 'b') return sel.filter(function(p) { return setB.has(p.id); });
    return sel.filter(function(p) { return !setB.has(p.id); });
  }

  function computeGroupsFor(block, track, isRefresh) {
    var bid      = block.id;
    var ex       = track === 'a' ? block.a : block.b;
    var outKey   = bid + ':' + track;
    var idp      = 'sw_' + bid + '_' + track;
    var outEl    = document.getElementById(idp + '_groupsOut');
    if (!outEl) return;

    if (!_swSelected.size) {
      outEl.innerHTML = '<div class="small-text" style="opacity:0.85;">Ingen spillere valgt.</div>';
      return;
    }

    var participants = getParticipantsFor(block, track);
    if (!participants.length) {
      outEl.innerHTML = '<div class="small-text" style="opacity:0.85;">Ingen deltakere til denne øvelsen.</div>';
      return;
    }

    var groupMode  = ex.groupMode || 'even';
    var groupCount = clampInt(ex.groupCount, 1, 20, 2);

    // Auto-størrelse fra suggestedGroupSize
    var meta = sh().EX_BY_KEY.get(ex.exerciseKey);
    if (meta && meta.suggestedGroupSize >= 2 && !ex._groupCountManual) {
      var auto = Math.max(1, Math.ceil(participants.length / meta.suggestedGroupSize));
      groupCount = auto;
      ex.groupCount = auto;
      var gi = document.getElementById(idp + '_groups');
      if (gi) gi.value = String(auto);
    }

    if (groupMode === 'none' || groupCount <= 1) {
      _swGroupsCache.set(outKey, [participants]);
      renderGroupsOut(bid, track);
      return;
    }

    if (!isRefresh && _swGroupsCache.has(outKey)) {
      renderGroupsOut(bid, track);
      return;
    }

    var alg = window.Grouping;
    if (!alg) {
      if (window.showNotification) window.showNotification('Mangler grouping.js', 'error');
      return;
    }

    if (groupMode === 'diff' && !_swUseSkill) {
      if (window.showNotification)
        window.showNotification('Slå på "Bruk ferdighetsnivå" for "Etter nivå"', 'error');
      return;
    }

    var groups = groupMode === 'diff'
      ? alg.makeDifferentiatedGroups(participants, groupCount, _swUseSkill)
      : alg.makeBalancedGroups(participants, groupCount, _swUseSkill);

    if (!groups) {
      if (window.showNotification) window.showNotification('Kunne ikke lage grupper', 'error');
      return;
    }

    _swGroupsCache.set(outKey, groups);
    renderGroupsOut(bid, track);
  }

  function renderGroupsOut(blockId, track) {
    var outKey = blockId + ':' + track;
    var outEl  = document.getElementById('sw_' + blockId + '_' + track + '_groupsOut');
    if (!outEl) return;

    var cached = _swGroupsCache.get(outKey);
    if (!cached) { outEl.innerHTML = ''; return; }

    var groups      = Array.isArray(cached) ? cached : [];
    var hasMultiple = groups.length > 1;
    var html        = '<div class="wo-groups-compact">';

    if (hasMultiple)
      html += '<div class="grpdd-hint small-text" style="opacity:0.6;margin-bottom:4px;' +
              'text-align:center;font-size:11px;">' +
              '<i class="fas fa-hand-pointer" style="margin-right:3px;"></i>' +
              ' Hold inne for å bytte/flytte</div>';

    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      html += '<div class="wo-group-card grpdd-group" data-grpdd-gi="' + gi + '">' +
        '<div class="wo-group-title grpdd-group" data-grpdd-gi="' + gi + '">' +
          (groups.length === 1 ? 'Deltakere' : 'Gruppe ' + (gi + 1)) +
          ' <span style="opacity:0.7;">(' + g.length + ')</span></div>' +
        '<div class="wo-group-names">';
      for (var pi = 0; pi < g.length; pi++) {
        var p = g[pi];
        html += '<span class="wo-group-name grpdd-player"' +
          ' data-grpdd-gi="' + gi + '" data-grpdd-pi="' + pi + '">' +
          esc(p.name) + (p.goalie ? ' 🧤' : '') + '</span>';
      }
      html += '</div></div>';
    }
    html += '</div>';
    outEl.innerHTML = html;

    if (hasMultiple && window.GroupDragDrop && window.GroupDragDrop.enable) {
      (function(key) {
        window.GroupDragDrop.enable(outEl, groups, function(updated) {
          _swGroupsCache.set(key, updated);
          renderGroupsOut(blockId, track);
        }, { notify: window.showNotification || function() {} });
      })(outKey);
    }
  }

  // ══════════════════════════════════════════════════════════
  // Event binding
  // ══════════════════════════════════════════════════════════
  function bindAll() {
    var c = _swContainer;
    if (!c) return;

    function on(id, ev, fn) { var el = c.querySelector('#' + id); if (el) el.addEventListener(ev, fn); }

    on('swBackBtn',    'click', handleBack);
    on('swAddBtn',     'click', function() { addBlock('single'); });
    on('swAddParBtn',  'click', function() { addBlock('parallel'); });
    on('swSaveManBtn', 'click', handleManualSave);
    on('swExportBtn',  'click', exportPdf);

    // Spillerpanel toggle
    var pToggle  = c.querySelector('#swPlayersToggle');
    var pBody    = c.querySelector('#swPlayersBody');
    var pChevron = c.querySelector('#swPlayersChevron');
    if (pToggle && pBody) {
      pToggle.addEventListener('click', function() {
        var open = pBody.style.display === 'block';
        pBody.style.display = open ? 'none' : 'block';
        if (pChevron) pChevron.textContent = open ? '▼' : '▲';
      });
    }

    // Spillervalg — [Bug 9] scoped til container
    if (pBody) {
      var cbs = pBody.querySelectorAll('input[type="checkbox"][data-pid]');
      for (var i = 0; i < cbs.length; i++) {
        (function(cb) {
          cb.addEventListener('change', function() {
            var pid = cb.getAttribute('data-pid');
            if (!pid) return;
            if (cb.checked) _swSelected.add(pid);
            else            _swSelected.delete(pid);
            _swGroupsCache.clear();
            var cnt = c.querySelector('#swPlayerCount');
            if (cnt) cnt.textContent = String(_swSelected.size);
            renderBlocks();
          });
        })(cbs[i]);
      }
      var skillToggle = pBody.querySelector('#swSkillToggle');
      if (skillToggle) {
        skillToggle.addEventListener('change', function() {
          _swUseSkill = skillToggle.checked;
          _swGroupsCache.clear();
        });
      }
    }

    // Øktmaler/tema — [Bug 9] scoped
    var genToggle   = c.querySelector('#swGenToggle');
    var genPanelBody = c.querySelector('#swGenPanelBody');
    if (genToggle && genPanelBody) {
      genToggle.addEventListener('click', function() {
        var open = genPanelBody.style.display === 'block';
        genPanelBody.style.display = open ? 'none' : 'block';
        if (!open) renderGenPanel(); // populer ved åpning
      });
    }

    renderBlocks();
    updateHeader(); // Fyll swHeaderTheme hvis existingTheme er satt
  }

  function bindExpanded(b) {
    function q(id) { return document.getElementById(id); }
    function on(id, fn) { var el = q(id); if (el) el.addEventListener('click', fn); }

    on('sw_' + b.id + '_up',    function() { moveBlock(b.id, -1); });
    on('sw_' + b.id + '_down',  function() { moveBlock(b.id, 1); });
    on('sw_' + b.id + '_del',   function() { deleteBlock(b.id); });
    on('sw_' + b.id + '_mkpar', function() { convertToParallel(b.id); });
    on('sw_' + b.id + '_close', function() { _swExpandedId = null; renderBlocks(); });

    if (b.kind === 'parallel') bindParallelSplit(b);
    bindEditor(b, 'a');
    if (b.kind === 'parallel') bindEditor(b, 'b');
  }

  function bindParallelSplit(b) {
    var bid = b.id;
    function q(id) { return document.getElementById(id); }

    // "Keepere → B"
    var goBtn = q('sw_' + bid + '_pickGoalies');
    if (goBtn) {
      goBtn.addEventListener('click', function() {
        var map = playerMap();
        var set = new Set(_swParPickB.get(bid) || []);
        _swSelected.forEach(function(id) {
          var p = map.get(id);
          if (p && p.goalie) set.add(id);
        });
        _swParPickB.set(bid, set);
        _swGroupsCache.delete(bid + ':a');
        _swGroupsCache.delete(bid + ':b');
        renderBlocks();
      });
    }

    // "Alle → A"
    var noneBtn = q('sw_' + bid + '_pickNone');
    if (noneBtn) {
      noneBtn.addEventListener('click', function() {
        _swParPickB.set(bid, new Set());
        _swGroupsCache.delete(bid + ':a');
        _swGroupsCache.delete(bid + ':b');
        renderBlocks();
      });
    }

    // Chip-klikk — toggle A ↔ B
    var chipsEl = q('sw_' + bid + '_splitChips');
    if (chipsEl) {
      chipsEl.addEventListener('click', function(e) {
        var chip = e.target.closest('.sw-split-chip');
        if (!chip) return;
        var pid = chip.getAttribute('data-splitpid');
        if (!pid) return;
        var set = new Set(_swParPickB.get(bid) || []);
        if (set.has(pid)) set.delete(pid);
        else              set.add(pid);
        _swParPickB.set(bid, set);
        _swGroupsCache.delete(bid + ':a');
        _swGroupsCache.delete(bid + ':b');
        renderBlocks();
      });
    }
  }

  function bindEditor(b, track) {
    var ex  = track === 'a' ? b.a : b.b;
    var idp = 'sw_' + b.id + '_' + track;
    function q(id) { return document.getElementById(id); }

    // Trigger → bottom sheet
    var trigger = q('wo_' + b.id + '_' + track + '_trigger');
    if (trigger) {
      trigger.addEventListener('click', function() {
        sh().openExercisePicker(function(newKey) {
          ex.exerciseKey       = newKey;
          ex.customName        = '';
          ex._groupCountManual = false;
          var m = sh().EX_BY_KEY.get(newKey);
          if (m && clampInt(ex.minutes, 0, 300, 0) <= 0) ex.minutes = m.defaultMin || 10;
          _swGroupsCache.delete(b.id + ':' + track);
          scheduleSave();
          renderBlocks();
        }, { ageGroup: _swMeta.ageGroup, blocks: _swBlocks });
      });
    }

    var cname = q(idp + '_cname');
    if (cname) cname.addEventListener('input', function() { ex.customName = cname.value; scheduleSave(); });

    var min = q(idp + '_min');
    if (min) min.addEventListener('input', function() {
      ex.minutes = clampInt(min.value, 0, 300, 0);
      updateHeader(); scheduleSave();
    });

    var comment = q(idp + '_comment');
    if (comment) comment.addEventListener('input', function() { ex.comment = comment.value; scheduleSave(); });

    var cwrap = q(idp + '_cwrap');
    if (cwrap) cwrap.classList.toggle('wo-hidden', ex.exerciseKey !== 'custom');

    // Info panel
    var infoBtn   = q(idp + '_infobtn');
    var infoPanel = q(idp + '_infopanel');
    if (infoBtn && infoPanel) {
      infoBtn.addEventListener('click', function() {
        var open = !infoPanel.classList.contains('wo-hidden');
        infoPanel.classList.toggle('wo-hidden', open);
        infoBtn.classList.toggle('wo-info-expand-active', !open);
        if (!open && !infoPanel.dataset.rendered) {
          infoPanel.innerHTML    = sh().renderInfoPanel(ex.exerciseKey);
          infoPanel.dataset.rendered = '1';
        }
      });
    }

    // Gruppeinndeling
    var groupsInput = q(idp + '_groups');
    if (groupsInput) {
      groupsInput.addEventListener('input', function() {
        ex.groupCount        = clampInt(groupsInput.value, 1, 20, 2);
        ex._groupCountManual = true;
        _swGroupsCache.delete(b.id + ':' + track);
        scheduleSave();
      });
    }

    var modeInput = q(idp + '_mode');
    if (modeInput) {
      modeInput.addEventListener('change', function() {
        ex.groupMode = String(modeInput.value || 'even');
        _swGroupsCache.delete(b.id + ':' + track);
        scheduleSave();
      });
    }

    var makeBtn    = q(idp + '_make');
    var refreshBtn = q(idp + '_refresh');
    if (makeBtn)    makeBtn.addEventListener('click',    function() { computeGroupsFor(b, track, false); });
    if (refreshBtn) refreshBtn.addEventListener('click', function() { computeGroupsFor(b, track, true);  });

    // Render eksisterende cached grupper
    renderGroupsOut(b.id, track);
  }

  // ══════════════════════════════════════════════════════════
  // Block-operasjoner
  // ══════════════════════════════════════════════════════════
  function addBlock(kind) {
    var b = makeBlock(kind);
    _swBlocks.push(b);
    _swExpandedId = b.id;
    renderBlocks(); // [Bug 8] renderBlocks kaller updateHeader
    scheduleSave();
  }

  function deleteBlock(blockId) {
    if (!confirm('Slette denne øvelsen?')) return;
    _swBlocks = _swBlocks.filter(function(b) { return b.id !== blockId; });
    _swGroupsCache.delete(blockId + ':a');
    _swGroupsCache.delete(blockId + ':b');
    _swParPickB.delete(blockId);
    if (_swExpandedId === blockId) _swExpandedId = null;
    renderBlocks();
    scheduleSave();
  }

  function moveBlock(blockId, delta) {
    var idx = -1;
    for (var i = 0; i < _swBlocks.length; i++) { if (_swBlocks[i].id === blockId) { idx = i; break; } }
    if (idx === -1) return;
    var next = idx + delta;
    if (next < 0 || next >= _swBlocks.length) return;
    var moved = _swBlocks.splice(idx, 1)[0];
    _swBlocks.splice(next, 0, moved);
    renderBlocks();
    scheduleSave();
  }

  function convertToParallel(blockId) {
    var idx = -1;
    for (var i = 0; i < _swBlocks.length; i++) { if (_swBlocks[i].id === blockId) { idx = i; break; } }
    if (idx === -1 || _swBlocks[idx].kind === 'parallel') return;
    if (!confirm('Legge til parallell øvelse? (Teller lengste varighet)')) return;
    var exB = makeEx(); exB.exerciseKey = 'keeper'; exB.minutes = 12;
    _swBlocks[idx] = { id: blockId, kind: 'parallel', a: _swBlocks[idx].a, b: exB };
    renderBlocks(); scheduleSave();
  }

  function inlineEditMin(b, el) {
    var cur = b.kind === 'parallel'
      ? Math.max(clampInt(b.a ? b.a.minutes : 0, 0, 300, 0),
                 clampInt(b.b ? b.b.minutes : 0, 0, 300, 0))
      : clampInt(b.a ? b.a.minutes : 0, 0, 300, 0);

    var input = document.createElement('input');
    input.type = 'number'; input.className = 'wo-h1-min-input';
    input.min = '0'; input.max = '300'; input.value = String(cur);
    el.textContent = ''; el.appendChild(input);
    input.focus(); input.select();

    var committed = false;
    function commit() {
      if (committed) return; committed = true;
      var val = clampInt(input.value, 0, 300, cur);
      b.a.minutes = val;
      if (b.kind === 'parallel' && b.b && clampInt(b.b.minutes, 0, 300, 0) >= cur)
        b.b.minutes = val;
      renderBlocks(); scheduleSave();
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter')  input.blur();
      if (e.key === 'Escape') { committed = true; renderBlocks(); }
    });
  }

  function loadTemplate(tpl) {
    var blocks = tpl.blocks || [];
    _swBlocks = blocks.map(function(step) {
      if (step.parallel) {
        var b = makeBlock('parallel');
        b.a.exerciseKey = step.a.key; b.a.minutes = step.a.min;
        b.b.exerciseKey = step.b.key; b.b.minutes = step.b.min;
        return b;
      }
      var b2 = makeBlock('single');
      b2.a.exerciseKey = step.key; b2.a.minutes = step.min;
      return b2;
    });
    if (tpl.theme) _swMeta.theme = tpl.theme;
    _swExpandedId = null;
    _swGroupsCache.clear();
    _swParPickB.clear();
    renderBlocks(); scheduleSave();
    if (window.showNotification)
      window.showNotification((tpl.title || 'Øktmal') + ' lastet inn', 'success');
  }

  // ══════════════════════════════════════════════════════════
  // Header-oppdatering
  // ══════════════════════════════════════════════════════════
  function updateHeader() {
    var tot = document.getElementById('swTotalMin');
    if (tot) tot.textContent = String(totalMin());
    var barEl = document.getElementById('swNffBar');
    if (barEl) barEl.innerHTML = buildNffBar();
    var themePlaceholder = document.getElementById('swHeaderTheme');
    if (themePlaceholder) {
      themePlaceholder.innerHTML = buildThemePill();
      // Re-bind X-knapp (opprettet dynamisk)
      var themeX = document.getElementById('swThemeX');
      if (themeX) {
        themeX.addEventListener('click', function() {
          _swMeta.theme = null;
          scheduleSave();
          updateHeader();
          var pb = document.getElementById('swGenPanelBody');
          if (pb && pb.style.display === 'block') renderGenPanel();
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Lagring + navigasjon
  // ══════════════════════════════════════════════════════════
  function handleManualSave() {
    if (_swSaveTimer) { clearTimeout(_swSaveTimer); _swSaveTimer = null; }
    doAutoSave();
    setTimeout(function() {
      if (window.showNotification) window.showNotification('Treningsøkt lagret', 'success');
    }, 400);
  }

  function handleBack() {
    if (_swSaveTimer) { clearTimeout(_swSaveTimer); _swSaveTimer = null; }
    if (_swDirty) doAutoSave();

    // Vent på pågående save maks 3s, [Bug 5] _swActive = false FØR onBack
    var waited = 0;
    function tryBack() {
      if (_swSaving && waited < 3000) {
        waited += 100; setTimeout(tryBack, 100); return;
      }
      var finalId = _swDbId;
      _swActive = false;
      if (_swCallbacks.onBack) _swCallbacks.onBack(finalId);
    }
    tryBack();
  }

  // ══════════════════════════════════════════════════════════
  // PDF-eksport
  // ══════════════════════════════════════════════════════════
  function exportPdf() {
    var shared  = sh();
    var title   = _swMeta.title || 'Treningsøkt';
    var date    = _swMeta.date  || '';
    var total   = totalMin();
    var prevCat = null;
    var acc     = 0;
    var includeDetail = !!(document.getElementById('swExportDetailToggle') && document.getElementById('swExportDetailToggle').checked);

    var blocksHtml = '';

    function renderGroupHtml(block, track) {
      var key = block.id + ':' + track;
      var cached = _swGroupsCache.get(key);
      if (!cached || !Array.isArray(cached) || cached.length === 0) return '';
      // Skip if single group with no meaningful split
      if (cached.length === 1 && cached[0].length <= 1) return '';
      var html = '<div style="margin-top:8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#888;font-weight:800;">Gruppeinndeling</div>';
      for (var gi = 0; gi < cached.length; gi++) {
        var g = cached[gi];
        var label = cached.length === 1 ? 'Deltakere' : 'Gruppe ' + (gi + 1);
        html += '<div style="background:#f6f8fc;border:1px solid #e2e8f0;border-left:3px solid rgba(11,91,211,0.35);border-radius:8px;padding:6px 8px;margin-top:4px;">' +
          '<div style="font-weight:800;font-size:12px;color:#1a2333;">' + esc(label) + ' (' + g.length + ')</div>' +
          '<div style="color:#666;font-size:12px;margin-top:2px;">' + g.map(function(p) { return esc(p.name); }).join(' \u00b7 ') + '</div>' +
        '</div>';
      }
      return html;
    }

    function renderExInfo(ex) {
      if (!includeDetail) return '';
      var meta = shared.EX_BY_KEY.get(ex ? ex.exerciseKey : null);
      if (!meta || !meta.description) return '';
      var info = '<div style="color:#374151;font-size:12px;margin-top:4px;line-height:1.5;">' + esc(meta.description) + '</div>';
      if (meta.equipment) {
        info += '<div style="color:#556070;font-size:12px;margin-top:4px;"><span style="font-weight:700;color:#374151;">Utstyr:</span> ' + esc(meta.equipment) + '</div>';
      }
      if (meta.setup) {
        info += '<div style="color:#556070;font-size:12px;margin-top:4px;"><span style="font-weight:700;color:#374151;">Oppsett:</span> ' + esc(meta.setup) + '</div>';
      }
      if (meta.steps && meta.steps.length) {
        info += '<div style="margin-top:4px;"><span style="font-weight:700;color:#374151;font-size:12px;">Gjennomf\u00f8ring:</span><ol style="margin:2px 0 0 16px;padding:0;font-size:12px;line-height:1.5;color:#556070;">';
        for (var si = 0; si < meta.steps.length; si++) info += '<li>' + esc(meta.steps[si]) + '</li>';
        info += '</ol></div>';
      }
      if (meta.coaching && meta.coaching.length) {
        info += '<div style="color:#556070;font-size:12px;margin-top:4px;"><span style="font-weight:700;color:#374151;">Tips:</span> ' + meta.coaching.map(function(c) { return esc(c); }).join(' \u00b7 ') + '</div>';
      }
      if (meta.diagram) {
        info += '<div style="margin:6px 0 2px;display:flex;justify-content:center;"><div style="max-width:200px;width:100%;background:#3d8b37;border-radius:8px;padding:6px;">' + shared.renderDrillSVG(meta.diagram) + '</div></div>';
      }
      return info;
    }

    for (var bi = 0; bi < _swBlocks.length; bi++) {
      var b    = _swBlocks[bi];
      var isP  = b.kind === 'parallel';
      var minA = clampInt(b.a ? b.a.minutes : 0, 0, 300, 0);
      var minB = isP ? clampInt(b.b ? b.b.minutes : 0, 0, 300, 0) : 0;
      var bMin = isP ? Math.max(minA, minB) : minA;
      acc += bMin;

      var metaA  = shared.EX_BY_KEY.get(b.a ? b.a.exerciseKey : 'tag');
      var curCat = (metaA && metaA.nffCategory !== 'pause') ? metaA.nffCategory : null;
      var secRow = '';
      if (curCat && curCat !== prevCat) {
        var catObj = shared.NFF_CATEGORY_BY_ID[curCat];
        if (catObj)
          secRow = '<tr><td colspan="4" style="border-left:4px solid ' + catObj.color +
            ';padding:5px 10px;font-size:11px;font-weight:800;color:' + catObj.color +
            ';background:#f9fafb;">' + esc(shared.catLabel(catObj, _swMeta.ageGroup)) + '</td></tr>';
      }
      if (curCat) prevCat = curCat;

      var nameA = displayName(b.a);
      var commA = esc(String(b.a && b.a.comment ? b.a.comment : '').trim());
      var infoA = renderExInfo(b.a);
      var grpA  = renderGroupHtml(b, 'a');

      if (!isP) {
        blocksHtml += secRow + '<tr>' +
          '<td style="color:#888;font-weight:800;width:40px;">' + (bi + 1) + '</td>' +
          '<td><div style="font-weight:900;">' + esc(nameA) + '</div>' + infoA +
            (commA ? '<div style="color:#666;font-size:12px;margin-top:3px;">' + commA + '</div>' : '') +
            grpA +
          '</td>' +
          '<td style="text-align:right;font-weight:900;width:70px;">' + bMin + '</td>' +
          '<td style="text-align:right;color:#888;font-size:12px;width:50px;">' + acc + '\'</td>' +
        '</tr>';
      } else {
        var nameB = displayName(b.b);
        var commB = esc(String(b.b && b.b.comment ? b.b.comment : '').trim());
        var infoB = renderExInfo(b.b);
        var grpB  = renderGroupHtml(b, 'b');
        blocksHtml += secRow + '<tr>' +
          '<td style="color:#888;font-weight:800;">' + (bi + 1) + '</td>' +
          '<td><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px;">' +
              '<div style="font-size:11px;color:#888;font-weight:800;margin-bottom:3px;">ØVELSE A</div>' +
              '<div style="font-weight:900;">' + esc(nameA) +
                ' <span style="color:#888;font-size:12px;">(' + minA + ' min)</span></div>' +
              infoA +
              (commA ? '<div style="color:#666;font-size:12px;">' + commA + '</div>' : '') +
              grpA +
            '</div>' +
            '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px;">' +
              '<div style="font-size:11px;color:#888;font-weight:800;margin-bottom:3px;">ØVELSE B</div>' +
              '<div style="font-weight:900;">' + esc(nameB) +
                ' <span style="color:#888;font-size:12px;">(' + minB + ' min)</span></div>' +
              infoB +
              (commB ? '<div style="color:#666;font-size:12px;">' + commB + '</div>' : '') +
              grpB +
            '</div>' +
          '</div></td>' +
          '<td style="text-align:right;font-weight:900;">' + bMin + '</td>' +
          '<td style="text-align:right;color:#888;font-size:12px;">' + acc + '\'</td>' +
        '</tr>';
      }
    }

    // NFF-balanse
    var bal = shared.calculateNffBalance(_swBlocks, _swMeta.ageGroup || '8-9');
    var balHtml = '';
    if (bal && bal.totalMinutes > 0) {
      balHtml = '<div style="margin-top:12px;">' +
        '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;' +
          'font-weight:800;margin-bottom:6px;">NFF-fordeling</div>' +
        '<div style="display:flex;gap:4px;height:22px;">';
      for (var ci = 0; ci < shared.NFF_CATEGORIES.length; ci++) {
        var cat = shared.NFF_CATEGORIES[ci];
        var bx  = bal.balance[cat.id];
        if (!bx || !bx.minutes) continue;
        var pct2 = Math.max(4, Math.round((bx.minutes / bal.totalMinutes) * 100));
        balHtml += '<div style="flex:' + pct2 + ';background:' + cat.color + '22;' +
          'border-left:3px solid ' + cat.color + ';border-radius:4px;' +
          'display:flex;align-items:center;justify-content:center;' +
          'font-size:9px;font-weight:800;color:' + cat.color + ';">' + bx.minutes + 'm</div>';
      }
      balHtml += '</div></div>';
    }

    var themeMeta = _swMeta.theme ? shared.NFF_THEME_BY_ID[_swMeta.theme] : null;
    var themeHtml = themeMeta
      ? '<div style="margin-top:3px;font-size:13px;opacity:0.9;">Tema: <strong>' +
        esc(themeMeta.label) + '</strong></div>' : '';

    var html = '<!doctype html><html lang="nb"><head><meta charset="utf-8">' +
      '<title>' + esc(title) + '</title><style>' +
      'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f8fc;}' +
      '.wrap{max-width:900px;margin:0 auto;padding:16px;}' +
      '.hdr{background:linear-gradient(135deg,#0b5bd3,#19b0ff);color:#fff;border-radius:16px;padding:14px 18px;margin-bottom:10px;}' +
      '.hdr-t{font-size:18px;font-weight:900;}.hdr-s{font-size:13px;opacity:0.9;margin-top:2px;}' +
      '.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;}' +
      'table{width:100%;border-collapse:collapse;}' +
      'th,td{vertical-align:top;padding:8px 10px;border-bottom:1px solid #e2e8f0;}' +
      'th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;}' +
      'tr{page-break-inside:avoid;}' +
      'svg{width:100%;height:auto;}' +
      '.btn{border:0;border-radius:10px;padding:10px 16px;font-weight:800;cursor:pointer;margin:4px;}' +
      '.btn-p{background:#0b5bd3;color:#fff;}.btn-s{background:#1f2a3d;color:#fff;}' +
      '.footer{text-align:center;margin-top:14px;font-size:11px;color:#888;}' +
      '@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      'body{background:#fff;}.wrap{padding:0;}' +
      '.actions{display:none!important;}.hdr,.card{border-radius:0;border-left:0;border-right:0;}}' +
      '</style></head><body><div class="wrap">' +
        '<div class="hdr"><div class="hdr-t">' + esc(title) + '</div>' +
          '<div class="hdr-s">' + (date ? esc(date) + ' &middot; ' : '') + 'Total: ' + total + ' min' +
            (_swMeta.ageGroup ? ' &middot; ' + esc(_swMeta.ageGroup) + ' år' : '') + '</div>' +
          themeHtml + '</div>' +
        '<div class="card"><table><thead><tr>' +
          '<th>#</th><th>Øvelse</th>' +
          '<th style="text-align:right">Min</th><th style="text-align:right">Akk.</th>' +
        '</tr></thead><tbody>' + blocksHtml + '</tbody></table>' + balHtml + '</div>' +
        '<div style="text-align:center;font-size:1.5rem;font-weight:900;margin-top:14px;">' +
          total + ' min totalt</div>' +
        '<div class="actions" style="margin-top:12px;text-align:center;">' +
          '<button class="btn btn-p" onclick="window.print()">Lagre som PDF</button>' +
          '<button class="btn btn-s" onclick="window.close()">Lukk</button>' +
        '</div>' +
        '<div class="footer">Laget med Barnefotballtrener.no</div>' +
      '</div></body></html>';

    var w = window.open('', '_blank');
    if (!w) {
      if (window.showNotification) window.showNotification('Popup blokkert. Tillat popups.', 'error');
      return;
    }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ══════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════

  /**
   * Initialiser embedded treningsøkt-editor.
   * players = oppmøteliste fra sesong (settes alle valgt som standard).
   */
  function init(container, players, opts) {
    if (!window._woShared) {
      console.error('[sesong-workout] window._woShared mangler. Er workout.js lastet?');
      return;
    }
    _swContainer  = container;
    // Normaliser spillerformat: season.js sender skill_level, Grouping.js forventer skill
    _swPlayers = (Array.isArray(players) ? players : []).map(function(p) {
      return {
        id:     p.id,
        name:   p.name    || '',
        skill:  Number(p.skill || p.skill_level || 0),
        goalie: !!p.goalie
      };
    });
    _swSelected   = new Set(_swPlayers.map(function(p) { return p.id; }));
    _swCallbacks  = {
      onSave: opts.onSave || function() { return Promise.resolve(null); },
      onBack: opts.onBack || function() {},
    };
    _swMeta = {
      ageGroup: opts.ageGroup      || null,
      theme:    opts.existingTheme || opts.theme || null,
      title:    opts.title         || 'Treningsøkt',
      date:     opts.date          || '',
      eventId:  opts.eventId       || null,
      seasonId: opts.seasonId      || null,
      duration: opts.minutes       || 60,
    };
    _swDbId        = opts.existingDbId || opts.workoutId || null;
    _swBlocks      = (opts.existingBlocks || opts.blocks)
      ? loadBlocks(opts.existingBlocks || opts.blocks)
      : [makeBlock('single')];
    _swExpandedId  = null;
    _swGroupsCache = new Map();
    _swParPickB    = new Map();
    _swUseSkill    = false;
    _swSaving      = false;
    _swDirty       = false;
    if (_swSaveTimer) { clearTimeout(_swSaveTimer); _swSaveTimer = null; }
    _swActive      = true;

    render();
    console.log('[sesong-workout] init — eventId:', _swMeta.eventId,
                '| dbId:', _swDbId, '| spillere:', _swPlayers.length);
  }

  function destroy() {
    _swActive = false; // [Bug 5] FØR alt annet
    if (_swSaveTimer) { clearTimeout(_swSaveTimer); _swSaveTimer = null; }
    if (_swDirty && _swCallbacks.onSave) {
      _swCallbacks.onSave(buildPayload())
        .then(function(r) { if (r && r.id && !_swDbId) _swDbId = r.id; })
        .catch(function() {});
    }
    _swContainer = null;
    _swCallbacks = { onSave: null, onBack: null };
    console.log('[sesong-workout] destroy');
  }

  window.sesongWorkout = {
    init:     init,
    destroy:  destroy,
    isActive: function() { return _swActive; },
  };

})();
