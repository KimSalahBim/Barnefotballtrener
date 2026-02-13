// © 2026 Barnefotballtrener.no. All rights reserved.
// Barnefotballtrener - kampdag.js
// Kampdag: oppmøte -> start/benk -> bytteplan med roligere bytter og bedre spilletidsfordeling.
// Bruker global variabel "window.players" (Array) som settes av core.js.

console.log('🔥🔥🔥 KAMPDAG.JS LOADING - BEFORE IIFE');

(function () {
  'use strict';
  console.log('🔥 KAMPDAG.JS - INSIDE IIFE');
  // ------------------------------
  // Utils
  // ------------------------------
  function $(id) { return document.getElementById(id); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function getPlayersArray() {
    const raw = window.players;
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.players)) return raw.players;
    return [];
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  // seedet RNG
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) { return mulberry32(seed || Date.now()); }

  function uniqSorted(nums) {
    const s = Array.from(new Set(nums.map(n => Math.round(n))));
    s.sort((a, b) => a - b);
    return s;
  }

  // ------------------------------
  // State
  // ------------------------------
  let kdSelected = new Set();
  let kdPreviousPlayerIds = new Set(); // track known player IDs to detect additions vs deselections
  let lastPlanText = '';
  let lastBest = null;          // last generated plan result
  let lastPresent = [];         // last present players
  let lastP = 7;                // last format
  let lastT = 48;               // last total minutes
  let lastFormation = null;     // formation array at generation time
  let lastFormationKey = '';    // formation label at generation time
  let lastUseFormation = false; // whether formation was active at generation
  let lastPositions = {};       // position preferences snapshot at generation

  // Formation state
  let kdFormationOn = false;
  let kdFormation = null;       // e.g. [2,3,1]
  let kdFormationKey = '';      // e.g. '2-3-1'

  // Build positions map from player data (set in core.js Spillere-fanen)
  function getPositionsMap() {
    const map = {};
    getPlayersArray().forEach(p => {
      const pos = Array.isArray(p.positions) ? p.positions : ['F','M','A'];
      map[p.id] = new Set(pos.length ? pos : ['F','M','A']);
    });
    return map;
  }

  // Frequency state
  let kdFrequency = 'normal';   // 'rare','normal','frequent'

  // Timer state
  let kdTimerInterval = null;
  let kdTimerStart = null;      // Date.now() when started
  let kdTimerPaused = false;
  let kdTimerPausedElapsed = 0; // ms elapsed when paused

  // Formation presets per format
  const FORMATIONS = {
    3: { '1-1-1': [1,1,1] },
    5: { '2-1-1': [2,1,1], '1-2-1': [1,2,1], '2-2-0': [2,2,0] },
    7: { '2-3-1': [2,3,1], '3-2-1': [3,2,1], '2-2-2': [2,2,2], '1-3-2': [1,3,2] },
    9: { '3-3-2': [3,3,2], '3-4-1': [3,4,1], '2-4-2': [2,4,2] },
    11: { '4-3-3': [4,3,3], '4-4-2': [4,4,2], '3-5-2': [3,5,2] },
  };

  const FREQ_PARAMS = {
    rare:     { minGap: 8, maxGap: 12, stopsMin: 3, stopsMax: 6 },
    normal:   { minGap: 5, maxGap: 10, stopsMin: 6, stopsMax: 10 },
    frequent: { minGap: 3, maxGap: 5,  stopsMin: 8, stopsMax: 14 },
  };

  // ------------------------------
  // Init
  // ------------------------------
  
  // Register event listener IMMEDIATELY (not waiting for DOMContentLoaded)
  console.log('[Kampdag] Script loaded - registering event listener');

  // Reset kampdag when team changes
  window.addEventListener('team:changed', () => {
    console.log('[Kampdag] team:changed — resetting kampdag state');
    try {
      // Stop timer if running
      if (kdTimerInterval || kdTimerStart) stopMatchTimer();
      // Clear plan state
      lastBest = null;
      lastPresent = [];
      lastPlanText = '';
      lastFormation = null;
      lastFormationKey = '';
      lastUseFormation = false;
      lastPositions = {};
      // Clear output areas
      const lineupEl = $('kdLineup');
      const planEl = $('kdPlan');
      const metaEl = $('kdMeta');
      const startBtn = $('kdStartMatch');
      if (lineupEl) lineupEl.innerHTML = '';
      if (planEl) planEl.innerHTML = '';
      if (metaEl) metaEl.textContent = '';
      if (startBtn) startBtn.style.display = 'none';
    } catch (err) {
      console.error('[Kampdag] Error in team:changed handler:', err);
    }
  });

  window.addEventListener('players:updated', (e) => {
    console.log('[Kampdag] players:updated event mottatt:', e.detail);
    try {
      // Sync selection: add new players, remove deleted ones, preserve user's deselections
      const currentIds = new Set(getPlayersArray().map(p => p.id));
      // Remove IDs that no longer exist
      for (const id of kdSelected) {
        if (!currentIds.has(id)) kdSelected.delete(id);
      }
      // Add new players (that weren't in previous set)
      for (const id of currentIds) {
        if (!kdSelected.has(id) && !kdPreviousPlayerIds.has(id)) {
          kdSelected.add(id);
        }
      }
      kdPreviousPlayerIds = currentIds;
      renderKampdagPlayers();
      updateKampdagCounts();
      if (kdFormationOn) { renderPositionList(); updateCoverage(); }
      console.log('[Kampdag] Players re-rendered, count:', getPlayersArray().length);
    } catch (err) {
      console.error('[Kampdag] Error in players:updated handler:', err);
    }
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Kampdag] DOMContentLoaded');
    const root = $('kampdag');
    if (!root) {
      console.log('[Kampdag] Root element ikke funnet');
      return;
    }

    bindKampdagUI();
    
    // Sjekk om spillere allerede er tilgjengelig
    const players = getPlayersArray();
    console.log('[Kampdag] Initial players:', players.length);
    if (players.length > 0) {
      kdSelected = new Set(players.map(p => p.id));
      kdPreviousPlayerIds = new Set(players.map(p => p.id));
    }
    renderKampdagPlayers();
    refreshKeeperUI();
    updateKampdagCounts();
  });

  function bindKampdagUI() {
    const formatEl = $('kdFormat');
    const minutesEl = $('kdMinutes');
    const selectAllBtn = $('kdSelectAll');
    const deselectAllBtn = $('kdDeselectAll');
    const refreshBtn = $('kdRefresh');
    const manualKeeperEl = $('kdManualKeeper');
    const keeperCountEl = $('kdKeeperCount');
    const genBtn = $('kdGenerate');
    const copyBtn = $('kdCopy');

    if (formatEl) formatEl.addEventListener('change', () => {
      refreshKeeperUI();
      updateKampdagCounts();
    });
    if (minutesEl) minutesEl.addEventListener('input', () => {
      refreshKeeperUI();
      updateKampdagCounts();
      updateKeeperSummary();
    });

    if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
      kdSelected = new Set(getPlayersArray().map(p => p.id));
      renderKampdagPlayers();
      refreshKeeperUI();
      if (kdFormationOn) { renderPositionList(); updateCoverage(); }
    });

    if (deselectAllBtn) deselectAllBtn.addEventListener('click', () => {
      kdSelected = new Set();
      renderKampdagPlayers();
      refreshKeeperUI();
      if (kdFormationOn) { renderPositionList(); updateCoverage(); }
    });

    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      renderKampdagPlayers();
      refreshKeeperUI();
      updateKampdagCounts();
    });

    if (manualKeeperEl) manualKeeperEl.addEventListener('change', () => {
      refreshKeeperUI();
      updateKeeperSummary();
    });

    if (keeperCountEl) keeperCountEl.addEventListener('change', () => {
      refreshKeeperUI();
      updateKeeperSummary();
    });

    for (let i = 1; i <= 4; i++) {
      const sel = $(`kdKeeper${i}`);
      const min = $(`kdKeeperMin${i}`);
      if (sel) sel.addEventListener('change', updateKeeperSummary);
      if (min) min.addEventListener('input', updateKeeperSummary);
    }

    if (genBtn) genBtn.addEventListener('click', generateKampdagPlan);
    if (copyBtn) copyBtn.addEventListener('click', copyKampdagPlan);

    const pdfBtn = $('kdExportPdf');
    if (pdfBtn) pdfBtn.addEventListener('click', exportKampdagPdf);

    const startBtn = $('kdStartMatch');
    if (startBtn) startBtn.addEventListener('click', startMatchTimer);

    const pauseBtn = $('kdTimerPause');
    if (pauseBtn) pauseBtn.addEventListener('click', toggleTimerPause);

    const stopBtn = $('kdTimerStop');
    if (stopBtn) stopBtn.addEventListener('click', stopMatchTimer);

    // Frequency buttons
    const freqContainer = $('kdFreqOptions');
    if (freqContainer) {
      freqContainer.querySelectorAll('.kd-freq-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          freqContainer.querySelectorAll('.kd-freq-btn').forEach(b => b.classList.remove('kd-freq-active'));
          btn.classList.add('kd-freq-active');
          kdFrequency = btn.getAttribute('data-freq') || 'normal';
        });
      });
    }

    // Formation toggle
    const formToggle = $('kdFormationToggle');
    if (formToggle) formToggle.addEventListener('change', () => {
      kdFormationOn = formToggle.checked;
      const panel = $('kdFormationPanel');
      if (panel) panel.style.display = kdFormationOn ? 'block' : 'none';
      if (kdFormationOn) renderFormationGrid();
    });

    // Formation changes when format changes
    if (formatEl) formatEl.addEventListener('change', () => {
      if (kdFormationOn) renderFormationGrid();
    });
  }

  // ------------------------------
  // Render player selection
  // ------------------------------
  function renderKampdagPlayers() {
    const container = $('kdPlayerSelection');
    if (!container) return;

    const list = getPlayersArray().slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));

    container.innerHTML = list.map(p => {
      const checked = kdSelected.has(p.id) ? 'checked' : '';
      return `
        <label class="player-checkbox">
          <input type="checkbox" data-id="${escapeHtml(p.id)}" ${checked}>
          <span class="checkmark"></span>
          <div class="player-details">
            <div class="player-name">${escapeHtml(p.name)}</div>
            <div class="player-meta">${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}</div>
          </div>
        </label>
      `;
    }).join('');

    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-id');
        if (cb.checked) kdSelected.add(id);
        else kdSelected.delete(id);
        updateKampdagCounts();
        refreshKeeperUI();
        updateKeeperSummary();
        if (kdFormationOn) { renderPositionList(); updateCoverage(); }
      });
    });

    updateKampdagCounts();
  }

  function updateKampdagCounts() {
    const countEl = $('kdPresentCount');
    if (countEl) countEl.textContent = String(kdSelected.size);

    const info = $('kdAutoInfo');
    const format = parseInt($('kdFormat')?.value, 10) || 7;
    const minutes = clamp(parseInt($('kdMinutes')?.value, 10) || 48, 10, 200);

    const onField = format;
    if (info) {
      info.textContent = `${kdSelected.size} på oppmøte • ${onField} på banen • ${minutes} min`;
    }
  }

  // ------------------------------
  // Keeper UI
  // ------------------------------
  function refreshKeeperUI() {
    const format = parseInt($('kdFormat')?.value, 10) || 7;

    const manualWrap = $('kdManualKeeper')?.closest('label');
    const panel = $('kdKeeperPanel');
    const manual = $('kdManualKeeper');

    if (format === 3) {
      if (manualWrap) manualWrap.style.display = 'none';
      if (panel) panel.style.display = 'none';
      if (manual) manual.checked = false;
      if ($('kdKeeperHint')) $('kdKeeperHint').textContent = '3-er: ingen keeper.';
      return;
    } else {
      if (manualWrap) manualWrap.style.display = '';
      if ($('kdKeeperHint')) $('kdKeeperHint').textContent = 'Velg antall keepere, deretter hvem + minutter.';
    }

    const isManual = !!manual?.checked;
    if (panel) panel.style.display = isManual ? 'block' : 'none';

    const present = getPresentPlayers();
    const opts = makeKeeperOptions(present);

    for (let i = 1; i <= 4; i++) {
      const sel = $(`kdKeeper${i}`);
      if (!sel) continue;

      const prev = sel.value;
      sel.innerHTML = opts;

      if (prev && Array.from(sel.options).some(o => o.value === prev)) {
        sel.value = prev;
      } else {
        sel.value = '';
      }
    }

    const kc = clamp(parseInt($('kdKeeperCount')?.value, 10) || 0, 0, 4);
    for (let i = 1; i <= 4; i++) {
      const row = document.querySelector(`.kd-keeper-row[data-row="${i}"]`);
      if (row) row.style.display = (i <= kc) ? 'flex' : 'none';
    }

    updateKeeperSummary();
  }

  function makeKeeperOptions(presentPlayers) {
    const header = `<option value="">Velg spiller</option>`;
    const items = presentPlayers.map(p => {
      const icon = p.goalie ? '🧤' : '⚽';
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} ${icon}</option>`;
    }).join('');
    return header + items;
  }

  function updateKeeperSummary() {
    const summary = $('kdKeeperSummary');
    if (!summary) return;

    const format = parseInt($('kdFormat')?.value, 10) || 7;
    const T = clamp(parseInt($('kdMinutes')?.value, 10) || 48, 10, 200);

    if (format === 3) {
      summary.textContent = '3-er: ingen keeper.';
      return;
    }

    const manual = !!$('kdManualKeeper')?.checked;
    if (!manual) {
      summary.textContent = 'Manuell keeper er av. (Appen planlegger uten keeper-krav.)';
      return;
    }

    const kc = clamp(parseInt($('kdKeeperCount')?.value, 10) || 0, 0, 4);
    let sum = 0;
    let chosen = 0;
    const warnings = [];
    const selectedPids = [];
    let t = 0;
    const actualAlloc = [];

    for (let i = 1; i <= kc; i++) {
      const pid = $(`kdKeeper${i}`)?.value || '';
      const min = clamp(parseInt($(`kdKeeperMin${i}`)?.value, 10) || 0, 0, 999);
      if (pid) {
        chosen++;
        if (selectedPids.includes(pid)) warnings.push('⚠ Samme keeper valgt flere ganger');
        selectedPids.push(pid);
      }
      sum += min;
      // Compute actual allocation (like buildKeeperTimeline)
      if (min > 0 && t < T) {
        const actual = Math.min(min, T - t);
        actualAlloc.push(actual);
        t += actual;
      } else {
        actualAlloc.push(0);
      }
    }

    // Warn if keepers get no time
    for (let i = 0; i < kc; i++) {
      if (actualAlloc[i] === 0 && (clamp(parseInt($(`kdKeeperMin${i + 1}`)?.value, 10) || 0, 0, 999) > 0)) {
        warnings.push(`⚠ Keeper ${i + 1} får ingen tid (total overstiger ${T} min)`);
      }
    }

    const ok = (chosen === kc) && (sum === T);
    let msg = `Velg keeper(e) — Sum: ${sum}/${T} (${ok ? 'OK' : 'SJEKK'})`;
    if (sum > T && sum !== T) {
      msg += ` — Capped til ${T} min totalt`;
    }
    if (warnings.length) {
      msg += '\n' + warnings.join('\n');
    }
    summary.textContent = msg;
  }

  // ------------------------------
  // Formation & positions
  // ------------------------------
  function getDefaultFormationKey(format) {
    const map = { 3: '1-1-1', 5: '2-1-1', 7: '2-3-1', 9: '3-3-2', 11: '4-3-3' };
    return map[format] || '2-3-1';
  }

  function renderFormationGrid() {
    const grid = $('kdFormationGrid');
    if (!grid) return;
    const format = parseInt($('kdFormat')?.value, 10) || 7;
    const opts = FORMATIONS[format] || FORMATIONS[7];

    if (!kdFormationKey || !opts[kdFormationKey]) {
      kdFormationKey = getDefaultFormationKey(format);
    }
    kdFormation = opts[kdFormationKey] || Object.values(opts)[0];

    grid.innerHTML = Object.entries(opts).map(([key, arr]) => {
      const active = key === kdFormationKey ? 'kd-formation-active' : '';
      return `<div class="kd-formation-opt ${active}" data-fkey="${key}">
        <div class="kd-f-name">${key}</div>
        <div class="kd-f-desc">${arr[0]} forsvar · ${arr[1]} midtbane · ${arr[2]} angrep</div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.kd-formation-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const key = opt.getAttribute('data-fkey');
        kdFormationKey = key;
        kdFormation = opts[key];
        grid.querySelectorAll('.kd-formation-opt').forEach(o => o.classList.remove('kd-formation-active'));
        opt.classList.add('kd-formation-active');
        updateCoverage();
      });
    });

    renderPositionList();
    updateCoverage();
  }

  function renderPositionList() {
    const container = $('kdPositionList');
    if (!container) return;
    const present = getPresentPlayers();
    const posMap = getPositionsMap();

    container.innerHTML = present.map(p => {
      const pos = posMap[p.id] || new Set(['F', 'M', 'A']);
      return `<div class="kd-pos-row">
        <div class="kd-pos-name">${escapeHtml(p.name)}</div>
        <div class="kd-pos-checks">
          <span class="kd-pos-tag ${pos.has('F') ? 'kd-pos-f-on' : ''}" style="pointer-events:none;">F</span>
          <span class="kd-pos-tag ${pos.has('M') ? 'kd-pos-m-on' : ''}" style="pointer-events:none;">M</span>
          <span class="kd-pos-tag ${pos.has('A') ? 'kd-pos-a-on' : ''}" style="pointer-events:none;">A</span>
        </div>
      </div>`;
    }).join('');
  }

  function updateCoverage() {
    const el = $('kdCoverage');
    if (!el || !kdFormation) { if (el) el.style.display = 'none'; return; }

    const present = getPresentPlayers();
    const posMap = getPositionsMap();
    const counts = { F: 0, M: 0, A: 0 };
    present.forEach(p => {
      const pos = posMap[p.id] || new Set(['F', 'M', 'A']);
      if (pos.has('F')) counts.F++;
      if (pos.has('M')) counts.M++;
      if (pos.has('A')) counts.A++;
    });

    const needs = { F: kdFormation[0], M: kdFormation[1], A: kdFormation[2] };
    const zones = [
      { key: 'F', name: 'Forsvar', need: needs.F, have: counts.F, color: '#16a34a' },
      { key: 'M', name: 'Midtbane', need: needs.M, have: counts.M, color: '#2563eb' },
      { key: 'A', name: 'Angrep', need: needs.A, have: counts.A, color: '#dc2626' },
    ];

    const warn = zones.some(z => z.have < z.need);
    el.style.display = 'block';
    el.style.background = warn ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.06)';
    el.style.color = warn ? '#d97706' : '#16a34a';

    el.innerHTML = `<div style="font-weight:800; margin-bottom:6px;">${warn ? '⚠ ' : ''}Sonedekning for ${kdFormationKey}</div>` +
      zones.map(z => {
        const pct = Math.min(100, Math.round((z.have / Math.max(1, present.length)) * 100));
        const low = z.have < z.need;
        return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">
          <span style="width:8px;height:8px;border-radius:50%;background:${z.color};flex-shrink:0;"></span>
          <span style="width:72px;">${z.name} (${z.need})</span>
          <div style="flex:1;height:6px;background:rgba(0,0,0,0.06);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${low ? '#d97706' : z.color};border-radius:3px;"></div>
          </div>
          <span style="width:32px;text-align:right;font-weight:800;${low ? 'color:#d97706;' : ''}">${z.have}${low ? ' ⚠' : ''}</span>
        </div>`;
      }).join('') +
      (warn ? `<div style="margin-top:6px;font-size:12px;">Noen spillere vil bli plassert utenfor preferanse.</div>` : '');
  }

  // Assign positions to a lineup based on formation + preferences
  function assignZones(lineup, keeperId, formation, positions) {
    if (!formation) return null;
    const posMap = positions || getPositionsMap();
    const outfield = lineup.filter(id => id !== keeperId);
    let [defN, midN, attN] = formation;
    const formationSum = defN + midN + attN;

    // If no keeper set, outfield has 1 extra player vs formation design.
    // Inflate zone needs to accommodate: distribute extras to largest zones first.
    let diff = outfield.length - formationSum;
    if (diff < 0) return null; // fewer players than formation needs
    if (diff > 0) {
      // Distribute extra slots to zones, largest first
      const inflate = [
        { zone: 'M', n: midN },
        { zone: 'F', n: defN },
        { zone: 'A', n: attN }
      ].sort((a, b) => b.n - a.n);
      let idx = 0;
      while (diff > 0) {
        if (inflate[idx].zone === 'F') defN++;
        else if (inflate[idx].zone === 'M') midN++;
        else attN++;
        diff--;
        idx = (idx + 1) % inflate.length;
      }
    }

    const zones = { F: [], M: [], A: [] };
    const zoneNeeds = { F: defN, M: midN, A: attN };
    const assigned = new Set();
    const overflows = [];

    // Phase 1: Single-zone preference (most constrained)
    for (const id of outfield) {
      if (assigned.has(id)) continue;
      const prefs = posMap[id] || new Set(['F', 'M', 'A']);
      if (prefs.size !== 1) continue;
      const zone = [...prefs][0];
      if (zones[zone].length < zoneNeeds[zone]) {
        zones[zone].push(id); assigned.add(id);
      }
    }

    // Phase 2: Dual-zone preference
    for (const id of outfield) {
      if (assigned.has(id)) continue;
      const prefs = posMap[id] || new Set(['F', 'M', 'A']);
      if (prefs.size !== 2) continue;
      const avail = [...prefs].filter(z => zones[z].length < zoneNeeds[z])
        .sort((a, b) => (zoneNeeds[b] - zones[b].length) - (zoneNeeds[a] - zones[a].length));
      if (avail.length) { zones[avail[0]].push(id); assigned.add(id); }
    }

    // Phase 3: Flexible (3 zones or unset)
    for (const id of outfield) {
      if (assigned.has(id)) continue;
      const prefs = posMap[id] || new Set(['F', 'M', 'A']);
      const avail = ['F', 'M', 'A'].filter(z => zones[z].length < zoneNeeds[z])
        .filter(z => prefs.has(z))
        .sort((a, b) => (zoneNeeds[b] - zones[b].length) - (zoneNeeds[a] - zones[a].length));
      if (avail.length) { zones[avail[0]].push(id); assigned.add(id); }
    }

    // Phase 4: Force-place (overflow)
    for (const id of outfield) {
      if (assigned.has(id)) continue;
      const avail = ['F', 'M', 'A'].filter(z => zones[z].length < zoneNeeds[z]);
      if (avail.length) {
        zones[avail[0]].push(id); assigned.add(id);
        overflows.push(id);
      }
    }

    return { zones, overflows };
  }

  // ------------------------------
  // Plan generation helpers
  // ------------------------------
  function getPresentPlayers() {
    const all = getPlayersArray();
    return all.filter(p => kdSelected.has(p.id));
  }

  function buildKeeperTimeline(T) {
    const format = parseInt($('kdFormat')?.value, 10) || 7;
    const manual = !!$('kdManualKeeper')?.checked;

    if (format === 3 || !manual) return [];

    const kc = clamp(parseInt($('kdKeeperCount')?.value, 10) || 0, 0, 4);
    if (kc <= 0) return [];

    const timeline = [];
    let t = 0;

    for (let i = 1; i <= kc; i++) {
      const pid = $(`kdKeeper${i}`)?.value || '';
      const minsRaw = parseInt($(`kdKeeperMin${i}`)?.value, 10) || 0;
      const mins = clamp(minsRaw, 0, 999);

      if (mins <= 0) continue;

      const start = t;
      const end = Math.min(T, t + mins);

      timeline.push({ start, end, keeperId: pid || null });
      t = end;
      if (t >= T) break;
    }

    if (t < T) {
      const first = timeline.find(x => x.keeperId)?.keeperId || null;
      timeline.push({ start: t, end: T, keeperId: first });
    }

    return timeline.filter(seg => seg.end > seg.start);
  }

  function keeperAtMinute(t, timeline) {
    if (!timeline || !timeline.length) return null;
    for (const seg of timeline) {
      if (t >= seg.start && t < seg.end) return seg.keeperId || null;
    }
    return timeline[timeline.length - 1].keeperId || null;
  }

  function keeperChangeTimes(timeline) {
    if (!timeline || !timeline.length) return [];
    const times = [];
    timeline.forEach(seg => times.push(seg.start, seg.end));
    return uniqSorted(times).filter(x => x > 0);
  }

  function generateSubTimes(T, seed, targetStopsMin = 6, targetStopsMax = 10, minGap = 5, maxGap = 10) {
    const rng = makeRng(seed);
    const times = [0];

    const desiredStops = clamp(Math.round(T / 7) + (rng() < 0.5 ? 0 : 1), targetStopsMin, targetStopsMax);
    const desiredSegments = Math.max(1, desiredStops - 1);

    let remaining = T;
    let t = 0;

    for (let s = 0; s < desiredSegments - 1; s++) {
      const segmentsLeft = (desiredSegments - 1) - s;

      const minRemaining = segmentsLeft * minGap;
      const maxLen = Math.min(maxGap, remaining - minRemaining);
      const minLen = Math.max(minGap, remaining - segmentsLeft * maxGap);

      let len = Math.floor(minLen + rng() * (maxLen - minLen + 1));
      len = clamp(len, minGap, maxGap);

      t += len;
      times.push(t);
      remaining = T - t;
    }

    times.push(T);
    return uniqSorted(times);
  }

  function splitLongestInterval(times, T, minGap = 5) {
    let bestIdx = -1;
    let bestLen = -1;
    for (let i = 0; i < times.length - 1; i++) {
      const len = times[i + 1] - times[i];
      if (len > bestLen) { bestLen = len; bestIdx = i; }
    }
    if (bestIdx < 0) return times;

    const a = times[bestIdx];
    const b = times[bestIdx + 1];
    const len = b - a;

    if (len <= minGap * 2) {
      const mid = a + Math.max(1, Math.floor(len / 2));
      if (mid <= a || mid >= b) return times;
      return uniqSorted([...times, mid]).filter(x => x >= 0 && x <= T);
    }

    let mid = a + Math.round(len / 2);
    mid = clamp(mid, a + minGap, b - minGap);
    return uniqSorted([...times, mid]).filter(x => x >= 0 && x <= T);
  }

  function buildKeeperMinutes(timeline, playerIds) {
    const km = {};
    playerIds.forEach(id => km[id] = 0);
    (timeline || []).forEach(seg => {
      if (!seg.keeperId) return;
      if (km[seg.keeperId] === undefined) km[seg.keeperId] = 0;
      km[seg.keeperId] += (seg.end - seg.start);
    });
    return km;
  }

  function maxDiffWithKeeperAllowance(minutes, keeperMinutes, allowanceMax = 5) {
    const ids = Object.keys(minutes);
    let min = Infinity;
    let maxAdj = -Infinity;

    ids.forEach(id => {
      const m = minutes[id];
      min = Math.min(min, m);
      const allow = keeperMinutes[id] > 0 ? allowanceMax : 0;
      maxAdj = Math.max(maxAdj, m - allow);
    });

    return maxAdj - min;
  }

  function assignLineups(playersList, times, P, keeperTimeline, seed) {
    const rng = makeRng(seed);
    const ids = playersList.map(p => p.id);
    const minutes = {};
    ids.forEach(id => minutes[id] = 0);

    const keeperMinutes = buildKeeperMinutes(keeperTimeline, ids);
    const keeperSet = new Set(Object.keys(keeperMinutes).filter(id => keeperMinutes[id] > 0));
    const keeperExtraBias = 0.35; // 0.2–0.6: høyere = sterkere preferanse
    const T = times[times.length - 1];
    const baseTarget = (P * T) / Math.max(1, ids.length);

    const segments = [];
    let prev = new Set();
    const idSet = new Set(ids);

    for (let i = 0; i < times.length - 1; i++) {
      const start = times[i];
      const end = times[i + 1];
      const dt = end - start;

      const keeperId = keeperAtMinute(start + 0.0001, keeperTimeline);
      const lineup = [];

      if (keeperId && idSet.has(keeperId)) lineup.push(keeperId);

      const scored = playersList
        .filter(p => !lineup.includes(p.id))
        .map(p => {
          const need = baseTarget - minutes[p.id];
          const keepBonus = prev.has(p.id) ? 0.9 : 0;
          const jitter = (rng() - 0.5) * 0.35;
          return { id: p.id, score: need + keepBonus + jitter + (keeperSet.has(p.id) ? keeperExtraBias : 0) };
        })
        .sort((a, b) => b.score - a.score);

      while (lineup.length < P && scored.length) {
        lineup.push(scored.shift().id);
      }

      if (lineup.length < P) {
        playersList.forEach(p => {
          if (lineup.length >= P) return;
          if (!lineup.includes(p.id)) lineup.push(p.id);
        });
      }

      lineup.forEach(id => { minutes[id] += dt; });

      const validKeeper = (keeperId && idSet.has(keeperId) && lineup.includes(keeperId)) ? keeperId : null;
      segments.push({ start, end, dt, lineup: lineup.slice(), keeperId: validKeeper });
      prev = new Set(lineup);
    }

    localRebalance(segments, playersList, minutes, keeperMinutes, P);

    return { segments, minutes, keeperMinutes, baseTarget };
  }

  function localRebalance(segments, playersList, minutes, keeperMinutes, P) {
    const ids = playersList.map(p => p.id);

    function currentDiff() {
      return maxDiffWithKeeperAllowance(minutes, keeperMinutes, 5);
    }

    let improved = true;
    let loops = 0;
    
    const keeperRebalanceAllowance = 2; // "et par" minutter
    const adj = (id) => minutes[id] - (keeperMinutes[id] > 0 ? keeperRebalanceAllowance : 0);
      
    while (improved && loops < 250) {
      loops++;
      improved = false;

      let highId = ids[0], lowId = ids[0];
      ids.forEach(id => {
      if (adj(id) > adj(highId)) highId = id;
      if (adj(id) < adj(lowId)) lowId = id;
      });

      const before = currentDiff();
      if (before <= 4) return;

      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        const keeperId = seg.keeperId;

        if (keeperId && (highId === keeperId || lowId === keeperId)) continue;

        const inLineup = new Set(seg.lineup);
        if (!inLineup.has(highId)) continue;
        if (inLineup.has(lowId)) continue;

        const dt = seg.dt;
        const newLineup = seg.lineup.map(id => id === highId ? lowId : id);

        const uniq = new Set(newLineup);
        if (uniq.size !== P) continue;
        if (keeperId && !uniq.has(keeperId)) continue;

        seg.lineup = newLineup;
        minutes[highId] -= dt;
        minutes[lowId] += dt;

        const after = currentDiff();
        if (after < before - 0.25) {
          improved = true;
          break;
        } else {
          seg.lineup = Array.from(inLineup);
          minutes[highId] += dt;
          minutes[lowId] -= dt;
        }
      }
    }
  }

  // ------------------------------
  // MAIN
  // ------------------------------
  function generateKampdagPlan() {
    const present = getPresentPlayers();
    const format = parseInt($('kdFormat')?.value, 10) || 7;
    const T = clamp(parseInt($('kdMinutes')?.value, 10) || 48, 10, 200);
    const P = format;

    const lineupEl = $('kdLineup');
    const planEl = $('kdPlan');
    const metaEl = $('kdMeta');

    if (!present.length) {
      if (lineupEl) lineupEl.innerHTML = `<div class="small-text" style="opacity:0.8;">Velg oppmøte først.</div>`;
      if (planEl) planEl.innerHTML = '';
      if (metaEl) metaEl.textContent = '';
      return;
    }
    if (present.length < P) {
      if (lineupEl) lineupEl.innerHTML = `<div class="small-text" style="opacity:0.8;">Du har valgt ${present.length} spillere, men trenger minst ${P} for ${format}-er.</div>`;
      if (planEl) planEl.innerHTML = '';
      if (metaEl) metaEl.textContent = '';
      return;
    }

    const keeperTimeline = buildKeeperTimeline(T);
    const seed = Date.now();

    const fp = FREQ_PARAMS[kdFrequency] || FREQ_PARAMS.normal;
    let times = generateSubTimes(T, seed, fp.stopsMin, fp.stopsMax, fp.minGap, fp.maxGap);

    const keeperTimes = keeperChangeTimes(keeperTimeline).filter(x => x < T);
    times = uniqSorted([...times, ...keeperTimes]).filter(x => x >= 0 && x <= T);

    const MAX_STOPS = clamp(Math.round(T / Math.max(3, fp.minGap)) + 3, 8, 20);
    let best = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const runSeed = seed + attempt * 99991;

      const res = assignLineups(present, times, P, keeperTimeline, runSeed);
      const diff = maxDiffWithKeeperAllowance(res.minutes, res.keeperMinutes, 5);
      best = { ...res, times: times.slice(), diff };

      if (diff <= 4) break;

      if (times.length < MAX_STOPS) {
        times = splitLongestInterval(times, T, fp.minGap);
        times = uniqSorted([...times, ...keeperTimes]).filter(x => x >= 0 && x <= T);
      } else {
        break;
      }
    }

    // Stop any running timer before generating new plan
    if (kdTimerInterval || kdTimerStart) {
      stopMatchTimer();
    }

    // Store for timer and export
    lastBest = best;
    lastPresent = present;
    lastP = P;
    lastT = T;
    lastFormation = kdFormation ? kdFormation.slice() : null;
    lastFormationKey = kdFormationKey || '';
    lastUseFormation = !!(kdFormationOn && kdFormation);
    // Deep-clone position preferences (Set → Set)
    lastPositions = {};
    const currentPositions = getPositionsMap();
    for (const [pid, zones] of Object.entries(currentPositions)) {
      lastPositions[pid] = new Set(zones);
    }

    renderKampdagOutput(present, best, P, T);

    if (metaEl) {
      metaEl.textContent = `Bytter ved: ${best.times.join(' / ')} (min) — Maks avvik: ${best.diff.toFixed(1)} min`;
    }

    // Show start match button
    const startBtn = $('kdStartMatch');
    if (startBtn) startBtn.style.display = '';
  }

  function renderKampdagOutput(presentPlayers, best, P, T) {
    const lineupEl = $('kdLineup');
    const planEl = $('kdPlan');

    const idToName = {};
    presentPlayers.forEach(p => idToName[p.id] = p.name);

    const first = best.segments[0];
    const startIds = first.lineup.slice();
    const benchIds = presentPlayers.map(p => p.id).filter(id => !startIds.includes(id));

    const minutesArr = Object.keys(best.minutes).map(id => ({ id, name: idToName[id] || id, min: best.minutes[id] }));
    minutesArr.sort((a, b) => b.min - a.min);

    const minutesHtml = minutesArr.map(m => `
      <div class="group-player">
        <span class="player-name">${escapeHtml(m.name)}:</span>
        <span class="player-skill" style="margin-left:auto;">${m.min.toFixed(1)} min</span>
      </div>
    `).join('');

    const useFormation = kdFormationOn && kdFormation;
    const format = parseInt($('kdFormat')?.value, 10) || 7;

    // Build timeline chart HTML (zone-colored bars per player)
    let timelineChartHtml = '';
    if (useFormation && format !== 3) {
      const zoneColors = { F: '#4ade80', M: '#60a5fa', A: '#f87171', K: '#c084fc', X: '#fbbf24' };
      const sortedPlayers = minutesArr.slice();
      const segments = best.segments;
      const rows = sortedPlayers.map(m => {
        const segs = [];
        for (let si = 0; si < segments.length; si++) {
          const seg = segments[si];
          const nextSeg = segments[si + 1];
          const segEnd = nextSeg ? nextSeg.start : T;
          const inLineup = seg.lineup.includes(m.id);
          if (!inLineup) {
            segs.push({ start: seg.start, end: segEnd, color: 'transparent' });
            continue;
          }
          if (seg.keeperId === m.id) {
            segs.push({ start: seg.start, end: segEnd, color: zoneColors.K });
            continue;
          }
          const zr = assignZones(seg.lineup, seg.keeperId, kdFormation);
          let zone = 'X';
          if (zr) {
            if (zr.zones.F.includes(m.id)) zone = 'F';
            else if (zr.zones.M.includes(m.id)) zone = 'M';
            else if (zr.zones.A.includes(m.id)) zone = 'A';
            if (zr.overflows.includes(m.id)) zone = 'X';
          }
          segs.push({ start: seg.start, end: segEnd, color: zoneColors[zone] || zoneColors.X });
        }
        const barsHtml = segs.map(s => {
          const pct = ((s.end - s.start) / T * 100).toFixed(1);
          return `<div class="kd-tl-seg" style="width:${pct}%;background:${s.color};"></div>`;
        }).join('');
        return `<div class="kd-tl-row">
          <div class="kd-tl-name">${escapeHtml(m.name)}</div>
          <div class="kd-tl-bar-wrap">${barsHtml}</div>
          <div class="kd-tl-min">${m.min.toFixed(1)}</div>
        </div>`;
      }).join('');

      // Axis ticks
      const ticks = [];
      const step = T <= 30 ? 5 : (T <= 60 ? 10 : 15);
      for (let t = 0; t <= T; t += step) ticks.push(t);
      if (ticks[ticks.length - 1] !== T) ticks.push(T);
      const axisHtml = `<div class="kd-tl-axis">${ticks.map(t => `<span>${t}</span>`).join('')}</div>`;

      const hasOverflow = best.segments.some(seg => {
        const zr = assignZones(seg.lineup, seg.keeperId, kdFormation);
        return zr && zr.overflows.length > 0;
      });

      timelineChartHtml = `
        <div class="kd-timeline-chart">
          <div class="kd-timeline-title">${T} MIN · ${format}-ER · ${kdFormationKey} · ${presentPlayers.length} SPILLERE</div>
          ${rows}
          ${axisHtml}
          <div class="kd-tl-legend">
            <div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#4ade80;"></div> Forsvar</div>
            <div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#60a5fa;"></div> Midtbane</div>
            <div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#f87171;"></div> Angrep</div>
            ${best.keeperMinutes && Object.values(best.keeperMinutes).some(v => v > 0) ? `<div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#c084fc;"></div> Keeper</div>` : ''}
            ${hasOverflow ? `<div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#fbbf24;"></div> Utenfor pref.</div>` : ''}
          </div>
        </div>`;
    }

    if (lineupEl) {
      let startHtml = '';
      if (useFormation && format !== 3) {
        // Pitch view with zones
        const zoneResult = assignZones(startIds, first.keeperId, kdFormation);
        if (zoneResult) {
          const { zones } = zoneResult;
          const keeperName = first.keeperId ? escapeHtml(idToName[first.keeperId] || first.keeperId) : '';
          startHtml = `
            <div class="kd-dark-output">
              <h3 class="kd-dark-heading">Startoppstilling · ${kdFormationKey}</h3>
              <div class="kd-pitch">
                ${kdFormation[2] > 0 ? `<div class="kd-pitch-row">${zones.A.map(id => `<span class="kd-pitch-player kd-pp-a">${escapeHtml(idToName[id] || id)}</span>`).join('')}</div>` : ''}
                ${kdFormation[1] > 0 ? `<div class="kd-pitch-row">${zones.M.map(id => `<span class="kd-pitch-player kd-pp-m">${escapeHtml(idToName[id] || id)}</span>`).join('')}</div>` : ''}
                ${kdFormation[0] > 0 ? `<div class="kd-pitch-row">${zones.F.map(id => `<span class="kd-pitch-player kd-pp-f">${escapeHtml(idToName[id] || id)}</span>`).join('')}</div>` : ''}
                ${keeperName ? `<div class="kd-pitch-row"><span class="kd-pitch-player kd-pp-k">🧤 ${keeperName}</span></div>` : ''}
              </div>
              <div class="kd-bench-strip" style="background:rgba(255,255,255,0.06);color:#94a3b8;"><b style="color:#cbd5e1;">Benk:</b> ${benchIds.map(id => escapeHtml(idToName[id] || id)).join(' · ') || '–'}</div>

              <h3 class="kd-dark-heading" style="margin-top:16px;">Beregnet spilletid</h3>
              ${timelineChartHtml}
            </div>`;
        }
      }

      if (!startHtml) {
        // Original flat list
        const startList = startIds.map(id => `<div class="group-player"><span class="player-icon">⚽</span><span class="player-name">${escapeHtml(idToName[id] || id)}</span></div>`).join('');
        const benchList = benchIds.map(id => `<div class="group-player"><span class="player-icon">⚪</span><span class="player-name">${escapeHtml(idToName[id] || id)}</span></div>`).join('');
        startHtml = `
          <div class="results-container">
            <h3>Startoppstilling</h3>
            <div class="group-card">
              <div class="group-header">
                <div class="group-name">Start (første periode)</div>
                <div class="group-stats">${P} på banen · ${benchIds.length} på benk</div>
              </div>
              <div class="group-players">${startList || '<div class="small-text">–</div>'}</div>
              <div class="group-header" style="margin-top:12px;">
                <div class="group-name">Benk (første periode)</div>
                <div class="group-stats"></div>
              </div>
              <div class="group-players">${benchList || '<div class="small-text">–</div>'}</div>
            </div>
            <h3 style="margin-top:16px;">Beregnet spilletid</h3>
            <div class="group-card">
              <div class="group-header">
                <div class="group-name">Mål: ≤ 4 min differanse</div>
                <div class="group-stats">Keeper kan få litt ekstra</div>
              </div>
              <div class="group-players">${minutesHtml}</div>
            </div>
          </div>`;
      }
      lineupEl.innerHTML = startHtml;
      // Toggle dark mode class on container (no :has() dependency)
      if (useFormation && format !== 3 && startHtml.includes('kd-dark-output')) {
        lineupEl.classList.add('kd-dark-mode');
        lineupEl.classList.remove('results-container');
      } else {
        lineupEl.classList.remove('kd-dark-mode');
        if (!lineupEl.classList.contains('results-container')) lineupEl.classList.add('results-container');
      }
    }

    // Build events with zone info
    const events = buildEvents(best.segments);

    const planCards = events.map((ev, idx) => {
      const keeperName = ev.keeperId ? (idToName[ev.keeperId] || ev.keeperId) : null;
      const seg = best.segments[idx];
      const nextSeg = best.segments[idx + 1];
      const periodEnd = nextSeg ? nextSeg.start : T;

      if (useFormation && format !== 3) {
        // Zone-grouped card (dark theme)
        const zoneResult = assignZones(seg.lineup, seg.keeperId, kdFormation);
        if (zoneResult) {
          const { zones, overflows } = zoneResult;
          const overflowSet = new Set(overflows);
          const isFirst = idx === 0;
          const prevLineup = !isFirst ? new Set(best.segments[idx - 1].lineup) : new Set();
          const newIds = isFirst ? new Set() : new Set(seg.lineup.filter(id => !prevLineup.has(id)));

          const renderZone = (label, zoneKey, ids) => {
            if (!ids.length) return '';
            return `
              <div class="kd-zone-label kd-zl-${zoneKey.toLowerCase()}"><span class="kd-zone-dot" style="background:${{A:'#f87171',M:'#60a5fa',F:'#4ade80'}[zoneKey]}"></span> ${label}</div>
              <div class="kd-zone-players">
                ${ids.map(id => {
                  const cls = [newIds.has(id) ? 'kd-new' : '', overflowSet.has(id) ? 'kd-overflow' : ''].filter(Boolean).join(' ');
                  return `<span class="kd-zone-player ${cls}">${escapeHtml(idToName[id] || id)}</span>`;
                }).join('')}
              </div>
              ${ids.some(id => overflowSet.has(id)) ? `<div class="kd-overflow-hint">Plassert her for lik spilletid</div>` : ''}`;
          };

          // Swaps (only for non-first segments)
          let swapsHtml = '';
          if (!isFirst && (ev.ins.length || ev.outs.length)) {
            const inLines = ev.ins.map(id => {
              let posHint = '';
              for (const [z, arr] of Object.entries(zones)) {
                if (arr.includes(id)) { posHint = { F: 'forsvar', M: 'midtbane', A: 'angrep' }[z]; break; }
              }
              const isOF = overflowSet.has(id);
              return `<div class="kd-swap-row">
                <span class="kd-swap-in">↑</span>
                <span class="kd-swap-name">${escapeHtml(idToName[id] || id)}</span>
                <span class="kd-swap-hint ${isOF ? 'kd-swap-hint-of' : ''}">${posHint}${isOF ? ' ⚠' : ''}</span>
              </div>`;
            }).join('');
            const outLines = ev.outs.map(id =>
              `<div class="kd-swap-row">
                <span class="kd-swap-out">↓</span>
                <span style="color:#94a3b8;">${escapeHtml(idToName[id] || id)}</span>
              </div>`
            ).join('');
            swapsHtml = `<div class="kd-dc-swaps">${inLines}${outLines}</div>`;
          }

          return `
            <div class="kd-dark-card">
              <div class="kd-dc-header">
                <div class="kd-dc-title">Minutt ${ev.minute} – ${periodEnd}</div>
                ${keeperName ? `<div class="kd-dc-keeper">🧤 ${escapeHtml(keeperName)}</div>` : ''}
              </div>
              <div class="kd-dc-body">
                ${renderZone('Angrep', 'A', zones.A)}
                ${renderZone('Midtbane', 'M', zones.M)}
                ${renderZone('Forsvar', 'F', zones.F)}
                ${isFirst ? '<div class="kd-dc-note">Start (ingen bytter)</div>' : ''}
                ${swapsHtml}
              </div>
            </div>`;
        }
      }

      // Fallback: original flat cards
      const ins = ev.ins.map(id => `<div class="small-text">Inn: <b>${escapeHtml(idToName[id] || id)}</b></div>`).join('');
      const outs = ev.outs.map(id => `<div class="small-text">Ut: <b>${escapeHtml(idToName[id] || id)}</b></div>`).join('');
      const empty = (!ev.ins.length && !ev.outs.length) ? `<div class="small-text" style="opacity:0.8;">Start (ingen bytter)</div>` : '';

      return `
        <div class="group-card" style="margin-bottom:12px;">
          <div class="group-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div class="group-name">Minutt ${ev.minute}</div>
            ${keeperName ? `<div style="background:var(--gray-100); padding:6px 10px; border-radius:999px; font-size:12px; opacity:0.85;">Keeper: ${escapeHtml(keeperName)}</div>` : ''}
          </div>
          <div class="group-players" style="gap:6px;">
            ${empty}
            ${ins}
            ${outs}
          </div>
        </div>
      `;
    }).join('');

    if (planEl) {
      if (useFormation && format !== 3) {
        planEl.classList.add('kd-dark-mode');
        planEl.classList.remove('results-container');
        planEl.innerHTML = `
          <div class="kd-dark-output">
            <h3 class="kd-dark-heading">Bytteplan</h3>
            <div class="kd-dc-grid">
              ${planCards || '<div class="small-text" style="opacity:0.8;">–</div>'}
            </div>
          </div>
        `;
      } else {
        planEl.classList.remove('kd-dark-mode');
        if (!planEl.classList.contains('results-container')) planEl.classList.add('results-container');
        planEl.innerHTML = `
          <div class="results-container">
            <h3>Bytteplan</h3>
            ${planCards || '<div class="small-text" style="opacity:0.8;">–</div>'}
          </div>
        `;
      }
    }

    lastPlanText = buildPlanText(best, presentPlayers, P, T);
  }

  function buildEvents(segments) {
    const events = [];
    let prev = new Set();

    segments.forEach((seg, idx) => {
      const cur = new Set(seg.lineup);
      const ins = [];
      const outs = [];

      if (idx === 0) {
        cur.forEach(id => ins.push(id));
      } else {
        cur.forEach(id => { if (!prev.has(id)) ins.push(id); });
        prev.forEach(id => { if (!cur.has(id)) outs.push(id); });
      }

      events.push({
        minute: seg.start,
        ins,
        outs,
        keeperId: seg.keeperId || null
      });

      prev = cur;
    });

    return events;
  }

  function buildPlanText(best, presentPlayers, P, T) {
    const idToName = {};
    presentPlayers.forEach(p => idToName[p.id] = p.name);

    const lines = [];
    const useFormation = kdFormationOn && kdFormation;
    const format = parseInt($('kdFormat')?.value, 10) || 7;

    lines.push('Startoppstilling' + (useFormation ? ` · ${kdFormationKey}` : ''));

    const first = best.segments[0];
    const startIds = first.lineup.slice();
    const benchIds = presentPlayers.map(p => p.id).filter(id => !startIds.includes(id));

    if (useFormation && format !== 3) {
      const zr = assignZones(startIds, first.keeperId, kdFormation);
      if (zr) {
        if (first.keeperId) lines.push(` Keeper: ${idToName[first.keeperId] || first.keeperId}`);
        if (zr.zones.F.length) lines.push(` Forsvar: ${zr.zones.F.map(id => idToName[id] || id).join(', ')}`);
        if (zr.zones.M.length) lines.push(` Midtbane: ${zr.zones.M.map(id => idToName[id] || id).join(', ')}`);
        if (zr.zones.A.length) lines.push(` Angrep: ${zr.zones.A.map(id => idToName[id] || id).join(', ')}`);
      }
    } else {
      lines.push(' Start (første periode)');
      startIds.forEach(id => lines.push(`  - ${idToName[id] || id}`));
    }
    lines.push(` Benk: ${benchIds.map(id => idToName[id] || id).join(', ') || '–'}`);

    lines.push('');
    lines.push('Beregnet spilletid');
    const minutesArr = Object.keys(best.minutes).map(id => ({ id, name: idToName[id] || id, min: best.minutes[id] }));
    minutesArr.sort((a, b) => b.min - a.min);
    minutesArr.forEach(m => lines.push(` ${m.name}: ${m.min.toFixed(1)} min`));

    lines.push('');
    lines.push('Bytteplan');
    const events = buildEvents(best.segments);
    events.forEach((ev, idx) => {
      const seg = best.segments[idx];
      const nextSeg = best.segments[idx + 1];
      const periodEnd = nextSeg ? nextSeg.start : T;

      lines.push(` Minutt ${ev.minute} – ${periodEnd}`);
      if (ev.keeperId) lines.push(`  Keeper: ${idToName[ev.keeperId] || ev.keeperId}`);

      if (useFormation && format !== 3) {
        const zr = assignZones(seg.lineup, seg.keeperId, kdFormation);
        if (zr) {
          const parts = [];
          if (zr.zones.F.length) parts.push(`F: ${zr.zones.F.map(id => idToName[id] || id).join(', ')}`);
          if (zr.zones.M.length) parts.push(`M: ${zr.zones.M.map(id => idToName[id] || id).join(', ')}`);
          if (zr.zones.A.length) parts.push(`A: ${zr.zones.A.map(id => idToName[id] || id).join(', ')}`);
          if (parts.length) lines.push(`  Soner: ${parts.join(' | ')}`);
        }
      }

      if (idx === 0) {
        lines.push('  Start (ingen bytter)');
      } else {
        ev.ins.forEach(id => lines.push(`  Inn: ${idToName[id] || id}`));
        ev.outs.forEach(id => lines.push(`  Ut: ${idToName[id] || id}`));
      }
    });

    return lines.join('\n');
  }

  function copyKampdagPlan() {
    if (!lastPlanText) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastPlanText)
        .then(() => {
          const metaEl = $('kdMeta');
          if (metaEl) {
            const prev = metaEl.textContent;
            metaEl.textContent = 'Plan kopiert ✅';
            setTimeout(() => { metaEl.textContent = prev; }, 1200);
          }
        })
        .catch(() => {
          fallbackCopy(lastPlanText);
        });
    } else {
      fallbackCopy(lastPlanText);
    }
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      const metaEl = $('kdMeta');
      if (metaEl) {
        const prev = metaEl.textContent;
        metaEl.textContent = 'Plan kopiert ✅';
        setTimeout(() => { metaEl.textContent = prev; }, 1200);
      }
    } catch (e) {
      alert('Klarte ikke å kopiere. Marker teksten manuelt.');
    }
  }

  function exportKampdagPdf() {
    if (!lastBest || !lastBest.segments.length) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Generer en plan først', 'error');
      }
      return;
    }

    const present = lastPresent;
    const format = lastP;
    const T = lastT;
    const idToName = {};
    present.forEach(p => idToName[p.id] = p.name);
    const best = lastBest;
    const useFormation = lastUseFormation;
    const formation = lastFormation;
    const formationKey = lastFormationKey;

    const logoUrl = (() => {
      try {
        const front = document.querySelector('.login-logo');
        if (front && front.getAttribute('src')) return new URL(front.getAttribute('src'), window.location.href).href;
        const appLogo = document.querySelector('.app-logo');
        if (appLogo && appLogo.getAttribute('src')) return new URL(appLogo.getAttribute('src'), window.location.href).href;
        return new URL('apple-touch-icon.png', window.location.href).href;
      } catch { return 'apple-touch-icon.png'; }
    })();

    const today = new Date().toLocaleDateString('nb-NO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const first = best.segments[0];
    const startIds = first.lineup.slice();
    const benchIds = present.map(p => p.id).filter(id => !startIds.includes(id));

    // Build startoppstilling section
    let startSection = '';
    if (useFormation && format !== 3) {
      const zr = assignZones(startIds, first.keeperId, formation, lastPositions);
      if (zr) {
        const keeperName = first.keeperId ? escapeHtml(idToName[first.keeperId] || first.keeperId) : '';
        startSection = `
          <div class="section-title">Startoppstilling · ${formationKey}</div>
          <div class="pitch">
            ${formation[2] > 0 ? `<div class="pitch-row">${zr.zones.A.map(id => `<span class="pp pp-a">${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>` : ''}
            ${formation[1] > 0 ? `<div class="pitch-row">${zr.zones.M.map(id => `<span class="pp pp-m">${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>` : ''}
            ${formation[0] > 0 ? `<div class="pitch-row">${zr.zones.F.map(id => `<span class="pp pp-f">${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>` : ''}
            ${keeperName ? `<div class="pitch-row"><span class="pp pp-k">🧤 ${keeperName}</span></div>` : ''}
          </div>
          <div class="bench">Benk: ${benchIds.map(id => escapeHtml(idToName[id]||id)).join(' · ') || '–'}</div>`;
      }
    }
    if (!startSection) {
      startSection = `
        <div class="section-title">Startoppstilling</div>
        <div class="start-list">${startIds.map(id => `<span class="chip">⚽ ${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>
        <div class="bench">Benk: ${benchIds.map(id => escapeHtml(idToName[id]||id)).join(' · ') || '–'}</div>`;
    }

    // Build spilletid rows
    const minutesArr = Object.keys(best.minutes).map(id => ({ id, name: idToName[id] || id, min: best.minutes[id] }));
    minutesArr.sort((a, b) => b.min - a.min);

    let timelineHtml = '';
    if (useFormation && format !== 3) {
      const zc = { F:'#4ade80', M:'#60a5fa', A:'#f87171', K:'#c084fc', X:'#fbbf24' };
      const rows = minutesArr.map(m => {
        const segs = [];
        for (let si = 0; si < best.segments.length; si++) {
          const seg = best.segments[si];
          const segEnd = best.segments[si+1] ? best.segments[si+1].start : T;
          if (!seg.lineup.includes(m.id)) { segs.push({pct:((segEnd-seg.start)/T*100),c:'transparent'}); continue; }
          if (seg.keeperId === m.id) { segs.push({pct:((segEnd-seg.start)/T*100),c:zc.K}); continue; }
          const zr = assignZones(seg.lineup, seg.keeperId, formation, lastPositions);
          let z = 'X';
          if (zr) { if(zr.zones.F.includes(m.id))z='F'; else if(zr.zones.M.includes(m.id))z='M'; else if(zr.zones.A.includes(m.id))z='A'; if(zr.overflows.includes(m.id))z='X'; }
          segs.push({pct:((segEnd-seg.start)/T*100),c:zc[z]});
        }
        const bars = segs.map(s => `<div style="width:${s.pct.toFixed(1)}%;height:100%;background:${s.c};"></div>`).join('');
        return `<div class="tl-row"><div class="tl-name">${escapeHtml(m.name)}</div><div class="tl-bar">${bars}</div><div class="tl-min">${m.min.toFixed(1)}</div></div>`;
      }).join('');

      const ticks = [];
      const step = T <= 30 ? 5 : (T <= 60 ? 10 : 15);
      for (let t = 0; t <= T; t += step) ticks.push(t);
      if (ticks[ticks.length - 1] !== T) ticks.push(T);

      timelineHtml = `
        <div class="section-title">Beregnet spilletid</div>
        <div class="tl-chart">
          <div class="tl-header">${T} MIN · ${format}-ER · ${formationKey} · ${present.length} SPILLERE</div>
          ${rows}
          <div class="tl-axis">${ticks.map(t => `<span>${t}</span>`).join('')}</div>
          <div class="tl-legend">
            <span><i style="background:#4ade80"></i> Forsvar</span>
            <span><i style="background:#60a5fa"></i> Midtbane</span>
            <span><i style="background:#f87171"></i> Angrep</span>
            <span><i style="background:#c084fc"></i> Keeper</span>
          </div>
        </div>`;
    } else {
      timelineHtml = `
        <div class="section-title">Beregnet spilletid</div>
        <div class="time-list">${minutesArr.map(m => `<div class="time-row"><span>${escapeHtml(m.name)}</span><span>${m.min.toFixed(1)} min</span></div>`).join('')}</div>`;
    }

    // Build bytteplan cards
    const events = buildEvents(best.segments);
    const planCards = events.map((ev, idx) => {
      const seg = best.segments[idx];
      const nextSeg = best.segments[idx+1];
      const periodEnd = nextSeg ? nextSeg.start : T;
      const keeperName = ev.keeperId ? escapeHtml(idToName[ev.keeperId]||ev.keeperId) : '';
      const isFirst = idx === 0;
      const prevLineup = !isFirst ? new Set(best.segments[idx-1].lineup) : new Set();
      const newIds = isFirst ? new Set() : new Set(seg.lineup.filter(id => !prevLineup.has(id)));

      let body = '';
      if (useFormation && format !== 3) {
        const zr = assignZones(seg.lineup, seg.keeperId, formation, lastPositions);
        if (zr) {
          const renderZ = (label, key, ids) => {
            if (!ids.length) return '';
            const col = {A:'#f87171',M:'#60a5fa',F:'#4ade80'}[key];
            return `<div class="zl" style="color:${col}"><span class="zd" style="background:${col}"></span> ${label}</div>
              <div class="zp">${ids.map(id => `<span class="zc${newIds.has(id) ? ' zc-new' : ''}">${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>`;
          };
          body = renderZ('Angrep','A',zr.zones.A) + renderZ('Midtbane','M',zr.zones.M) + renderZ('Forsvar','F',zr.zones.F);
        }
      }
      if (!body) {
        body = `<div class="zp">${seg.lineup.map(id => `<span class="zc">${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>`;
      }

      let swaps = '';
      if (isFirst) {
        swaps = '<div class="note">Start (ingen bytter)</div>';
      } else if (ev.ins.length || ev.outs.length) {
        swaps = '<div class="swaps">' +
          ev.ins.map(id => `<div class="sw"><span class="sw-in">↑</span><b>${escapeHtml(idToName[id]||id)}</b></div>`).join('') +
          ev.outs.map(id => `<div class="sw"><span class="sw-out">↓</span><span style="color:#94a3b8;">${escapeHtml(idToName[id]||id)}</span></div>`).join('') +
          '</div>';
      }

      return `<div class="card">
        <div class="card-head"><span class="card-title">Minutt ${ev.minute} – ${periodEnd}</span>${keeperName ? `<span class="card-keeper">🧤 ${keeperName}</span>` : ''}</div>
        <div class="card-body">${body}${swaps}</div>
      </div>`;
    }).join('');

    const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Kampdag – Barnefotballtrener</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial;background:#0f172a;color:#e2e8f0;line-height:1.45}
.wrap{max-width:900px;margin:0 auto;padding:16px}
.header{background:linear-gradient(135deg,#0b5bd3,#19b0ff);color:#fff;border-radius:16px;padding:14px 16px;display:flex;gap:14px;align-items:center;box-shadow:0 6px 18px rgba(11,91,211,0.3)}
.logo{width:80px;height:80px;border-radius:12px;background:#fff;overflow:hidden;flex-shrink:0}
.logo img{width:80px;height:80px;object-fit:cover}
.h-title{font-size:18px;font-weight:900}
.h-sub{opacity:0.9;font-size:12px;margin-top:2px}
.section-title{font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:0.04em;color:#60a5fa;margin:18px 0 10px;padding-bottom:4px;border-bottom:2px solid rgba(255,255,255,0.08)}
.main-card{background:#1a2333;border-radius:16px;padding:16px;margin-top:12px;border:1px solid rgba(255,255,255,0.06)}
/* Pitch */
.pitch{background:linear-gradient(180deg,#1a5c1a,#145214);border:2px solid #2a7a2a;border-radius:12px;padding:12px 8px;position:relative;overflow:hidden}
.pitch::before{content:'';position:absolute;top:50%;left:8%;right:8%;height:1px;background:rgba(255,255,255,0.12)}
.pitch-row{display:flex;justify-content:center;gap:6px;padding:6px 0;position:relative;z-index:1}
.pp{border-radius:7px;padding:3px 8px;font-size:11px;font-weight:700}
.pp-f{background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.3)}
.pp-m{background:rgba(59,130,246,0.2);color:#60a5fa;border:1px solid rgba(59,130,246,0.3)}
.pp-a{background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.3)}
.pp-k{background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.3)}
.bench{font-size:11px;color:#64748b;margin-top:8px;padding:6px 10px;background:rgba(255,255,255,0.04);border-radius:8px}
.bench b{color:#94a3b8}
.start-list{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:11px;padding:3px 8px;background:rgba(255,255,255,0.08);border-radius:6px}
/* Timeline */
.tl-chart{background:rgba(255,255,255,0.03);border-radius:12px;padding:12px}
.tl-header{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;margin-bottom:8px}
.tl-row{display:flex;align-items:center;gap:6px;padding:2px 0}
.tl-name{width:60px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl-bar{flex:1;height:14px;background:rgba(255,255,255,0.04);border-radius:3px;display:flex;overflow:hidden}
.tl-min{width:32px;text-align:right;font-size:10px;font-weight:800;color:#64748b}
.tl-axis{display:flex;justify-content:space-between;margin:4px 38px 0 66px;font-size:9px;color:#475569}
.tl-legend{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;padding-left:66px;font-size:10px;color:#64748b}
.tl-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px;vertical-align:middle}
/* Time list (non-formation) */
.time-list{display:flex;flex-direction:column}
.time-row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.04)}
/* Bytteplan grid */
.plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.06)}
.card-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06)}
.card-title{font-weight:900;font-size:13px;color:#fff}
.card-keeper{background:rgba(168,85,247,0.15);padding:3px 8px;border-radius:999px;font-size:10px;color:#c084fc;font-weight:700}
.card-body{padding:8px 12px 10px}
.zl{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;display:flex;align-items:center;gap:5px;margin-bottom:3px}
.zd{width:6px;height:6px;border-radius:50%}
.zp{display:flex;flex-wrap:wrap;gap:4px;padding-left:11px;margin-bottom:6px}
.zc{font-size:11px;font-weight:600;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,0.08);color:#cbd5e1;border:1px solid rgba(255,255,255,0.06)}
.zc-new{background:rgba(34,197,94,0.15);color:#4ade80;border-color:rgba(34,197,94,0.4)}
.swaps{padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);margin-top:6px}
.sw{display:flex;align-items:center;gap:6px;padding:1px 0;font-size:11px}
.sw-in{color:#4ade80;font-weight:900;width:14px;text-align:center}
.sw-out{color:#f87171;font-weight:900;width:14px;text-align:center}
.note{font-size:10px;color:#475569;font-style:italic;margin-top:4px}
.footer{text-align:center;margin-top:16px;font-size:10px;color:#475569;padding:8px 0;border-top:1px solid rgba(255,255,255,0.06)}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{background:#0f172a}
  .wrap{max-width:none;padding:8px}
  .actions{display:none!important}
  #saveGuide{display:none!important}
  .card{break-inside:avoid}
  .tl-chart{break-inside:avoid}
  .pitch{break-inside:avoid}
  .main-card{break-inside:avoid}
}
@media (max-width:600px){
  .plan-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo"><img src="${escapeHtml(logoUrl)}" alt=""></div>
    <div>
      <div class="h-title">Kampdag – ${format}-er fotball${useFormation && formationKey ? ` · ${formationKey}` : ''}</div>
      <div class="h-sub">${escapeHtml(today)} · ${T} min · ${present.length} spillere</div>
    </div>
  </div>

  <div class="main-card">
    ${startSection}
    ${timelineHtml}
    <div class="section-title">Bytteplan</div>
    <div class="plan-grid">${planCards}</div>
  </div>

  <div class="footer">Laget med Barnefotballtrener.no</div>
  <div class="actions" style="display:flex;gap:10px;margin-top:12px;">
    <button style="border:0;border-radius:10px;padding:10px 16px;font-weight:800;background:#0b5bd3;color:#fff;cursor:pointer;font-size:13px;" onclick="window.print()">Lagre som PDF</button>
  </div>
  <div id="saveGuide" style="margin-top:12px;"></div>
  <script>
  (function(){
    var ua = navigator.userAgent;
    var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    var isAndroid = /Android/i.test(ua);
    var g = document.getElementById('saveGuide');
    if (!g) return;
    var steps = '';
    if (isIOS) {
      steps = '<div style="color:#94a3b8;font-size:11px;margin-top:8px;">Trykk <b>Lagre som PDF</b>, deretter <b>Del-ikon ↑</b> og <b>Arkiver i Filer</b>.</div>';
    } else if (isAndroid) {
      steps = '<div style="color:#94a3b8;font-size:11px;margin-top:8px;">Trykk <b>Lagre som PDF</b>, velg <b>Lagre som PDF</b> som skriver, trykk <b>Last ned</b>.</div>';
    } else {
      steps = '<div style="color:#94a3b8;font-size:11px;margin-top:8px;">Trykk <b>Lagre som PDF</b>, velg <b>Lagre som PDF</b> i stedet for skriver, klikk <b>Lagre</b>.</div>';
    }
    g.innerHTML = steps;
  })();
  window.onafterprint = function(){ window.close(); };
  </script>
</div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Popup ble blokkert. Tillat popups for å eksportere.', 'error');
      }
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // ------------------------------
  // Match timer
  // ------------------------------
  // Timer pre-computed data
  let kdTimerEvents = null;
  let kdTimerIdToName = {};
  let kdTimerVibrated = new Set(); // track which sub times already vibrated

  function startMatchTimer() {
    if (!lastBest || !lastBest.segments.length) return;
    kdTimerStart = Date.now();
    kdTimerPaused = false;
    kdTimerPausedElapsed = 0;
    kdTimerVibrated = new Set();

    // Pre-compute events and names
    kdTimerEvents = buildEvents(lastBest.segments);
    kdTimerIdToName = {};
    lastPresent.forEach(p => kdTimerIdToName[p.id] = p.name);

    const wrap = $('kdTimerWrap');
    if (wrap) wrap.style.display = '';

    const pauseBtn = $('kdTimerPause');
    if (pauseBtn) pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';

    if (kdTimerInterval) clearInterval(kdTimerInterval);
    kdTimerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  }

  function toggleTimerPause() {
    if (!kdTimerStart) return;
    const pauseBtn = $('kdTimerPause');
    if (kdTimerPaused) {
      // Resume: adjust start time
      kdTimerStart = Date.now() - kdTimerPausedElapsed;
      kdTimerPaused = false;
      if (pauseBtn) pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
      if (!kdTimerInterval) kdTimerInterval = setInterval(updateTimer, 1000);
    } else {
      // Pause
      kdTimerPausedElapsed = Date.now() - kdTimerStart;
      kdTimerPaused = true;
      if (pauseBtn) pauseBtn.innerHTML = '<i class="fas fa-play"></i>';
      if (kdTimerInterval) { clearInterval(kdTimerInterval); kdTimerInterval = null; }
    }
  }

  function stopMatchTimer() {
    if (kdTimerInterval) { clearInterval(kdTimerInterval); kdTimerInterval = null; }
    kdTimerStart = null;
    kdTimerPaused = false;
    kdTimerPausedElapsed = 0;
    const wrap = $('kdTimerWrap');
    if (wrap) wrap.style.display = 'none';
  }

  function updateTimer() {
    if (!kdTimerStart || !lastBest) return;

    const elapsed = kdTimerPaused ? kdTimerPausedElapsed : (Date.now() - kdTimerStart);
    const elapsedMin = elapsed / 60000;
    const totalSec = Math.floor(elapsed / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');

    const clockEl = $('kdTimerClock');
    if (clockEl) clockEl.textContent = `${mm}:${ss}`;

    // Find next sub time
    const subTimes = lastBest.times.filter(t => t > 0 && t < lastT);
    const nextSub = subTimes.find(t => t > elapsedMin);
    const nextEl = $('kdTimerNext');
    const subsEl = $('kdTimerSubs');

    if (elapsedMin >= lastT) {
      // Match over
      if (nextEl) nextEl.textContent = 'Kampen er ferdig!';
      if (subsEl) { subsEl.style.display = 'none'; }
      if (kdTimerInterval) { clearInterval(kdTimerInterval); kdTimerInterval = null; }
      kdTimerPaused = false;
      // Auto-hide timer after 5 seconds
      setTimeout(() => {
        if (!kdTimerStart || kdTimerInterval) return; // user restarted
        kdTimerStart = null;
        kdTimerPausedElapsed = 0;
        const wrap = $('kdTimerWrap');
        if (wrap) wrap.style.display = 'none';
      }, 5000);
      return;
    }

    if (nextSub !== undefined) {
      const remaining = nextSub - elapsedMin;
      const remMin = Math.floor(remaining);
      const remSec = Math.round((remaining - remMin) * 60);
      if (nextEl) nextEl.textContent = `Neste bytte om ${remMin}:${String(remSec).padStart(2, '0')} (minutt ${nextSub})`;

      // Show upcoming subs (use pre-computed events)
      const nextEvent = kdTimerEvents ? kdTimerEvents.find(ev => ev.minute === nextSub) : null;
      if (nextEvent && subsEl) {
        const inNames = nextEvent.ins.map(id => kdTimerIdToName[id] || id);
        const outNames = nextEvent.outs.map(id => kdTimerIdToName[id] || id);
        if (inNames.length || outNames.length) {
          subsEl.style.display = '';
          subsEl.innerHTML =
            (inNames.length ? `<span style="color:#16a34a;font-weight:700;">↑ ${inNames.map(n => escapeHtml(n)).join(', ')}</span>` : '') +
            (inNames.length && outNames.length ? ' &nbsp; ' : '') +
            (outNames.length ? `<span style="color:#dc2626;font-weight:700;">↓ ${outNames.map(n => escapeHtml(n)).join(', ')}</span>` : '');
        } else {
          subsEl.style.display = 'none';
        }
      }

      // Vibrate once when sub time is reached
      if (remaining <= 0.017 && !kdTimerVibrated.has(nextSub)) { // ~1 sec
        kdTimerVibrated.add(nextSub);
        try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
      }
    } else {
      if (nextEl) nextEl.textContent = 'Ingen flere bytter planlagt';
      if (subsEl) subsEl.style.display = 'none';
    }
  }
})();
