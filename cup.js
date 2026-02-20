// © 2026 Barnefotballtrener.no. All rights reserved.
// cup.js — UI, state, and storage for cup/tournament planner
// Depends on: cup-scheduler.js (CupScheduler global)

(() => {
  'use strict';

  const CS = window.CupScheduler;
  if (!CS) { console.error('[cup.js] CupScheduler not found'); return; }


// ============================================================
// Migration / compatibility
// Ensures day.id, pitch.maxFormat, class.allowedDayIds, etc.
// ============================================================
function migrateInPlace(cup) {
  try {
    if (cup && window.CupScheduler && typeof window.CupScheduler.migrateCupData === 'function') {
      window.CupScheduler.migrateCupData(cup);
    }
  } catch (e) {
    console.warn('[cup.js] migrateCupData failed (non-fatal):', e);
  }
  return cup;
}

function getEffectivePitches(cup) {
  try {
    if (window.CupScheduler && typeof window.CupScheduler.expandPitches === 'function') {
      return window.CupScheduler.expandPitches((cup && cup.pitches) ? cup.pitches : []);
    }
  } catch (e) {
    console.warn('[cup.js] expandPitches failed (non-fatal):', e);
  }
  return (cup && cup.pitches) ? cup.pitches : [];
}

function buildPitchMap(cup) {
  const map = Object.create(null);
  for (const p of getEffectivePitches(cup)) map[p.id] = p;
  return map;
}

/**
 * Stable pool sync: removes stale teamIds, assigns unassigned teams
 * to the smallest pool. Preserves existing distribution.
 */
function syncPoolsWithTeams(cls) {
  if (!cls || !cls.usePooling || !cls.pools || cls.pools.length === 0) return;
  const teamIds = new Set(cls.teams.map(t => t.id));
  // Remove stale ids
  for (const pool of cls.pools) {
    pool.teamIds = pool.teamIds.filter(id => teamIds.has(id));
  }
  // Find unassigned teams
  const assigned = new Set(cls.pools.flatMap(p => p.teamIds));
  const unassigned = cls.teams.filter(t => !assigned.has(t.id));
  // Assign each to smallest pool
  for (const t of unassigned) {
    let smallest = cls.pools[0];
    for (const p of cls.pools) {
      if (p.teamIds.length < smallest.teamIds.length) smallest = p;
    }
    smallest.teamIds.push(t.id);
  }
}

  // ============================================================
  // Storage
  // ============================================================
  const STORAGE_KEY = 'bft_cup_store';

  function defaultStore() {
    return { schemaVersion: 1, cups: [] };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultStore();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 1) return defaultStore();
      return parsed;
    } catch { return defaultStore(); }
  }

  function saveStore(store) {
    try {
      store.schemaVersion = 1;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn('[cup.js] Storage save failed:', e);
    }
  }

  // ============================================================
  // State
  // ============================================================
  let state = {
    currentCupId: null,
    activeStep: 'setup',      // setup | schedule | results
    scheduleView: 'pitch',    // pitch | team | time
    scheduleClassFilter: '',   // '' = all, or classId
    resultClassId: null,       // selected class in results step
    scheduleData: null,        // result from scheduleAllClasses
  };

  function getCurrentCup() {
    const store = loadStore();
    if (!state.currentCupId && store.cups.length > 0) {
      state.currentCupId = store.cups[store.cups.length - 1].id;
    }
    const cup = store.cups.find(c => c.id === state.currentCupId) || null;
    return migrateInPlace(cup);
  }

  function saveCup(cup) {
    migrateInPlace(cup);
    const store = loadStore();
    const idx = store.cups.findIndex(c => c.id === cup.id);
    if (idx >= 0) store.cups[idx] = cup;
    else store.cups.push(cup);
    cup.updatedAt = new Date().toISOString();
    saveStore(store);
  }

  // ============================================================
  // DOM helpers
  // ============================================================
  const $ = id => document.getElementById(id);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function toast(msg, type) {
    const el = $('cupToast');
    if (!el) return;
    const div = document.createElement('div');
    div.className = `cup-toast-msg ${type || ''}`;
    div.textContent = msg;
    el.appendChild(div);
    setTimeout(() => div.remove(), 2600);
  }

  // ============================================================
  // Initialize or create cup
  // ============================================================
  function ensureCup() {
    let cup = getCurrentCup();
    if (!cup) {
      cup = {
        id: CS.uuid(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title: '',
        venue: '',
        rulesMode: 'nff',
        days: [{ id: CS.uuid(), date: todayStr(), startTime: '09:00', endTime: '16:00', breaks: [] }],
        pitches: [{ id: CS.uuid(), name: 'Bane 1', maxFormat: '11v11' }],
        classes: [],
      };
      state.currentCupId = cup.id;
      saveCup(cup);
    }
    return cup;
  }

  // ============================================================
  // Schedule-awareness helpers
  // Prevent silent data corruption when setup changes after generation
  // ============================================================
  function hasExistingSchedule(cup) {
    if (!cup) return false;
    return cup.classes.some(c => (c.matches || []).length > 0);
  }

  function hasExistingScores(cup) {
    if (!cup) return false;
    return cup.classes.some(c =>
      (c.matches || []).some(m => m.score && (m.score.home !== null || m.score.away !== null))
    );
  }

  function markScheduleStale(cup, reason) {
    if (!cup) return;
    if (!hasExistingSchedule(cup)) return;
    cup._scheduleStale = true;
    cup._staleReason = reason || 'Oppsett endret';
    saveCup(cup);
    renderStaleWarning(cup);
  }

  function clearStaleFlag(cup) {
    if (!cup) return;
    delete cup._scheduleStale;
    delete cup._staleReason;
  }

  function renderStaleWarning(cup) {
    // Insert/update stale banner in setup view
    let banner = document.getElementById('cupStaleBanner');
    if (!cup || !cup._scheduleStale || !hasExistingSchedule(cup)) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'cupStaleBanner';
      banner.className = 'cup-stale-banner';
      const setupSection = document.getElementById('cupSetup');
      if (setupSection) {
        const firstCard = setupSection.querySelector('.cup-card');
        if (firstCard) setupSection.insertBefore(banner, firstCard);
        else setupSection.prepend(banner);
      }
    }
    const reason = cup._staleReason || 'Oppsett endret';
    banner.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <strong>${esc(reason)}</strong> etter sist generering. Kampprogrammet er utdatert. <em>Gå til Kampprogram-steget og generer på nytt.</em>`;
  }

  function clearClassMatches(cls) {
    if (!cls) return;
    cls.matches = [];
    if (cls.generation) {
      cls.generation.warnings = [];
      cls.generation.bestScore = 0;
    }
  }

  // ============================================================
  // PATCH 2: Restore schedule view after refresh
  // Derives scheduleData from saved matches so UI doesn't reset
  // ============================================================
  function restoreScheduleStateFromCup(cup) {
    if (!cup || !Array.isArray(cup.classes)) return;

    let anyPlaced = false;
    let totalUnplaced = 0;
    let totalPenalty = 0;
    const classResults = [];

    for (const cls of cup.classes) {
      const schedule = [];
      const unplaced = [];

      for (const m of (cls.matches || [])) {
        // dayIndex === 0 is valid, so check null/undefined explicitly
        const hasPlacement = m && (m.pitchId !== null && m.pitchId !== undefined) &&
          (m.dayIndex !== null && m.dayIndex !== undefined) &&
          (m.start !== null && m.start !== undefined) &&
          (m.end !== null && m.end !== undefined);
        if (hasPlacement) {
          anyPlaced = true;
          const sMin = CS.parseTime(m.start);
          const eMin = CS.parseTime(m.end);
          // Ensure string labels even if stored as minutes (number)
          const sLabel = (typeof m.start === 'string' && m.start.indexOf(':') !== -1) ? m.start : CS.formatTime(sMin);
          const eLabel = (typeof m.end === 'string' && m.end.indexOf(':') !== -1) ? m.end : CS.formatTime(eMin);
          schedule.push({
            matchId: m.id, homeId: m.homeId, awayId: m.awayId,
            pitchId: m.pitchId, dayIndex: m.dayIndex,
            startMin: sMin, endMin: eMin,
            startTime: sLabel, endTime: eLabel, _classId: cls.id,
          });
        } else if (m && m.id) {
          unplaced.push(m.id);
        }
      }

      totalUnplaced += unplaced.length;
      totalPenalty += cls.generation?.bestScore || 0;
      classResults.push({ classId: cls.id, schedule, unplaced, penalty: cls.generation?.bestScore || 0 });
    }

    if (anyPlaced) {
      state.scheduleData = {
        classResults, totalPenalty, totalUnplaced,
        seed: cup.generationGlobal?.seed || cup.classes[0]?.generation?.seed || 0,
        attempt: cup.generationGlobal?.attempt || 0,
        attempts: cup.generationGlobal?.attempts || 0,
      };
      if (state.activeStep === 'setup') state.activeStep = 'schedule';
    }
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // ============================================================
  // Render: Steps navigation
  // ============================================================
  function renderSteps() {
    const steps = document.querySelectorAll('.cup-step');
    const sections = document.querySelectorAll('.cup-section');
    steps.forEach(s => s.classList.toggle('is-active', s.dataset.step === state.activeStep));
    sections.forEach(s => {
      const id = s.id.replace('cup', '').toLowerCase();
      s.classList.toggle('is-active', id === state.activeStep);
    });
  }

  function setupStepNav() {
    document.querySelectorAll('.cup-step').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeStep = btn.dataset.step;
        renderSteps();
        renderCurrentStep();
      });
    });
  }

  function renderCurrentStep() {
    const cup = getCurrentCup();
    if (!cup) return;
    if (state.activeStep === 'setup') renderSetup(cup);
    else if (state.activeStep === 'schedule') renderSchedule(cup);
    else if (state.activeStep === 'results') renderResults(cup);
  }

  // ============================================================
  // Render: Setup (step 1)
  // ============================================================
  function renderSetup(cup) {
    migrateInPlace(cup);
    // Cup info
    const nameInput = $('cupName');
    const venueInput = $('cupVenue');
    if (nameInput && nameInput.value !== cup.title) nameInput.value = cup.title || '';
    if (venueInput && venueInput.value !== cup.venue) venueInput.value = cup.venue || '';

    renderDays(cup);
    renderPitches(cup);
    renderClasses(cup);
    renderStaleWarning(cup);
  }

  // --- Days ---
  function renderDays(cup) {
    const container = $('cupDays');
    if (!container) return;
    container.innerHTML = cup.days.map((day, di) => `
      <div class="cup-item" data-day="${di}">
        <div class="cup-item-header">
          <span class="cup-item-title">Dag ${di + 1}</span>
          ${cup.days.length > 1 ? `<button class="cup-item-remove" data-action="removeDay" data-idx="${di}" title="Fjern dag"><i class="fas fa-times"></i></button>` : ''}
        </div>
        <div class="cup-item-fields">
          <div class="cup-field">
            <label class="cup-label">Dato</label>
            <input class="cup-input cup-input-sm" type="date" value="${day.date}" data-day="${di}" data-field="date">
          </div>
          <div class="cup-field">
            <label class="cup-label">Starttid</label>
            <input class="cup-input cup-input-sm" type="time" value="${day.startTime}" data-day="${di}" data-field="startTime">
          </div>
          <div class="cup-field">
            <label class="cup-label">Sluttid</label>
            <input class="cup-input cup-input-sm" type="time" value="${day.endTime}" data-day="${di}" data-field="endTime">
          </div>
        </div>
        <div class="cup-breaks" data-day="${di}">
          ${(day.breaks || []).map((b, bi) => `
            <div class="cup-break-row">
              <span style="font-weight:700; color: var(--cup-gray-500);">Pause:</span>
              <input class="cup-input cup-input-sm" type="time" value="${b.start}" data-day="${di}" data-break="${bi}" data-field="breakStart" style="width:80px;">
              <span>-</span>
              <input class="cup-input cup-input-sm" type="time" value="${b.end}" data-day="${di}" data-break="${bi}" data-field="breakEnd" style="width:80px;">
              <button class="cup-item-remove" data-action="removeBreak" data-day="${di}" data-break="${bi}"><i class="fas fa-times"></i></button>
            </div>
          `).join('')}
          <button class="cup-btn cup-btn-ghost cup-btn-sm" data-action="addBreak" data-day="${di}" style="margin-top:4px;">
            <i class="fas fa-plus"></i> Legg til pause (f.eks. lunsj)
          </button>
        </div>
      </div>
    `).join('');
  }

  // --- Pitches ---
  function renderPitches(cup) {
    const container = $('cupPitches');
    if (!container) return;
    container.innerHTML = cup.pitches.map((p, pi) => `
      <div class="cup-input-row">
        <input class="cup-input cup-input-sm" type="text" value="${esc(p.name)}" data-pitch="${pi}" data-field="pitchName" placeholder="Banenavn">
        <select class="cup-input cup-input-sm cup-select" data-pitch="${pi}" data-field="pitchMaxFormat" title="Maks spillform denne banen kan brukes til">
          <option value="3v3" ${p.maxFormat==='3v3'?'selected':''}>3v3</option>
          <option value="5v5" ${p.maxFormat==='5v5'?'selected':''}>5v5</option>
          <option value="7v7" ${p.maxFormat==='7v7'?'selected':''}>7v7</option>
          <option value="9v9" ${p.maxFormat==='9v9'?'selected':''}>9v9</option>
          <option value="11v11" ${p.maxFormat==='11v11'?'selected':''}>11v11</option>
        </select>
        ${cup.pitches.length > 1 ? `<button class="cup-item-remove" data-action="removePitch" data-idx="${pi}"><i class="fas fa-times"></i></button>` : ''}
      </div>
    `).join('');
  }

  // --- Classes ---
  function renderClasses(cup) {
    const container = $('cupClasses');
    if (!container) return;

    container.innerHTML = cup.classes.map((cls, ci) => {
      const nff = CS.getNffDefaults(cls.age);
      const isNffAge = cls.age <= 12;
      const nffBadge = isNffAge
        ? `<span class="cup-nff-badge"><i class="fas fa-shield-alt"></i> NFF: Ingen sluttspill/rangering</span>`
        : `<span class="cup-nff-badge cup-nff-warning"><i class="fas fa-info-circle"></i> Sluttspill tillatt (13+)</span>`;

      return `
      <div class="cup-item" data-class="${ci}">
        <div class="cup-item-header">
          <span class="cup-item-title">${esc(cls.name) || `Klasse ${ci+1}`}</span>
          <button class="cup-item-remove" data-action="removeClass" data-idx="${ci}"><i class="fas fa-times"></i></button>
        </div>
        <div class="cup-item-fields">
          <div class="cup-field">
            <label class="cup-label">Navn</label>
            <input class="cup-input cup-input-sm" type="text" value="${esc(cls.name)}" data-class="${ci}" data-field="className" placeholder="F.eks. G11">
          </div>
          <div class="cup-field">
            <label class="cup-label">Kjønn</label>
            <select class="cup-input cup-input-sm cup-select" data-class="${ci}" data-field="classGender">
              <option value="G" ${cls.gender==='G'?'selected':''}>Gutter (G)</option>
              <option value="J" ${cls.gender==='J'?'selected':''}>Jenter (J)</option>
              <option value="Mix" ${cls.gender==='Mix'?'selected':''}>Mix</option>
            </select>
          </div>
          <div class="cup-field">
            <label class="cup-label">Alder</label>
            <input class="cup-input cup-input-sm" type="number" min="6" max="19" value="${cls.age}" data-class="${ci}" data-field="classAge">
          </div>
          <div class="cup-field">
            <label class="cup-label">Spillform</label>
            <input class="cup-input cup-input-sm" type="text" value="${cls.playFormat}" data-class="${ci}" data-field="classPlayFormat" placeholder="7v7">
          </div>
          <div class="cup-field">
            <label class="cup-label">Kamptid (min)</label>
            <input class="cup-input cup-input-sm" type="number" min="10" max="90" value="${cls.matchMinutes}" data-class="${ci}" data-field="classMatchMin">
          </div>
          <div class="cup-field">
            <label class="cup-label">Buffer (min)</label>
            <input class="cup-input cup-input-sm" type="number" min="0" max="30" value="${cls.bufferMinutes}" data-class="${ci}" data-field="classBuffer" title="Tid mellom kamper på samme bane for banebytte">
          </div>
          <div class="cup-field">
            <label class="cup-label">Min. hvile (min)</label>
            <input class="cup-input cup-input-sm" type="number" min="0" max="120" value="${cls.minRestMinutes}" data-class="${ci}" data-field="classMinRest" title="Minimum tid mellom to kamper for samme lag">
          </div>
          <div class="cup-field">
            <label class="cup-label">Maks kamper/dag</label>
            <input class="cup-input cup-input-sm" type="number" min="1" max="10" value="${cls.maxMatchesPerTeamPerDay || ''}" data-class="${ci}" data-field="classMaxPerDay" placeholder="Auto" title="Maks kamper per lag per dag (tom = ingen grense)">
          </div>
          <div class="cup-field" style="grid-column: 1 / -1;">
            <label class="cup-label">Spiller på dag</label>
            <div class="cup-day-checks">
              ${(cup.days || []).map((day, di) => {
                const checked = !cls.allowedDayIds || cls.allowedDayIds.length===0 || cls.allowedDayIds.indexOf(day.id) >= 0;
                return `<label class="cup-day-check"><input type="checkbox" data-class="${ci}" data-field="allowedDay" data-dayid="${day.id}" ${checked ? 'checked' : ''}> ${esc(day.date || ('Dag ' + (di+1)))}</label>`;
              }).join('')}
            </div>
          </div>
          ${(cls.teams.length >= 7 || cls.usePooling) ? `
          <div class="cup-field" style="grid-column: 1 / -1;">
            <label class="cup-day-check">
              <input type="checkbox" data-class="${ci}" data-field="usePooling" ${cls.usePooling ? 'checked' : ''}>
              Bruk puljer (${cls.teams.length} lag)
            </label>
          </div>
          ` : ''}
        </div>

        ${cls.usePooling && cls.pools && cls.pools.length > 0 ? `
        <div class="cup-pool-section" data-class="${ci}">
          <div class="cup-pool-header">
            <span style="font-weight:700;font-size:13px;color:var(--cup-gray-700);">Puljer</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <select class="cup-input cup-input-sm" data-class="${ci}" data-field="poolCount" style="width:auto;">
                ${[2,3,4,5,6].filter(n => n <= Math.floor(cls.teams.length / 2)).map(n => `<option value="${n}" ${cls.pools.length === n ? 'selected' : ''}>${n} puljer</option>`).join('')}
              </select>
              <button class="cup-btn cup-btn-ghost cup-btn-sm" data-action="distributePools" data-class="${ci}"><i class="fas fa-random"></i> Fordel lag</button>
            </div>
          </div>
          <div class="cup-pool-grid">
            ${cls.pools.map(pool => {
              const poolTeams = pool.teamIds.map(tid => cls.teams.find(t => t.id === tid)).filter(Boolean);
              const poolMatches = poolTeams.length * (poolTeams.length - 1) / 2;
              return `
              <div class="cup-pool-card">
                <div class="cup-pool-card-header">${esc(pool.name)} (${poolTeams.length} lag)</div>
                <div class="cup-pool-card-teams">
                  ${poolTeams.map(t => `<div class="cup-pool-team">${esc(t.name || '?')}</div>`).join('')}
                </div>
                <div class="cup-pool-card-info">${poolMatches} kamper</div>
              </div>`;
            }).join('')}
          </div>
          <div class="cup-pool-summary">
            Totalt: ${cls.pools.reduce((s, p) => { const n = p.teamIds.filter(id => cls.teams.some(t => t.id === id)).length; return s + n * (n - 1) / 2; }, 0)} kamper
            (vs ${cls.teams.length * (cls.teams.length - 1) / 2} uten puljer)
          </div>
        </div>
        ` : ''}
        <div style="margin-top:8px;">${nffBadge}</div>

        <!-- Teams -->
        <div class="cup-teams-list" data-class="${ci}">
          <div style="display:flex; align-items:center; justify-content:space-between; margin: 10px 0 6px;">
            <span style="font-weight:700; font-size:13px; color: var(--cup-gray-700);">Lag (${cls.teams.length})</span>
            <div style="display:flex; gap:6px;">
              <button class="cup-btn cup-btn-ghost cup-btn-sm" data-action="toggleImport" data-class="${ci}"><i class="fas fa-paste"></i> Lim inn</button>
              <button class="cup-btn cup-btn-ghost cup-btn-sm" data-action="addTeam" data-class="${ci}"><i class="fas fa-plus"></i> Legg til</button>
            </div>
          </div>
          <div class="cup-import-area" id="cupImport_${ci}" style="display:none;">
            <textarea class="cup-input cup-import-textarea" data-class="${ci}" placeholder="Ett lag per linje. Bruk semikolon for klubb:&#10;Steinkjer IL 1;Steinkjer IL&#10;Levanger FK 2;Levanger FK&#10;Verdal IL Gul" rows="5"></textarea>
            <div style="display:flex; gap:6px; margin-top:4px;">
              <button class="cup-btn cup-btn-sm cup-btn-primary" data-action="importTeams" data-class="${ci}"><i class="fas fa-check"></i> Importer</button>
              <button class="cup-btn cup-btn-ghost cup-btn-sm" data-action="toggleImport" data-class="${ci}">Avbryt</button>
            </div>
          </div>
          ${cls.teams.map((t, ti) => `
            <div class="cup-team-row">
              <span class="cup-team-num">${ti+1}.</span>
              <input class="cup-input cup-input-sm" type="text" value="${esc(t.name)}" data-class="${ci}" data-team="${ti}" data-field="teamName" placeholder="Lagnavn" style="flex:2;">
              <input class="cup-input cup-input-sm" type="text" value="${esc(t.club || '')}" data-class="${ci}" data-team="${ti}" data-field="teamClub" placeholder="Klubb" style="flex:1; color: var(--cup-gray-500);">
              <button class="cup-item-remove" data-action="removeTeam" data-class="${ci}" data-team="${ti}"><i class="fas fa-times"></i></button>
            </div>
          `).join('')}
        </div>
      </div>
      `;
    }).join('');

    if (cup.classes.length === 0) {
      container.innerHTML = '<p class="cup-help" style="text-align:center; padding: 20px;">Ingen klasser ennå. Legg til en klasse for å starte.</p>';
    }
  }

  // ============================================================
  // Class color coding
  // ============================================================
  const CLASS_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  ];
  function getClassColor(cup, classId) {
    const idx = cup.classes.findIndex(c => c.id === classId);
    return CLASS_COLORS[idx % CLASS_COLORS.length] || CLASS_COLORS[0];
  }

  // ============================================================
  // Render: Schedule (step 2) — by pitch grid
  // ============================================================
  function renderSchedule(cup) {
    const grid = $('cupGrid');
    const warningsEl = $('cupWarnings');
    if (!grid) return;

    if (!state.scheduleData) {
      grid.innerHTML = '<p class="cup-help" style="text-align:center; padding:30px;">Ingen kampprogram generert ennå. Gå tilbake til Oppsett og generer.</p>';
      if (warningsEl) warningsEl.innerHTML = '';
      return;
    }

    // Populate class filter dropdown
    const filterEl = $('cupClassFilter');
    if (filterEl) {
      const prev = state.scheduleClassFilter || '';
      filterEl.innerHTML = `<option value="">Alle klasser</option>` +
        cup.classes.map(c => `<option value="${c.id}" ${c.id === prev ? 'selected' : ''}>${esc(c.name || 'Ukjent')}</option>`).join('');
    }

    const { classResults } = state.scheduleData;

    // Apply class filter
    const filteredResults = state.scheduleClassFilter
      ? classResults.filter(cr => cr.classId === state.scheduleClassFilter)
      : classResults;
    const allEntries = filteredResults.flatMap(cr => cr.schedule);

    // Render warnings
    if (warningsEl) {
      const allWarnings = [];
      for (const cr of classResults) {
        if (cr.unplaced.length > 0) {
          const cls = cup.classes.find(c => c.id === cr.classId);
          allWarnings.push(`${cls?.name || cr.classId}: ${cr.unplaced.length} kamp(er) kunne ikke plasseres`);
        }
      }
      // Validation
      const valWarnings = CS.validateSchedule(cup.classes, allEntries);
      for (const w of valWarnings) allWarnings.push(w.message);

      warningsEl.innerHTML = allWarnings.length > 0
        ? `<div class="cup-warnings">${allWarnings.map(w => `<div class="cup-warning-item"><i class="fas fa-exclamation-triangle"></i> ${esc(w)}</div>`).join('')}</div>`
        : '';
    }

    const pitchMap = buildPitchMap(cup);

    // Render unplaced matches list (so organizer can see exactly which matches failed)
    const allUnplaced = classResults.flatMap(cr => {
      const cls = cup.classes.find(c => c.id === cr.classId);
      if (!cls || cr.unplaced.length === 0) return [];
      return cr.unplaced.map(mid => {
        const m = cls.matches.find(m => m.id === mid);
        if (!m) return null;
        const home = cls.teams.find(t => t.id === m.homeId);
        const away = cls.teams.find(t => t.id === m.awayId);
        return { className: cls.name || 'Ukjent', home: home?.name || '?', away: away?.name || '?' };
      }).filter(Boolean);
    });
    if (allUnplaced.length > 0) {
      const unplacedHtml = `<div class="cup-unplaced-section">
        <div class="cup-unplaced-header"><i class="fas fa-exclamation-circle"></i> ${allUnplaced.length} kamp(er) ikke plassert:</div>
        ${allUnplaced.map(u => `<div class="cup-unplaced-match">${esc(u.className)}: ${esc(u.home)} vs ${esc(u.away)}</div>`).join('')}
      </div>`;
      if (warningsEl) warningsEl.innerHTML += unplacedHtml;
    }

    if (state.scheduleView === 'pitch') renderByPitch(cup, allEntries, grid, pitchMap);
    else if (state.scheduleView === 'team') renderByTeam(cup, allEntries, grid, pitchMap);
    else renderByTime(cup, allEntries, grid, pitchMap);
  }

  function renderByPitch(cup, entries, container, pitchMap) {
    const byPitch = {};
    for (const p of getEffectivePitches(cup)) byPitch[p.id] = { name: p.name, entries: [] };
    for (const e of entries) {
      if (!byPitch[e.pitchId]) byPitch[e.pitchId] = { name: e.pitchId, entries: [] };
      byPitch[e.pitchId].entries.push(e);
    }

    let html = '';
    for (const pid of Object.keys(byPitch)) {
      const pitch = byPitch[pid];
      pitch.entries.sort((a, b) => (a.dayIndex - b.dayIndex) || (a.startMin - b.startMin));
      html += `<div class="cup-grid-pitch">`;
      html += `<div class="cup-grid-pitch-name"><i class="fas fa-map-marker-alt"></i> ${esc(pitch.name)}</div>`;
      for (const e of pitch.entries) {
        html += renderMatchCard(cup, e, pitchMap);
      }
      if (pitch.entries.length === 0) {
        html += '<p class="cup-help" style="padding:8px;">Ingen kamper på denne banen.</p>';
      }
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function renderByTeam(cup, entries, container, pitchMap) {
    const allTeams = cup.classes.flatMap(cls => cls.teams.map(t => ({ ...t, className: cls.name, classId: cls.id })));
    const teams = state.scheduleClassFilter
      ? allTeams.filter(t => t.classId === state.scheduleClassFilter)
      : allTeams;
    let html = '';
    for (const team of teams) {
      const teamEntries = entries
        .filter(e => e.homeId === team.id || e.awayId === team.id)
        .sort((a, b) => (a.dayIndex - b.dayIndex) || (a.startMin - b.startMin));
      html += `<div class="cup-team-schedule">`;
      html += `<div class="cup-team-schedule-name">${esc(team.name)} <span style="font-weight:400;color:var(--cup-gray-400)">(${esc(team.className)})</span></div>`;
      for (const e of teamEntries) html += renderMatchCard(cup, e, pitchMap);
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function renderByTime(cup, entries, container, pitchMap) {
    const sorted = [...entries].sort((a, b) => (a.dayIndex - b.dayIndex) || (a.startMin - b.startMin));
    let html = '';
    let lastDay = -1;
    for (const e of sorted) {
      if (e.dayIndex !== lastDay) {
        lastDay = e.dayIndex;
        const day = cup.days[e.dayIndex];
        html += `<div class="cup-grid-pitch-name" style="margin-top:12px;"><i class="fas fa-calendar-day"></i> ${day?.date || `Dag ${e.dayIndex+1}`}</div>`;
      }
      html += renderMatchCard(cup, e, pitchMap);
    }
    container.innerHTML = html;
  }

  function renderMatchCard(cup, entry, pitchMap) {
    const cls = cup.classes.find(c => c.id === entry._classId);
    const home = cls?.teams.find(t => t.id === entry.homeId);
    const away = cls?.teams.find(t => t.id === entry.awayId);
    const match = cls?.matches.find(m => m.id === entry.matchId);
    const locked = match?.locked || false;
    const pm = pitchMap || buildPitchMap(cup);
    const pitch = pm[entry.pitchId] || null;
    const pool = (match?.poolId && cls?.pools) ? cls.pools.find(p => p.id === match.poolId) : null;
    const poolBadge = pool ? `<span class="cup-pool-badge">${esc(pool.name)}</span>` : '';
    const color = getClassColor(cup, entry._classId);
    const colorDot = cup.classes.length > 1 ? `<span class="cup-class-dot" style="background:${color}"></span>` : '';

    const matchNum = match?.matchNumber ? `<span class="cup-match-num">${match.matchNumber}</span>` : '';

    return `
      <div class="cup-match-card ${locked ? 'is-locked' : ''}" data-match-id="${entry.matchId}" data-class-id="${entry._classId}" style="border-left:3px solid ${color};">
        ${matchNum}<span class="cup-match-time">${entry.startTime}</span>
        <span class="cup-match-teams">
          ${esc(home?.name || '?')}<span class="cup-match-vs"> vs </span>${esc(away?.name || '?')}
        </span>
        <span class="cup-match-class">${colorDot}${poolBadge}${esc(cls?.name || '')}</span>
        <span style="font-size:11px;color:var(--cup-gray-400);">${esc(pitch?.name || '')}</span>
        <button class="cup-match-lock ${locked ? 'is-locked' : ''}" data-action="toggleLock" data-match-id="${entry.matchId}" data-class-id="${entry._classId}" title="${locked ? 'Lås opp' : 'Lås kamp'}">
          <i class="fas fa-${locked ? 'lock' : 'lock-open'}"></i>
        </button>
      </div>
    `;
  }

  // ============================================================
  // Render: Results (step 3)
  // ============================================================
  function renderResults(cup) {
    const classSelect = $('cupResultClass');
    const matchesEl = $('cupMatchResults');
    const standingsEl = $('cupStandings');
    if (!classSelect || !matchesEl || !standingsEl) return;

    // Populate class selector (preserve selection)
    const prevId = state.resultClassId;
    classSelect.innerHTML = cup.classes.map(c => `<option value="${c.id}" ${c.id === prevId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    if (cup.classes.length === 0) {
      matchesEl.innerHTML = '<p class="cup-help">Ingen klasser.</p>';
      standingsEl.innerHTML = '';
      return;
    }

    const selectedId = classSelect.value || cup.classes[0]?.id;
    state.resultClassId = selectedId;
    const cls = cup.classes.find(c => c.id === selectedId);
    if (!cls) return;

    // Render matches for result entry (grouped by pool if applicable)
    const sortedMatches = [...cls.matches].sort((a, b) => {
      const da = (a.dayIndex !== null && a.dayIndex !== undefined) ? a.dayIndex : 0;
      const db = (b.dayIndex !== null && b.dayIndex !== undefined) ? b.dayIndex : 0;
      if (da !== db) return da - db;
      const ta = (a.start !== null && a.start !== undefined) ? CS.parseTime(a.start) : Infinity;
      const tb = (b.start !== null && b.start !== undefined) ? CS.parseTime(b.start) : Infinity;
      return ta - tb;
    });

    const pitchMap = buildPitchMap(cup);
    const hasPools = cls.usePooling && cls.pools && cls.pools.length > 0;

    if (hasPools) {
      // Group matches by pool
      let matchHtml = '';
      for (const pool of cls.pools) {
        const poolMatches = sortedMatches.filter(m => m.poolId === pool.id);
        matchHtml += `<div class="cup-pool-results-header">${esc(pool.name)}</div>`;
        matchHtml += poolMatches.map(m => renderResultRow(cls, m, pitchMap)).join('');
      }
      // Any orphan matches without poolId
      const orphans = sortedMatches.filter(m => !m.poolId);
      if (orphans.length > 0) {
        matchHtml += `<div class="cup-pool-results-header">Uten pulje</div>`;
        matchHtml += orphans.map(m => renderResultRow(cls, m, pitchMap)).join('');
      }
      matchesEl.innerHTML = matchHtml;
    } else {
      matchesEl.innerHTML = sortedMatches.map(m => renderResultRow(cls, m, pitchMap)).join('');
    }

    // Render standings (per pool if applicable)
    const nffRules = CS.getNffDefaults(cls.age || 10);
    const standingsOpts = { noRanking: nffRules.noRanking };
    if (hasPools) {
      standingsEl.innerHTML = cls.pools.map(pool => {
        const poolTeams = cls.teams.filter(t => pool.teamIds.includes(t.id));
        const poolMatches = cls.matches.filter(m => m.poolId === pool.id);
        const standings = CS.calcStandings(poolTeams, poolMatches);
        return renderStandingsTable(pool.name, standings, standingsOpts);
      }).join('');
    } else {
      const standings = CS.calcStandings(cls.teams, cls.matches);
      standingsEl.innerHTML = renderStandingsTable(cls.name, standings, standingsOpts);
    }
  }

  function renderResultRow(cls, m, pitchMap) {
    const home = cls.teams.find(t => t.id === m.homeId);
    const away = cls.teams.find(t => t.id === m.awayId);
    const pitch = pitchMap[m.pitchId] || null;
    const matchNum = m.matchNumber ? `<span class="cup-match-num">${m.matchNumber}</span>` : '';
    return `
      <div class="cup-result-row" data-match-id="${m.id}">
        ${matchNum}
        <span class="cup-result-time">${(m.start !== null && m.start !== undefined) ? CS.formatTime(CS.parseTime(m.start)) : '--:--'}</span>
        <span class="cup-result-home">${esc(home?.name || '?')}</span>
        <span class="cup-result-score">
          <input type="number" min="0" inputmode="numeric" value="${m.score.home ?? ''}" data-match-id="${m.id}" data-class-id="${cls.id}" data-side="home" placeholder="-">
          <span class="cup-result-dash">-</span>
          <input type="number" min="0" inputmode="numeric" value="${m.score.away ?? ''}" data-match-id="${m.id}" data-class-id="${cls.id}" data-side="away" placeholder="-">
        </span>
        <span class="cup-result-away">${esc(away?.name || '?')}</span>
        <span class="cup-result-pitch">${esc(pitch?.name || '')}</span>
        <select class="cup-wo-select" data-match-id="${m.id}" data-class-id="${cls.id}" title="Walk-over">
          <option value="">WO</option>
          <option value="home">H 3-0</option>
          <option value="away">B 0-3</option>
          <option value="clear">Nullstill</option>
        </select>
      </div>
    `;
  }

  function renderStandingsTable(title, standings, options) {
    const noRanking = options?.noRanking || false;
    const icon = noRanking ? 'fa-table' : 'fa-list-ol';
    const heading = noRanking ? 'Kampstatistikk' : 'Tabell';
    const nffNote = noRanking ? '<div class="cup-nff-note"><i class="fas fa-shield-alt"></i> NFF: Ingen rangering i barnefotball. Oversikten er kun til intern bruk.</div>' : '';

    // For barnefotball: sort alphabetically to avoid implicit ranking
    const rows = noRanking
      ? [...standings].sort((a, b) => (a.teamName || '').localeCompare(b.teamName || '', 'nb'))
      : standings;

    return `
      <div class="cup-standings">
        <h3><i class="fas ${icon}"></i> ${heading}: ${esc(title)}</h3>
        ${nffNote}
        <table>
          <thead>
            <tr>
              ${noRanking ? '' : '<th>#</th>'}<th class="col-team">Lag</th><th class="col-num">K</th><th class="col-num">V</th>
              <th class="col-num">U</th><th class="col-num">T</th><th class="col-num">Mål</th>
              ${noRanking ? '' : '<th class="col-num">+/-</th><th class="col-num col-pts">P</th>'}
            </tr>
          </thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                ${noRanking ? '' : '<td>' + (i+1) + '</td>'}<td class="col-team">${esc(r.teamName)}</td>
                <td class="col-num">${r.p}</td><td class="col-num">${r.w}</td>
                <td class="col-num">${r.d}</td><td class="col-num">${r.l}</td>
                <td class="col-num">${r.gf}-${r.ga}</td>
                ${noRanking ? '' : '<td class="col-num">' + r.gd + '</td><td class="col-num col-pts">' + r.pts + '</td>'}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ============================================================
  // Event handling
  // ============================================================
  function setupEvents() {
    const main = document.querySelector('.cup-main');
    if (!main) return;

    // Delegated events
    main.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const cup = getCurrentCup();
      if (!cup) return;

      if (action === 'addDay') {
        cup.days.push({ id: CS.uuid(), date: todayStr(), startTime: '09:00', endTime: '16:00', breaks: [] });
        saveCup(cup); renderSetup(cup);
      }
      else if (action === 'removeDay') {
        const idx = Number(btn.dataset.idx);
        if (cup.days.length > 1) {
          const removedDayId = cup.days[idx]?.id;
          cup.days.splice(idx, 1);
          // Fix match dayIndex references (CRITICAL: prevent data corruption)
          for (const cls of cup.classes) {
            for (const m of (cls.matches || [])) {
              if (m.dayIndex === idx) {
                // Unplace matches that were on deleted day
                m.dayIndex = null; m.start = null; m.end = null; m.pitchId = null; m.locked = false;
              } else if (m.dayIndex !== null && m.dayIndex !== undefined && m.dayIndex > idx) {
                m.dayIndex--;
              }
            }
            // Fix allowedDayIds references
            if (cls.allowedDayIds && removedDayId) {
              cls.allowedDayIds = cls.allowedDayIds.filter(id => id !== removedDayId);
              if (cls.allowedDayIds.length === 0 || cls.allowedDayIds.length === cup.days.length) {
                cls.allowedDayIds = null;
              }
            }
          }
          markScheduleStale(cup, 'Dag fjernet');
          saveCup(cup); renderSetup(cup);
        }
      }
      else if (action === 'addBreak') {
        const di = Number(btn.dataset.day);
        if (!cup.days[di].breaks) cup.days[di].breaks = [];
        cup.days[di].breaks.push({ start: '12:00', end: '12:30' });
        if (hasExistingSchedule(cup)) markScheduleStale(cup, 'Pause lagt til');
        saveCup(cup); renderSetup(cup);
      }
      else if (action === 'removeBreak') {
        const di = Number(btn.dataset.day);
        const bi = Number(btn.dataset.break);
        cup.days[di].breaks.splice(bi, 1);
        if (hasExistingSchedule(cup)) markScheduleStale(cup, 'Pause fjernet');
        saveCup(cup); renderSetup(cup);
      }
      else if (action === 'addPitch') {
        cup.pitches.push({ id: CS.uuid(), name: `Bane ${cup.pitches.length + 1}`, maxFormat: '11v11' });
        saveCup(cup); renderSetup(cup);
      }
      else if (action === 'removePitch') {
        const idx = Number(btn.dataset.idx);
        if (cup.pitches.length > 1) {
          const removedPitchId = cup.pitches[idx]?.id;
          cup.pitches.splice(idx, 1);
          // Unplace matches assigned to deleted pitch
          if (removedPitchId) {
            for (const cls of cup.classes) {
              for (const m of (cls.matches || [])) {
                if (m.pitchId === removedPitchId) {
                  m.pitchId = null; m.start = null; m.end = null; m.dayIndex = null; m.locked = false;
                }
              }
            }
          }
          markScheduleStale(cup, 'Bane fjernet');
          saveCup(cup); renderSetup(cup);
        }
      }
      else if (action === 'addClass') {
        const nff = CS.getNffDefaults(10);
        cup.classes.push({
          id: CS.uuid(), name: '', gender: 'G', age: 10,
          playFormat: nff.playFormat, matchMinutes: nff.matchMinutes,
          bufferMinutes: 5, minRestMinutes: 25,
          allowedDayIds: null,
          maxMatchesPerTeamPerDay: null,
          usePooling: false,
          teams: [], matches: [],
          generation: { seed: CS.newSeed(), attempts: 0, bestScore: 0, warnings: [] },
        });
        saveCup(cup); renderSetup(cup);
      }
      else if (action === 'removeClass') {
        const idx = Number(btn.dataset.idx);
        const cls = cup.classes[idx];
        if (!cls) return;
        const hasTeams = cls.teams.length > 0;
        const hasMatches = (cls.matches || []).length > 0;
        const hasScoresInClass = (cls.matches || []).some(m => m.score && (m.score.home !== null || m.score.away !== null));
        let msg = `Slette klasse "${cls.name || 'Klasse ' + (idx+1)}"`;
        if (hasScoresInClass) msg += ` med ${cls.teams.length} lag og registrerte resultater`;
        else if (hasTeams) msg += ` med ${cls.teams.length} lag`;
        msg += '? Dette kan ikke angres.';
        if (hasTeams || hasMatches) {
          const ok = confirm(msg);
          if (!ok) return;
        }
        cup.classes.splice(idx, 1);
        // Clean up scheduleData for removed class
        if (state.scheduleData?.classResults) {
          state.scheduleData.classResults = state.scheduleData.classResults.filter(cr => cr.classId !== cls.id);
        }
        saveCup(cup); renderSetup(cup);
      }
      else if (action === 'addTeam') {
        const ci = Number(btn.dataset.class);
        const cls = cup.classes[ci];
        if (cls) {
          cls.teams.push({ id: CS.uuid(), name: `Lag ${cls.teams.length + 1}`, club: '' });
          syncPoolsWithTeams(cls);
          if ((cls.matches || []).length > 0) {
            markScheduleStale(cup, 'Lag lagt til');
          }
          saveCup(cup); renderSetup(cup);
        }
      }
      else if (action === 'toggleImport') {
        const ci = Number(btn.dataset.class);
        const el = document.getElementById(`cupImport_${ci}`);
        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
      }
      else if (action === 'importTeams') {
        const ci = Number(btn.dataset.class);
        const cls = cup.classes[ci];
        if (!cls) return;
        const ta = document.querySelector(`.cup-import-textarea[data-class="${ci}"]`);
        if (!ta || !ta.value.trim()) return;
        const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
        let added = 0;
        for (const line of lines) {
          const parts = line.split(';');
          const name = (parts[0] || '').trim();
          const club = (parts[1] || '').trim();
          if (!name) continue;
          cls.teams.push({ id: CS.uuid(), name, club });
          added++;
        }
        if (added > 0) {
          syncPoolsWithTeams(cls);
          if ((cls.matches || []).length > 0) markScheduleStale(cup, `${added} lag importert`);
          saveCup(cup);
          toast(`${added} lag importert`, 'success');
        }
        renderClasses(cup);
      }
      else if (action === 'removeTeam') {
        const ci = Number(btn.dataset.class);
        const ti = Number(btn.dataset.team);
        const cls = cup.classes[ci];
        if (!cls) return;
        const removedId = cls.teams[ti]?.id;
        cls.teams.splice(ti, 1);
        syncPoolsWithTeams(cls);
        // Remove orphan matches involving deleted team
        if (removedId && cls.matches) {
          cls.matches = cls.matches.filter(m => m.homeId !== removedId && m.awayId !== removedId);
        }
        markScheduleStale(cup, 'Lag fjernet');
        saveCup(cup); renderSetup(cup);
      }
      else if (action === 'distributePools') {
        const ci = Number(btn.dataset.class);
        const cls = cup.classes[ci];
        if (!cls || cls.teams.length < 4) return;
        // Warn if matches exist (poolIds will be invalid after redistribution)
        if ((cls.matches || []).length > 0) {
          const ok = confirm('Ny fordeling av lag i puljer gjør at eksisterende kampprogram blir ugyldig for denne klassen. Kamper og resultater for klassen slettes. Fortsette?');
          if (!ok) return;
          clearClassMatches(cls);
          markScheduleStale(cup, 'Puljer omfordelt');
        }
        const poolCount = cls.pools?.length || CS.autoPoolCount(cls.teams.length);
        const seed = CS.newSeed();
        cls.pools = CS.assignTeamsToPools(cls.teams, poolCount, seed);
        cls.generation = cls.generation || {};
        cls.generation.seed = seed;
        saveCup(cup);
        renderClasses(cup);
      }
      else if (action === 'toggleLock') {
        const matchId = btn.dataset.matchId;
        const classId = btn.dataset.classId;
        const cls = cup.classes.find(c => c.id === classId);
        const match = cls?.matches.find(m => m.id === matchId);
        if (match) {
          match.locked = !match.locked;
          saveCup(cup);
          renderSchedule(cup);
        }
      }
    });


// Input / change changes (delegated)
function handleCupField(inp) {
  if (!inp) return;
  // Don't intercept score inputs
  if (inp.dataset.side === 'home' || inp.dataset.side === 'away') return;

  const cup = getCurrentCup();
  if (!cup) return;

  const field = inp.dataset.field;
  if (!field) return;

  // Day fields
  if (field === 'date' || field === 'startTime' || field === 'endTime') {
    const di = Number(inp.dataset.day);
    if (cup.days[di]) {
      cup.days[di][field] = inp.value;
      if (hasExistingSchedule(cup) && (field === 'startTime' || field === 'endTime')) {
        markScheduleStale(cup, 'Dagstider endret');
      }
      saveCup(cup);
    }
  }
  else if (field === 'breakStart' || field === 'breakEnd') {
    const di = Number(inp.dataset.day);
    const bi = Number(inp.dataset.break);
    if (cup.days[di]?.breaks[bi]) {
      if (field === 'breakStart') cup.days[di].breaks[bi].start = inp.value;
      else cup.days[di].breaks[bi].end = inp.value;
      saveCup(cup);
    }
  }
  // Pitch
  else if (field === 'pitchName') {
    const pi = Number(inp.dataset.pitch);
    if (cup.pitches[pi]) { cup.pitches[pi].name = inp.value; saveCup(cup); }
  }
  else if (field === 'pitchMaxFormat') {
    const pi = Number(inp.dataset.pitch);
    if (cup.pitches[pi]) { cup.pitches[pi].maxFormat = inp.value; saveCup(cup); }
  }
  // Class fields
  else if (field === 'className') {
    const ci = Number(inp.dataset.class);
    if (cup.classes[ci]) { cup.classes[ci].name = inp.value; saveCup(cup); }
  }
  else if (field === 'classGender') {
    const ci = Number(inp.dataset.class);
    if (cup.classes[ci]) { cup.classes[ci].gender = inp.value; saveCup(cup); }
  }
  else if (field === 'classAge') {
    const ci = Number(inp.dataset.class);
    const age = Math.max(6, Math.min(19, Number(inp.value) || 10));
    if (cup.classes[ci]) {
      cup.classes[ci].age = age;
      // Auto-update NFF defaults (can be overridden)
      const nff = CS.getNffDefaults(age);
      cup.classes[ci].playFormat = nff.playFormat;
      cup.classes[ci].matchMinutes = nff.matchMinutes;
      if ((cup.classes[ci].matches || []).length > 0) {
        markScheduleStale(cup, 'Aldersgruppe endret');
      }
      saveCup(cup);
      renderClasses(cup);
    }
  }
  else if (field === 'classPlayFormat') {
    const ci = Number(inp.dataset.class);
    if (cup.classes[ci]) { cup.classes[ci].playFormat = inp.value; saveCup(cup); }
  }
  else if (field === 'classMatchMin') {
    const ci = Number(inp.dataset.class);
    if (cup.classes[ci]) {
      cup.classes[ci].matchMinutes = Math.max(10, Number(inp.value) || 30);
      if ((cup.classes[ci].matches || []).length > 0) markScheduleStale(cup, 'Kamptid endret');
      saveCup(cup);
    }
  }
  else if (field === 'classBuffer') {
    const ci = Number(inp.dataset.class);
    // allow 0
    const v = inp.value === '' ? 0 : Number(inp.value);
    if (cup.classes[ci]) {
      cup.classes[ci].bufferMinutes = Math.max(0, Number.isFinite(v) ? v : 5);
      if ((cup.classes[ci].matches || []).length > 0) markScheduleStale(cup, 'Buffertid endret');
      saveCup(cup);
    }
  }
  else if (field === 'classMinRest') {
    const ci = Number(inp.dataset.class);
    // allow 0
    const v = inp.value === '' ? 0 : Number(inp.value);
    if (cup.classes[ci]) {
      cup.classes[ci].minRestMinutes = Math.max(0, Number.isFinite(v) ? v : 20);
      if ((cup.classes[ci].matches || []).length > 0) markScheduleStale(cup, 'Hviletid endret');
      saveCup(cup);
    }
  }
  else if (field === 'classMaxPerDay') {
    const ci = Number(inp.dataset.class);
    if (!cup.classes[ci]) return;
    const raw = String(inp.value || '').trim();
    cup.classes[ci].maxMatchesPerTeamPerDay = raw === '' ? null : Math.max(1, parseInt(raw, 10));
    saveCup(cup);
  }
  else if (field === 'allowedDay') {
    const ci = Number(inp.dataset.class);
    if (!cup.classes[ci]) return;
    const boxes = document.querySelectorAll(`input[type="checkbox"][data-class="${ci}"][data-field="allowedDay"]`);
    const checkedIds = [];
    boxes.forEach(cb => { if (cb.checked) checkedIds.push(cb.dataset.dayid); });
    // all or none => null
    if (checkedIds.length === 0 || checkedIds.length === (cup.days || []).length) {
      cup.classes[ci].allowedDayIds = null;
    } else {
      cup.classes[ci].allowedDayIds = checkedIds;
    }
    if ((cup.classes[ci].matches || []).length > 0) markScheduleStale(cup, 'Tillatte dager endret');
    saveCup(cup);
  }
  else if (field === 'usePooling') {
    const ci = Number(inp.dataset.class);
    if (!cup.classes[ci]) return;
    const cls = cup.classes[ci];
    // Warn if matches exist - toggling pooling invalidates all match-pool mappings
    if ((cls.matches || []).length > 0) {
      const action = inp.checked ? 'Slå på puljer' : 'Slå av puljer';
      const ok = confirm(`${action} gjør at eksisterende kampprogram for denne klassen blir ugyldig. Kamper og resultater slettes. Fortsette?`);
      if (!ok) { inp.checked = !inp.checked; return; }
      clearClassMatches(cls);
      markScheduleStale(cup, 'Puljeoppsett endret');
    }
    cls.usePooling = inp.checked;
    if (cls.usePooling && (!cls.pools || cls.pools.length === 0) && cls.teams.length >= 4) {
      const poolCount = CS.autoPoolCount(cls.teams.length);
      const seed = cls.generation?.seed || CS.newSeed();
      cls.pools = CS.assignTeamsToPools(cls.teams, poolCount, seed);
    }
    saveCup(cup);
    renderClasses(cup);
  }
  else if (field === 'poolCount') {
    const ci = Number(inp.dataset.class);
    if (!cup.classes[ci]) return;
    const cls = cup.classes[ci];
    // Warn if matches exist - changing pool count invalidates match-pool mappings
    if ((cls.matches || []).length > 0) {
      const ok = confirm('Endring av antall puljer gjør at eksisterende kampprogram for denne klassen blir ugyldig. Kamper og resultater slettes. Fortsette?');
      if (!ok) { inp.value = cls.pools?.length || 2; return; }
      clearClassMatches(cls);
      markScheduleStale(cup, 'Antall puljer endret');
    }
    const count = Math.max(2, parseInt(inp.value, 10) || 2);
    const seed = cls.generation?.seed || CS.newSeed();
    cls.pools = CS.assignTeamsToPools(cls.teams, count, seed);
    saveCup(cup);
    renderClasses(cup);
  }
  // Team name
  else if (field === 'teamName') {
    const ci = Number(inp.dataset.class);
    const ti = Number(inp.dataset.team);
    if (cup.classes[ci]?.teams[ti]) { cup.classes[ci].teams[ti].name = inp.value; saveCup(cup); }
  }
  // Team club
  else if (field === 'teamClub') {
    const ci = Number(inp.dataset.class);
    const ti = Number(inp.dataset.team);
    if (cup.classes[ci]?.teams[ti]) { cup.classes[ci].teams[ti].club = inp.value; saveCup(cup); }
  }
}

main.addEventListener('input', e => handleCupField(e.target));
main.addEventListener('change', e => handleCupField(e.target));


    // Score input (results step)
    main.addEventListener('input', e => {
      const inp = e.target;
      if (inp.dataset.side !== 'home' && inp.dataset.side !== 'away') return;
      const cup = getCurrentCup();
      if (!cup) return;

      const classId = inp.dataset.classId;
      const matchId = inp.dataset.matchId;
      const side = inp.dataset.side;
      const cls = cup.classes.find(c => c.id === classId);
      const match = cls?.matches.find(m => m.id === matchId);
      if (!match) return;

      const val = inp.value === '' ? null : Math.max(0, Math.floor(Number(inp.value)));
      match.score[side] = Number.isFinite(val) ? val : null;
      saveCup(cup);

      // Re-render standings only (not inputs, to preserve focus)
      const standingsEl = $('cupStandings');
      if (standingsEl) {
        const nffRules = CS.getNffDefaults(cls.age || 10);
        const standingsOpts = { noRanking: nffRules.noRanking };
        const hasPools = cls.usePooling && cls.pools && cls.pools.length > 0;
        if (hasPools) {
          standingsEl.innerHTML = cls.pools.map(pool => {
            const poolTeams = cls.teams.filter(t => pool.teamIds.includes(t.id));
            const poolMatches = cls.matches.filter(m => m.poolId === pool.id);
            const standings = CS.calcStandings(poolTeams, poolMatches);
            return renderStandingsTable(pool.name, standings, standingsOpts);
          }).join('');
        } else {
          const standings = CS.calcStandings(cls.teams, cls.matches);
          standingsEl.innerHTML = renderStandingsTable(cls.name, standings, standingsOpts);
        }
      }
    });

    // Walk-over select (results step)
    main.addEventListener('change', e => {
      const sel = e.target;
      if (!sel.classList.contains('cup-wo-select')) return;
      if (!sel.value) return;

      const cup = getCurrentCup();
      if (!cup) return;
      const cls = cup.classes.find(c => c.id === sel.dataset.classId);
      const match = cls?.matches.find(m => m.id === sel.dataset.matchId);
      if (!match) return;

      if (sel.value === 'home') {
        match.score.home = 3; match.score.away = 0;
      } else if (sel.value === 'away') {
        match.score.home = 0; match.score.away = 3;
      } else if (sel.value === 'clear') {
        match.score.home = null; match.score.away = null;
      }
      sel.value = ''; // Reset select
      saveCup(cup);
      renderResults(cup); // Full re-render to update inputs + standings
    });

    // Result class selector change
    const classSelect = $('cupResultClass');
    if (classSelect) {
      classSelect.addEventListener('change', () => {
        state.resultClassId = classSelect.value;
        const cup = getCurrentCup();
        if (cup) renderResults(cup);
      });
    }

    // Cup name/venue
    const nameInput = $('cupName');
    const venueInput = $('cupVenue');
    if (nameInput) nameInput.addEventListener('input', () => { const cup = getCurrentCup(); if (cup) { cup.title = nameInput.value; saveCup(cup); } });
    if (venueInput) venueInput.addEventListener('input', () => { const cup = getCurrentCup(); if (cup) { cup.venue = venueInput.value; saveCup(cup); } });

    // Add buttons
    $('cupAddDay')?.addEventListener('click', () => {
      const cup = getCurrentCup(); if (!cup) return;
      cup.days.push({ id: CS.uuid(), date: todayStr(), startTime: '09:00', endTime: '16:00', breaks: [] });
      if (hasExistingSchedule(cup)) markScheduleStale(cup, 'Dag lagt til');
      saveCup(cup); renderSetup(cup);
    });
    $('cupAddPitch')?.addEventListener('click', () => {
      const cup = getCurrentCup(); if (!cup) return;
      cup.pitches.push({ id: CS.uuid(), name: `Bane ${cup.pitches.length + 1}`, maxFormat: '11v11' });
      if (hasExistingSchedule(cup)) markScheduleStale(cup, 'Bane lagt til');
      saveCup(cup); renderSetup(cup);
    });
    $('cupAddClass')?.addEventListener('click', () => {
      const cup = getCurrentCup(); if (!cup) return;
      const nff = CS.getNffDefaults(10);
      cup.classes.push({
          id: CS.uuid(), name: '', gender: 'G', age: 10,
          playFormat: nff.playFormat, matchMinutes: nff.matchMinutes,
          bufferMinutes: 5, minRestMinutes: 25,
          allowedDayIds: null,
          maxMatchesPerTeamPerDay: null,
          usePooling: false,
          teams: [], matches: [],
          generation: { seed: CS.newSeed(), attempts: 0, bestScore: 0, warnings: [] },
        });
      saveCup(cup); renderSetup(cup);
    });

    // Check feasibility
    $('cupCheckBtn')?.addEventListener('click', () => {
      const cup = getCurrentCup();
      if (!cup) return;
      if (cup.classes.length === 0) { toast('Legg til minst én klasse', 'warning'); return; }

      const effectivePitches = getEffectivePitches(cup);
      const results = CS.calcFeasibility(cup.classes, effectivePitches, cup.days);
      const el = $('cupFeasibility');
      if (el) {
        el.innerHTML = results.map(r => {
          const ok = r.feasible;
          const hasWarn = ok && (r.restWarning || r.budgetWarning);
          const cssClass = !ok ? 'cup-feasibility-fail' : hasWarn ? 'cup-feasibility-warn' : 'cup-feasibility-ok';
          const icon = !ok ? 'times-circle' : hasWarn ? 'exclamation-triangle' : 'check-circle';
          const parts = [];
          if (ok && r.restWarning) parts.push('⚠ ' + esc(r.restWarning));
          if (ok && r.budgetWarning) parts.push('⚠ ' + esc(r.budgetWarning));
          const statusText = !ok ? esc(r.reason) : (parts.length ? parts.join('<br>') : 'Gjennomforbart!');
          return `<div class="cup-feasibility-item ${cssClass}">
            <i class="fas fa-${icon}"></i>
            <strong>${esc(r.className || 'Ukjent klasse')}</strong>: ${r.totalMatches} kamper, ${r.totalSlots} ledige slots.
            ${statusText}
          </div>`;
        }).join('');

        // Total summary with cross-class capacity warning
        const totalMatches = results.reduce((s, r) => s + (r.totalMatches || 0), 0);
        const totalTeams = cup.classes.reduce((s, c) => s + c.teams.length, 0);
        const allFeasible = results.every(r => r.feasible);

        // Estimate total available slot-minutes across all pitches/days
        let totalSlotMins = 0;
        for (const day of cup.days) {
          const dayStart = CS.parseTime(day.startTime);
          const dayEnd = CS.parseTime(day.endTime);
          let breakMins = 0;
          for (const b of (day.breaks || [])) breakMins += CS.parseTime(b.end) - CS.parseTime(b.start);
          totalSlotMins += (dayEnd - dayStart - breakMins) * effectivePitches.length;
        }
        // Average match length across classes
        const avgMatchMins = cup.classes.length > 0
          ? cup.classes.reduce((s, c) => s + c.matchMinutes + c.bufferMinutes, 0) / cup.classes.length
          : 30;
        const globalSlots = Math.floor(totalSlotMins / avgMatchMins);
        const overloaded = totalMatches > globalSlots;

        let summaryHtml = `<div class="cup-feasibility-item" style="margin-top:8px; border-top:1px solid rgba(0,0,0,0.08); padding-top:8px; font-weight:600;">
          <i class="fas fa-chart-bar"></i>
          Totalt: ${totalMatches} kamper, ${totalTeams} lag, ${cup.classes.length} klasser, ${effectivePitches.length} baner, ${cup.days.length} dag(er)
        </div>`;

        if (overloaded) {
          summaryHtml += `<div class="cup-feasibility-item cup-feasibility-warn" style="margin-top:4px;">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Advarsel:</strong> ${totalMatches} kamper totalt, men anslått ~${globalSlots} tilgjengelige slots på tvers av alle baner/dager. Noen kamper vil sannsynligvis ikke bli plassert.
          </div>`;
        } else if (allFeasible) {
          summaryHtml += `<div class="cup-feasibility-item cup-feasibility-ok" style="margin-top:4px;">
            <i class="fas fa-check-circle"></i>
            Kapasiteten ser tilstrekkelig ut på tvers av alle klasser.
          </div>`;
        }

        el.innerHTML += summaryHtml;
      }
    });

    // Generate / optimize / regenerate
    $('cupGenerateBtn')?.addEventListener('click', () => generateSchedule());
    $('cupOptimizeBtn')?.addEventListener('click', () => optimizeSchedule());
    $('cupRegenerateBtn')?.addEventListener('click', () => {
      const ok = confirm('Ny trekning lager nye kamper og sletter alle låser, resultater og manuelle endringer. Fortsette?');
      if (ok) generateSchedule(true);
    });

    // Schedule view toggle
    document.querySelectorAll('.cup-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cup-view-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.scheduleView = btn.dataset.view;
        const cup = getCurrentCup();
        if (cup) renderSchedule(cup);
      });
    });

    // Class filter in schedule view
    $('cupClassFilter')?.addEventListener('change', () => {
      state.scheduleClassFilter = $('cupClassFilter').value;
      const cup = getCurrentCup();
      if (cup) renderSchedule(cup);
    });

    // Print and export
    $('cupPrintBtn')?.addEventListener('click', () => window.print());
    $('cupExportCsvBtn')?.addEventListener('click', () => exportCsv());
    $('cupDeleteBtn')?.addEventListener('click', () => deleteCup());
  }

  // ============================================================
  // Generate schedule
  // ============================================================
  function generateSchedule(newSeed) {
    const cup = getCurrentCup();
    if (!cup) return;

    if (cup.classes.length === 0) { toast('Legg til minst én klasse', 'warning'); return; }

    const hasTeams = cup.classes.some(c => c.teams.length >= 2);
    if (!hasTeams) { toast('Minst én klasse trenger 2+ lag', 'warning'); return; }

    // Generate matches for each class (pool-aware)
    for (const cls of cup.classes) {
      if (cls.teams.length < 2) continue;
      const seed = newSeed ? CS.newSeed() : (cls.generation?.seed || CS.newSeed());
      if (cls.usePooling && cls.pools && cls.pools.length > 0) {
        const { matches } = CS.generatePoolMatches(cls, seed);
        cls.matches = matches;
      } else {
        const { matches } = CS.generateRoundRobin(cls.teams, seed);
        cls.matches = matches;
      }
      cls.generation = { seed, attempts: 0, bestScore: 0, warnings: [] };
    }

    // Schedule all classes together
    const globalSeed = newSeed ? CS.newSeed() : (cup.classes[0]?.generation?.seed || CS.newSeed());
    const numAttempts = Math.min(200, Math.max(50, cup.classes.reduce((sum, c) => sum + c.teams.length, 0) * 10));

    const effectivePitches = getEffectivePitches(cup);
    const result = CS.scheduleAllClasses(cup.classes, effectivePitches, cup.days, globalSeed, numAttempts);
    state.scheduleData = result;

    // Lagre global seed/attempts for reproduserbarhet ved feilsoking
    cup.generationGlobal = {
      seed: (result && typeof result.seed === 'number') ? result.seed : globalSeed,
      attempt: (result && typeof result.attempt === 'number') ? result.attempt : 0,
      attempts: numAttempts,
      mode: newSeed ? 'new-draw' : 'generate',
      updatedAt: new Date().toISOString(),
    };

    // Apply schedule back to matches
    if (result) {
      for (const cr of result.classResults) {
        const cls = cup.classes.find(c => c.id === cr.classId);
        if (!cls) continue;
        cls.generation.attempts = numAttempts;
        cls.generation.bestScore = cr.penalty;

        for (const entry of cr.schedule) {
          const match = cls.matches.find(m => m.id === entry.matchId);
          if (match) {
            match.pitchId = entry.pitchId;
            match.dayIndex = entry.dayIndex;
            match.start = entry.startTime;
            match.end = entry.endTime;
          }
        }
      }
    }

    assignMatchNumbers(cup);
    clearStaleFlag(cup);
    saveCup(cup);
    state.activeStep = 'schedule';
    renderSteps();
    renderSchedule(cup);

    const totalUnplaced = result?.totalUnplaced || 0;
    if (totalUnplaced > 0) {
      toast(`${totalUnplaced} kamp(er) kunne ikke plasseres. Sjekk baner/tider.`, 'warning');
    } else {
      toast('Kampprogram generert!', 'success');
    }
  }

  // ============================================================
  // PATCH 3: Optimize — re-run scheduler without regenerating matches
  // Preserves scores and locked matches
  // ============================================================
  function optimizeSchedule() {
    const cup = getCurrentCup();
    if (!cup) return;

    const hasMatches = cup.classes.some(c => (c.matches || []).length > 0);
    if (!hasMatches) { toast('Generer kampprogram først', 'warning'); return; }

    const hasScores = cup.classes.some(c =>
      (c.matches || []).some(m => m.score && (m.score.home !== null || m.score.away !== null))
    );
    if (hasScores) {
      const ok = confirm('Det finnes registrerte resultater. Optimalisering kan flytte kamper (unntatt låste). Fortsette?');
      if (!ok) return;
    }

    // Clear placement for non-locked matches (avoid stale slots)
    for (const cls of cup.classes) {
      for (const m of (cls.matches || [])) {
        if (!m.locked) {
          m.pitchId = null;
          m.dayIndex = null;
          m.start = null;
          m.end = null;
        }
      }
    }

    const globalSeed = CS.newSeed();
    const numAttempts = Math.min(200, Math.max(50, cup.classes.reduce((sum, c) => sum + c.teams.length, 0) * 10));
    const effectivePitches = getEffectivePitches(cup);
    const result = CS.scheduleAllClasses(cup.classes, effectivePitches, cup.days, globalSeed, numAttempts);
    state.scheduleData = result;

    // Lagre global seed/attempts for reproduserbarhet ved feilsoking
    cup.generationGlobal = {
      seed: (result && typeof result.seed === 'number') ? result.seed : globalSeed,
      attempt: (result && typeof result.attempt === 'number') ? result.attempt : 0,
      attempts: numAttempts,
      mode: 'optimize',
      updatedAt: new Date().toISOString(),
    };

    if (result) {
      for (const cr of result.classResults) {
        const cls = cup.classes.find(c => c.id === cr.classId);
        if (!cls) continue;
        cls.generation = cls.generation || {};
        cls.generation.attempts = numAttempts;
        cls.generation.bestScore = cr.penalty;

        for (const entry of cr.schedule) {
          const match = cls.matches.find(m => m.id === entry.matchId);
          if (match) {
            match.pitchId = entry.pitchId;
            match.dayIndex = entry.dayIndex;
            match.start = entry.startTime;
            match.end = entry.endTime;
          }
        }
      }
    }

    assignMatchNumbers(cup);
    clearStaleFlag(cup);
    saveCup(cup);
    state.activeStep = 'schedule';
    renderSteps();
    renderSchedule(cup);

    const totalUnplaced = result?.totalUnplaced || 0;
    if (totalUnplaced > 0) {
      toast(`${totalUnplaced} kamp(er) kunne ikke plasseres. Sjekk baner/tider.`, 'warning');
    } else {
      toast('Kampprogram optimalisert!', 'success');
    }
  }

  // ============================================================
  // Assign sequential match numbers (Kamp 1, 2, 3...) across all classes
  // Sorted by day, then time, then pitch for natural reading order
  // ============================================================
  function assignMatchNumbers(cup) {
    const allMatches = [];
    for (const cls of cup.classes) {
      for (const m of (cls.matches || [])) {
        allMatches.push({ match: m, classId: cls.id });
      }
    }
    // Sort: placed first (by day, time, pitch), then unplaced at end
    allMatches.sort((a, b) => {
      const am = a.match, bm = b.match;
      const aPlaced = am.dayIndex != null && am.start != null;
      const bPlaced = bm.dayIndex != null && bm.start != null;
      if (aPlaced && !bPlaced) return -1;
      if (!aPlaced && bPlaced) return 1;
      if (!aPlaced && !bPlaced) return 0;
      const dDay = (am.dayIndex || 0) - (bm.dayIndex || 0);
      if (dDay !== 0) return dDay;
      const dTime = (CS.parseTime(am.start) || 0) - (CS.parseTime(bm.start) || 0);
      if (dTime !== 0) return dTime;
      return (am.pitchId || '').localeCompare(bm.pitchId || '');
    });
    for (let i = 0; i < allMatches.length; i++) {
      allMatches[i].match.matchNumber = i + 1;
    }
  }

  // ============================================================
  // Export CSV
  // ============================================================
  function exportCsv() {
    const cup = getCurrentCup();
    if (!cup) return;
    if (!state.scheduleData) { toast('Generer kampprogram først', 'warning'); return; }

    const pitchMap = buildPitchMap(cup);
    const rows = [['Kamp', 'Klasse', 'Pulje', 'Dag', 'Dato', 'Tid', 'Bane', 'Hjemme', 'Borte', 'Resultat']];

    for (const cls of cup.classes) {
      const sorted = [...(cls.matches || [])].sort((a, b) => {
        const da = a.dayIndex ?? 999, db = b.dayIndex ?? 999;
        if (da !== db) return da - db;
        const ta = a.start ? CS.parseTime(a.start) : 9999;
        const tb = b.start ? CS.parseTime(b.start) : 9999;
        return ta - tb;
      });
      for (const m of sorted) {
        const home = cls.teams.find(t => t.id === m.homeId);
        const away = cls.teams.find(t => t.id === m.awayId);
        const pool = (m.poolId && cls.pools) ? cls.pools.find(p => p.id === m.poolId) : null;
        const day = cup.days[m.dayIndex];
        const pitch = pitchMap[m.pitchId];
        const score = (m.score?.home !== null && m.score?.away !== null)
          ? `${m.score.home}-${m.score.away}` : '';
        rows.push([
          m.matchNumber || '',
          cls.name || '',
          pool?.name || '',
          m.dayIndex !== null && m.dayIndex !== undefined ? `Dag ${m.dayIndex + 1}` : '',
          day?.date || '',
          m.start ? CS.formatTime(CS.parseTime(m.start)) : '',
          pitch?.name || '',
          home?.name || '',
          away?.name || '',
          score,
        ]);
      }
    }

    const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const BOM = '\uFEFF'; // Excel needs BOM for UTF-8
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cup.title || 'cup'}_kampprogram.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV lastet ned', 'success');
  }

  // ============================================================
  // Delete cup
  // ============================================================
  function deleteCup() {
    const cup = getCurrentCup();
    if (!cup) return;
    const title = cup.title || 'denne cupen';
    const ok = confirm(`Er du sikker på at du vil slette "${title}"? Alt innhold (klasser, lag, kampprogram, resultater) slettes permanent.`);
    if (!ok) return;

    const store = loadStore();
    store.cups = store.cups.filter(c => c.id !== cup.id);
    saveStore(store);
    state.currentCupId = null;
    state.scheduleData = null;
    state.activeStep = 'setup';

    const newCup = ensureCup();
    renderSteps();
    renderSetup(newCup);
    toast('Cup slettet', 'success');
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    const cup = ensureCup();
    restoreScheduleStateFromCup(cup);
    setupStepNav();
    setupEvents();
    renderSteps();
    renderSetup(cup);

    // Render the active step (may be schedule if restored)
    if (state.activeStep === 'schedule') {
      renderSchedule(cup);
    } else if (state.activeStep === 'results') {
      renderResults(cup);
    }
    console.log('[cup.js] Initialized', cup.id);
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
