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
  let lastPlanText = '';
  let lastBest = null;          // last generated plan result
  let lastPresent = [];         // last present players
  let lastP = 7;                // last format
  let lastT = 48;               // last total minutes

  // Formation state
  let kdFormationOn = false;
  let kdFormation = null;       // e.g. [2,3,1]
  let kdFormationKey = '';      // e.g. '2-3-1'
  let kdPositions = {};         // playerId -> Set of zones ('F','M','A')

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
  window.addEventListener('players:updated', (e) => {
    console.log('[Kampdag] players:updated event mottatt:', e.detail);
    try {
      kdSelected = new Set(getPlayersArray().map(p => p.id));
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
          <input type="checkbox" data-id="${p.id}" ${checked}>
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
      return `<option value="${p.id}">${escapeHtml(p.name)} ${icon}</option>`;
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

    for (let i = 1; i <= kc; i++) {
      const pid = $(`kdKeeper${i}`)?.value || '';
      const min = parseInt($(`kdKeeperMin${i}`)?.value, 10) || 0;
      if (pid) chosen++;
      sum += clamp(min, 0, 999);
    }

    const ok = (chosen === kc) && (sum === T);
    summary.textContent = `Velg keeper(e) — Sum: ${sum}/${T} (${ok ? 'OK' : 'SJEKK'})`;
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

    // Initialize positions for new players
    present.forEach(p => {
      if (!kdPositions[p.id]) kdPositions[p.id] = new Set(['F', 'M', 'A']);
    });

    container.innerHTML = present.map(p => {
      const pos = kdPositions[p.id] || new Set(['F', 'M', 'A']);
      return `<div class="kd-pos-row">
        <div class="kd-pos-name">${escapeHtml(p.name)}</div>
        <div class="kd-pos-checks">
          <button type="button" class="kd-pos-btn ${pos.has('F') ? 'kd-pos-f-on' : ''}" data-pid="${p.id}" data-zone="F">F</button>
          <button type="button" class="kd-pos-btn ${pos.has('M') ? 'kd-pos-m-on' : ''}" data-pid="${p.id}" data-zone="M">M</button>
          <button type="button" class="kd-pos-btn ${pos.has('A') ? 'kd-pos-a-on' : ''}" data-pid="${p.id}" data-zone="A">A</button>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.kd-pos-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-pid');
        const zone = btn.getAttribute('data-zone');
        if (!kdPositions[pid]) kdPositions[pid] = new Set(['F', 'M', 'A']);
        const pos = kdPositions[pid];
        if (pos.has(zone)) { pos.delete(zone); } else { pos.add(zone); }
        // If all removed, re-add all (can't have no zones)
        if (pos.size === 0) { pos.add('F'); pos.add('M'); pos.add('A'); }
        // Update all buttons in this row
        const row = btn.closest('.kd-pos-row');
        if (row) {
          row.querySelectorAll('.kd-pos-btn').forEach(b => {
            const z = b.getAttribute('data-zone');
            const onClass = { F: 'kd-pos-f-on', M: 'kd-pos-m-on', A: 'kd-pos-a-on' }[z];
            b.classList.toggle(onClass, pos.has(z));
          });
        }
        updateCoverage();
      });
    });
  }

  function updateCoverage() {
    const el = $('kdCoverage');
    if (!el || !kdFormation) { if (el) el.style.display = 'none'; return; }

    const present = getPresentPlayers();
    const counts = { F: 0, M: 0, A: 0 };
    present.forEach(p => {
      const pos = kdPositions[p.id] || new Set(['F', 'M', 'A']);
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
  function assignZones(lineup, keeperId, formation) {
    if (!formation) return null;
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
      const prefs = kdPositions[id] || new Set(['F', 'M', 'A']);
      if (prefs.size !== 1) continue;
      const zone = [...prefs][0];
      if (zones[zone].length < zoneNeeds[zone]) {
        zones[zone].push(id); assigned.add(id);
      }
    }

    // Phase 2: Dual-zone preference
    for (const id of outfield) {
      if (assigned.has(id)) continue;
      const prefs = kdPositions[id] || new Set(['F', 'M', 'A']);
      if (prefs.size !== 2) continue;
      const avail = [...prefs].filter(z => zones[z].length < zoneNeeds[z])
        .sort((a, b) => (zoneNeeds[b] - zones[b].length) - (zoneNeeds[a] - zones[a].length));
      if (avail.length) { zones[avail[0]].push(id); assigned.add(id); }
    }

    // Phase 3: Flexible (3 zones or unset)
    for (const id of outfield) {
      if (assigned.has(id)) continue;
      const prefs = kdPositions[id] || new Set(['F', 'M', 'A']);
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

    for (let i = 0; i < times.length - 1; i++) {
      const start = times[i];
      const end = times[i + 1];
      const dt = end - start;

      const keeperId = keeperAtMinute(start + 0.0001, keeperTimeline);
      const lineup = [];

      if (keeperId) lineup.push(keeperId);

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

      segments.push({ start, end, dt, lineup: lineup.slice(), keeperId });
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
            <div class="results-container">
              <h3>Startoppstilling · ${kdFormationKey}</h3>
              <div class="kd-pitch">
                ${kdFormation[2] > 0 ? `<div class="kd-pitch-row">${zones.A.map(id => `<span class="kd-pitch-player kd-pp-a">${escapeHtml(idToName[id] || id)}</span>`).join('')}</div>` : ''}
                <div class="kd-pitch-row">${zones.M.map(id => `<span class="kd-pitch-player kd-pp-m">${escapeHtml(idToName[id] || id)}</span>`).join('')}</div>
                <div class="kd-pitch-row">${zones.F.map(id => `<span class="kd-pitch-player kd-pp-f">${escapeHtml(idToName[id] || id)}</span>`).join('')}</div>
                ${keeperName ? `<div class="kd-pitch-row"><span class="kd-pitch-player kd-pp-k">🧤 ${keeperName}</span></div>` : ''}
              </div>
              <div class="kd-bench-strip"><b>Benk:</b> ${benchIds.map(id => escapeHtml(idToName[id] || id)).join(' · ') || '–'}</div>

              <h3 style="margin-top:16px;">Beregnet spilletid</h3>
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
      planEl.innerHTML = `
        <div class="results-container">
          <h3>Bytteplan</h3>
          ${planCards || '<div class="small-text" style="opacity:0.8;">–</div>'}
        </div>
      `;
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
        alert('Klarte ikke å kopiere. Marker teksten manuelt.');
      });
  }

  function exportKampdagPdf() {
    if (!lastPlanText) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Generer en plan først', 'error');
      }
      return;
    }

    const present = getPresentPlayers();
    const format = parseInt($('kdFormat')?.value, 10) || 7;
    const T = clamp(parseInt($('kdMinutes')?.value, 10) || 48, 10, 200);
    const idToName = {};
    present.forEach(p => idToName[p.id] = p.name);

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

    // Parse lastPlanText for structured output
    const lines = lastPlanText.split('\n');
    let sectionHtml = '';
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('Startoppstilling') || trimmed === 'Beregnet spilletid' || trimmed === 'Bytteplan') {
        if (currentSection) sectionHtml += '</div>';
        currentSection = trimmed;
        sectionHtml += `<div class="kd-section"><div class="kd-section-title">${escapeHtml(trimmed)}</div>`;
        continue;
      }

      if (trimmed.startsWith('Start (') || trimmed.startsWith('Benk:') || trimmed.startsWith('Benk (')) {
        if (trimmed === 'Start (ingen bytter)') {
          sectionHtml += `<div class="kd-note">${escapeHtml(trimmed)}</div>`;
        } else {
          sectionHtml += `<div class="kd-sub-title">${escapeHtml(trimmed)}</div>`;
        }
      } else if (trimmed.startsWith('Forsvar:') || trimmed.startsWith('Midtbane:') || trimmed.startsWith('Angrep:')) {
        const isF = trimmed.startsWith('Forsvar:');
        const isA = trimmed.startsWith('Angrep:');
        const color = isF ? '#16a34a' : (isA ? '#dc2626' : '#2563eb');
        sectionHtml += `<div class="kd-line" style="color:${color}; font-weight:700;">${escapeHtml(trimmed)}</div>`;
      } else if (trimmed.startsWith('Soner: ')) {
        // Compact zone line: "Soner: F: Per, Kari | M: Nils | A: Mia"
        const parts = trimmed.slice(7).split(' | ');
        const colorMap = { F: '#16a34a', M: '#2563eb', A: '#dc2626' };
        const html = parts.map(p => {
          const z = p.charAt(0);
          const names = escapeHtml(p.slice(3));
          const c = colorMap[z] || '#374151';
          return `<span style="color:${c};font-weight:700;">${z}:</span> ${names}`;
        }).join(' &nbsp;|&nbsp; ');
        sectionHtml += `<div class="kd-line" style="font-size:12px;">${html}</div>`;
      } else if (trimmed.startsWith('Minutt ')) {
        sectionHtml += `<div class="kd-event-header">${escapeHtml(trimmed)}</div>`;
      } else if (trimmed.startsWith('- ')) {
        sectionHtml += `<div class="kd-player">${escapeHtml(trimmed.slice(2))}</div>`;
      } else if (trimmed.startsWith('Inn: ') || trimmed.startsWith('Ut: ') || trimmed.startsWith('Keeper: ')) {
        const isIn = trimmed.startsWith('Inn:');
        const isKeeper = trimmed.startsWith('Keeper:');
        const cls = isIn ? 'kd-in' : (isKeeper ? 'kd-keeper' : 'kd-out');
        sectionHtml += `<div class="${cls}">${escapeHtml(trimmed)}</div>`;
      } else if (trimmed.includes(': ') && trimmed.includes(' min')) {
        sectionHtml += `<div class="kd-time-row">${escapeHtml(trimmed)}</div>`;
      } else {
        sectionHtml += `<div class="kd-line">${escapeHtml(trimmed)}</div>`;
      }
    }
    if (currentSection) sectionHtml += '</div>';

    const html = `<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Kampdag – Barnefotballtrener</title>
  <style>
    :root{
      --bg:#0b1220; --card:#ffffff; --muted:#556070; --line:#e6e9ef;
      --brand:#0b5bd3; --brand2:#19b0ff; --soft:#f6f8fc;
    }
    *{box-sizing:border-box}
    body{margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial; background:var(--soft); color:#111; line-height:1.45;}
    .wrap{max-width:980px; margin:0 auto; padding:18px;}
    .header{
      background:linear-gradient(135deg,var(--brand),var(--brand2));
      color:#fff; border-radius:18px; padding:16px 18px;
      display:flex; gap:14px; align-items:center;
      box-shadow:0 6px 18px rgba(11,91,211,0.20);
    }
    .logo{width:96px; height:96px; border-radius:14px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden;}
    .logo img{width:96px; height:96px; object-fit:cover;}
    .h-title{font-size:20px; font-weight:900; line-height:1.2;}
    .h-sub{opacity:0.9; font-size:13px; margin-top:2px;}
    .meta{margin-left:auto; text-align:right;}
    .meta .m1{font-weight:800;}
    .meta .m2{opacity:0.9; font-size:13px; margin-top:2px;}
    .card{background:var(--card); border:1px solid var(--line); border-radius:18px; padding:14px; margin-top:12px;}
    .kd-section{margin-bottom:16px;}
    .kd-section-title{font-size:15px; font-weight:900; text-transform:uppercase; letter-spacing:0.04em; color:var(--brand); margin:14px 0 8px; padding-bottom:4px; border-bottom:2px solid var(--line);}
    .kd-sub-title{font-weight:800; font-size:13px; margin:10px 0 4px; color:#1a2333;}
    .kd-player{padding:3px 0 3px 12px; font-size:13px; color:#374151;}
    .kd-event-header{font-weight:900; font-size:14px; margin:12px 0 4px; padding:6px 10px; background:var(--soft); border-radius:10px; border-left:4px solid var(--brand);}
    .kd-in{padding:2px 0 2px 16px; font-size:13px; color:#16a34a; font-weight:700;}
    .kd-out{padding:2px 0 2px 16px; font-size:13px; color:#dc2626; font-weight:700;}
    .kd-keeper{padding:2px 0 2px 16px; font-size:13px; color:#7c3aed; font-weight:700;}
    .kd-note{padding:2px 0 2px 16px; font-size:12px; color:var(--muted); font-style:italic;}
    .kd-time-row{padding:3px 0 3px 12px; font-size:13px; display:flex; justify-content:space-between; border-bottom:1px solid #f1f5f9;}
    .kd-line{padding:2px 0; font-size:13px;}
    .summary{text-align:center; margin-top:16px; padding:12px; background:var(--soft); border-radius:14px;}
    .summary-title{font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:900;}
    .summary-value{font-size:1.3rem; font-weight:900; margin-top:4px;}
    .actions{display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;}
    .btn{border:0; border-radius:12px; padding:10px 12px; font-weight:800; background:var(--brand); color:#fff; cursor:pointer;}
    .note{color:var(--muted); font-size:12px; margin-top:8px;}
    .guide{margin-top:12px;}
    .guide-title{font-weight:900; font-size:13px; margin-bottom:8px; color:#1a2333;}
    .guide-steps{display:flex; flex-direction:column; gap:6px;}
    .guide-step{display:flex; align-items:center; gap:8px; font-size:13px; color:#374151; padding:8px 10px; background:var(--soft); border-radius:10px; border-left:3px solid var(--brand);}
    .step-num{background:var(--brand); color:#fff; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; flex-shrink:0;}
    .step-icon{font-size:16px;}
    .footer{text-align:center; margin-top:20px; font-size:11px; color:var(--muted); padding:10px 0; border-top:1px solid var(--line);}
    @media (max-width:720px){
      .meta{display:none;}
    }
    @media print{
      * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      body{background:#fff;}
      .wrap{max-width:none; padding:0;}
      .actions,.note,.guide{display:none !important;}
      .header{border-radius:0; box-shadow:none;}
      .card{border-radius:0; border-left:0; border-right:0;}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="logo"><img src="${escapeHtml(logoUrl)}" alt="Barnefotballtrener"></div>
      <div>
        <div class="h-title">Kampdag – ${format}-er fotball${kdFormationOn && kdFormationKey ? ` · ${kdFormationKey}` : ''}</div>
        <div class="h-sub">${escapeHtml(today)} · ${T} min · ${present.length} spillere</div>
      </div>
      <div class="meta">
        <div class="m1">Barnefotballtrener</div>
        <div class="m2">Kampdag</div>
      </div>
    </div>

    <div class="card">
      ${sectionHtml}
    </div>

    <div class="summary">
      <div class="summary-title">Kampoppsett</div>
      <div class="summary-value">${format}-er · ${T} min · ${present.length} spillere</div>
    </div>

    <div class="actions">
      <button class="btn" onclick="window.print()">Lagre som PDF</button>
    </div>
    <div class="guide" id="saveGuide"></div>
    <script>
    (function(){
      var ua = navigator.userAgent;
      var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
      var isAndroid = /Android/i.test(ua);
      var g = document.getElementById('saveGuide');
      if (!g) return;
      if (isIOS) {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF på iPhone/iPad</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Trykk på <b>Del-ikonet</b> <span class="step-icon">↑</span> øverst i Valg-dialogen</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Velg <b>Arkiver i Filer</b> for å lagre PDF-en</div>' +
          '</div>';
      } else if (isAndroid) {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF på Android</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Velg <b>Lagre som PDF</b> som skriver</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Trykk på den gule <b>Last ned</b>-knappen</div>' +
          '</div>';
      } else {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Velg <b>Lagre som PDF</b> i stedet for en skriver</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Klikk <b>Lagre</b></div>' +
          '</div>';
      }
    })();
    </script>
    <div class="footer">Laget med Barnefotballtrener.no</div>
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
