/**
 * sesong-workout.js — Embedded treningsplanlegger for sesong-modulen.
 * Følger samme mønster som sesong-kampdag.js.
 *
 * Avhengigheter:
 *   - workout.js må lastes først (eksponerer window._woShared)
 *   - season.js kaller window.sesongWorkout.init(container, players, opts)
 *
 * Bruker IKKE egne kopier av øvelsesdata — henter alt fra _woShared.
 */
(function() {
  'use strict';

  // ─── SHARED DATA (from workout.js) ───
  function W() { return window._woShared || {}; }

  // ─── STATE ───
  var _swActive = false;
  var _swContainer = null;
  var _swCallbacks = {};
  var _swOpts = {};
  var _swSaveTimer = null;
  var _swDbId = null; // existing workout row id for upsert
  var _swIdCounter = 0;

  var _sw = {
    blocks: [],
    ageGroup: '8-9',
    theme: null,
    expandedBlockId: null,
    genOpen: false,
    genTheme: null,
    genDuration: 60,
  };

  function uuid() { return 'sw_' + Date.now().toString(36) + '_' + (++_swIdCounter); }

  function makeBlock() {
    return {
      id: uuid(),
      kind: 'single',
      a: { exerciseKey: '', minutes: 10, comment: '' }
    };
  }

  // ─── HELPERS ───
  function $(id) { return document.getElementById(id); }
  function esc(s) { return W().escapeHtml ? W().escapeHtml(String(s || '')) : String(s || '').replace(/[&<>"']/g, function(c) { return '&#'+c.charCodeAt(0)+';'; }); }

  function totalMinutes() {
    var sum = 0;
    for (var i = 0; i < _sw.blocks.length; i++) {
      sum += parseInt(_sw.blocks[i].a.minutes) || 0;
    }
    return sum;
  }

  function exLabel(key) {
    var ex = W().EX_BY_KEY && W().EX_BY_KEY.get(key);
    return ex ? ex.label : key || 'Velg øvelse';
  }

  // ─── AUTO-SAVE ───
  var _swSaveTimer = null;
  var _swSaving = false; // in-flight guard

  function scheduleAutoSave() {
    if (_swSaveTimer) clearTimeout(_swSaveTimer);
    _swSaveTimer = setTimeout(async function() {
      if (_swSaving) return; // previous save still in flight
      if (_swCallbacks.onSave) {
        _swSaving = true;
        try {
          var saveData = {
            blocks: _sw.blocks.map(function(b) {
              return { kind: 'single', a: { exerciseKey: b.a.exerciseKey, minutes: b.a.minutes, comment: b.a.comment || '' } };
            }),
            theme: _sw.theme,
            ageGroup: _sw.ageGroup,
            duration: totalMinutes(),
            seasonId: _swOpts.seasonId || null,
            dbId: _swDbId
          };
          var result = await _swCallbacks.onSave(saveData);
          // Update _swDbId after first insert so subsequent saves do upsert
          if (result && result.id && !_swDbId) {
            _swDbId = result.id;
          }
        } finally {
          _swSaving = false;
        }
      }
    }, 1500);
  }

  // ─── NFF BALANCE BAR ───
  function renderBalanceBar() {
    var w = W();
    if (!w.calculateNffBalance || !w.NFF_CATEGORIES) return '';
    var bal = w.calculateNffBalance(_sw.blocks, _sw.ageGroup);
    if (bal.totalMinutes <= 0) return '';

    var html = '<div class="sw-balance">';
    for (var i = 0; i < w.NFF_CATEGORIES.length; i++) {
      var cat = w.NFF_CATEGORIES[i];
      var b = bal.balance[cat.id];
      if (!b) continue;
      var pct = Math.round((b.minutes / bal.totalMinutes) * 100);
      var label = w.catShort ? w.catShort(cat, _sw.ageGroup) : cat.short;
      html += '<div class="sw-bal-seg" style="flex:' + Math.max(pct, 5) + ';background:' + cat.color + '20;border-left:3px solid ' + cat.color + ';" title="' + esc(label) + ': ' + b.minutes + ' min (' + pct + '%)">' +
        '<span class="sw-bal-label">' + esc(label) + '</span>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  // ─── GENERER FLOW ───
  function renderGenerer() {
    var w = W();
    if (!_sw.genOpen) return '';
    var themes = (w.NFF_THEMES_BY_AGE && w.NFF_THEMES_BY_AGE[_sw.ageGroup]) || [];
    var templates = (w.NFF_TEMPLATES && w.NFF_TEMPLATES[_sw.ageGroup]) || [];

    var html = '<div class="sw-gen">';

    // Templates
    if (templates.length) {
      html += '<div class="sw-gen-label">Ferdige øktmaler</div><div class="sw-gen-pills">';
      for (var t = 0; t < templates.length; t++) {
        html += '<button type="button" class="sw-pill" data-tpl="' + t + '">📋 ' + esc(templates[t].title) + '</button>';
      }
      html += '</div>';
      html += '<div style="border-top:1px solid var(--border, #e2e8f0);margin:10px 0;padding-top:8px;"><div class="sw-gen-label" style="opacity:0.6;font-size:12px;">...eller bygg selv:</div></div>';
    }

    // Theme pills
    html += '<div class="sw-gen-label">Tema</div><div class="sw-gen-pills">';
    for (var i = 0; i < themes.length; i++) {
      var themeId = themes[i];
      var meta = w.NFF_THEME_BY_ID && w.NFF_THEME_BY_ID[themeId];
      if (!meta) continue;
      var sel = _sw.genTheme === themeId ? ' sw-pill-sel' : '';
      html += '<button type="button" class="sw-pill' + sel + '" data-theme="' + themeId + '">' + esc(meta.icon) + ' ' + esc(meta.label) + '</button>';
    }
    html += '</div>';

    // Duration
    html += '<div class="sw-gen-label">Varighet</div><div class="sw-gen-pills">';
    var durs = [45, 60, 75, 90];
    for (var d = 0; d < durs.length; d++) {
      var dsel = _sw.genDuration === durs[d] ? ' sw-pill-sel' : '';
      html += '<button type="button" class="sw-pill' + dsel + '" data-dur="' + durs[d] + '">' + durs[d] + ' min</button>';
    }
    html += '</div>';

    html += '<button type="button" class="sw-gen-go" id="swGenGo"' + (_sw.genTheme ? '' : ' disabled') + '>Generer treningsøkt →</button>';
    html += '</div>';
    return html;
  }

  function generateWorkout(themeId, durationMin) {
    var w = W();
    var dist = (w.NFF_TIME_DISTRIBUTION && w.NFF_TIME_DISTRIBUTION[_sw.ageGroup]) || { sjef_over_ballen: 20, spille_med_og_mot: 25, smalagsspill: 45, scoringstrening: 10 };
    var drinkMin = 2;
    var available = durationMin - drinkMin;
    var is1316 = _sw.ageGroup === '13-16';

    var catMinutes = {};
    var totalPct = 0;
    for (var cat in dist) totalPct += dist[cat];
    for (var cat2 in dist) catMinutes[cat2] = Math.round((dist[cat2] / totalPct) * available);

    function pickExercise(nffCatId, usedKeys, preferKey) {
      if (!w.EXERCISES) return null;
      var candidates = w.EXERCISES.filter(function(ex) {
        return ex.category !== 'special' && ex.nffCategory === nffCatId &&
          !usedKeys[ex.key] && (!ex.ages || ex.ages.indexOf(_sw.ageGroup) >= 0);
      });
      if (preferKey) {
        var pref = candidates.filter(function(ex) { return ex.key === preferKey; });
        if (pref.length) return pref[0];
      }
      var themed = candidates.filter(function(ex) { return ex.themes && ex.themes.indexOf(themeId) >= 0; });
      if (themed.length) return themed[Math.floor(Math.random() * themed.length)];
      if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
      return null;
    }

    var blocks = [];
    var used = {};
    var order = ['sjef_over_ballen', 'spille_med_og_mot', 'scoringstrening', 'smalagsspill'];

    for (var ci = 0; ci < order.length; ci++) {
      var catId = order[ci];
      var remaining = catMinutes[catId] || 0;
      if (remaining <= 0) continue;

      var preferKey = (is1316 && catId === 'sjef_over_ballen') ? 'prepp' : null;
      var numEx = remaining >= 20 ? 2 : 1;
      var perEx = Math.round(remaining / numEx);

      for (var ei = 0; ei < numEx; ei++) {
        var ex = pickExercise(catId, used, ei === 0 ? preferKey : null);
        if (!ex) break;
        used[ex.key] = true;
        var b = makeBlock();
        b.a.exerciseKey = ex.key;
        b.a.minutes = ei === numEx - 1 ? (remaining - perEx * ei) : perEx;
        blocks.push(b);
      }

      if (catId === 'spille_med_og_mot') {
        var drink = makeBlock();
        drink.a.exerciseKey = 'drink';
        drink.a.minutes = drinkMin;
        blocks.push(drink);
      }
    }

    if (blocks.length >= 2) {
      _sw.blocks = blocks;
      _sw.theme = themeId;
      _sw.expandedBlockId = null;
      renderAll();
      scheduleAutoSave();
      notify('Økt generert – juster fritt', 'success');
    }
  }

  function loadTemplate(tpl) {
    if (!tpl || !tpl.blocks) return;
    var blocks = [];
    for (var i = 0; i < tpl.blocks.length; i++) {
      var step = tpl.blocks[i];
      var b = makeBlock();
      b.a.exerciseKey = step.key;
      b.a.minutes = step.min;
      blocks.push(b);
    }
    _sw.blocks = blocks;
    _sw.theme = tpl.theme || null;
    _sw.expandedBlockId = null;
    renderAll();
    scheduleAutoSave();
    notify(tpl.title + ' lastet inn', 'success');
  }

  // ─── EXERCISE PICKER (inline dropdown) ───
  function buildExerciseOptions(selectedKey) {
    var w = W();
    if (!w.NFF_CATEGORIES || !w.EXERCISES) return '<option>Laster...</option>';
    var html = '<option value="">Velg øvelse…</option>';

    // Drink always available
    html += '<option value="drink"' + (selectedKey === 'drink' ? ' selected' : '') + '>💧 Drikkepause</option>';

    for (var ci = 0; ci < w.NFF_CATEGORIES.length; ci++) {
      var cat = w.NFF_CATEGORIES[ci];
      var label = w.catLabel ? w.catLabel(cat, _sw.ageGroup) : cat.label;
      var exs = w.EXERCISES.filter(function(ex) {
        return ex.category !== 'special' && ex.nffCategory === cat.id &&
          (!ex.ages || ex.ages.indexOf(_sw.ageGroup) >= 0);
      });
      if (!exs.length) continue;
      html += '<optgroup label="' + esc(label) + '">';
      for (var ei = 0; ei < exs.length; ei++) {
        html += '<option value="' + esc(exs[ei].key) + '"' + (selectedKey === exs[ei].key ? ' selected' : '') + '>' + esc(exs[ei].label) + '</option>';
      }
      html += '</optgroup>';
    }
    return html;
  }

  // ─── RENDER: BLOCKS ───
  function renderBlocks() {
    var container = $('swBlocks');
    if (!container) return;

    if (_sw.blocks.length === 0) {
      container.innerHTML =
        '<div style="text-align:center;padding:24px 16px;color:var(--text-400);font-size:14px;">' +
          '<div style="font-size:28px;margin-bottom:8px;">📝</div>' +
          'Ingen øvelser ennå. Bruk «Generer» eller legg til manuelt.' +
        '</div>';
      return;
    }

    var w = W();
    var html = '';
    for (var i = 0; i < _sw.blocks.length; i++) {
      var b = _sw.blocks[i];
      var isExpanded = _sw.expandedBlockId === b.id;
      var ex = w.EX_BY_KEY && w.EX_BY_KEY.get(b.a.exerciseKey);
      var cat = ex && w.NFF_CATEGORY_BY_ID ? w.NFF_CATEGORY_BY_ID[ex.nffCategory] : null;
      var color = cat ? cat.color : '#94a3b8';

      if (isExpanded) {
        html += renderExpandedBlock(b, i, ex, color);
      } else {
        html += renderCollapsedBlock(b, i, ex, color);
      }
    }
    container.innerHTML = html;
    bindBlockHandlers();
  }

  function renderCollapsedBlock(b, idx, ex, color) {
    var name = ex ? ex.label : (b.a.exerciseKey || 'Velg øvelse');
    var min = b.a.minutes || 0;
    var commentHint = (b.a.comment || '').trim() ? ' 💬' : '';

    return '<div class="sw-block sw-block-collapsed" data-bid="' + b.id + '">' +
      '<div class="sw-block-stripe" style="background:' + color + ';"></div>' +
      '<div class="sw-block-num">' + (idx + 1) + '</div>' +
      '<div class="sw-block-name">' + esc(name) + commentHint + '</div>' +
      '<div class="sw-block-min">' + min + ' min</div>' +
      '<div class="sw-block-arrow">›</div>' +
    '</div>';
  }

  function renderExpandedBlock(b, idx, ex, color) {
    var w = W();
    var diagram = '';
    if (ex && ex.diagram && w.renderDrillSVG) {
      diagram = '<div class="sw-diagram">' + w.renderDrillSVG(ex.diagram) + '</div>';
    }

    var info = '';
    if (ex && ex.description) {
      info += '<div class="sw-info-desc">' + esc(ex.description) + '</div>';
      if (ex.coaching && ex.coaching.length) {
        info += '<div class="sw-info-coach">';
        for (var c = 0; c < ex.coaching.length; c++) {
          info += '<div>• ' + esc(ex.coaching[c]) + '</div>';
        }
        info += '</div>';
      }
    }

    return '<div class="sw-block sw-block-expanded" data-bid="' + b.id + '">' +
      '<div class="sw-block-stripe" style="background:' + color + ';"></div>' +
      '<div class="sw-exp-body">' +
        '<div class="sw-exp-header">' +
          '<span class="sw-exp-num">' + (idx + 1) + '.</span>' +
          '<select class="sw-select" id="swEx_' + b.id + '">' + buildExerciseOptions(b.a.exerciseKey) + '</select>' +
        '</div>' +
        '<div class="sw-exp-row">' +
          '<label class="sw-label">Minutter</label>' +
          '<input type="number" class="sw-input sw-min-input" id="swMin_' + b.id + '" min="1" max="120" value="' + (b.a.minutes || 10) + '">' +
        '</div>' +
        diagram +
        info +
        '<div class="sw-exp-row">' +
          '<label class="sw-label">Kommentar</label>' +
          '<textarea class="sw-input sw-comment" id="swComment_' + b.id + '" rows="2" placeholder="Notater til øvelsen...">' + esc(b.a.comment || '') + '</textarea>' +
        '</div>' +
        '<div class="sw-exp-actions">' +
          '<button type="button" class="sw-btn" data-act="up" data-bid="' + b.id + '" title="Flytt opp">↑</button>' +
          '<button type="button" class="sw-btn" data-act="down" data-bid="' + b.id + '" title="Flytt ned">↓</button>' +
          '<button type="button" class="sw-btn sw-btn-del" data-act="del" data-bid="' + b.id + '" title="Slett">🗑</button>' +
          '<button type="button" class="sw-btn" data-act="collapse" data-bid="' + b.id + '">▲ Lukk</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function bindBlockHandlers() {
    var container = $('swBlocks');
    if (!container) return;

    // Collapsed → expand on click
    var collapsed = container.querySelectorAll('.sw-block-collapsed');
    for (var i = 0; i < collapsed.length; i++) {
      collapsed[i].addEventListener('click', (function(bid) {
        return function() { _sw.expandedBlockId = bid; renderBlocks(); };
      })(collapsed[i].getAttribute('data-bid')));
    }

    // Expanded: bind controls
    for (var j = 0; j < _sw.blocks.length; j++) {
      var b = _sw.blocks[j];
      if (_sw.expandedBlockId !== b.id) continue;

      (function(block) {
        var exSel = $('swEx_' + block.id);
        var minInput = $('swMin_' + block.id);
        var commentInput = $('swComment_' + block.id);

        if (exSel) exSel.addEventListener('change', function() {
          block.a.exerciseKey = exSel.value;
          var meta = W().EX_BY_KEY && W().EX_BY_KEY.get(exSel.value);
          if (meta && (!block.a.minutes || block.a.minutes <= 1)) block.a.minutes = meta.defaultMin || 10;
          renderAll();
          scheduleAutoSave();
        });

        if (minInput) minInput.addEventListener('input', function() {
          block.a.minutes = Math.max(1, Math.min(120, parseInt(minInput.value) || 1));
          updateHeader();
          scheduleAutoSave();
        });

        if (commentInput) commentInput.addEventListener('input', function() {
          block.a.comment = commentInput.value || '';
          scheduleAutoSave();
        });
      })(b);
    }

    // Action buttons (up/down/del/collapse)
    var btns = container.querySelectorAll('[data-act]');
    for (var k = 0; k < btns.length; k++) {
      btns[k].addEventListener('click', (function(btn) {
        return function(e) {
          e.stopPropagation();
          var act = btn.getAttribute('data-act');
          var bid = btn.getAttribute('data-bid');
          if (act === 'collapse') { _sw.expandedBlockId = null; renderBlocks(); }
          else if (act === 'del') { deleteBlock(bid); }
          else if (act === 'up') { moveBlock(bid, -1); }
          else if (act === 'down') { moveBlock(bid, 1); }
        };
      })(btns[k]));
    }
  }

  // ─── BLOCK OPERATIONS ───
  function addBlock() {
    var b = makeBlock();
    _sw.blocks.push(b);
    _sw.expandedBlockId = b.id;
    renderBlocks();
  }

  function deleteBlock(bid) {
    var idx = -1;
    for (var i = 0; i < _sw.blocks.length; i++) { if (_sw.blocks[i].id === bid) { idx = i; break; } }
    if (idx === -1) return;
    _sw.blocks.splice(idx, 1);
    if (_sw.expandedBlockId === bid) _sw.expandedBlockId = null;
    renderAll();
    scheduleAutoSave();
  }

  function moveBlock(bid, delta) {
    var idx = -1;
    for (var i = 0; i < _sw.blocks.length; i++) { if (_sw.blocks[i].id === bid) { idx = i; break; } }
    if (idx === -1) return;
    var newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= _sw.blocks.length) return;
    var tmp = _sw.blocks[idx];
    _sw.blocks[idx] = _sw.blocks[newIdx];
    _sw.blocks[newIdx] = tmp;
    renderAll();
    scheduleAutoSave();
  }

  // ─── HEADER ───
  function updateHeader() {
    var totalEl = $('swTotal');
    if (totalEl) totalEl.textContent = totalMinutes() + ' min';
    var countEl = $('swCount');
    if (countEl) {
      var real = _sw.blocks.filter(function(b) { return b.a.exerciseKey && b.a.exerciseKey !== 'drink'; }).length;
      countEl.textContent = real + ' øvelser';
    }
    var balEl = $('swBalanceBar');
    if (balEl) balEl.innerHTML = renderBalanceBar();
  }

  // ─── MASTER RENDER ───
  function renderAll() {
    if (!_swContainer) return;

    var w = W();
    var title = _swOpts.title || 'Trening';
    var themeLabel = '';
    if (_sw.theme && w.NFF_THEME_BY_ID && w.NFF_THEME_BY_ID[_sw.theme]) {
      var tm = w.NFF_THEME_BY_ID[_sw.theme];
      themeLabel = '<span class="sw-theme-pill">' + esc(tm.icon) + ' ' + esc(tm.label) +
        '<button type="button" class="sw-theme-x" id="swThemeX">✕</button></span>';
    }

    var html =
      '<div class="sw-wrap">' +
        '<div class="sw-header">' +
          '<button type="button" class="sw-back" id="swBack"><i class="fas fa-chevron-left"></i> Tilbake</button>' +
          '<div class="sw-header-title">🏋 ' + esc(title) + '</div>' +
        '</div>' +
        '<div class="sw-meta">' +
          '<div class="sw-meta-row">' +
            '<span class="sw-total" id="swTotal">' + totalMinutes() + ' min</span>' +
            '<span class="sw-count" id="swCount">' + _sw.blocks.filter(function(b) { return b.a.exerciseKey && b.a.exerciseKey !== 'drink'; }).length + ' øvelser</span>' +
            '<span class="sw-age">' + esc(_sw.ageGroup) + ' år</span>' +
            themeLabel +
          '</div>' +
          '<div id="swBalanceBar">' + renderBalanceBar() + '</div>' +
        '</div>' +

        '<button type="button" class="sw-gen-cta' + (_sw.genOpen ? ' sw-gen-cta-open' : '') + '" id="swGenCta">' +
          '<i class="fas fa-magic"></i> ' + (_sw.genOpen ? 'Lukk' : 'Generer treningsøkt') +
        '</button>' +
        '<div id="swGenPanel">' + renderGenerer() + '</div>' +

        '<div id="swBlocks"></div>' +

        '<button type="button" class="sw-add-btn" id="swAddBtn">+ Legg til øvelse</button>' +

        '<div class="sw-autosave-hint">Endringer lagres automatisk</div>' +
      '</div>';

    _swContainer.innerHTML = html;

    // Render blocks separately (into swBlocks div)
    renderBlocks();

    // Bind top-level handlers
    bindTopHandlers();
  }

  function bindTopHandlers() {
    // Back
    var backBtn = $('swBack');
    if (backBtn) backBtn.addEventListener('click', async function() {
      if (_swSaveTimer) { clearTimeout(_swSaveTimer); _swSaveTimer = null; }
      // Wait for any in-flight save to complete
      var waitCount = 0;
      while (_swSaving && waitCount < 20) { await new Promise(function(r) { setTimeout(r, 100); }); waitCount++; }
      // Force final save (await to ensure it completes before destroy)
      if (_swCallbacks.onSave && _sw.blocks.length > 0) {
        await _swCallbacks.onSave({
          blocks: _sw.blocks.map(function(b) {
            return { kind: 'single', a: { exerciseKey: b.a.exerciseKey, minutes: b.a.minutes, comment: b.a.comment || '' } };
          }),
          theme: _sw.theme,
          ageGroup: _sw.ageGroup,
          duration: totalMinutes(),
          seasonId: _swOpts.seasonId || null,
          dbId: _swDbId
        });
      }
      if (_swCallbacks.onBack) _swCallbacks.onBack();
    });

    // Add exercise
    var addBtn = $('swAddBtn');
    if (addBtn) addBtn.addEventListener('click', addBlock);

    // Generer CTA toggle
    var genCta = $('swGenCta');
    if (genCta) genCta.addEventListener('click', function() {
      _sw.genOpen = !_sw.genOpen;
      renderAll();
    });

    // Theme remove
    var themeX = $('swThemeX');
    if (themeX) themeX.addEventListener('click', function(e) {
      e.stopPropagation();
      _sw.theme = null;
      renderAll();
      scheduleAutoSave();
    });

    // Generer panel bindings
    bindGenererHandlers();
  }

  function bindGenererHandlers() {
    var w = W();

    // Template pills
    var tplBtns = document.querySelectorAll('[data-tpl]');
    for (var t = 0; t < tplBtns.length; t++) {
      tplBtns[t].addEventListener('click', (function(btn) {
        return function() {
          var templates = (w.NFF_TEMPLATES && w.NFF_TEMPLATES[_sw.ageGroup]) || [];
          var tpl = templates[parseInt(btn.getAttribute('data-tpl'))];
          if (tpl) { loadTemplate(tpl); _sw.genOpen = false; }
        };
      })(tplBtns[t]));
    }

    // Theme pills
    var themeBtns = document.querySelectorAll('[data-theme]');
    for (var i = 0; i < themeBtns.length; i++) {
      themeBtns[i].addEventListener('click', (function(btn) {
        return function() {
          var tid = btn.getAttribute('data-theme');
          _sw.genTheme = _sw.genTheme === tid ? null : tid;
          renderAll();
        };
      })(themeBtns[i]));
    }

    // Duration pills
    var durBtns = document.querySelectorAll('[data-dur]');
    for (var d = 0; d < durBtns.length; d++) {
      durBtns[d].addEventListener('click', (function(btn) {
        return function() {
          _sw.genDuration = parseInt(btn.getAttribute('data-dur'));
          renderAll();
        };
      })(durBtns[d]));
    }

    // Generate button
    var goBtn = $('swGenGo');
    if (goBtn) goBtn.addEventListener('click', function() {
      if (_sw.genTheme) {
        generateWorkout(_sw.genTheme, _sw.genDuration);
        _sw.genOpen = false;
      }
    });
  }

  function notify(msg, type) {
    if (window.showNotification) window.showNotification(msg, type || 'info');
  }

  // ─── CSS (injected once) ───
  var _swCssInjected = false;
  function injectCss() {
    if (_swCssInjected) return;
    _swCssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '.sw-wrap { max-width:600px; margin:0 auto; }',

      '.sw-header { display:flex; align-items:center; gap:10px; margin-bottom:12px; }',
      '.sw-back { background:none; border:none; color:var(--primary, #0b5bd3); font-size:14px; font-weight:600; cursor:pointer; padding:8px 4px; }',
      '.sw-header-title { font-size:18px; font-weight:800; color:var(--text-800); }',

      '.sw-meta { background:var(--bg-card, #fff); border-radius:14px; padding:12px 16px; margin-bottom:12px; border:1px solid var(--border, #e2e8f0); }',
      '.sw-meta-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px; margin-bottom:6px; }',
      '.sw-total { font-size:20px; font-weight:900; color:var(--text-800); }',
      '.sw-count, .sw-age { color:var(--text-400); font-weight:600; }',
      '.sw-theme-pill { display:inline-flex; align-items:center; gap:4px; background:rgba(11,91,211,0.08); color:var(--primary, #0b5bd3); padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700; }',
      '.sw-theme-x { background:none; border:none; color:var(--primary); cursor:pointer; font-size:12px; padding:0 0 0 4px; }',

      '.sw-balance { display:flex; gap:3px; height:24px; border-radius:8px; overflow:hidden; }',
      '.sw-bal-seg { display:flex; align-items:center; justify-content:center; border-radius:6px; transition:flex 0.3s; }',
      '.sw-bal-label { font-size:9px; font-weight:800; color:var(--text-600); white-space:nowrap; overflow:hidden; }',

      '.sw-gen-cta { width:100%; padding:12px; border:2px solid var(--primary, #0b5bd3); border-radius:14px; background:rgba(11,91,211,0.04); color:var(--primary); font-size:14px; font-weight:800; cursor:pointer; margin-bottom:12px; text-align:center; }',
      '.sw-gen-cta-open { background:var(--primary); color:#fff; }',

      '.sw-gen { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:14px; margin-bottom:12px; }',
      '.sw-gen-label { font-size:12px; font-weight:700; color:var(--text-500); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; margin-top:8px; }',
      '.sw-gen-label:first-child { margin-top:0; }',
      '.sw-gen-pills { display:flex; flex-wrap:wrap; gap:6px; }',
      '.sw-pill { padding:7px 12px; border-radius:10px; border:1.5px solid var(--border, #e2e8f0); background:var(--bg-card); color:var(--text-700); font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }',
      '.sw-pill:hover { border-color:var(--primary); }',
      '.sw-pill-sel { border-color:var(--primary); background:var(--primary); color:#fff; }',
      '.sw-gen-go { width:100%; padding:12px; border:none; border-radius:12px; background:var(--primary, #0b5bd3); color:#fff; font-size:14px; font-weight:800; cursor:pointer; margin-top:12px; }',
      '.sw-gen-go:disabled { opacity:0.4; cursor:not-allowed; }',

      '.sw-block { display:flex; align-items:stretch; background:var(--bg-card, #fff); border:1px solid var(--border, #e2e8f0); border-radius:12px; margin-bottom:6px; overflow:hidden; cursor:pointer; transition:box-shadow 0.15s; }',
      '.sw-block:hover { box-shadow:0 2px 8px rgba(0,0,0,0.06); }',
      '.sw-block-stripe { width:4px; flex-shrink:0; }',
      '.sw-block-num { width:28px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:var(--text-400); flex-shrink:0; }',
      '.sw-block-name { flex:1; padding:12px 8px; font-size:14px; font-weight:600; color:var(--text-800); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.sw-block-min { padding:12px 10px; font-size:13px; font-weight:700; color:var(--text-500); white-space:nowrap; }',
      '.sw-block-arrow { padding:12px 10px 12px 0; color:var(--text-300); font-size:16px; }',

      '.sw-block-expanded { cursor:default; flex-direction:column; }',
      '.sw-block-expanded .sw-block-stripe { width:100%; height:4px; }',
      '.sw-exp-body { padding:14px; }',
      '.sw-exp-header { display:flex; align-items:center; gap:8px; margin-bottom:10px; }',
      '.sw-exp-num { font-size:14px; font-weight:800; color:var(--text-400); }',
      '.sw-select { flex:1; padding:10px 12px; border:1.5px solid var(--border); border-radius:10px; font-size:14px; font-weight:600; background:var(--bg-card); color:var(--text-800); appearance:auto; }',
      '.sw-exp-row { margin-bottom:10px; }',
      '.sw-label { display:block; font-size:12px; font-weight:700; color:var(--text-500); margin-bottom:4px; }',
      '.sw-input { width:100%; padding:8px 12px; border:1.5px solid var(--border); border-radius:10px; font-size:14px; background:var(--bg-card); color:var(--text-800); box-sizing:border-box; }',
      '.sw-min-input { max-width:100px; }',
      '.sw-comment { resize:vertical; min-height:40px; font-size:13px; }',

      '.sw-diagram { margin:8px 0; text-align:center; }',
      '.sw-diagram svg { max-width:240px; border-radius:10px; background:#1a2e1a; padding:8px; }',
      '.sw-info-desc { font-size:13px; color:var(--text-600); line-height:1.45; margin:6px 0; }',
      '.sw-info-coach { font-size:12px; color:var(--text-500); line-height:1.5; margin:4px 0 8px; }',

      '.sw-exp-actions { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }',
      '.sw-btn { padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg-card); font-size:13px; font-weight:600; cursor:pointer; color:var(--text-600); }',
      '.sw-btn:hover { background:var(--bg, #f1f5f9); }',
      '.sw-btn-del { color:#e74c3c; }',

      '.sw-add-btn { width:100%; padding:14px; border:2px dashed var(--border, #e2e8f0); border-radius:14px; background:transparent; color:var(--text-400); font-size:14px; font-weight:700; cursor:pointer; margin-top:4px; }',
      '.sw-add-btn:hover { border-color:var(--primary); color:var(--primary); }',

      '.sw-autosave-hint { text-align:center; font-size:11px; color:var(--text-300); margin-top:12px; padding-bottom:20px; }',

      '@media(max-width:500px) {',
      '  .sw-pill { font-size:12px; padding:6px 10px; }',
      '  .sw-select { font-size:13px; padding:8px 10px; }',
      '  .sw-block-name { font-size:13px; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ─── INIT / DESTROY ───
  function init(container, players, opts) {
    if (_swActive) destroy();
    injectCss();

    _swActive = true;
    _swContainer = container;
    _swOpts = opts || {};
    _swCallbacks = { onSave: opts.onSave || null, onBack: opts.onBack || null };
    _swDbId = opts.existingDbId || null;
    _swIdCounter = 0;

    // Set state
    _sw.ageGroup = opts.ageGroup || '8-9';
    _sw.theme = opts.existingTheme || null;
    _sw.genDuration = opts.minutes || 60;
    _sw.genOpen = false;
    _sw.genTheme = null;
    _sw.expandedBlockId = null;

    // Load existing blocks or start empty
    if (opts.existingBlocks && Array.isArray(opts.existingBlocks) && opts.existingBlocks.length > 0) {
      _sw.blocks = opts.existingBlocks.map(function(b) {
        var nb = makeBlock();
        nb.a.exerciseKey = (b.a && b.a.exerciseKey) || '';
        nb.a.minutes = (b.a && b.a.minutes) || 10;
        nb.a.comment = (b.a && b.a.comment) || '';
        return nb;
      });
    } else {
      _sw.blocks = [];
    }

    renderAll();
  }

  function destroy() {
    if (_swSaveTimer) { clearTimeout(_swSaveTimer); _swSaveTimer = null; }
    // Fire-and-forget final save for unsaved changes
    if (_swActive && _swCallbacks.onSave && _sw.blocks.length > 0 && !_swSaving) {
      try {
        _swCallbacks.onSave({
          blocks: _sw.blocks.map(function(b) {
            return { kind: 'single', a: { exerciseKey: b.a.exerciseKey, minutes: b.a.minutes, comment: b.a.comment || '' } };
          }),
          theme: _sw.theme,
          ageGroup: _sw.ageGroup,
          duration: totalMinutes(),
          seasonId: _swOpts.seasonId || null,
          dbId: _swDbId
        });
      } catch (e) { /* best effort */ }
    }
    if (_swContainer) _swContainer.innerHTML = '';
    _swActive = false;
    _swContainer = null;
    _swCallbacks = {};
    _swSaving = false;
    _sw.blocks = [];
    _sw.expandedBlockId = null;
    _sw.genOpen = false;
  }

  // ─── PUBLIC API ───
  window.sesongWorkout = {
    init: init,
    destroy: destroy,
    isActive: function() { return _swActive; }
  };

})();
