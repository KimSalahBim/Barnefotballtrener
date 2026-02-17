// Â© 2026 Barnefotballtrener.no. All rights reserved.
// Barnefotballtrener - kampdag.js
// Kampdag: oppmÃ¸te -> start/benk -> bytteplan med roligere bytter og bedre spilletidsfordeling.
// Bruker global variabel "window.players" (Array) som settes av core.js.

console.log('KAMPDAG.JS LOADING - BEFORE IIFE');

(function () {
  'use strict';
  console.log('KAMPDAG.JS - INSIDE IIFE');
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

  // Drag & drop slot override state
  let kdSlotOverrides = {};     // { segIdx: { slots: {slotKey: playerId}, bench: [playerId] } }
  let kdDragState = null;
  const KD_DRAG_THRESHOLD = 8;

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
  let kdFrequency = 'equal';   // 'equal' or 'calm'

  // Timer state
  let kdTimerInterval = null;
  let kdTimerStart = null;      // Date.now() when started
  let kdTimerPaused = false;
  let kdTimerPausedElapsed = 0; // ms elapsed when paused

  // Formation presets per format
  const FORMATIONS = {
    3: { '1-1-1': [1,1,1] },
    5: { '2-1-1': [2,1,1], '1-2-1': [1,2,1], '2-2': [2,2,0] },
    7: { '2-3-1': [2,3,1], '3-2-1': [3,2,1], '2-2-2': [2,2,2], '1-3-2': [1,3,2] },
    9: { '3-3-2': [3,3,2], '3-4-1': [3,4,1], '2-4-2': [2,4,2] },
    11: { '4-3-3': [4,3,3], '4-4-2': [4,4,2], '3-5-2': [3,5,2] },
  };

  // Slot layouts for visual pitch rendering (drag & drop)
  // Each slot has: key (unique), label (display), zone (F/M/A/K), x/y (% position)
  const SLOT_LAYOUTS = {
    '1-1-1': [
      { key:'A1', label:'A', zone:'A', x:50, y:18 },
      { key:'M1', label:'M', zone:'M', x:50, y:50 },
      { key:'F1', label:'F', zone:'F', x:50, y:80 },
    ],
    '2-1-1': [
      { key:'ST', label:'ST', zone:'A', x:50, y:14 },
      { key:'CM', label:'CM', zone:'M', x:50, y:40 },
      { key:'LB', label:'LB', zone:'F', x:28, y:66 },
      { key:'RB', label:'RB', zone:'F', x:72, y:66 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '1-2-1': [
      { key:'ST', label:'ST', zone:'A', x:50, y:14 },
      { key:'LM', label:'LM', zone:'M', x:30, y:40 },
      { key:'RM', label:'RM', zone:'M', x:70, y:40 },
      { key:'CB', label:'CB', zone:'F', x:50, y:66 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '2-2': [
      { key:'LM', label:'LM', zone:'M', x:30, y:28 },
      { key:'RM', label:'RM', zone:'M', x:70, y:28 },
      { key:'LB', label:'LB', zone:'F', x:30, y:60 },
      { key:'RB', label:'RB', zone:'F', x:70, y:60 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '2-3-1': [
      { key:'ST', label:'ST', zone:'A', x:50, y:14 },
      { key:'LM', label:'LM', zone:'M', x:18, y:38 },
      { key:'CM', label:'CM', zone:'M', x:50, y:42 },
      { key:'RM', label:'RM', zone:'M', x:82, y:38 },
      { key:'LB', label:'LB', zone:'F', x:30, y:66 },
      { key:'RB', label:'RB', zone:'F', x:70, y:66 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '3-2-1': [
      { key:'ST', label:'ST', zone:'A', x:50, y:14 },
      { key:'LM', label:'LM', zone:'M', x:32, y:38 },
      { key:'RM', label:'RM', zone:'M', x:68, y:38 },
      { key:'LB', label:'LB', zone:'F', x:20, y:64 },
      { key:'CB', label:'CB', zone:'F', x:50, y:68 },
      { key:'RB', label:'RB', zone:'F', x:80, y:64 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '2-2-2': [
      { key:'LA', label:'LA', zone:'A', x:32, y:16 },
      { key:'RA', label:'RA', zone:'A', x:68, y:16 },
      { key:'LM', label:'LM', zone:'M', x:32, y:42 },
      { key:'RM', label:'RM', zone:'M', x:68, y:42 },
      { key:'LB', label:'LB', zone:'F', x:32, y:66 },
      { key:'RB', label:'RB', zone:'F', x:68, y:66 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '1-3-2': [
      { key:'LA', label:'LA', zone:'A', x:32, y:16 },
      { key:'RA', label:'RA', zone:'A', x:68, y:16 },
      { key:'LM', label:'LM', zone:'M', x:20, y:42 },
      { key:'CM', label:'CM', zone:'M', x:50, y:44 },
      { key:'RM', label:'RM', zone:'M', x:80, y:42 },
      { key:'CB', label:'CB', zone:'F', x:50, y:68 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '3-3-2': [
      { key:'LS', label:'LS', zone:'A', x:32, y:14 },
      { key:'RS', label:'RS', zone:'A', x:68, y:14 },
      { key:'LM', label:'LM', zone:'M', x:20, y:38 },
      { key:'CM', label:'CM', zone:'M', x:50, y:40 },
      { key:'RM', label:'RM', zone:'M', x:80, y:38 },
      { key:'LB', label:'LB', zone:'F', x:20, y:64 },
      { key:'CB', label:'CB', zone:'F', x:50, y:68 },
      { key:'RB', label:'RB', zone:'F', x:80, y:64 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '3-4-1': [
      { key:'ST', label:'ST', zone:'A', x:50, y:14 },
      { key:'LM', label:'LM', zone:'M', x:14, y:36 },
      { key:'LCM', label:'LCM', zone:'M', x:38, y:40 },
      { key:'RCM', label:'RCM', zone:'M', x:62, y:40 },
      { key:'RM', label:'RM', zone:'M', x:86, y:36 },
      { key:'LB', label:'LB', zone:'F', x:20, y:64 },
      { key:'CB', label:'CB', zone:'F', x:50, y:68 },
      { key:'RB', label:'RB', zone:'F', x:80, y:64 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '2-4-2': [
      { key:'LS', label:'LS', zone:'A', x:32, y:14 },
      { key:'RS', label:'RS', zone:'A', x:68, y:14 },
      { key:'LM', label:'LM', zone:'M', x:14, y:38 },
      { key:'LCM', label:'LCM', zone:'M', x:38, y:42 },
      { key:'RCM', label:'RCM', zone:'M', x:62, y:42 },
      { key:'RM', label:'RM', zone:'M', x:86, y:38 },
      { key:'LB', label:'LB', zone:'F', x:32, y:66 },
      { key:'RB', label:'RB', zone:'F', x:68, y:66 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '4-3-3': [
      { key:'LW', label:'LW', zone:'A', x:16, y:14 },
      { key:'ST', label:'ST', zone:'A', x:50, y:10 },
      { key:'RW', label:'RW', zone:'A', x:84, y:14 },
      { key:'LCM', label:'LCM', zone:'M', x:28, y:40 },
      { key:'CM', label:'CM', zone:'M', x:50, y:42 },
      { key:'RCM', label:'RCM', zone:'M', x:72, y:40 },
      { key:'LB', label:'LB', zone:'F', x:14, y:64 },
      { key:'LCB', label:'LCB', zone:'F', x:38, y:68 },
      { key:'RCB', label:'RCB', zone:'F', x:62, y:68 },
      { key:'RB', label:'RB', zone:'F', x:86, y:64 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '4-4-2': [
      { key:'LS', label:'LS', zone:'A', x:36, y:12 },
      { key:'RS', label:'RS', zone:'A', x:64, y:12 },
      { key:'LM', label:'LM', zone:'M', x:14, y:38 },
      { key:'LCM', label:'LCM', zone:'M', x:38, y:42 },
      { key:'RCM', label:'RCM', zone:'M', x:62, y:42 },
      { key:'RM', label:'RM', zone:'M', x:86, y:38 },
      { key:'LB', label:'LB', zone:'F', x:14, y:64 },
      { key:'LCB', label:'LCB', zone:'F', x:38, y:68 },
      { key:'RCB', label:'RCB', zone:'F', x:62, y:68 },
      { key:'RB', label:'RB', zone:'F', x:86, y:64 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
    '3-5-2': [
      { key:'LS', label:'LS', zone:'A', x:36, y:12 },
      { key:'RS', label:'RS', zone:'A', x:64, y:12 },
      { key:'LWB', label:'LWB', zone:'M', x:12, y:36 },
      { key:'LCM', label:'LCM', zone:'M', x:32, y:42 },
      { key:'CM', label:'CM', zone:'M', x:50, y:38 },
      { key:'RCM', label:'RCM', zone:'M', x:68, y:42 },
      { key:'RWB', label:'RWB', zone:'M', x:88, y:36 },
      { key:'LCB', label:'LCB', zone:'F', x:26, y:66 },
      { key:'CB', label:'CB', zone:'F', x:50, y:70 },
      { key:'RCB', label:'RCB', zone:'F', x:74, y:66 },
      { key:'GK', label:'GK', zone:'K', x:50, y:88 },
    ],
  };

  // Two strategic modes based on coach priorities.
  // "equal" = Lik spilletid: minimize diff, accept more substitutions.
  //   No stickiness â†’ greedy optimizes purely for equal minutes.
  //   Low splitHalf â†’ addIndividualSwaps can aggressively balance.
  // "calm" = Rolig bytteplan: fewer substitutions and longer stints.
  //   Strong stickiness â†’ holds players on field/bench longer.
  //   High splitHalf â†’ avoids creating short segments.
  const FREQ_PARAMS = {
    equal: { mode: 'equal', sticky: 'mild',   swapSplitHalf: 4 },
    calm:  { mode: 'calm',  sticky: 'strong', swapSplitHalf: 5 },
  };

  // ------------------------------
  // Init
  // ------------------------------
  
  // Register event listener IMMEDIATELY (not waiting for DOMContentLoaded)
  console.log('[Kampdag] Script loaded - registering event listener');

  // Reset kampdag when team changes
  window.addEventListener('team:changed', () => {
    console.log('[Kampdag] team:changed â€” resetting kampdag state');
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
      kdSlotOverrides = {};
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
      // Auto-set match duration based on format (Norwegian youth football defaults)
      if (minutesEl) {
        const fmt = parseInt(formatEl.value, 10) || 7;
        const defaultMinutes = { 3: 20, 5: 40, 7: 60, 9: 70, 11: 80 };
        if (defaultMinutes[fmt]) {
          minutesEl.value = defaultMinutes[fmt];
          // Programmatic value change doesn't fire 'input' event,
          // so we must call the same functions manually:
          autoFillKeeperMinutes();
          updateKeeperSummary();
        }
      }
      refreshKeeperUI();
      updateKampdagCounts();
    });
    if (minutesEl) minutesEl.addEventListener('input', () => {
      refreshKeeperUI();
      autoFillKeeperMinutes();
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
      autoFillKeeperMinutes();
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

    // Drag & drop event listeners for pitch view
    const lineupEl = $('kdLineup');
    const planEl = $('kdPlan');
    const ddTargets = [lineupEl, planEl].filter(Boolean);
    ddTargets.forEach(container => {
      container.addEventListener('mousedown', (e) => {
        const bubble = e.target.closest('.kd-pos-bubble[data-seg][data-slot]');
        const benchB = e.target.closest('.kd-bench-bubble[data-seg][data-pid]');
        if (bubble) initSlotDragStart(parseInt(bubble.dataset.seg), bubble.dataset.slot, false, null, e.clientX, e.clientY);
        else if (benchB) initSlotDragStart(parseInt(benchB.dataset.seg), null, true, benchB.dataset.pid, e.clientX, e.clientY);
      });
      container.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        const bubble = e.target.closest('.kd-pos-bubble[data-seg][data-slot]');
        const benchB = e.target.closest('.kd-bench-bubble[data-seg][data-pid]');
        if (bubble) initSlotDragStart(parseInt(bubble.dataset.seg), bubble.dataset.slot, false, null, t.clientX, t.clientY);
        else if (benchB) initSlotDragStart(parseInt(benchB.dataset.seg), null, true, benchB.dataset.pid, t.clientX, t.clientY);
      }, { passive: true });
    });
    document.addEventListener('mousemove', (e) => { if (kdDragState) { handleSlotDragMove(e.clientX, e.clientY); e.preventDefault(); } }, { passive: false });
    document.addEventListener('mouseup', (e) => { if (kdDragState) handleSlotDragEnd(e.clientX, e.clientY); });
    document.addEventListener('touchmove', (e) => { if (!kdDragState) return; const t = e.touches[0]; if (handleSlotDragMove(t.clientX, t.clientY)) e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend', (e) => { if (kdDragState) handleSlotDragEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY); });
    document.addEventListener('touchcancel', cleanupDragState);

    // Frequency buttons
    const freqContainer = $('kdFreqOptions');
    if (freqContainer) {
      freqContainer.querySelectorAll('.kd-freq-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          freqContainer.querySelectorAll('.kd-freq-btn').forEach(b => b.classList.remove('kd-freq-active'));
          btn.classList.add('kd-freq-active');
          kdFrequency = btn.getAttribute('data-freq') || 'equal';
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
            <div class="player-meta">${p.goalie ? '\ud83e\udde4 Keeper' : '\u26bd Utespiller'}</div>
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
      info.textContent = `${kdSelected.size} pÃ¥ oppmÃ¸te â€¢ ${onField} pÃ¥ banen â€¢ ${minutes} min`;
    }
  }

  // ------------------------------
  // Keeper UI
  // ------------------------------
  /**
   * Auto-distribute keeper minutes evenly when count changes.
   * 70 min / 3 keepers â†’ 24, 23, 23 (largest remainder gets extra).
   */
  function autoFillKeeperMinutes() {
    const kc = clamp(parseInt($('kdKeeperCount')?.value, 10) || 0, 0, 4);
    if (kc === 0) return;
    const T = clamp(parseInt($('kdMinutes')?.value, 10) || 48, 10, 200);
    const base = Math.floor(T / kc);
    let remainder = T - base * kc;

    for (let i = 1; i <= kc; i++) {
      const el = $(`kdKeeperMin${i}`);
      if (!el) continue;
      const extra = remainder > 0 ? 1 : 0;
      el.value = base + extra;
      if (extra) remainder--;
    }
  }

  function refreshKeeperUI() {
    const format = parseInt($('kdFormat')?.value, 10) || 7;

    const manualEl = $('kdManualKeeper');
    const keeperCard = manualEl?.closest('.settings-card');
    const panel = $('kdKeeperPanel');

    if (format === 3) {
      if (keeperCard) keeperCard.style.display = 'none';
      if (panel) panel.style.display = 'none';
      if (manualEl) manualEl.checked = false;
      return;
    } else {
      if (keeperCard) keeperCard.style.display = '';
      if ($('kdKeeperHint')) $('kdKeeperHint').textContent = 'Velg hvem som stÃ¥r i mÃ¥l og hvor lenge.';
    }

    const isManual = !!manualEl?.checked;
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
      const icon = p.goalie ? '\ud83e\udde4' : '\u26bd';
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
        if (selectedPids.includes(pid)) warnings.push('âš  Samme keeper valgt flere ganger');
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
        warnings.push(`âš  Keeper ${i + 1} fÃ¥r ingen tid (total overstiger ${T} min)`);
      }
    }

    const ok = (chosen === kc) && (sum === T);
    let msg = `Velg keeper(e) â€” Sum: ${sum}/${T} (${ok ? 'OK' : 'SJEKK'})`;
    if (sum > T && sum !== T) {
      msg += ` â€” Capped til ${T} min totalt`;
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
        <div class="kd-f-desc">${[arr[0] > 0 ? arr[0]+' forsvar' : '', arr[1] > 0 ? arr[1]+' midtbane' : '', arr[2] > 0 ? arr[2]+' angrep' : ''].filter(Boolean).join(' Â· ')}</div>
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
    ].filter(z => z.need > 0);

    const warn = zones.some(z => z.have < z.need);
    el.style.display = 'block';
    el.style.background = warn ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.06)';
    el.style.color = warn ? '#d97706' : '#16a34a';

    el.innerHTML = `<div style="font-weight:800; margin-bottom:6px;">${warn ? 'âš  ' : ''}Sonedekning for ${kdFormationKey}</div>` +
      zones.map(z => {
        const pct = Math.min(100, Math.round((z.have / Math.max(1, present.length)) * 100));
        const low = z.have < z.need;
        return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">
          <span style="width:8px;height:8px;border-radius:50%;background:${z.color};flex-shrink:0;"></span>
          <span style="width:72px;">${z.name} (${z.need})</span>
          <div style="flex:1;height:6px;background:rgba(0,0,0,0.06);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${low ? '#d97706' : z.color};border-radius:3px;"></div>
          </div>
          <span style="width:32px;text-align:right;font-weight:800;${low ? 'color:#d97706;' : ''}">${z.have}${low ? ' âš ' : ''}</span>
        </div>`;
      }).join('') +
      (warn ? `<div style="margin-top:6px;font-size:12px;">Noen spillere vil bli plassert utenfor preferanse.</div>` : '');
  }

  // Assign positions to a lineup based on formation + preferences
  function assignZones(lineup, keeperId, formation, positions) {
    if (!formation) return null;
    const posMap = positions || getPositionsMap();

    // Auto-pick keeper if none assigned but formation expects one (format > 3)
    // Formation [D, M, A] sums to outfield count; keeper is the extra slot.
    let effectiveKeeperId = keeperId;
    const formationSum = formation[0] + formation[1] + formation[2];
    if (!effectiveKeeperId && lineup.length > formationSum) {
      // Pick a goalie-flagged player if possible, else last in lineup
      const players = (typeof getPlayersArray === 'function') ? getPlayersArray() : [];
      const goalies = lineup.filter(id => players.some(p => p.id === id && p.goalie));
      effectiveKeeperId = goalies.length ? goalies[0] : lineup[lineup.length - 1];
    }

    const outfield = lineup.filter(id => id !== effectiveKeeperId);
    let [defN, midN, attN] = formation;

    // If fewer outfield than formation needs, can't assign
    let diff = outfield.length - formationSum;
    if (diff < 0) return null;
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

    return { zones, overflows, keeperId: effectiveKeeperId || null };
  }

  // ------------------------------
  // Slot override functions (drag & drop)
  // ------------------------------

  function getActiveSlots() {
    if (!lastFormationKey || !SLOT_LAYOUTS[lastFormationKey]) return null;
    return SLOT_LAYOUTS[lastFormationKey];
  }

  function getSlotSizeCls(slots) {
    if (!slots) return '';
    return slots.length <= 7 ? 'kd-slot-small' : (slots.length <= 9 ? 'kd-slot-medium' : 'kd-slot-large');
  }

  function buildDefaultSlotMap(segIdx) {
    if (!lastBest || !lastBest.segments[segIdx]) return { slots: {}, bench: [] };
    const seg = lastBest.segments[segIdx];
    const slots = getActiveSlots();
    const fm = lastFormation;
    if (!slots || !fm) return { slots: {}, bench: [] };
    const zr = assignZones(seg.lineup, seg.keeperId, fm, lastPositions);
    if (!zr) return { slots: {}, bench: [] };
    const map = {};
    const zoneSlots = { F: [], M: [], A: [] };
    slots.filter(s => s.zone !== 'K').forEach(s => zoneSlots[s.zone].push(s.key));
    for (const zone of ['F', 'M', 'A']) {
      zr.zones[zone].forEach((pid, i) => { if (i < zoneSlots[zone].length) map[zoneSlots[zone][i]] = pid; });
    }
    const gk = slots.find(s => s.zone === 'K');
    if (gk && seg.keeperId) map[gk.key] = seg.keeperId;
    return { slots: map, bench: lastPresent.filter(p => !seg.lineup.includes(p.id)).map(p => p.id) };
  }

  function getSlotMap(si) {
    if (kdSlotOverrides[si]) return { slots: { ...kdSlotOverrides[si].slots }, bench: [...(kdSlotOverrides[si].bench || [])] };
    return buildDefaultSlotMap(si);
  }

  function hasSlotOverrides(si) { return !!kdSlotOverrides[si]; }

  function ensureSlotOverride(si) {
    if (!kdSlotOverrides[si]) {
      const d = buildDefaultSlotMap(si);
      kdSlotOverrides[si] = { slots: { ...d.slots }, bench: [...d.bench] };
    }
  }

  function swapFieldSlots(si, a, b) {
    ensureSlotOverride(si);
    const m = kdSlotOverrides[si].slots;
    const t = m[a]; m[a] = m[b]; m[b] = t;
  }

  function swapBenchToField(si, benchPid, fieldSlot) {
    ensureSlotOverride(si);
    const m = kdSlotOverrides[si];
    const fieldPid = m.slots[fieldSlot];
    m.slots[fieldSlot] = benchPid;
    const bi = m.bench.indexOf(benchPid);
    if (bi !== -1) m.bench.splice(bi, 1);
    if (fieldPid) m.bench.push(fieldPid);
  }

  function resetSlotOverride(si) {
    delete kdSlotOverrides[si];
    renderKampdagOutput(lastPresent, lastBest, lastP, lastT);
  }

  function resetAllSlotOverrides() {
    kdSlotOverrides = {};
    renderKampdagOutput(lastPresent, lastBest, lastP, lastT);
  }

  function copySlotToNext(si) {
    if (!lastBest || si >= lastBest.segments.length - 1 || !kdSlotOverrides[si]) return;
    const slots = getActiveSlots();
    if (!slots) return;
    const src = kdSlotOverrides[si];
    const nextLineup = new Set(lastBest.segments[si + 1].lineup);
    ensureSlotOverride(si + 1);
    const tgt = kdSlotOverrides[si + 1];
    // Copy field positions where player is still in next lineup
    for (const [sk, pid] of Object.entries(src.slots)) {
      const slot = slots.find(s => s.key === sk);
      if (!slot || slot.zone === 'K') continue;
      if (nextLineup.has(pid)) {
        // Clear player from any other slot first
        for (const [tk, tv] of Object.entries(tgt.slots)) { if (tv === pid && tk !== sk) tgt.slots[tk] = null; }
        tgt.slots[sk] = pid;
      }
    }
    // Fill empty slots with unplaced players
    for (const [sk, sv] of Object.entries(tgt.slots)) {
      if (!sv || !nextLineup.has(sv)) {
        const unused = [...nextLineup].filter(p => !Object.values(tgt.slots).includes(p) && p !== lastBest.segments[si + 1].keeperId);
        if (unused.length) tgt.slots[sk] = unused[0];
      }
    }
    tgt.bench = lastPresent.filter(p => !lastBest.segments[si + 1].lineup.includes(p.id)).map(p => p.id);
    renderKampdagOutput(lastPresent, lastBest, lastP, lastT);
  }

  function getEffectiveMinutes() {
    if (!lastBest) return {};
    const mins = {};
    lastPresent.forEach(p => { mins[p.id] = 0; });
    for (let i = 0; i < lastBest.segments.length; i++) {
      const dt = lastBest.segments[i].end - lastBest.segments[i].start;
      const sm = getSlotMap(i);
      for (const pid of Object.values(sm.slots).filter(Boolean)) {
        mins[pid] = (mins[pid] || 0) + dt;
      }
    }
    return mins;
  }

  function isSlotOutOfPref(pid, slotKey) {
    const slots = getActiveSlots();
    if (!slots) return false;
    const s = slots.find(s => s.key === slotKey);
    if (!s || s.zone === 'K') return false;
    const prefs = lastPositions[pid] || getPositionsMap()[pid];
    return prefs ? !prefs.has(s.zone) : false;
  }

  function getSlotZoneBalance(si) {
    const slots = getActiveSlots();
    const fm = lastFormation;
    if (!slots || !fm) return null;
    const sm = getSlotMap(si);
    const c = { F: 0, M: 0, A: 0 };
    for (const s of slots) {
      if (s.zone !== 'K' && sm.slots[s.key]) c[s.zone]++;
    }
    return {
      F: { count: c.F, expected: fm[0], ok: c.F === fm[0] },
      M: { count: c.M, expected: fm[1], ok: c.M === fm[1] },
      A: { count: c.A, expected: fm[2], ok: c.A === fm[2] },
    };
  }

  // ------------------------------
  // Drag & drop handlers
  // ------------------------------

  function initSlotDragStart(segIdx, slotKey, isBench, benchPid, startX, startY) {
    const slots = getActiveSlots();
    if (!slots) return;
    if (!isBench) {
      const sl = slots.find(s => s.key === slotKey);
      if (sl && sl.zone === 'K') return;
    }
    const sm = getSlotMap(segIdx);
    const pid = isBench ? benchPid : sm.slots[slotKey];
    if (!pid) return;
    const zone = isBench ? 'bench' : (slots.find(s => s.key === slotKey) || {}).zone || 'M';
    kdDragState = { segIdx, slotKey: isBench ? null : slotKey, playerId: pid, isBench, ghostEl: null, startX, startY, isDragging: false, zone };
  }

  function handleSlotDragMove(clientX, clientY) {
    if (!kdDragState) return false;
    const idToName = {};
    lastPresent.forEach(p => { idToName[p.id] = p.name; });
    if (!kdDragState.isDragging) {
      if (Math.abs(clientX - kdDragState.startX) + Math.abs(clientY - kdDragState.startY) < KD_DRAG_THRESHOLD) return false;
      kdDragState.isDragging = true;
      const ghost = document.createElement('div');
      ghost.className = 'kd-drag-ghost';
      ghost.id = 'kdActiveGhost';
      const bgMap = { F: 'rgba(34,197,94,0.9)', M: 'rgba(59,130,246,0.9)', A: 'rgba(239,68,68,0.9)', K: 'rgba(168,85,247,0.9)', bench: 'rgba(100,116,139,0.9)' };
      ghost.style.background = bgMap[kdDragState.zone] || bgMap.M;
      ghost.innerHTML = `<span class="kd-g-name">${escapeHtml(idToName[kdDragState.playerId] || kdDragState.playerId)}</span>`;
      ghost.style.left = clientX + 'px';
      ghost.style.top = clientY + 'px';
      document.body.appendChild(ghost);
      kdDragState.ghostEl = ghost;
      const srcSel = kdDragState.slotKey
        ? `.kd-pos-bubble[data-seg="${kdDragState.segIdx}"][data-slot="${kdDragState.slotKey}"]`
        : `.kd-bench-bubble[data-seg="${kdDragState.segIdx}"][data-pid="${kdDragState.playerId}"]`;
      const srcEl = document.querySelector(srcSel);
      if (srcEl) srcEl.classList.add('kd-dragging');
    }
    if (kdDragState.ghostEl) {
      kdDragState.ghostEl.style.left = clientX + 'px';
      kdDragState.ghostEl.style.top = clientY + 'px';
    }
    document.querySelectorAll('.kd-pos-slot.kd-drop-target').forEach(el => el.classList.remove('kd-drop-target'));
    const tgt = findSlotDropTarget(clientX, clientY);
    if (tgt) tgt.classList.add('kd-drop-target');
    return kdDragState.isDragging;
  }

  function handleSlotDragEnd(clientX, clientY) {
    if (!kdDragState) return;
    const idToName = {};
    lastPresent.forEach(p => { idToName[p.id] = p.name; });
    if (kdDragState.isDragging) {
      const slots = getActiveSlots();
      const tgt = findSlotDropTarget(clientX, clientY);
      if (tgt && slots) {
        const tsk = tgt.dataset.slotkey;
        const ts = slots.find(s => s.key === tsk);
        if (ts && ts.zone !== 'K' && tsk !== kdDragState.slotKey) {
          if (kdDragState.isBench) {
            swapBenchToField(kdDragState.segIdx, kdDragState.playerId, tsk);
          } else {
            swapFieldSlots(kdDragState.segIdx, kdDragState.slotKey, tsk);
          }
          try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
          renderKampdagOutput(lastPresent, lastBest, lastP, lastT);
        }
      }
      if (kdDragState.ghostEl) kdDragState.ghostEl.remove();
      document.querySelectorAll('.kd-dragging,.kd-drop-target').forEach(el => {
        el.classList.remove('kd-dragging');
        el.classList.remove('kd-drop-target');
      });
    }
    kdDragState = null;
  }

  function findSlotDropTarget(x, y) {
    if (!kdDragState) return null;
    const slots = getActiveSlots();
    if (!slots) return null;
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.id === 'kdActiveGhost' || el.closest('#kdActiveGhost')) continue;
      const slot = el.classList.contains('kd-pos-slot') ? el : el.closest('.kd-pos-slot');
      if (slot && slot.dataset.seg === String(kdDragState.segIdx)) {
        const sk = slot.dataset.slotkey;
        const s = slots.find(s => s.key === sk);
        if (s && s.zone !== 'K' && sk !== kdDragState.slotKey) return slot;
      }
    }
    return null;
  }

  function cleanupDragState() {
    if (kdDragState) {
      if (kdDragState.ghostEl) kdDragState.ghostEl.remove();
      document.querySelectorAll('.kd-dragging,.kd-drop-target').forEach(el => {
        el.classList.remove('kd-dragging');
        el.classList.remove('kd-drop-target');
      });
      kdDragState = null;
    }
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

  // ------------------------------
  // NEW ALGORITHM: Optimal segments + greedy assignment + individual swaps
  // ------------------------------

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

  /**
   * Choose optimal number of segments based on mode, format and squad size.
   *
   * Based on exhaustive simulation across all NFF formats (3/5/7/9-er),
   * squad sizes (N from P+1 to P+7), and both modes.
   *
   * "equal" mode: minimize diff, allow more segments and swaps.
   * "calm" mode: minimize substitutions, accept higher diff (â‰¤10 min).
   *
   * Uses a lookup table for known scenarios, with formula fallback.
   */
  function chooseOptimalSegments(T, P, N, mode) {
    const bench = N - P;

    // Minimum segments needed so every player gets at least 1 segment on field.
    const rawMinSegs = Math.ceil(N / P);
    const minSegsForAll = bench > P ? rawMinSegs + 1 : rawMinSegs;

    // Perfect match: bench >= P â†’ entire lineup rotates at halftime
    if (bench >= P) return Math.max(2, minSegsForAll);

    // No bench: just play the whole match, split at half
    if (bench === 0) return 2;

    // Bench=1: exactly 1 spare player. For perfect fairness, need N segments
    // (each player sits out exactly 1 segment). But that's too many subs.
    // Cap so segments aren't too short (min ~4 min each).
    if (bench === 1) {
      return Math.max(minSegsForAll, Math.min(N, Math.floor(T / 4)));
    }

    // Pre-computed optimal segment counts from exhaustive simulation.
    // Key: P_N, values: { equal: nsegs, calm: nsegs }
    // These were found by brute-force testing nsegs 2..25 across 30 seeds,
    // optimizing for (low diff + few subs + no short segments + few stints).
    const LOOKUP = {
      // 3-er (T=30, K=0, ingen keeper)
      '3_4': { equal: 2, calm: 2 },
      '3_5': { equal: 2, calm: 2 },
      '3_6': { equal: 2, calm: 2 },
      '3_7': { equal: 2, calm: 2 },
      '3_8': { equal: 4, calm: 3 },
      // 5-er (T=40, K=2)
      '5_6': { equal: 6, calm: 6 },
      '5_7': { equal: 4, calm: 6 },
      '5_8': { equal: 7, calm: 6 },
      '5_9': { equal: 6, calm: 2 },
      '5_10': { equal: 2, calm: 2 },
      '5_11': { equal: 7, calm: 2 },
      // 7-er (T=60, K=2)
      '7_8': { equal: 10, calm: 8 },
      '7_9': { equal: 4, calm: 4 },
      '7_10': { equal: 3, calm: 5 },
      '7_11': { equal: 3, calm: 3 },
      '7_12': { equal: 5, calm: 5 },
      '7_13': { equal: 2, calm: 3 },
      '7_14': { equal: 2, calm: 3 },
      // 9-er (T=70, K=2)
      '9_10': { equal: 12, calm: 8 },
      '9_11': { equal: 5, calm: 5 },
      '9_12': { equal: 4, calm: 4 },
      '9_13': { equal: 3, calm: 4 },
      '9_14': { equal: 3, calm: 4 },
      '9_15': { equal: 5, calm: 5 },
      '9_16': { equal: 5, calm: 3 },
    };

    const key = P + '_' + N;
    const entry = LOOKUP[key];
    if (entry) {
      // Ensure LOOKUP value gives enough segments for all players
      const val = entry[mode] || entry.equal;
      return Math.max(val, minSegsForAll);
    }

    // Fallback formula for unlisted combinations
    // 3-er has no keeper feature, so all P spots are outfield.
    // For other formats, assume 1 keeper spot when bench > 0.
    const hasKeeperFeature = (P !== 3);
    const keeperSlots = (hasKeeperFeature && bench > 0) ? 1 : 0;
    const outfieldPlaces = P - keeperSlots;
    const outfieldCount = N - keeperSlots;

    if (mode === 'calm') {
      const minSegs = minSegsForAll;
      const maxSegs = Math.min(8, Math.floor(T / 5));
      let best = null;
      for (let nsegs = minSegs; nsegs <= maxSegs; nsegs++) {
        const remainder = (nsegs * outfieldPlaces) % outfieldCount;
        const avg = T / nsegs;
        // Prefer: low remainder, then fewer segments (= fewer subs)
        const score = remainder * 10 + nsegs * 2;
        if (!best || score < best.score) best = { score, nsegs };
      }
      return best ? best.nsegs : Math.max(2, Math.round(T / 10));
    }

    // Equal: search wide range, minimize remainder, prefer moderate segment length
    const inRange = [];
    for (let nsegs = minSegsForAll; nsegs <= Math.min(15, Math.ceil(T / 4) + 2); nsegs++) {
      const avg = T / nsegs;
      if (avg >= 4 && avg <= 20) {
        const remainder = (nsegs * outfieldPlaces) % outfieldCount;
        const score = remainder * 10 + Math.abs(avg - 8) * 0.5 + nsegs * 0.5;
        inRange.push({ score, nsegs });
      }
    }
    inRange.sort((a, b) => a.score - b.score);
    return inRange.length ? inRange[0].nsegs : Math.max(2, Math.round(T / 8));
  }

  /**
   * Generate segment boundary times.
   * Keeper change times are mandatory boundaries (user expects exact keeper swap).
   */
  function generateSegmentTimes(T, nsegs, keeperChangeTimes, keeperTimeline, P, N) {
    const boundaries = new Set([0, T]);
    (keeperChangeTimes || []).forEach(t => { if (t > 0 && t < T) boundaries.add(t); });

    // For K>=2: add keeper outfield window boundaries so each keeper
    // gets a dedicated outfield stint in the other keeper's half.
    // This prevents keeper time asymmetry without needing extra splits later.
    const keepers = keeperTimeline || [];
    if (keepers.length >= 2 && P && N) {
      const target = P * T / N;
      const keeperBonus = Math.min(4, Math.max(2, Math.round(T / 20)));
      for (const kseg of keepers) {
        const kTime = kseg.end - kseg.start;
        const outfield = Math.round(Math.max(5, target - kTime + keeperBonus));
        if (kseg.end < T) {
          const b = Math.round(Math.min(T - 3, kseg.end + outfield));
          if (b > kseg.end + 3 && T - b >= 3) boundaries.add(b);
        }
        if (kseg.start > 0) {
          const b = Math.round(Math.max(3, kseg.start - outfield));
          if (b < kseg.start - 3 && b >= 3) boundaries.add(b);
        }
      }
    }

    // If keeper boundaries already give us enough segments, use them as-is.
    // Note: for K=3, outfield windows may create many boundaries but the
    // late-path merge handles micro-segments. Don't merge here to preserve
    // keeper balance boundaries.
    const sortedB = Array.from(boundaries).sort((a, b) => a - b);
    if (sortedB.length - 1 >= nsegs) return sortedB;

    // Otherwise, distribute LOOKUP segments across zones proportionally
    const zones = [];
    for (let i = 0; i < sortedB.length - 1; i++) {
      zones.push({ start: sortedB[i], end: sortedB[i + 1], dur: sortedB[i + 1] - sortedB[i] });
    }
    const totalSegs = Math.max(nsegs, zones.length);
    const zoneCounts = zones.map(z => Math.max(1, Math.round(totalSegs * z.dur / T)));
    let sum = zoneCounts.reduce((a, b) => a + b, 0);
    while (sum > totalSegs) {
      let maxIdx = 0;
      for (let i = 1; i < zoneCounts.length; i++) {
        if (zoneCounts[i] > zoneCounts[maxIdx]) maxIdx = i;
      }
      if (zoneCounts[maxIdx] <= 1) break;
      zoneCounts[maxIdx]--;
      sum--;
    }
    while (sum < totalSegs) {
      let maxIdx = 0;
      for (let i = 1; i < zoneCounts.length; i++) {
        if (zones[i].dur / zoneCounts[i] > zones[maxIdx].dur / zoneCounts[maxIdx]) maxIdx = i;
      }
      zoneCounts[maxIdx]++;
      sum++;
    }

    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      const count = zoneCounts[z];
      if (count <= 1) continue;
      const segLen = zone.dur / count;
      for (let i = 1; i < count; i++) {
        boundaries.add(Math.round(zone.start + i * segLen));
      }
    }

    const finalTimes = Array.from(boundaries).sort((a, b) => a - b);

    // Merge micro-segments: if any segment is shorter than 3 minutes,
    // remove the boundary that creates it (keep keeper change boundaries).
    // This prevents 1-2 min segments that occur with 3+ keepers.
    const kChangeSet = new Set(keeperChangeTimes || []);
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 1; i < finalTimes.length - 1; i++) {
        const dt = finalTimes[i + 1] - finalTimes[i];
        const dtPrev = finalTimes[i] - finalTimes[i - 1];
        if (dt < 3 || dtPrev < 3) {
          // Don't remove keeper change boundaries
          if (kChangeSet.has(finalTimes[i])) continue;
          finalTimes.splice(i, 1);
          merged = true;
          break;
        }
      }
    }

    return finalTimes;
  }


  /**
   * Greedy lineup assignment: at each segment, pick players furthest behind target pace.
   * Keeper is always forced on field during their keeper segments.
   */
  function greedyAssign(playersList, times, P, keeperTimeline, seed, stickyMode) {
    const rng = makeRng(seed);
    const ids = playersList.map(p => p.id);
    const T = times[times.length - 1];
    const target = (P * T) / Math.max(1, ids.length);
    const minutes = {};
    ids.forEach(id => { minutes[id] = 0; });

    const keeperMins = buildKeeperMinutes(keeperTimeline, ids);
    const keeperSet = new Set(Object.keys(keeperMins).filter(id => keeperMins[id] > 0));
    const idSet = new Set(ids);

    // Pre-calculate remaining keeper time from any point
    function remainingKeeperTime(keeperId, afterTime) {
      let remaining = 0;
      (keeperTimeline || []).forEach(seg => {
        if (seg.keeperId !== keeperId) return;
        const overlapStart = Math.max(seg.start, afterTime);
        const overlapEnd = seg.end;
        if (overlapEnd > overlapStart) remaining += (overlapEnd - overlapStart);
      });
      return remaining;
    }

    // For K>=2: pre-compute which segments each keeper plays outfield in,
    // and which segments they should be EXCLUDED from (to avoid over-playing).
    const keeperOutfieldSegs = {};
    const keeperExcludeSegs = {};
    for (const kid of keeperSet) {
      keeperOutfieldSegs[kid] = new Set();
      keeperExcludeSegs[kid] = new Set();
    }
    if (keeperSet.size >= 2) {
      const keeperBonus = Math.min(4, Math.max(2, Math.round(T / 20)));
      for (const ktlSeg of (keeperTimeline || [])) {
        const kid = ktlSeg.keeperId;
        if (!keeperSet.has(kid)) continue;
        const kTime = ktlSeg.end - ktlSeg.start;
        const outfieldTarget = Math.max(0, Math.round(target + keeperBonus - kTime));
        let assigned = 0;
        // Assign outfield segments after keeper stint
        if (ktlSeg.end < T) {
          for (let i = 0; i < times.length - 1 && assigned < outfieldTarget; i++) {
            if (times[i] >= ktlSeg.end) {
              keeperOutfieldSegs[kid].add(i);
              assigned += times[i + 1] - times[i];
            }
          }
        }
        // Assign outfield segments before keeper stint (backwards)
        if (ktlSeg.start > 0 && assigned < outfieldTarget) {
          for (let i = times.length - 2; i >= 0 && assigned < outfieldTarget; i--) {
            if (times[i + 1] <= ktlSeg.start && !keeperOutfieldSegs[kid].has(i)) {
              keeperOutfieldSegs[kid].add(i);
              assigned += times[i + 1] - times[i];
            }
          }
        }
        // All other segments (not keeper, not outfield) â†’ excluded
        for (let i = 0; i < times.length - 1; i++) {
          const isKeeper = keeperAtMinute(times[i] + 0.0001, keeperTimeline) === kid;
          if (!isKeeper && !keeperOutfieldSegs[kid].has(i)) {
            keeperExcludeSegs[kid].add(i);
          }
        }
      }
    }

    const segments = [];

    // Stickiness parameters per mode
    const STICKY = {
      strong: { on1: 4.0, on2: 2.0, on3: 0.5, off1: -3.0, off2: -1.0 },
      mild:   { on1: 1.5, on2: 0.8, on3: 0.3, off1: -1.0, off2: 0 },
    };
    const sp = stickyMode ? STICKY[stickyMode] : null;

    const onFieldStreak = {};
    const offFieldStreak = {};
    ids.forEach(id => { onFieldStreak[id] = 0; offFieldStreak[id] = 0; });

    for (let i = 0; i < times.length - 1; i++) {
      const start = times[i];
      const end = times[i + 1];
      const dt = end - start;
      if (dt <= 0) continue;

      const keeperId = keeperAtMinute(start + 0.0001, keeperTimeline);
      const lineup = [];

      // Keeper must be on field
      if (keeperId && idSet.has(keeperId)) lineup.push(keeperId);

      // K>=2: pre-assign keepers to their outfield segments
      if (keeperSet.size >= 2) {
        for (const kid of keeperSet) {
          if (kid === keeperId || lineup.includes(kid) || lineup.length >= P) continue;
          if (keeperOutfieldSegs[kid].has(i)) lineup.push(kid);
        }
      }

      // Calculate deficit: how far behind target pace is each player?
      const paceTarget = target * start / T;
      const scored = playersList
        .filter(p => !lineup.includes(p.id))
        .map(p => {
          // K>=2: exclude keepers from non-assigned segments
          if (keeperSet.size >= 2 && keeperExcludeSegs[p.id] && keeperExcludeSegs[p.id].has(i)) {
            return { id: p.id, score: -9999 };
          }

          let effectiveMinutes = minutes[p.id];
          // K<=1: use keeper compensation factor (original behavior)
          if (keeperSet.has(p.id) && keeperSet.size <= 1) {
            const futureKeeper = remainingKeeperTime(p.id, end);
            const totalKeeperTime = keeperMins[p.id] || 0;
            const keeperRatio = totalKeeperTime / T;
            const factor = Math.max(0.1, 0.93 - keeperRatio * 0.83);
            effectiveMinutes += futureKeeper * factor;
          }
          let deficit = paceTarget - effectiveMinutes;

          // Stickiness: bonus for staying on field, penalty for leaving bench early
          if (sp) {
            const onStreak = onFieldStreak[p.id];
            const offStreak = offFieldStreak[p.id];
            if (onStreak > 0) {
              deficit += onStreak === 1 ? sp.on1 : onStreak === 2 ? sp.on2 : sp.on3;
            } else if (offStreak > 0) {
              deficit += offStreak === 1 ? sp.off1 : offStreak === 2 ? sp.off2 : 0;
            }
          }

          const jitter = (rng() - 0.5) * 0.3;
          return { id: p.id, score: deficit + jitter };
        })
        .sort((a, b) => b.score - a.score);

      // Fill remaining spots
      while (lineup.length < P && scored.length) {
        lineup.push(scored.shift().id);
      }

      lineup.forEach(id => { minutes[id] += dt; });

      // Update on/off field streaks
      const lineupSet = new Set(lineup);
      ids.forEach(id => {
        if (lineupSet.has(id)) {
          onFieldStreak[id]++;
          offFieldStreak[id] = 0;
        } else {
          offFieldStreak[id]++;
          onFieldStreak[id] = 0;
        }
      });

      const validKeeper = (keeperId && idSet.has(keeperId) && lineup.includes(keeperId)) ? keeperId : null;
      segments.push({ start, end, dt, lineup: lineup.slice(), keeperId: validKeeper });
    }

    return { segments, minutes, keeperMinutes: keeperMins, keeperSet, target };
  }

  /**
   * Add individual mid-segment swaps to balance playing time.
   * Finds over/under pairs among non-keepers and splits a segment for them.
   * Max maxSwaps individual swaps. Returns the swaps and updated minutes.
   * Segments are physically split so rendering works without changes.
   */
  function addIndividualSwaps(segments, minutes, keeperMinutes, playersList, P, maxSwaps, splitHalf) {
    const ids = playersList.map(p => p.id);
    const keeperSet = new Set(Object.keys(keeperMinutes).filter(id => keeperMinutes[id] > 0));
    const nonKeepers = ids.filter(id => !keeperSet.has(id));
    const keepers = ids.filter(id => keeperSet.has(id));
    const swapsAdded = [];

    const minSplitHalf = Math.max(3, splitHalf || 4);
    const minSplitDt = minSplitHalf * 2;

    // v12: Hard cap on new splits to minimize substitution moments
    const maxNewSplits = maxSwaps; // use the mode-based maxSwaps as split cap
    let splitsUsed = 0;

    // Helper: split a segment to transfer time from 'from' to 'to'
    function trySplit(from, to, amount) {
      if (splitsUsed >= maxNewSplits) return 0;
      const segIndices = segments.map((_, i) => i)
        .sort((a, b) => (segments[b].end - segments[b].start) - (segments[a].end - segments[a].start));
      for (const idx of segIndices) {
        const seg = segments[idx];
        if (!seg.lineup.includes(from) || seg.lineup.includes(to) || seg.keeperId === from) continue;
        const dt = seg.end - seg.start;
        if (dt < minSplitDt) continue;
        const actual = Math.min(amount, dt - minSplitHalf);
        if (actual < minSplitHalf) continue;
        const splitTime = Math.round(seg.end - actual);
        if (splitTime - seg.start < 2 || seg.end - splitTime < 2) continue;
        const realActual = seg.end - splitTime;
        segments.splice(idx, 1,
          { start: seg.start, end: splitTime, dt: splitTime - seg.start, lineup: seg.lineup.slice(), keeperId: seg.keeperId },
          { start: splitTime, end: seg.end, dt: realActual, lineup: seg.lineup.map(id => id === from ? to : id), keeperId: seg.keeperId }
        );
        minutes[from] -= realActual;
        minutes[to] += realActual;
        swapsAdded.push({ time: splitTime, out: from, in: to, amount: realActual });
        splitsUsed++;
        return realActual;
      }
      return 0;
    }

    // Helper: swap two players between existing segments (no new splits)
    function trySegSwap(from, to) {
      const gap = minutes[from] - minutes[to];
      let bestSwap = null, bestImp = 0;
      for (let i = 0; i < segments.length; i++) {
        const s1 = segments[i];
        if (!s1.lineup.includes(from) || s1.lineup.includes(to) || s1.keeperId === from) continue;
        for (let j = 0; j < segments.length; j++) {
          if (i === j) continue;
          const s2 = segments[j];
          if (!s2.lineup.includes(to) || s2.lineup.includes(from) || s2.keeperId === to) continue;
          const d1 = s1.end - s1.start, d2 = s2.end - s2.start;
          const newGap = Math.abs((minutes[from] - d1 + d2) - (minutes[to] + d1 - d2));
          const imp = gap - newGap;
          if (imp > bestImp && newGap < gap) { bestSwap = { i, j, d1, d2 }; bestImp = imp; }
        }
      }
      if (bestSwap && bestImp >= 1) {
        segments[bestSwap.i].lineup = segments[bestSwap.i].lineup.map(id => id === from ? to : id);
        segments[bestSwap.j].lineup = segments[bestSwap.j].lineup.map(id => id === to ? from : id);
        minutes[from] += bestSwap.d2 - bestSwap.d1;
        minutes[to] += bestSwap.d1 - bestSwap.d2;
        return true;
      }
      return false;
    }

    // Phase 1: NK balance via splits (limited by maxNewSplits)
    for (let round = 0; round < maxSwaps; round++) {
      if (nonKeepers.length < 2) break;
      const nkVals = nonKeepers.map(id => minutes[id]);
      if (Math.max(...nkVals) - Math.min(...nkVals) <= 2) break;
      const overP = nonKeepers.reduce((a, b) => minutes[a] > minutes[b] ? a : b);
      const underP = nonKeepers.reduce((a, b) => minutes[a] < minutes[b] ? a : b);
      const amt = Math.round(Math.max(2, Math.min((minutes[overP] - minutes[underP]) / 2, 10)));
      if (!trySplit(overP, underP, amt)) break;
    }

    // Phase 1b: NK repair swaps (no new segments)
    for (let r = 0; r < maxSwaps * 2; r++) {
      if (nonKeepers.length < 2) break;
      const nkVals = nonKeepers.map(id => minutes[id]);
      if (Math.max(...nkVals) - Math.min(...nkVals) <= 1) break;
      const overP = nonKeepers.reduce((a, b) => minutes[a] > minutes[b] ? a : b);
      const underP = nonKeepers.reduce((a, b) => minutes[a] < minutes[b] ? a : b);
      if (!trySegSwap(overP, underP)) break;
    }

    // Phase 2: Keeper equalization (swap-only, no new segments)
    if (keepers.length >= 2) {
      for (let r = 0; r < 20; r++) {
        const kSorted = keepers.slice().sort((a, b) => minutes[b] - minutes[a]);
        const kHigh = kSorted[0], kLow = kSorted[kSorted.length - 1];
        if (minutes[kHigh] - minutes[kLow] <= 3) break;
        if (trySegSwap(kHigh, kLow)) continue;
        // Indirect: swap kHighâ†”NK, then NKâ†”kLow
        let ok = false;
        for (const nk of nonKeepers) {
          if (minutes[kHigh] > minutes[nk] && trySegSwap(kHigh, nk)) {
            if (minutes[nk] > minutes[kLow]) trySegSwap(nk, kLow);
            ok = true; break;
          }
        }
        if (!ok) break;
      }
    }

    // Phase 3: Final global repair (swap-only)
    for (let r = 0; r < 15; r++) {
      const allVals = ids.map(id => minutes[id]);
      if (Math.max(...allVals) - Math.min(...allVals) <= 3) break;
      const overP = ids.reduce((a, b) => minutes[a] > minutes[b] ? a : b);
      const underP = ids.reduce((a, b) => minutes[a] < minutes[b] ? a : b);
      if (!trySegSwap(overP, underP)) break;
    }

    return swapsAdded;
  }

  // ------------------------------
  // CYCLIC ROTATION (equal-mode candidate)
  // ------------------------------
  // Deterministic bench-window rotation: slides a "bench group" through
  // a ring of outfield players, producing equal-length periods.
  // Competes with greedy via comparator â€” wins when it produces
  // cleaner, more coach-friendly plans.

  function _gcd(a, b) { return b === 0 ? a : _gcd(b, a % b); }

  function buildCyclicCandidate(playersList, P, T, keeperTimeline) {
    const keeperIds = new Set(keeperTimeline.filter(k => k.keeperId).map(k => k.keeperId));
    const keeperCount = keeperIds.size;

    // Qualification: skip when cyclic is unlikely to help
    if (keeperCount >= 3) return null;

    const allIds = playersList.map(p => p.id);
    const N = allIds.length;
    const bench = N - P;
    if (bench <= 0) return null;

    // Min segment length by format
    const minSegLen = P >= 7 ? 6 : (P >= 5 ? 5 : 4);

    // If no keepers, treat whole match as one interval
    const intervals = keeperTimeline.length > 0
      ? keeperTimeline
      : [{ keeperId: null, start: 0, end: T }];

    // Build segments per keeper interval
    const segments = [];
    for (const kSeg of intervals) {
      const halfDur = kSeg.end - kSeg.start;
      const outfield = allIds.filter(id => id !== kSeg.keeperId);
      const outfieldSpots = kSeg.keeperId ? P - 1 : P;
      const benchSize = outfield.length - outfieldSpots;

      if (benchSize <= 0) {
        // Everyone plays this half
        const lineup = kSeg.keeperId ? [kSeg.keeperId, ...outfield] : [...outfield];
        segments.push({ start: kSeg.start, end: kSeg.end, dt: halfDur, lineup, keeperId: kSeg.keeperId });
        continue;
      }

      const cycleLen = outfield.length / _gcd(outfield.length, benchSize);

      // Check qualification: period length and cycle length
      const periodLen = halfDur / cycleLen;
      if (periodLen < minSegLen || cycleLen > 6) return null;

      // Build rotation: slide bench window through player ring
      for (let p = 0; p < cycleLen; p++) {
        const sitting = new Set();
        for (let b = 0; b < benchSize; b++) {
          sitting.add(outfield[(p * benchSize + b) % outfield.length]);
        }
        const playing = outfield.filter(id => !sitting.has(id));
        const start = Math.round(kSeg.start + p * periodLen);
        const end = Math.round(kSeg.start + (p + 1) * periodLen);
        const lineup = kSeg.keeperId ? [kSeg.keeperId, ...playing] : [...playing];
        segments.push({ start, end, dt: end - start, lineup, keeperId: kSeg.keeperId });
      }
    }

    // Calculate minutes
    const minutes = {};
    allIds.forEach(id => { minutes[id] = 0; });
    for (const seg of segments) {
      for (const id of seg.lineup) minutes[id] += seg.dt;
    }

    // Keeper minutes (for compatibility with rest of system)
    const keeperMinutes = {};
    for (const kSeg of keeperTimeline) {
      if (kSeg.keeperId) {
        keeperMinutes[kSeg.keeperId] = (keeperMinutes[kSeg.keeperId] || 0) + (kSeg.end - kSeg.start);
      }
    }

    // Calculate metrics
    const nonKeepers = allIds.filter(id => !keeperIds.has(id));
    const nkVals = nonKeepers.map(id => minutes[id]);
    const nkDiff = nkVals.length >= 2 ? Math.max(...nkVals) - Math.min(...nkVals) : 0;
    const kVals = [...keeperIds].map(id => minutes[id]);
    const kDiff = kVals.length >= 2 ? Math.max(...kVals) - Math.min(...kVals) : 0;

    // Count lineup changes
    let lineupChanges = 0;
    for (let i = 1; i < segments.length; i++) {
      const prev = new Set(segments[i - 1].lineup);
      let changed = false;
      for (const pid of segments[i].lineup) { if (!prev.has(pid)) { changed = true; break; } }
      if (changed) lineupChanges++;
    }

    const allTimes = uniqSorted(segments.map(s => s.start).concat([T]));

    return {
      segments,
      minutes,
      keeperMinutes,
      times: allTimes,
      nkDiff,
      kDiff,
      lineupChanges,
      swaps: []
    };
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
      if (lineupEl) lineupEl.innerHTML = `<div class="small-text" style="opacity:0.8;">Velg oppmÃ¸te fÃ¸rst.</div>`;
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
    const N = present.length;
    const fp = FREQ_PARAMS[kdFrequency] || FREQ_PARAMS.equal;
    const kChangeTimes = keeperChangeTimes(keeperTimeline).filter(x => x > 0 && x < T);
    const NUM_ATTEMPTS = 20;

    let best = null;

    if (fp.mode === 'equal') {
      // Dynamic nsegs search: find plan with nkDiff â‰¤ 5 using fewest lineup changes.
      // Scans all nsegs values and picks globally best valid plan via comparator.
      const minSegLen = P >= 7 ? 6 : (P >= 5 ? 5 : 4);
      const minNsegs = Math.max(2, Math.ceil(N / P));
      // Use minSegLen (not hardcoded 4) so equal-mode avoids micro-segments
      let maxNsegs = Math.min(N, Math.floor(T / minSegLen));
      // Guard: always try at least one nsegs value (prevents NO_PLAN / best=null)
      if (maxNsegs < minNsegs) maxNsegs = minNsegs;

      // Comparator: valid (nkDiff â‰¤ 5) first, then fewest lineupChanges,
      // then lowest nkDiff, then lowest kDiff
      function isBetter(a, b) {
        const aValid = a.nkDiff <= 5 ? 1 : 0;
        const bValid = b.nkDiff <= 5 ? 1 : 0;
        if (aValid !== bValid) return aValid > bValid;
        if (a.lineupChanges !== b.lineupChanges) return a.lineupChanges < b.lineupChanges;
        if (a.nkDiff !== b.nkDiff) return a.nkDiff < b.nkDiff;
        return a.kDiff < b.kDiff;
      }

      // Run greedy nsegs scan with maxSwaps=2
      for (let tryNsegs = minNsegs; tryNsegs <= maxNsegs; tryNsegs++) {
        const times = generateSegmentTimes(T, tryNsegs, kChangeTimes, keeperTimeline, P, N);
        const maxSwaps = 2;
        const stickyMode = (P === 3) ? null : (times.length - 1 >= 4 ? (fp.sticky || null) : null);

        for (let attempt = 0; attempt < NUM_ATTEMPTS; attempt++) {
          const runSeed = seed + attempt * 99991;
          const res = greedyAssign(present, times, P, keeperTimeline, runSeed, stickyMode);

          const segClone = res.segments.map(s => ({
            start: s.start, end: s.end, dt: s.dt,
            lineup: s.lineup.slice(), keeperId: s.keeperId
          }));
          const minClone = Object.assign({}, res.minutes);
          const swaps = addIndividualSwaps(segClone, minClone, res.keeperMinutes, present, P, maxSwaps, fp.swapSplitHalf);

          const nonKeepers = present.map(p => p.id).filter(id => !res.keeperSet.has(id));
          const nkVals = nonKeepers.map(id => minClone[id]);
          const nkDiff = nkVals.length ? Math.max(...nkVals) - Math.min(...nkVals) : 0;
          const kIds = present.map(p => p.id).filter(id => res.keeperSet.has(id));
          const kVals = kIds.map(id => minClone[id]);
          const kDiff = kVals.length >= 2 ? Math.max(...kVals) - Math.min(...kVals) : 0;
          const allTimes = uniqSorted(segClone.map(s => s.start).concat([T]));

          // Count real lineup changes
          let lineupChanges = 0;
          for (let i = 1; i < segClone.length; i++) {
            const prev = new Set(segClone[i - 1].lineup);
            let changed = false;
            for (const pid of segClone[i].lineup) { if (!prev.has(pid)) { changed = true; break; } }
            if (changed) lineupChanges++;
          }

          const candidate = {
            segments: segClone,
            minutes: minClone,
            keeperMinutes: res.keeperMinutes,
            times: allTimes,
            nkDiff,
            kDiff,
            lineupChanges,
            swaps
          };

          if (!best || isBetter(candidate, best)) {
            best = candidate;
          }
        }
      }

      // Cyclic rotation candidate: deterministic bench-window rotation.
      // Competes with greedy via same comparator â€” wins when it produces
      // cleaner plans (fewer lineup changes, equal-length periods).
      const cyclicPlan = buildCyclicCandidate(present, P, T, keeperTimeline);
      if (cyclicPlan && (!best || isBetter(cyclicPlan, best))) {
        best = cyclicPlan;
      }

      // Fallback: if still nkDiff > 5 after full scan with maxSwaps=2,
      // re-run with maxSwaps=3 to give addIndividualSwaps more room.
      // This fixes rare K=3 cases where keeper-locking is too rigid.
      if (best && best.nkDiff > 5) {
        for (let tryNsegs = minNsegs; tryNsegs <= maxNsegs; tryNsegs++) {
          const times = generateSegmentTimes(T, tryNsegs, kChangeTimes, keeperTimeline, P, N);
          const stickyMode = (P === 3) ? null : (times.length - 1 >= 4 ? (fp.sticky || null) : null);
          for (let attempt = 0; attempt < NUM_ATTEMPTS; attempt++) {
            const runSeed = seed + attempt * 99991;
            const res = greedyAssign(present, times, P, keeperTimeline, runSeed, stickyMode);
            const segClone = res.segments.map(s => ({
              start: s.start, end: s.end, dt: s.dt,
              lineup: s.lineup.slice(), keeperId: s.keeperId
            }));
            const minClone = Object.assign({}, res.minutes);
            const swaps = addIndividualSwaps(segClone, minClone, res.keeperMinutes, present, P, 3, fp.swapSplitHalf);
            const nonKeepers = present.map(p => p.id).filter(id => !res.keeperSet.has(id));
            const nkVals = nonKeepers.map(id => minClone[id]);
            const nkDiff = nkVals.length ? Math.max(...nkVals) - Math.min(...nkVals) : 0;
            const kIds = present.map(p => p.id).filter(id => res.keeperSet.has(id));
            const kVals = kIds.map(id => minClone[id]);
            const kDiff = kVals.length >= 2 ? Math.max(...kVals) - Math.min(...kVals) : 0;
            const allTimes = uniqSorted(segClone.map(s => s.start).concat([T]));
            let lineupChanges = 0;
            for (let i = 1; i < segClone.length; i++) {
              const prev = new Set(segClone[i - 1].lineup);
              let changed = false;
              for (const pid of segClone[i].lineup) { if (!prev.has(pid)) { changed = true; break; } }
              if (changed) lineupChanges++;
            }
            const candidate = {
              segments: segClone, minutes: minClone, keeperMinutes: res.keeperMinutes,
              times: allTimes, nkDiff, kDiff, lineupChanges, swaps
            };
            if (isBetter(candidate, best)) best = candidate;
          }
        }
      }
    } else {
      // Calm mode: keep existing logic unchanged
      const nsegs = chooseOptimalSegments(T, P, N, fp.mode);
      const times = generateSegmentTimes(T, nsegs, kChangeTimes, keeperTimeline, P, N);
      const maxSwaps = P === 3 ? 2 : 1;
      const stickyMode = (P === 3) ? null : (nsegs >= 4 ? (fp.sticky || null) : null);

      for (let attempt = 0; attempt < NUM_ATTEMPTS; attempt++) {
        const runSeed = seed + attempt * 99991;
        const res = greedyAssign(present, times, P, keeperTimeline, runSeed, stickyMode);

        const segClone = res.segments.map(s => ({
          start: s.start, end: s.end, dt: s.dt,
          lineup: s.lineup.slice(), keeperId: s.keeperId
        }));
        const minClone = Object.assign({}, res.minutes);
        const swaps = addIndividualSwaps(segClone, minClone, res.keeperMinutes, present, P, maxSwaps, fp.swapSplitHalf);

        const nonKeepers = present.map(p => p.id).filter(id => !res.keeperSet.has(id));
        const nkVals = nonKeepers.map(id => minClone[id]);
        const nkDiff = nkVals.length ? Math.max(...nkVals) - Math.min(...nkVals) : 0;
        const kIds = present.map(p => p.id).filter(id => res.keeperSet.has(id));
        const kVals = kIds.map(id => minClone[id]);
        const kDiff = kVals.length >= 2 ? Math.max(...kVals) - Math.min(...kVals) : 0;
        const allTimes = uniqSorted(segClone.map(s => s.start).concat([T]));

        const candidate = {
          segments: segClone,
          minutes: minClone,
          keeperMinutes: res.keeperMinutes,
          times: allTimes,
          nkDiff,
          kDiff,
          swaps
        };

        const candidateScore = kDiff * 2 + nkDiff;
        const bestScore = best ? (best.kDiff || 0) * 2 + best.nkDiff : Infinity;
        if (!best || candidateScore < bestScore) {
          best = candidate;
        }
        if (kDiff <= 2 && nkDiff <= 2) break;
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
    lastPositions = {};
    const currentPositions = getPositionsMap();
    for (const [pid, zones] of Object.entries(currentPositions)) {
      lastPositions[pid] = new Set(zones);
    }

    // Clear any previous drag & drop overrides
    kdSlotOverrides = {};

    renderKampdagOutput(present, best, P, T);

    if (metaEl) {
      const mins = Object.values(best.minutes);
      const realDiff = mins.length ? Math.max(...mins) - Math.min(...mins) : 0;
      const nkDiffStr = best.nkDiff !== undefined ? best.nkDiff.toFixed(1) : realDiff.toFixed(1);
      const swapNote = best.swaps && best.swaps.length ? ` (${best.swaps.length} ind. bytte${best.swaps.length > 1 ? 'r' : ''})` : '';
      metaEl.textContent = `Bytter ved: ${best.times.join(' / ')} (min) â€” Maks avvik: ${nkDiffStr} min${swapNote}`;
    }

    // Show start match button
    const startBtn = $('kdStartMatch');
    if (startBtn) startBtn.style.display = '';
  }

  function renderKampdagOutput(presentPlayers, best, P, T) {
    const lineupEl = $('kdLineup');
    const planEl = $('kdPlan');
    if (!lineupEl && !planEl) return;

    const idToName = {};
    presentPlayers.forEach(p => idToName[p.id] = p.name);

    const first = best.segments[0];
    const startIds = first.lineup.slice();
    const benchIds = presentPlayers.map(p => p.id).filter(id => !startIds.includes(id));

    const useFormation = lastUseFormation && lastFormation;
    const format = lastP;
    const slots = getActiveSlots();
    const slotSizeCls = getSlotSizeCls(slots);
    const hasAnyOverride = Object.keys(kdSlotOverrides).length > 0;

    // Effective minutes (respects overrides)
    const effMins = getEffectiveMinutes();
    const minutesArr = Object.keys(effMins).map(id => ({ id, name: idToName[id] || id, min: effMins[id] }));
    minutesArr.sort((a, b) => b.min - a.min);

    // Check if any bench swap happened (override moved bench player to field)
    let hasBenchSwap = false;
    for (const [si, ov] of Object.entries(kdSlotOverrides)) {
      if (!ov) continue;
      const def = buildDefaultSlotMap(parseInt(si));
      const dSet = new Set(Object.values(def.slots).filter(Boolean));
      for (const pid of Object.values(ov.slots).filter(Boolean)) {
        if (!dSet.has(pid)) { hasBenchSwap = true; break; }
      }
      if (hasBenchSwap) break;
    }

    // ── BUILD PITCH-CARD HTML (formation mode) ──
    if (useFormation && format !== 3 && slots) {
      // Timeline chart
      const zoneColors = { F: '#4ade80', M: '#60a5fa', A: '#f87171', K: '#c084fc', X: '#fbbf24' };
      const tlRows = minutesArr.map(m => {
        const segs = [];
        for (let si = 0; si < best.segments.length; si++) {
          const seg = best.segments[si];
          const segEnd = best.segments[si + 1] ? best.segments[si + 1].start : T;
          const sm = getSlotMap(si);
          const onField = new Set(Object.values(sm.slots).filter(Boolean));
          if (!onField.has(m.id)) {
            segs.push({ pct: ((segEnd - seg.start) / T * 100), color: 'transparent' });
            continue;
          }
          // Determine zone from slot position
          let color = zoneColors.X;
          for (const s of slots) {
            if (sm.slots[s.key] === m.id) { color = zoneColors[s.zone] || zoneColors.X; break; }
          }
          segs.push({ pct: ((segEnd - seg.start) / T * 100), color });
        }
        const barsHtml = segs.map(s => `<div class="kd-tl-seg" style="width:${s.pct.toFixed(1)}%;background:${s.color};"></div>`).join('');
        const edited = effMins[m.id] !== best.minutes[m.id];
        return `<div class="kd-tl-row">
          <div class="kd-tl-name">${escapeHtml(m.name)}</div>
          <div class="kd-tl-bar-wrap">${barsHtml}</div>
          <div class="kd-tl-min" ${edited ? 'style="color:#f59e0b;"' : ''}>${effMins[m.id].toFixed(1)}${edited ? ' \u270f\ufe0f' : ''}</div>
        </div>`;
      }).join('');

      const ticks = [];
      const step = T <= 30 ? 5 : (T <= 60 ? 10 : 15);
      for (let t = 0; t <= T; t += step) ticks.push(t);
      if (ticks[ticks.length - 1] !== T) ticks.push(T);

      const timelineChartHtml = `
        <div class="kd-timeline-chart">
          <div class="kd-timeline-title">${T} MIN \u00b7 ${format}-ER \u00b7 ${lastFormationKey} \u00b7 ${presentPlayers.length} SPILLERE${hasBenchSwap ? ' \u00b7 JUSTERT' : ''}</div>
          ${tlRows}
          <div class="kd-tl-axis">${ticks.map(t => `<span>${t}</span>`).join('')}</div>
          <div class="kd-tl-legend">
            <div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#4ade80;"></div> Forsvar</div>
            <div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#60a5fa;"></div> Midtbane</div>
            <div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#f87171;"></div> Angrep</div>
            ${best.keeperMinutes && Object.values(best.keeperMinutes).some(v => v > 0) ? `<div class="kd-tl-legend-item"><div class="kd-tl-legend-dot" style="background:#c084fc;"></div> Keeper</div>` : ''}
          </div>
        </div>`;

      // Build pitch SVG
      const pitchSVG = `<svg class="kd-pitch-lines" viewBox="0 0 680 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <rect x="20" y="10" width="640" height="780" rx="6" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2.5"/>
        <line x1="20" y1="400" x2="660" y2="400" stroke="rgba(255,255,255,0.15)" stroke-width="2.5"/>
        <circle cx="340" cy="400" r="72" fill="none" stroke="rgba(255,255,255,0.13)" stroke-width="2"/>
        <circle cx="340" cy="400" r="4" fill="rgba(255,255,255,0.15)"/>
        <rect x="170" y="10" width="340" height="110" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>
        <rect x="240" y="10" width="200" height="44" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
        <rect x="170" y="680" width="340" height="110" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>
        <rect x="240" y="746" width="200" height="44" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
      </svg>`;

      const bubbleCls = { F: 'kd-bb-f', M: 'kd-bb-m', A: 'kd-bb-a', K: 'kd-bb-k' };

      // First segment → startoppstilling in kdLineup
      if (lineupEl) {
        const sm0 = getSlotMap(0);
        const ov0 = hasSlotOverrides(0);
        const kn0 = first.keeperId ? escapeHtml(idToName[first.keeperId] || first.keeperId) : '';

        const slotsHtml0 = slots.map(slot => {
          const pid = sm0.slots[slot.key];
          const name = pid ? idToName[pid] : '?';
          const isK = slot.zone === 'K';
          const prefW = pid && !isK && isSlotOutOfPref(pid, slot.key);
          const cls = (bubbleCls[slot.zone] || '') + (prefW ? ' kd-pref-warn' : '');
          return `<div class="kd-pos-slot" data-seg="0" data-slotkey="${slot.key}" style="left:${slot.x}%;top:${slot.y}%;">
            <span class="kd-pos-label">${slot.label}</span>
            <div class="kd-pos-bubble ${cls}" data-seg="0" data-slot="${slot.key}">
              <span class="kd-p-name">${escapeHtml(name)}</span>
              <span class="kd-p-hint">${isK ? '\ud83e\udde4' : slot.label}</span>
            </div></div>`;
        }).join('');

        const benchHtml0 = sm0.bench.map(pid =>
          `<div class="kd-bench-bubble" data-seg="0" data-pid="${pid}"><span class="kd-p-name">${escapeHtml(idToName[pid] || pid)}</span></div>`
        ).join('');

        lineupEl.innerHTML = `
          <div class="kd-dark-output">
            <h3 class="kd-dark-heading">Startoppstilling \u00b7 ${lastFormationKey}
              ${hasAnyOverride ? `<button class="kd-reset-all-btn" id="kdResetAllSlots">\u21ba Tilbakestill alle</button>` : ''}
            </h3>
            <div class="kd-pitch-card">
              <div class="kd-pitch-card-header">
                <div class="kd-pitch-card-title">Minutt 0 \u2013 ${best.segments[1] ? best.segments[1].start : T}
                  ${ov0 ? '<span class="kd-override-badge">\u270f\ufe0f Tilpasset</span>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                  ${ov0 && best.segments.length > 1 ? `<button class="kd-copy-btn" data-action="kdcopy" data-seg="0">\u2192 Kopier</button>` : ''}
                  ${ov0 ? `<button class="kd-reset-btn" data-action="kdreset" data-seg="0">\u21ba</button>` : ''}
                  ${kn0 ? `<span class="kd-period-keeper">\ud83e\udde4 ${kn0}</span>` : ''}
                </div>
              </div>
              <div class="kd-pitch-wrap ${slotSizeCls}">
                <div class="kd-pitch-field">${pitchSVG}${slotsHtml0}</div>
              </div>
              <div class="kd-bench-area"><span class="kd-bench-label">Benk:</span>${benchHtml0 || '<span style="color:#64748b;font-size:10px;">Ingen</span>'}</div>
            </div>

            <h3 class="kd-dark-heading" style="margin-top:16px;">Beregnet spilletid${hasBenchSwap ? ' (justert)' : ''}</h3>
            ${timelineChartHtml}
          </div>`;

        lineupEl.classList.add('kd-dark-mode');
        lineupEl.classList.remove('results-container');
      }

      // Remaining segments → bytteplan in kdPlan
      if (planEl) {
        let cardsHtml = '';
        for (let idx = 1; idx < best.segments.length; idx++) {
          const seg = best.segments[idx];
          const sm = getSlotMap(idx);
          const nextSeg = best.segments[idx + 1];
          const periodEnd = nextSeg ? nextSeg.start : T;
          const kn = seg.keeperId ? escapeHtml(idToName[seg.keeperId] || seg.keeperId) : '';
          const isLast = idx === best.segments.length - 1;
          const ov = hasSlotOverrides(idx);
          const prevLineup = new Set(best.segments[idx - 1].lineup);
          const newIds = new Set(seg.lineup.filter(id => !prevLineup.has(id)));
          const outIds = [...prevLineup].filter(id => !seg.lineup.includes(id));

          const slotsHtml = slots.map(slot => {
            const pid = sm.slots[slot.key];
            const name = pid ? idToName[pid] : '?';
            const isK = slot.zone === 'K';
            const isNew = pid && newIds.has(pid);
            const prefW = pid && !isK && isSlotOutOfPref(pid, slot.key);
            const cls = (bubbleCls[slot.zone] || '') + (isNew ? ' kd-is-new' : '') + (prefW ? ' kd-pref-warn' : '');
            return `<div class="kd-pos-slot" data-seg="${idx}" data-slotkey="${slot.key}" style="left:${slot.x}%;top:${slot.y}%;">
              <span class="kd-pos-label">${slot.label}</span>
              <div class="kd-pos-bubble ${cls}" data-seg="${idx}" data-slot="${slot.key}">
                <span class="kd-p-name">${escapeHtml(name)}</span>
                <span class="kd-p-hint">${isK ? '\ud83e\udde4' : slot.label}</span>
              </div></div>`;
          }).join('');

          const benchHtml = sm.bench.map(pid =>
            `<div class="kd-bench-bubble" data-seg="${idx}" data-pid="${pid}"><span class="kd-p-name">${escapeHtml(idToName[pid] || pid)}</span></div>`
          ).join('');

          // Swap strip
          let swapHtml = '';
          if (newIds.size || outIds.length) {
            swapHtml = '<div class="kd-swap-strip">';
            newIds.forEach(id => { swapHtml += `<span class="kd-sw-item kd-sw-in-item"><span class="kd-sw-in">\u2192</span> <span class="kd-sw-label">inn</span> <span class="kd-sw-name">${escapeHtml(idToName[id] || id)}</span></span>`; });
            outIds.forEach(id => { swapHtml += `<span class="kd-sw-item kd-sw-out-item"><span class="kd-sw-out">\u2190</span> <span class="kd-sw-label">ut</span> <span class="kd-sw-name">${escapeHtml(idToName[id] || id)}</span></span>`; });
            swapHtml += '</div>';
          }

          cardsHtml += `<div class="kd-pitch-card">
            <div class="kd-pitch-card-header">
              <div class="kd-pitch-card-title">Minutt ${seg.start} \u2013 ${periodEnd}
                ${ov ? '<span class="kd-override-badge">\u270f\ufe0f Tilpasset</span>' : ''}
              </div>
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                ${ov && !isLast ? `<button class="kd-copy-btn" data-action="kdcopy" data-seg="${idx}">\u2192 Kopier</button>` : ''}
                ${ov ? `<button class="kd-reset-btn" data-action="kdreset" data-seg="${idx}">\u21ba</button>` : ''}
                ${kn ? `<span class="kd-period-keeper">\ud83e\udde4 ${kn}</span>` : ''}
              </div>
            </div>
            <div class="kd-pitch-wrap ${slotSizeCls}">
              <div class="kd-pitch-field">${pitchSVG}${slotsHtml}</div>
            </div>
            ${swapHtml}
            <div class="kd-bench-area"><span class="kd-bench-label">Benk:</span>${benchHtml || '<span style="color:#64748b;font-size:10px;">Ingen</span>'}</div>
          </div>`;
        }

        planEl.classList.add('kd-dark-mode');
        planEl.classList.remove('results-container');
        planEl.innerHTML = `
          <div class="kd-dark-output">
            <h3 class="kd-dark-heading">Bytteplan</h3>
            <div class="kd-dc-grid">${cardsHtml || '<div class="small-text" style="opacity:0.8;">\u2014</div>'}</div>
          </div>`;
      }

      // Bind action buttons (delegation-safe, re-binds each render)
      const resetAllBtn = document.getElementById('kdResetAllSlots');
      if (resetAllBtn) resetAllBtn.addEventListener('click', resetAllSlotOverrides);
      document.querySelectorAll('[data-action="kdreset"]').forEach(b => {
        b.addEventListener('click', (e) => { e.stopPropagation(); resetSlotOverride(parseInt(b.dataset.seg)); });
      });
      document.querySelectorAll('[data-action="kdcopy"]').forEach(b => {
        b.addEventListener('click', (e) => { e.stopPropagation(); copySlotToNext(parseInt(b.dataset.seg)); });
      });

    } else {
      // ── FALLBACK: original flat list (no formation) ──
      const minutesHtml = minutesArr.map(m => `
        <div class="group-player">
          <span class="player-name">${escapeHtml(m.name)}:</span>
          <span class="player-skill" style="margin-left:auto;">${m.min.toFixed(1)} min</span>
        </div>
      `).join('');

      if (lineupEl) {
        const startList = startIds.map(id => `<div class="group-player"><span class="player-icon">\u26bd</span><span class="player-name">${escapeHtml(idToName[id] || id)}</span></div>`).join('');
        const benchList = benchIds.map(id => `<div class="group-player"><span class="player-icon">\u26aa</span><span class="player-name">${escapeHtml(idToName[id] || id)}</span></div>`).join('');
        lineupEl.innerHTML = `
          <div class="results-container">
            <h3>Startoppstilling</h3>
            <div class="group-card">
              <div class="group-header">
                <div class="group-name">Start (f\u00f8rste periode)</div>
                <div class="group-stats">${P} p\u00e5 banen \u00b7 ${benchIds.length} p\u00e5 benk</div>
              </div>
              <div class="group-players">${startList || '<div class="small-text">\u2014</div>'}</div>
              <div class="group-header" style="margin-top:12px;">
                <div class="group-name">Benk (f\u00f8rste periode)</div>
              </div>
              <div class="group-players">${benchList || '<div class="small-text">\u2014</div>'}</div>
            </div>
            <h3 style="margin-top:16px;">Beregnet spilletid</h3>
            <div class="group-card">
              <div class="group-header">
                <div class="group-name">M\u00e5l: \u2264 4 min differanse</div>
                <div class="group-stats">Keeper kan f\u00e5 litt ekstra</div>
              </div>
              <div class="group-players">${minutesHtml}</div>
            </div>
          </div>`;
        lineupEl.classList.remove('kd-dark-mode');
        if (!lineupEl.classList.contains('results-container')) lineupEl.classList.add('results-container');
      }

      if (planEl) {
        const events = buildEvents(best.segments);
        const planCards = events.map((ev, idx) => {
          const keeperName = ev.keeperId ? (idToName[ev.keeperId] || ev.keeperId) : null;
          const ins = ev.ins.map(id => `<div class="small-text">Inn: <b>${escapeHtml(idToName[id] || id)}</b></div>`).join('');
          const outs = ev.outs.map(id => `<div class="small-text">Ut: <b>${escapeHtml(idToName[id] || id)}</b></div>`).join('');
          const empty = (!ev.ins.length && !ev.outs.length) ? `<div class="small-text" style="opacity:0.8;">Start (ingen bytter)</div>` : '';
          return `
            <div class="group-card" style="margin-bottom:12px;">
              <div class="group-header" style="display:flex;justify-content:space-between;align-items:center;">
                <div class="group-name">Minutt ${ev.minute}</div>
                ${keeperName ? `<div style="background:var(--gray-100);padding:6px 10px;border-radius:999px;font-size:12px;opacity:0.85;">Keeper: ${escapeHtml(keeperName)}</div>` : ''}
              </div>
              <div class="group-players" style="gap:6px;">${empty}${ins}${outs}</div>
            </div>`;
        }).join('');

        planEl.classList.remove('kd-dark-mode');
        if (!planEl.classList.contains('results-container')) planEl.classList.add('results-container');
        planEl.innerHTML = `<div class="results-container"><h3>Bytteplan</h3>${planCards || '<div class="small-text" style="opacity:0.8;">\u2014</div>'}</div>`;
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

    lines.push('Startoppstilling' + (useFormation ? ` Â· ${kdFormationKey}` : ''));

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
      lines.push(' Start (fÃ¸rste periode)');
      startIds.forEach(id => lines.push(`  - ${idToName[id] || id}`));
    }
    lines.push(` Benk: ${benchIds.map(id => idToName[id] || id).join(', ') || 'â€“'}`);

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

      lines.push(` Minutt ${ev.minute} â€“ ${periodEnd}`);
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
            metaEl.textContent = 'Plan kopiert âœ…';
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
        metaEl.textContent = 'Plan kopiert âœ…';
        setTimeout(() => { metaEl.textContent = prev; }, 1200);
      }
    } catch (e) {
      alert('Klarte ikke Ã¥ kopiere. Marker teksten manuelt.');
    }
  }

  function exportKampdagPdf() {
    if (!lastBest || !lastBest.segments.length) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Generer en plan f\u00f8rst', 'error');
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
    const slots = getActiveSlots();
    const hasAnyOverride = Object.keys(kdSlotOverrides).length > 0;
    const effMins = getEffectiveMinutes();

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
    const sm0 = getSlotMap(0);

    // Build startoppstilling section
    let startSection = '';
    if (useFormation && format !== 3 && slots) {
      const bbg = { F:'rgba(34,197,94,0.2)', M:'rgba(59,130,246,0.2)', A:'rgba(239,68,68,0.2)', K:'rgba(168,85,247,0.15)' };
      const bbd = { F:'rgba(34,197,94,0.4)', M:'rgba(59,130,246,0.4)', A:'rgba(239,68,68,0.4)', K:'rgba(168,85,247,0.3)' };
      const bc = { F:'#4ade80', M:'#60a5fa', A:'#f87171', K:'#c084fc' };
      const dots0 = slots.map(s => {
        const pid = sm0.slots[s.key];
        const nm = pid ? escapeHtml(idToName[pid] || pid) : '?';
        return `<div style="position:absolute;left:${s.x}%;top:${s.y}%;transform:translate(-50%,-50%);z-index:2;"><div style="width:34px;height:34px;border-radius:50%;background:${bbg[s.zone]};border:1.5px solid ${bbd[s.zone]};display:flex;align-items:center;justify-content:center;"><span style="font-size:8px;font-weight:800;color:${bc[s.zone]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:30px;">${nm}</span></div></div>`;
      }).join('');
      const benchNames0 = sm0.bench.map(pid => escapeHtml(idToName[pid] || pid)).join(' \u00b7 ') || '\u2014';
      startSection = `
        <div class="section-title">Startoppstilling \u00b7 ${formationKey}${hasAnyOverride ? ' \u00b7 Justert' : ''}</div>
        <div style="position:relative;width:100%;aspect-ratio:68/55;background:linear-gradient(180deg,#1a5c1a,#145214);border-radius:12px;overflow:visible;border:2px solid #2a7a2a;"><div style="position:absolute;top:50%;left:8%;right:8%;height:1px;background:rgba(255,255,255,0.1);"></div>${dots0}</div>
        <div class="bench">Benk: ${benchNames0}</div>`;
    }
    if (!startSection) {
      const startIds = first.lineup.slice();
      const benchIds = present.map(p => p.id).filter(id => !startIds.includes(id));
      startSection = `
        <div class="section-title">Startoppstilling</div>
        <div class="start-list">${startIds.map(id => `<span class="chip">\u26bd ${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>
        <div class="bench">Benk: ${benchIds.map(id => escapeHtml(idToName[id]||id)).join(' \u00b7 ') || '\u2014'}</div>`;
    }

    // Build spilletid rows using effective minutes
    const minutesArr = Object.keys(effMins).map(id => ({ id, name: idToName[id] || id, min: effMins[id] }));
    minutesArr.sort((a, b) => b.min - a.min);

    let timelineHtml = '';
    if (useFormation && format !== 3 && slots) {
      const zc = { F:'#4ade80', M:'#60a5fa', A:'#f87171', K:'#c084fc', X:'#fbbf24' };
      const rows = minutesArr.map(m => {
        const segs = [];
        for (let si = 0; si < best.segments.length; si++) {
          const seg = best.segments[si];
          const segEnd = best.segments[si+1] ? best.segments[si+1].start : T;
          const sm = getSlotMap(si);
          const onField = new Set(Object.values(sm.slots).filter(Boolean));
          if (!onField.has(m.id)) { segs.push({pct:((segEnd-seg.start)/T*100),c:'transparent'}); continue; }
          let color = zc.X;
          for (const s of slots) { if (sm.slots[s.key] === m.id) { color = zc[s.zone] || zc.X; break; } }
          segs.push({pct:((segEnd-seg.start)/T*100),c:color});
        }
        const bars = segs.map(s => `<div style="width:${s.pct.toFixed(1)}%;height:100%;background:${s.c};"></div>`).join('');
        const edited = effMins[m.id] !== best.minutes[m.id];
        return `<div class="tl-row"><div class="tl-name">${escapeHtml(m.name)}</div><div class="tl-bar">${bars}</div><div class="tl-min" ${edited ? 'style="color:#f59e0b;"' : ''}>${m.min.toFixed(1)}${edited ? ' \u270f\ufe0f' : ''}</div></div>`;
      }).join('');
      const ticks = [];
      const step = T <= 30 ? 5 : (T <= 60 ? 10 : 15);
      for (let t = 0; t <= T; t += step) ticks.push(t);
      if (ticks[ticks.length - 1] !== T) ticks.push(T);
      timelineHtml = `
        <div class="section-title">Beregnet spilletid${hasAnyOverride ? ' (justert)' : ''}</div>
        <div class="tl-chart">
          <div class="tl-header">${T} MIN \u00b7 ${format}-ER \u00b7 ${formationKey} \u00b7 ${present.length} SPILLERE${hasAnyOverride ? ' \u00b7 JUSTERT' : ''}</div>
          ${rows}
          <div class="tl-axis">${ticks.map(t => `<span>${t}</span>`).join('')}</div>
          <div class="tl-legend"><span><i style="background:#4ade80"></i> Forsvar</span><span><i style="background:#60a5fa"></i> Midtbane</span><span><i style="background:#f87171"></i> Angrep</span><span><i style="background:#c084fc"></i> Keeper</span></div>
        </div>`;
    } else {
      timelineHtml = `
        <div class="section-title">Beregnet spilletid</div>
        <div class="time-list">${minutesArr.map(m => `<div class="time-row"><span>${escapeHtml(m.name)}</span><span>${m.min.toFixed(1)} min</span></div>`).join('')}</div>`;
    }

    // Build bytteplan cards using slot maps (mini pitches)
    const planCards = best.segments.map((seg, idx) => {
      const sm = getSlotMap(idx);
      const nextSeg = best.segments[idx+1];
      const periodEnd = nextSeg ? nextSeg.start : T;
      const keeperName = seg.keeperId ? escapeHtml(idToName[seg.keeperId]||seg.keeperId) : '';
      const isFirst = idx === 0;
      const prevLineup = !isFirst ? new Set(best.segments[idx-1].lineup) : new Set();
      const newIds = isFirst ? new Set() : new Set(seg.lineup.filter(id => !prevLineup.has(id)));
      const outIds = isFirst ? [] : [...prevLineup].filter(id => !seg.lineup.includes(id));
      const ov = hasSlotOverrides(idx);

      let body = '';
      if (useFormation && format !== 3 && slots) {
        const bbg = { F:'rgba(34,197,94,0.2)', M:'rgba(59,130,246,0.2)', A:'rgba(239,68,68,0.2)', K:'rgba(168,85,247,0.15)' };
        const bbd = { F:'rgba(34,197,94,0.4)', M:'rgba(59,130,246,0.4)', A:'rgba(239,68,68,0.4)', K:'rgba(168,85,247,0.3)' };
        const bc = { F:'#4ade80', M:'#60a5fa', A:'#f87171', K:'#c084fc' };
        const dots = slots.map(s => {
          const pid = sm.slots[s.key]; const nm = pid ? escapeHtml(idToName[pid]||pid) : '?';
          const isNew = pid && newIds.has(pid);
          const outline = isNew ? 'box-shadow:0 0 0 2px #fbbf24;' : '';
          return `<div style="position:absolute;left:${s.x}%;top:${s.y}%;transform:translate(-50%,-50%);z-index:2;"><div style="width:30px;height:30px;border-radius:50%;background:${bbg[s.zone]};border:1.5px solid ${bbd[s.zone]};display:flex;align-items:center;justify-content:center;${outline}"><span style="font-size:7.5px;font-weight:800;color:${bc[s.zone]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:28px;">${nm}</span></div></div>`;
        }).join('');
        body = `<div style="position:relative;width:100%;aspect-ratio:68/55;background:linear-gradient(180deg,#1a5c1a,#145214);overflow:visible;"><div style="position:absolute;top:50%;left:8%;right:8%;height:1px;background:rgba(255,255,255,0.1);"></div>${dots}</div>`;
        const benchNames = sm.bench.map(pid => escapeHtml(idToName[pid]||pid)).join(', ') || '\u2014';
        body += `<div style="font-size:8px;color:#64748b;padding:2px 10px 5px;">Benk: ${benchNames}</div>`;
      }
      if (!body) {
        body = `<div class="zp">${seg.lineup.map(id => `<span class="zc">${escapeHtml(idToName[id]||id)}</span>`).join('')}</div>`;
      }
      let swaps = '';
      if (isFirst) { swaps = '<div class="note">Avspark</div>'; }
      else if (newIds.size || outIds.length) {
        swaps = '<div class="swaps">';
        newIds.forEach(id => { swaps += `<div class="sw"><span class="sw-in">\u2192</span><b>${escapeHtml(idToName[id]||id)}</b></div>`; });
        outIds.forEach(id => { swaps += `<div class="sw"><span class="sw-out">\u2190</span><span style="color:#94a3b8;">${escapeHtml(idToName[id]||id)}</span></div>`; });
        swaps += '</div>';
      }
      return `<div class="card"><div class="card-head"><span class="card-title">${isFirst ? 'Start ' : ''}${seg.start}\u2013${periodEnd} min${ov ? ' \u270f\ufe0f' : ''}</span>${keeperName ? `<span class="card-keeper">\ud83e\udde4 ${keeperName}</span>` : ''}</div><div class="card-body">${body}${swaps}</div></div>`;
    }).join('');
    const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Kampdag â€“ Barnefotballtrener</title>
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
      <div class="h-title">Kampdag â€“ ${format}-er fotball${useFormation && formationKey ? ` Â· ${formationKey}` : ''}</div>
      <div class="h-sub">${escapeHtml(today)} Â· ${T} min Â· ${present.length} spillere${hasAnyOverride ? " \u00b7 Justert oppstilling" : ""}</div>
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
      steps = '<div style="color:#94a3b8;font-size:11px;margin-top:8px;">Trykk <b>Lagre som PDF</b>, deretter <b>Del-ikon â†‘</b> og <b>Arkiver i Filer</b>.</div>';
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
        window.showNotification('Popup ble blokkert. Tillat popups for Ã¥ eksportere.', 'error');
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
            (inNames.length ? `<span style="color:#16a34a;font-weight:700;">â†‘ ${inNames.map(n => escapeHtml(n)).join(', ')}</span>` : '') +
            (inNames.length && outNames.length ? ' &nbsp; ' : '') +
            (outNames.length ? `<span style="color:#dc2626;font-weight:700;">â†“ ${outNames.map(n => escapeHtml(n)).join(', ')}</span>` : '');
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
