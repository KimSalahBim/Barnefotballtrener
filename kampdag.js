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
    });

    if (deselectAllBtn) deselectAllBtn.addEventListener('click', () => {
      kdSelected = new Set();
      renderKampdagPlayers();
      refreshKeeperUI();
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

    let times = generateSubTimes(T, seed, 6, 10, 5, 10);

    const keeperTimes = keeperChangeTimes(keeperTimeline).filter(x => x < T);
    times = uniqSorted([...times, ...keeperTimes]).filter(x => x >= 0 && x <= T);

    const MAX_STOPS = clamp(Math.round(T / 5) + 3, 8, 12); // inkl 0 og T
    let best = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const runSeed = seed + attempt * 99991;

      const res = assignLineups(present, times, P, keeperTimeline, runSeed);
      const diff = maxDiffWithKeeperAllowance(res.minutes, res.keeperMinutes, 5);
      best = { ...res, times: times.slice(), diff };

      if (diff <= 4) break;

      if (times.length < MAX_STOPS) {
        times = splitLongestInterval(times, T, 5);
        times = uniqSorted([...times, ...keeperTimes]).filter(x => x >= 0 && x <= T);
      } else {
        break;
      }
    }

    renderKampdagOutput(present, best, P, T);

    if (metaEl) {
      metaEl.textContent = `Bytter ved: ${best.times.join(' / ')} (min) — Maks avvik: ${best.diff.toFixed(1)} min`;
    }
  }

  function renderKampdagOutput(presentPlayers, best, P, T) {
    const lineupEl = $('kdLineup');
    const planEl = $('kdPlan');

    const idToName = {};
    presentPlayers.forEach(p => idToName[p.id] = p.name);

    const first = best.segments[0];
    const startIds = first.lineup.slice();
    const benchIds = presentPlayers.map(p => p.id).filter(id => !startIds.includes(id));

    const startList = startIds.map(id => `<div class="group-player"><span class="player-icon">⚽</span><span class="player-name">${escapeHtml(idToName[id] || id)}</span></div>`).join('');
    const benchList = benchIds.map(id => `<div class="group-player"><span class="player-icon">⚪</span><span class="player-name">${escapeHtml(idToName[id] || id)}</span></div>`).join('');

    const minutesArr = Object.keys(best.minutes).map(id => ({ id, name: idToName[id] || id, min: best.minutes[id] }));
    minutesArr.sort((a, b) => b.min - a.min);

    const minutesHtml = minutesArr.map(m => `
      <div class="group-player">
        <span class="player-name">${escapeHtml(m.name)}:</span>
        <span class="player-skill" style="margin-left:auto;">${m.min.toFixed(1)} min</span>
      </div>
    `).join('');

    if (lineupEl) {
      lineupEl.innerHTML = `
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
        </div>
      `;
    }

    const events = buildEvents(best.segments);

    const planCards = events.map(ev => {
      const keeperName = ev.keeperId ? (idToName[ev.keeperId] || ev.keeperId) : null;

      const ins = ev.ins.map(id => `<div class="small-text">Inn: <b>${escapeHtml(idToName[id] || id)}</b></div>`).join('');
      const outs = ev.outs.map(id => `<div class="small-text">Ut: <b>${escapeHtml(idToName[id] || id)}</b></div>`).join('');

      const empty = (!ev.ins.length && !ev.outs.length)
        ? `<div class="small-text" style="opacity:0.8;">Start (ingen bytter)</div>`
        : '';

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
    lines.push('Startoppstilling');

    const first = best.segments[0];
    const startIds = first.lineup.slice();
    const benchIds = presentPlayers.map(p => p.id).filter(id => !startIds.includes(id));

    lines.push(' Start (første periode)');
    startIds.forEach(id => lines.push(`  - ${idToName[id] || id}`));
    lines.push(' Benk (første periode)');
    benchIds.forEach(id => lines.push(`  - ${idToName[id] || id}`));

    lines.push('');
    lines.push('Beregnet spilletid');
    const minutesArr = Object.keys(best.minutes).map(id => ({ id, name: idToName[id] || id, min: best.minutes[id] }));
    minutesArr.sort((a, b) => b.min - a.min);
    minutesArr.forEach(m => lines.push(` ${m.name}: ${m.min.toFixed(1)} min`));

    lines.push('');
    lines.push('Bytteplan');
    const events = buildEvents(best.segments);
    events.forEach(ev => {
      lines.push(` Minutt ${ev.minute}`);
      if (ev.keeperId) lines.push(`  Keeper: ${idToName[ev.keeperId] || ev.keeperId}`);
      if (!ev.ins.length && !ev.outs.length) lines.push('  Start (ingen bytter)');
      ev.ins.forEach(id => lines.push(`  Inn: ${idToName[id] || id}`));
      ev.outs.forEach(id => lines.push(`  Ut: ${idToName[id] || id}`));
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
})();
