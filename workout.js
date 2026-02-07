// Barnefotballtrener - workout.js
// ================================================
// Bygg din treningsøkt: øvelse-for-øvelse, (valgfritt) oppmøte/spillere, gruppeinndeling og eksport.
// Designmål: integreres som en ny tab uten å påvirke Stripe/auth/kampdag/konkurranser.
//
// Viktig integrasjon:
// - Henter spillere fra window.players (publisert av core.js) + lytter på 'players:updated'.
// - Bruker delte algoritmer via window.Grouping (grouping.js), slik at Treningsgrupper/Laginndeling og denne modulen bruker samme logikk.

(function () {
  'use strict';

  console.log('[workout.js] loaded');

  // -------------------------
  // Utils
  // -------------------------
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function isUseSkillEnabled() {
    const t = document.getElementById('skillToggle');
    return !!(t && t.checked);
  }


  function uuid(prefix = 'wo_') {
    return prefix + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  // -------------------------
  // Exercise catalog
  // -------------------------
  // "Drikkepause" skal ligge øverst (krav).
  const EXERCISES = [
    { key: 'drink', label: 'Drikkepause', defaultMin: 2 },
    { key: 'tag', label: 'Lek/Sisten (oppvarming)', defaultMin: 8 },
    { key: 'warm_ball', label: 'Oppvarming med ball', defaultMin: 10 },
    { key: 'warm_no_ball', label: 'Oppvarming uten ball', defaultMin: 8 },
    { key: 'driving', label: 'Føring av ball', defaultMin: 10 },
    { key: 'pass_pair', label: 'Pasning parvis', defaultMin: 10 },
    { key: 'pass_turn', label: 'Pasning med vending', defaultMin: 10 },
    { key: 'pass_square', label: 'Pasningsfirkant', defaultMin: 12 },
    { key: 'long_pass', label: 'Langpasninger', defaultMin: 10 },
    { key: 'dribble', label: 'Dribling', defaultMin: 10 },
    { key: 'shot', label: 'Skudd', defaultMin: 12 },
    { key: 'cross_finish', label: 'Innlegg/avslutning', defaultMin: 12 },
    { key: 'juggle', label: 'Triksing med ball', defaultMin: 8 },
    { key: '1v1', label: '1 mot 1', defaultMin: 10 },
    { key: '2v1', label: '2 mot 1', defaultMin: 10 },
    { key: '3v2', label: '3 mot 2', defaultMin: 12 },
    { key: 'competitions', label: 'Konkurranser', defaultMin: 10 },
    { key: 'ssg', label: 'Smålagsspill', defaultMin: 18 },
    { key: 'square_german', label: 'Firkant/Tysker', defaultMin: 12 },
    { key: 'overload', label: 'Overtallsspill', defaultMin: 12 },
    { key: 'possession_joker', label: 'Possession med joker', defaultMin: 12 },
    { key: 'possession_even', label: 'Possession likt antall', defaultMin: 12 },
    { key: 'game_activity', label: 'Spillaktivitet', defaultMin: 18 },
    { key: 'keeper', label: 'Keepertrening', defaultMin: 12 },
    // "Overrask meg" er en trigger, ikke en faktisk øvelse
    { key: 'surprise', label: 'Overrask meg', defaultMin: 10, isSurprise: true },
    // Manuell
    { key: 'custom', label: 'Skriv inn selv', defaultMin: 10, isCustom: true }
  ];

  const EX_BY_KEY = new Map(EXERCISES.map(x => [x.key, x]));

  function pickRandomExerciseKey() {
    const candidates = EXERCISES.filter(x => !x.isSurprise && !x.isCustom);
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx]?.key || 'ssg';
  }

  // -------------------------
  // Storage (tåler Tracking Prevention / private mode)
  // -------------------------
  const _mem = new Map();

  function safeGet(key) {
    try { return localStorage.getItem(key); }
    catch { return _mem.get(key) ?? null; }
  }
  let _storageWarned = false;
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch {
      _mem.set(key, value);
      if (!_storageWarned) {
        _storageWarned = true;
        if (typeof window.showNotification === 'function') {
          window.showNotification('Nettleseren blokkerer lagring. Data lagres kun midlertidig. Eksporter øktfil/PDF for sikker lagring.', 'error');
        }
      }
    }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); }
    catch { _mem.delete(key); }
  }

  function getUserKeyPrefix() {
    try {
      const uid =
        (window.authService && typeof window.authService.getUserId === 'function'
          ? (window.authService.getUserId() || 'anon')
          : 'anon');
      return `bft:${uid}`;
    } catch {
      return 'bft:anon';
    }
  }
  function k(suffix) { return `${getUserKeyPrefix()}:${suffix}`; }

  // Lazy-evaluated keys: uid may not be available at IIFE-init (auth is async).
  // Computing per-call ensures correct key even after auth completes.
  function STORE_KEY()    { return k('workout_templates_v1'); }
  function WORKOUTS_KEY() { return k('workout_sessions_v1'); }
  function DRAFT_KEY()    { return k('workout_draft_v1'); }
  const SCHEMA_VERSION = 1;

  function defaultStore() {
    return { schemaVersion: SCHEMA_VERSION, templates: [] };
  }

  function loadStore() {
    const raw = safeGet(STORE_KEY());
    if (!raw) return { ok: true, data: defaultStore(), corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad');
      if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error('schema');
      if (!Array.isArray(parsed.templates)) parsed.templates = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: defaultStore(), corrupt: true, error: e };
    }
  }

  function saveStore(store) {
    safeSet(STORE_KEY(), JSON.stringify(store));
  }

  // Separate store for saved workouts (økt-historikk) to avoid schema migration for templates
  const WORKOUTS_SCHEMA_VERSION = 1;

  function defaultWorkoutsStore() {
    return { schemaVersion: WORKOUTS_SCHEMA_VERSION, workouts: [] };
  }

  function loadWorkoutsStore() {
    const raw = safeGet(WORKOUTS_KEY());
    if (!raw) return { ok: true, data: defaultWorkoutsStore(), corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad');
      if (parsed.schemaVersion !== WORKOUTS_SCHEMA_VERSION) throw new Error('schema');
      if (!Array.isArray(parsed.workouts)) parsed.workouts = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: defaultWorkoutsStore(), corrupt: true, error: e };
    }
  }

  function saveWorkoutsStore(store) {
    safeSet(WORKOUTS_KEY(), JSON.stringify(store));
  }

  function loadDraft() {
    const raw = safeGet(DRAFT_KEY());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveDraft(draft) {
    try { safeSet(DRAFT_KEY(), JSON.stringify(draft)); } catch {}
  }

  // -------------------------
  // Players (from core.js)
  // -------------------------
  function getPlayersSnapshot() {
    const list = Array.isArray(window.players) ? window.players : [];
    // kun aktive spillere
    return list.filter(p => p && p.active !== false).map(p => ({
      id: p.id,
      name: p.name,
      skill: Number(p.skill) || 0,
      goalie: !!p.goalie,
      active: p.active !== false
    }));
  }

  function playerMap(players) {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }

  // -------------------------
  // Workout state
  // -------------------------
  const state = {
    bound: false,
    usePlayers: false,
    selected: new Set(), // oppmøte
    // parallel picks: blockId -> Set(playerId) for track B
    parallelPickB: new Map(),
    // groups cache: key = `${blockId}:${track}` -> groups (array of arrays of player objects)
    groupsCache: new Map(),
    blocks: []
  };

  function makeDefaultExercise() {
    return {
      exerciseKey: 'tag',
      customName: '',
      minutes: 10,
      groupCount: 2,
      groupMode: 'even', // even | diff | none
      comment: ''
    };
  }

  function makeBlock(kind = 'single') {
    const id = uuid('b_');
    if (kind === 'parallel') {
      return {
        id,
        kind: 'parallel',
        a: makeDefaultExercise(),
        b: { ...makeDefaultExercise(), exerciseKey: 'keeper', minutes: 12 },
        // UI-only: whether player picker panel is open
        _showPickB: false
      };
    }
    return { id, kind: 'single', a: makeDefaultExercise() };
  }

  // -------------------------
  // Rendering helpers
  // -------------------------
  function displayName(ex) {
    if (!ex) return '';
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    if (ex.exerciseKey === 'custom') return String(ex.customName || '').trim() || 'Egendefinert øvelse';
    if (meta && !meta.isSurprise) return meta.label;
    if (ex.exerciseKey === 'surprise') return 'Overrask meg';
    return 'Øvelse';
  }

  function totalMinutes() {
    let sum = 0;
    for (const b of state.blocks) {
      if (b.kind === 'parallel') {
        const a = clampInt(b.a?.minutes, 0, 300, 0);
        const bb = clampInt(b.b?.minutes, 0, 300, 0);
        sum += Math.max(a, bb); // parallelt: teller lengste
      } else {
        sum += clampInt(b.a?.minutes, 0, 300, 0);
      }
    }
    return sum;
  }

  function updateTotalUI() {
    const el = $('woTotal');
    if (el) el.textContent = `${totalMinutes()} min`;
  }

  function renderPlayersPanel() {
    const panel = $('woPlayersPanel');
    const container = $('woPlayerSelection');
    const countEl = $('woPlayerCount');
    if (!panel || !container || !countEl) return;

    if (!state.usePlayers) {
      panel.style.display = 'none';
      countEl.textContent = '0';
      container.innerHTML = '';
      return;
    }

    panel.style.display = 'block';

    const players = getPlayersSnapshot().slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
    // fjern valg som ikke eksisterer lenger
    const validIds = new Set(players.map(p => p.id));
    state.selected = new Set(Array.from(state.selected).filter(id => validIds.has(id)));

    container.innerHTML = players.map(p => {
      const checked = state.selected.has(p.id) ? 'checked' : '';
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
        if (!id) return;
        if (cb.checked) state.selected.add(id);
        else state.selected.delete(id);
        if (countEl) countEl.textContent = String(state.selected.size);

        // grupper blir fort stale når oppmøte endres
        state.groupsCache.clear();
        renderBlocks(); // oppdater visning + counts
      });
    });

    countEl.textContent = String(state.selected.size);
  }

  function optionHtml(selectedKey) {
    return EXERCISES.map(x => {
      const sel = x.key === selectedKey ? 'selected' : '';
      return `<option value="${escapeHtml(x.key)}" ${sel}>${escapeHtml(x.label)}</option>`;
    }).join('');
  }

  function renderExerciseEditor(blockId, track, ex) {
    const idp = `wo_${blockId}_${track}`;
    const showCustom = ex.exerciseKey === 'custom';
    const mode = ex.groupMode || 'even';
    const groupCount = clampInt(ex.groupCount, 1, 6, 2);

    return `
      <div class="wo-subcard">
        <div class="wo-subheader">
          <div class="wo-subtitle">${track === 'a' ? 'Øvelse' : 'Parallell øvelse'}</div>
        </div>

        <div class="wo-row">
          <div class="wo-field">
            <label class="wo-label">Velg øvelse</label>
            <select id="${idp}_sel" class="input wo-input">
              ${optionHtml(ex.exerciseKey)}
            </select>
          </div>

          <div class="wo-field ${showCustom ? '' : 'wo-hidden'}" id="${idp}_customWrap">
            <label class="wo-label">Navn (manuelt)</label>
            <input id="${idp}_custom" class="input wo-input" type="text" value="${escapeHtml(ex.customName || '')}" placeholder="Skriv inn navn på øvelse">
          </div>

          <div class="wo-field wo-minutes">
            <label class="wo-label">Minutter</label>
            <input id="${idp}_min" class="input wo-input" type="number" min="0" max="300" value="${escapeHtml(String(clampInt(ex.minutes, 0, 300, 10)))}">
          </div>
        </div>

        <div class="wo-row">
          <div class="wo-field wo-groups-settings">
            <label class="wo-label">Grupper</label>
            <div class="wo-inline">
              <input id="${idp}_groups" class="input wo-input" type="number" min="1" max="6" value="${escapeHtml(String(groupCount))}" style="max-width:90px;">
              <select id="${idp}_mode" class="input wo-input">
                <option value="none" ${mode === 'none' ? 'selected' : ''}>Ingen inndeling</option>
                <option value="even" ${mode === 'even' ? 'selected' : ''}>Jevne grupper</option>
                <option value="diff" ${mode === 'diff' ? 'selected' : ''}>Etter nivå (beste sammen)</option>
              </select>
            </div>
            <div class="small-text" style="opacity:0.85; margin-top:6px;">
              ${track === 'b' ? 'Parallelt: grupper lages på deltakere til denne øvelsen.' : ''}
              ${track === 'a' ? '' : ''}
            </div>
          </div>

          <div class="wo-field wo-group-actions">
            <label class="wo-label">&nbsp;</label>
            <div class="wo-inline" style="justify-content:flex-end;">
              <button id="${idp}_make" class="btn-secondary" type="button"><i class="fas fa-users"></i> Lag grupper</button>
              <button id="${idp}_refresh" class="btn-secondary" type="button"><i class="fas fa-rotate"></i> Refresh</button>
            </div>
          </div>
        </div>

        <div class="wo-row">
          <div class="wo-field">
            <label class="wo-label">Kommentar</label>
            <textarea id="${idp}_comment" class="input wo-input" rows="2" placeholder="Skriv detaljer til øvelsen...">${escapeHtml(ex.comment || '')}</textarea>
          </div>
        </div>

        <div id="${idp}_groupsOut" class="wo-groupsout"></div>
      </div>
    `;
  }

  function renderParallelPicker(block) {
    const bid = block.id;
    const open = !!block._showPickB;
    const players = getPlayersSnapshot().slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'nb'));
    const selectedIds = new Set(state.selected);
    const eligible = players.filter(p => selectedIds.has(p.id));

    const setB = state.parallelPickB.get(bid) || new Set();
    // hold kun valide
    const valid = new Set(eligible.map(p => p.id));
    const cleaned = new Set(Array.from(setB).filter(id => valid.has(id)));
    state.parallelPickB.set(bid, cleaned);

    const countB = cleaned.size;
    const countAll = eligible.length;
    const countA = Math.max(0, countAll - countB);

    return `
      <div class="wo-parallel-pick">
        <div class="wo-parallel-pick-head">
          <div>
            <div style="font-weight:800;">Fordel spillere mellom parallelle øvelser</div>
            <div class="small-text" style="opacity:0.85;">
              Øvelse A: <strong>${countA}</strong> • Øvelse B: <strong>${countB}</strong>
              ${countAll === 0 ? ' • (Velg oppmøte først)' : ''}
            </div>
          </div>
          <button id="wo_${bid}_pickToggle" class="btn-small" type="button">
            ${open ? 'Skjul' : 'Velg deltakere til øvelse B'}
          </button>
        </div>

        <div id="wo_${bid}_pickPanel" class="${open ? '' : 'wo-hidden'}">
          <div class="wo-inline" style="margin:8px 0; gap:8px; flex-wrap:wrap;">
            <button id="wo_${bid}_pickGoalies" class="btn-small" type="button">Velg alle keepere</button>
            <button id="wo_${bid}_pickNone" class="btn-small" type="button">Fjern alle</button>
          </div>

          <div class="wo-pick-list">
            ${eligible.map(p => {
              const checked = cleaned.has(p.id) ? 'checked' : '';
              return `
                <label class="player-checkbox wo-pick-item">
                  <input type="checkbox" data-pickb="${escapeHtml(p.id)}" ${checked}>
                  <span class="checkmark"></span>
                  <div class="player-details">
                    <div class="player-name">${escapeHtml(p.name)}</div>
                    <div class="player-meta">${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}</div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>

          <div class="small-text" style="opacity:0.85; margin-top:6px;">
            Tips: Velg keepere til øvelse B (keepertrening). Resten går automatisk til øvelse A.
          </div>
        </div>
      </div>
    `;
  }

  function renderBlocks() {
    const container = $('woBlocks');
    if (!container) return;

    container.innerHTML = state.blocks.map((b, idx) => {
      const isParallel = b.kind === 'parallel';
      const header = `
        <div class="wo-block-header">
          <div class="wo-block-title">Del ${idx + 1}${isParallel ? ' • Parallelt' : ''}</div>
          <div class="wo-block-actions">
            <button class="btn-small" type="button" id="wo_${b.id}_up" title="Flytt opp">↑</button>
            <button class="btn-small" type="button" id="wo_${b.id}_down" title="Flytt ned">↓</button>
            ${isParallel ? '' : `<button class="btn-small" type="button" id="wo_${b.id}_addParallel" title="Legg til parallell øvelse">+ Parallel</button>`}
            <button class="btn-small btn-danger" type="button" id="wo_${b.id}_del" title="Slett">Slett</button>
          </div>
        </div>
      `;

      const help = isParallel
        ? `<div class="small-text" style="opacity:0.85; margin-top:6px;">Parallelt: total tid teller lengste varighet av øvelse A/B.</div>`
        : '';

      const body = `
        ${renderExerciseEditor(b.id, 'a', b.a)}
        ${isParallel ? renderParallelPicker(b) + renderExerciseEditor(b.id, 'b', b.b) : ''}
      `;

      return `
        <div class="wo-block">
          ${header}
          ${help}
          <div class="wo-block-body">
            ${body}
          </div>
        </div>
      `;
    }).join('');

    // bind per-block actions
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];

      const up = $(`wo_${b.id}_up`);
      const down = $(`wo_${b.id}_down`);
      const del = $(`wo_${b.id}_del`);
      const addPar = $(`wo_${b.id}_addParallel`);

      if (up) up.addEventListener('click', () => moveBlock(b.id, -1));
      if (down) down.addEventListener('click', () => moveBlock(b.id, +1));
      if (del) del.addEventListener('click', () => deleteBlock(b.id));
      if (addPar) addPar.addEventListener('click', () => convertToParallel(b.id));

      bindExerciseEditor(b, 'a');
      if (b.kind === 'parallel') {
        bindParallelPicker(b);
        bindExerciseEditor(b, 'b');
      }
    }

    updateTotalUI();
    persistDraft();
  }

  function bindExerciseEditor(block, track) {
    const bid = block.id;
    const ex = track === 'a' ? block.a : block.b;
    const idp = `wo_${bid}_${track}`;

    const sel = $(`${idp}_sel`);
    const customWrap = $(`${idp}_customWrap`);
    const custom = $(`${idp}_custom`);
    const min = $(`${idp}_min`);
    const groups = $(`${idp}_groups`);
    const mode = $(`${idp}_mode`);
    const comment = $(`${idp}_comment`);
    const makeBtn = $(`${idp}_make`);
    const refreshBtn = $(`${idp}_refresh`);

    if (sel) {
      sel.addEventListener('change', () => {
        const v = String(sel.value || 'tag');
        if (v === 'surprise') {
          const chosen = pickRandomExerciseKey();
          sel.value = chosen;
          ex.exerciseKey = chosen;
          const meta = EX_BY_KEY.get(chosen);
          if (meta && Number(ex.minutes) <= 0) ex.minutes = meta.defaultMin ?? 10;
          if (customWrap) customWrap.classList.add('wo-hidden');
          ex.customName = '';
        } else {
          ex.exerciseKey = v;
          const meta = EX_BY_KEY.get(v);
          // Sett default minutter kun hvis bruker ikke har skrevet noe "tungt" (0 eller tom)
          if (meta && Number(ex.minutes) <= 0) ex.minutes = meta.defaultMin ?? 10;

          if (v === 'custom') {
            if (customWrap) customWrap.classList.remove('wo-hidden');
          } else {
            if (customWrap) customWrap.classList.add('wo-hidden');
            ex.customName = '';
          }
        }

        // grupper stale
        state.groupsCache.delete(`${bid}:${track}`);
        renderBlocks();
      });
    }

    if (custom) {
      custom.addEventListener('input', () => {
        ex.customName = String(custom.value || '');
        persistDraft();
      });
    }

    if (min) {
      min.addEventListener('input', () => {
        ex.minutes = clampInt(min.value, 0, 300, 0);
        updateTotalUI();
        persistDraft();
      });
    }

    if (groups) {
      groups.addEventListener('input', () => {
        ex.groupCount = clampInt(groups.value, 1, 6, 2);
        // grupper stale
        state.groupsCache.delete(`${bid}:${track}`);
        persistDraft();
      });
    }

    if (mode) {
      mode.addEventListener('change', () => {
        ex.groupMode = String(mode.value || 'even');
        state.groupsCache.delete(`${bid}:${track}`);
        persistDraft();
      });
    }

    if (comment) {
      comment.addEventListener('input', () => {
        ex.comment = String(comment.value || '');
        persistDraft();
      });
    }

    if (makeBtn) makeBtn.addEventListener('click', () => {
      computeGroupsFor(block, track, false);
    });
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      computeGroupsFor(block, track, true);
    });

    // re-render cached groups if exists
    renderGroupsOut(bid, track);
  }

  function bindParallelPicker(block) {
    const bid = block.id;
    const toggle = $(`wo_${bid}_pickToggle`);
    const panel = $(`wo_${bid}_pickPanel`);
    const goaliesBtn = $(`wo_${bid}_pickGoalies`);
    const noneBtn = $(`wo_${bid}_pickNone`);

    if (toggle) toggle.addEventListener('click', () => {
      block._showPickB = !block._showPickB;
      renderBlocks();
    });

    const players = getPlayersSnapshot();
    const map = playerMap(players);

    if (goaliesBtn) goaliesBtn.addEventListener('click', () => {
      const set = new Set(state.parallelPickB.get(bid) || []);
      for (const id of state.selected) {
        const p = map.get(id);
        if (p && p.goalie) set.add(id);
      }
      state.parallelPickB.set(bid, set);
      state.groupsCache.delete(`${bid}:a`);
      state.groupsCache.delete(`${bid}:b`);
      renderBlocks();
    });

    if (noneBtn) noneBtn.addEventListener('click', () => {
      state.parallelPickB.set(bid, new Set());
      state.groupsCache.delete(`${bid}:a`);
      state.groupsCache.delete(`${bid}:b`);
      renderBlocks();
    });

    if (panel) {
      panel.querySelectorAll('input[type="checkbox"][data-pickb]').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.getAttribute('data-pickb');
          const set = new Set(state.parallelPickB.get(bid) || []);
          if (cb.checked) set.add(id);
          else set.delete(id);
          state.parallelPickB.set(bid, set);
          // grupper stale
          state.groupsCache.delete(`${bid}:a`);
          state.groupsCache.delete(`${bid}:b`);
          renderBlocks();
        });
      });
    }
  }

  // -------------------------
  // Group computation (reuses core.js algorithms)
  // -------------------------
  function getParticipantsFor(block, track) {
    if (!state.usePlayers) return [];
    const players = getPlayersSnapshot();
    const map = playerMap(players);

    const selectedPlayers = Array.from(state.selected).map(id => map.get(id)).filter(Boolean);

    if (block.kind !== 'parallel') return selectedPlayers;

    // parallel:
    const setB = state.parallelPickB.get(block.id) || new Set();
    if (track === 'b') {
      return selectedPlayers.filter(p => setB.has(p.id));
    }
    // track a = remaining
    return selectedPlayers.filter(p => !setB.has(p.id));
  }

  function computeGroupsFor(block, track, isRefresh) {
    const bid = block.id;
    const ex = track === 'a' ? block.a : block.b;
    const outKey = `${bid}:${track}`;

    const groupsOut = $(`wo_${bid}_${track}_groupsOut`);
    if (!groupsOut) return;

    // ikke valgt spillere => ingen grupper (men ikke error)
    if (!state.usePlayers) {
      groupsOut.innerHTML = `<div class="small-text" style="opacity:0.85;">Slå på "Velg spillere til økta" for gruppeinndeling.</div>`;
      return;
    }

    const participants = getParticipantsFor(block, track);
    if (participants.length < 1) {
      groupsOut.innerHTML = `<div class="small-text" style="opacity:0.85;">Ingen deltakere valgt for denne øvelsen.</div>`;
      return;
    }

    const groupMode = String(ex.groupMode || 'even');
    const groupCount = clampInt(ex.groupCount, 1, 6, 2);

    // "none" -> bare vis liste
    if (groupMode === 'none' || groupCount <= 1) {
      state.groupsCache.set(outKey, [participants]);
      renderGroupsOut(bid, track);
      return;
    }

    // Cache: "Lag grupper" gjenbruker eksisterende, "Refresh" tvinger ny inndeling
    if (!isRefresh && state.groupsCache.has(outKey)) {
      renderGroupsOut(bid, track);
      return;
    }

    const alg = window.Grouping;
    if (!alg) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Mangler Grouping (grouping.js). Kan ikke lage grupper.', 'error');
      }
      return;
    }

    const useSkill = isUseSkillEnabled();
    if (groupMode === 'diff' && !useSkill) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Slå på "Bruk ferdighetsnivå" for "Etter nivå"', 'error');
      }
      return;
    }

    let groups = null;
    if (groupMode === 'diff') {
      groups = alg.makeDifferentiatedGroups(participants, groupCount, useSkill);
    } else {
      groups = alg.makeBalancedGroups(participants, groupCount, useSkill);
    }

    if (!groups) {
      if (typeof window.showNotification === 'function') {
        window.showNotification('Kunne ikke lage grupper', 'error');
      }
      return;
    }

    state.groupsCache.set(outKey, groups);
    renderGroupsOut(bid, track);
  }

  function renderGroupsOut(blockId, track) {
    const outKey = `${blockId}:${track}`;
    const groupsOut = $(`wo_${blockId}_${track}_groupsOut`);
    if (!groupsOut) return;

    const cached = state.groupsCache.get(outKey);
    if (!cached) {
      groupsOut.innerHTML = '';
      return;
    }

    const groups = Array.isArray(cached) ? cached : [];
    groupsOut.innerHTML = `
      <div class="wo-groups-wrap">
        ${groups.map((g, idx) => `
          <div class="results-card">
            <h3>${groups.length === 1 ? 'Deltakere' : `Gruppe ${idx + 1}`} <span class="small-text" style="opacity:0.8;">(${g.length})</span></h3>
            <div class="results-list">
              ${g.map(p => `<div class="result-item">${escapeHtml(p.name)} ${p.goalie ? ' 🧤' : ''}</div>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // -------------------------
  // Block operations
  // -------------------------
  function addBlock(kind = 'single') {
    state.blocks.push(makeBlock(kind));
    renderBlocks();
  }

  function deleteBlock(blockId) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const ok = window.confirm('Slette denne delen av økta?');
    if (!ok) return;

    const b = state.blocks[idx];
    // rydde cache
    state.groupsCache.delete(`${b.id}:a`);
    state.groupsCache.delete(`${b.id}:b`);
    state.parallelPickB.delete(b.id);

    state.blocks.splice(idx, 1);
    renderBlocks();
  }

  function moveBlock(blockId, delta) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;
    const next = idx + delta;
    if (next < 0 || next >= state.blocks.length) return;
    const [b] = state.blocks.splice(idx, 1);
    state.blocks.splice(next, 0, b);
    renderBlocks();
  }

  function convertToParallel(blockId) {
    const idx = state.blocks.findIndex(b => b.id === blockId);
    if (idx === -1) return;

    const b = state.blocks[idx];
    if (b.kind === 'parallel') return;

    const ok = window.confirm('Legge til en parallell øvelse i samme tidsblokk? (Total tid teller lengste varighet)');
    if (!ok) return;

    const parallel = makeBlock('parallel');
    // behold eksisterende A-øvelse
    parallel.id = b.id;
    parallel.a = b.a;
    // default B = keeper
    parallel.b.exerciseKey = 'keeper';
    parallel.b.minutes = 12;
    state.blocks[idx] = parallel;

    renderBlocks();
  }

  // -------------------------
  // Templates
  // -------------------------
  function serializeTemplateFromState() {
    const title = String($('woTitle')?.value || '').trim();
    const date = String($('woDate')?.value || '').trim();

    const blocks = state.blocks.map(b => {
      if (b.kind === 'parallel') {
        return {
          id: uuid('tplb_'), // new ids to avoid collision when loading
          kind: 'parallel',
          a: { ...b.a },
          b: { ...b.b }
        };
      }
      return { id: uuid('tplb_'), kind: 'single', a: { ...b.a } };
    });

    return {
      id: uuid('tpl_'),
      title: title || (date ? `Trening ${date}` : 'Ny treningsøkt'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blocks
    };
  }

  function applyTemplateToState(tpl) {
    if (!tpl || !Array.isArray(tpl.blocks)) return;

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (titleEl) titleEl.value = String(tpl.title || '');
    // dato settes ikke automatisk ved last inn (ofte brukt som mal) – men vi kan beholde dagens verdi
    // (ikke overskriv user input)

    state.blocks = tpl.blocks.map(b => {
      if (b.kind === 'parallel') {
        return {
          id: uuid('b_'),
          kind: 'parallel',
          a: { ...makeDefaultExercise(), ...b.a },
          b: { ...makeDefaultExercise(), ...b.b },
          _showPickB: false
        };
      }
      return { id: uuid('b_'), kind: 'single', a: { ...makeDefaultExercise(), ...b.a } };
    });

    state.groupsCache.clear();
    state.parallelPickB.clear();
    renderBlocks();
  }

  function renderTemplates() {
    const wrap = $('woTemplates');
    if (!wrap) return;

    const storeRes = loadStore();
    const store = storeRes.data;
    const list = store.templates.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (storeRes.corrupt && typeof window.showNotification === 'function') {
      window.showNotification('⚠️ Lagring av maler var korrupt – startet med tom liste', 'error');
    }

    if (!list.length) {
      wrap.innerHTML = `<div class="small-text" style="opacity:0.85;">Ingen maler lagret ennå.</div>`;
      return;
    }

    wrap.innerHTML = list.map(t => {
      const dt = new Date(t.updatedAt || t.createdAt || Date.now());
      const when = dt.toLocaleString('nb-NO', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:800;">${escapeHtml(t.title || 'Uten navn')}</div>
            <div class="small-text" style="opacity:0.85;">Sist endret: ${escapeHtml(when)}</div>
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(t.id)}">Last inn</button>
            <button class="btn-small" type="button" data-wo-rename="${escapeHtml(t.id)}">Gi nytt navn</button>
            <button class="btn-small btn-danger" type="button" data-wo-del="${escapeHtml(t.id)}">Slett</button>
          </div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const s = loadStore().data;
        const tpl = s.templates.find(x => x.id === id);
        if (!tpl) return;
        applyTemplateToState(tpl);
        if (typeof window.showNotification === 'function') window.showNotification('Mal lastet inn', 'success');
      });
    });

    wrap.querySelectorAll('button[data-wo-rename]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-rename');
        const res = loadStore();
        const s = res.data;
        const tpl = s.templates.find(x => x.id === id);
        if (!tpl) return;
        const name = window.prompt('Nytt navn på malen:', tpl.title || '');
        if (name === null) return;
        const v = String(name).trim();
        if (!v) return;
        tpl.title = v;
        tpl.updatedAt = Date.now();
        saveStore(s);
        renderTemplates();
        if (typeof window.showNotification === 'function') window.showNotification('Navn oppdatert', 'success');
      });
    });

    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne malen?');
        if (!ok) return;
        const s = loadStore().data;
        s.templates = s.templates.filter(x => x.id !== id);
        saveStore(s);
        renderTemplates();
        if (typeof window.showNotification === 'function') window.showNotification('Mal slettet', 'info');
      });
    });
  }

  function saveTemplate() {
    const tpl = serializeTemplateFromState();
    const res = loadStore();
    const store = res.data;

    // dedupe title if same (optional)
    store.templates.push(tpl);
    saveStore(store);

    renderTemplates();
    if (typeof window.showNotification === 'function') window.showNotification('Mal lagret', 'success');
  }

  
  // -------------------------
  // Saved workouts (økt-historikk)
  // -------------------------
  
// -------------------------
// Shareable workout file (JSON) — local-only sharing between coaches
// -------------------------
const WORKOUT_FILE_VERSION = 1;

function serializeWorkoutFileFromState() {
  const title = String($('woTitle')?.value || '').trim();
  const date = String($('woDate')?.value || '').trim();

  // Intentionally exclude attendance/player ids (GDPR + variability).
  const blocks = state.blocks.map(b => {
    const out = { kind: b.kind === 'parallel' ? 'parallel' : 'single', a: { ...b.a } };
    if (out.kind === 'parallel') out.b = { ...b.b };
    return out;
  });

  return {
    type: 'bft_workout',
    v: WORKOUT_FILE_VERSION,
    title: title || (date ? `Trening ${date}` : 'Treningsøkt'),
    date: date || '',
    usePlayers: !!state.usePlayers,
    exportedAt: new Date().toISOString(),
    blocks
  };
}

function clampText(v, maxLen) {
  const s = String(v ?? '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function normalizeImportedExercise(ex) {
  const d = makeDefaultExercise();
  const out = { ...d, ...ex };

  // Minutes
  out.minutes = clampInt(out.minutes, 0, 300, d.minutes);

  // Group settings
  out.groupCount = clampInt(out.groupCount, 1, 6, d.groupCount);
  out.groupMode = (out.groupMode === 'diff' || out.groupMode === 'even') ? out.groupMode : d.groupMode;

  // Exercise key
  const allowedKeys = new Set(EXERCISES.map(x => x.key));
  if (!allowedKeys.has(out.exerciseKey)) {
    // If unknown, treat as custom
    const maybe = clampText(out.exerciseKey, 60);
    out.exerciseKey = 'custom';
    out.customName = clampText(out.customName || maybe || '', 60);
  }

  // Text fields
  out.customName = clampText(out.customName || '', 60);
  out.comment = clampText(out.comment || '', 1200);

  return out;
}

function normalizeImportedBlocks(blocks) {
  const out = [];
  const maxBlocks = 80; // safety cap
  for (const b of (Array.isArray(blocks) ? blocks.slice(0, maxBlocks) : [])) {
    if (!b || (b.kind !== 'single' && b.kind !== 'parallel')) continue;

    if (b.kind === 'parallel') {
      out.push({
        id: uuid('b_'),
        kind: 'parallel',
        a: normalizeImportedExercise(b.a),
        b: normalizeImportedExercise(b.b),
        _showPickB: false
      });
    } else {
      out.push({
        id: uuid('b_'),
        kind: 'single',
        a: normalizeImportedExercise(b.a)
      });
    }
  }
  return out.length ? out : [makeBlock('single')];
}

function applyWorkoutFileToState(fileObj) {
  const titleEl = $('woTitle');
  const dateEl = $('woDate');

  if (titleEl) titleEl.value = clampText(fileObj.title || 'Treningsøkt', 80);
  if (dateEl) dateEl.value = clampText(fileObj.date || '', 20);

  state.usePlayers = !!fileObj.usePlayers;
  const t = $('woUsePlayersToggle');
  if (t) t.checked = !!state.usePlayers;

  // Attendance is intentionally NOT imported
  state.selected = new Set();
  state.parallelPickB.clear();
  state.groupsCache.clear();

  state.blocks = normalizeImportedBlocks(fileObj.blocks);

  renderPlayersPanel();
  renderBlocks();
  persistDraft();
}

function makeWorkoutFilename(fileObj) {
  const safeDate = (fileObj.date || '').replace(/[^0-9-]/g, '');
  const base = safeDate ? `treningsokt_${safeDate}` : 'treningsokt';
  return `${base}.json`;
}

function downloadWorkoutFile() {
  const fileObj = serializeWorkoutFileFromState();
  const blob = new Blob([JSON.stringify(fileObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = makeWorkoutFilename(fileObj);
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
  if (typeof window.showNotification === 'function') window.showNotification('Øktfil lastet ned', 'success');
}

async function shareWorkoutFile() {
  const fileObj = serializeWorkoutFileFromState();
  const jsonStr = JSON.stringify(fileObj, null, 2);
  const filename = makeWorkoutFilename(fileObj);

  // Prefer Web Share API (mobile), fallback to download.
  try {
    if (navigator.share && navigator.canShare) {
      const file = new File([jsonStr], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: fileObj.title || 'Treningsøkt',
          text: 'Treningsøkt (øktfil) fra Barnefotballtrener',
          files: [file]
        });
        if (typeof window.showNotification === 'function') window.showNotification('Øktfil delt', 'success');
        return;
      }
    }
  } catch {
    // ignore and fallback
  }

  downloadWorkoutFile();
}

function importWorkoutFileFromPicker() {
  const input = $('woImportFile');
  if (!input) return;
  input.value = '';
  input.click();
}

function handleWorkoutFileInputChange(evt) {
  const input = evt?.target;
  const file = input?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || '');
      const obj = JSON.parse(text);

      if (!obj || obj.type !== 'bft_workout' || Number(obj.v) !== WORKOUT_FILE_VERSION) {
        window.alert('Ugyldig øktfil (feil type/versjon).');
        return;
      }
      if (!Array.isArray(obj.blocks)) {
        window.alert('Ugyldig øktfil (mangler øvelser).');
        return;
      }

      applyWorkoutFileToState(obj);
      if (typeof window.showNotification === 'function') window.showNotification('Økt importert. Husk å lagre hvis du vil beholde den i "Mine økter".', 'success');
    } catch (e) {
      window.alert('Kunne ikke importere øktfil. Sjekk at filen er gyldig JSON.');
    }
  };
  reader.onerror = () => window.alert('Kunne ikke lese filen.');
  reader.readAsText(file);
}

function serializeWorkoutFromState() {
    const title = String($('woTitle')?.value || '').trim();
    const date = String($('woDate')?.value || '').trim();

    const blocks = state.blocks.map(b => {
      // new ids to avoid collision with draft mapping
      const bid = uuid('wb_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: { ...b.a }, b: { ...b.b } };
      }
      return { id: bid, kind: 'single', a: { ...b.a } };
    });

    return {
      id: uuid('w_'),
      title: title || (date ? `Trening ${date}` : 'Treningsøkt'),
      date: date || '',
      usePlayers: !!state.usePlayers,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blocks
    };
  }

  function applyWorkoutToState(w) {
    if (!w || !Array.isArray(w.blocks)) return;

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (titleEl) titleEl.value = String(w.title || '');
    if (dateEl && typeof w.date === 'string') dateEl.value = w.date;

    state.usePlayers = !!w.usePlayers;
    const t = $('woUsePlayersToggle');
    if (t) t.checked = !!state.usePlayers;

    // attendance is intentionally NOT stored
    state.selected = new Set();
    state.parallelPickB.clear();
    state.groupsCache.clear();

    state.blocks = w.blocks.map(b => {
      const bid = uuid('b_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: { ...makeDefaultExercise(), ...b.a }, b: { ...makeDefaultExercise(), ...b.b }, _showPickB: false };
      }
      return { id: bid, kind: 'single', a: { ...makeDefaultExercise(), ...b.a } };
    });

    renderPlayersPanel();
    renderBlocks();
    persistDraft();
  }

  function renderWorkouts() {
    const wrap = $('woWorkouts');
    if (!wrap) return;

    const loaded = loadWorkoutsStore();
    const store = loaded.data;

    if (!loaded.ok && loaded.corrupt) {
      wrap.innerHTML = `
        <div class="small-text" style="opacity:0.85;">
          Kunne ikke lese lagrede økter (korrupt data). Ny lagring vil overskrive.
        </div>
      `;
      return;
    }

    const list = store.workouts.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!list.length) {
      wrap.innerHTML = `<div class="small-text" style="opacity:0.75;">Ingen lagrede økter ennå.</div>`;
      return;
    }

    wrap.innerHTML = list.map(w => {
      const dateTxt = w.date ? `<span class="small-text" style="opacity:0.8;">${escapeHtml(w.date)}</span>` : '';
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:900;">${escapeHtml(w.title || 'Treningsøkt')}</div>
            ${dateTxt}
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(w.id)}"><i class="fas fa-upload"></i> Last</button>
            <button class="btn-small" type="button" data-wo-del="${escapeHtml(w.id)}"><i class="fas fa-trash"></i> Slett</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind actions
    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const s = loadWorkoutsStore().data;
        const w = s.workouts.find(x => x.id === id);
        if (w) applyWorkoutToState(w);
      });
    });
    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne økta?');
        if (!ok) return;
        const loaded2 = loadWorkoutsStore();
        const s2 = loaded2.data;
        s2.workouts = s2.workouts.filter(x => x.id !== id);
        saveWorkoutsStore(s2);
        renderWorkouts();
      });
    });
  }

  function saveWorkout() {
    const date = String($('woDate')?.value || '').trim();
    // For saved workouts, date is useful but not mandatory
    if (!date) {
      const ok = window.confirm('Ingen dato valgt. Vil du lagre økta likevel?');
      if (!ok) return;
    }

    const loaded = loadWorkoutsStore();
    const store = loaded.data;
    const w = serializeWorkoutFromState();

    // cap to avoid unbounded localStorage growth (user can still delete)
    const MAX = 100;
    store.workouts = store.workouts.filter(x => x.id !== w.id);
    store.workouts.unshift(w);
    if (store.workouts.length > MAX) store.workouts = store.workouts.slice(0, MAX);

    saveWorkoutsStore(store);
    renderWorkouts();
    if (typeof window.showNotification === 'function') window.showNotification('Økt lagret lokalt', 'success');
  }


  // -------------------------
  // Suggestions ("Lag en treningsøkt for meg")
  // -------------------------
  const SUGGESTIONS = [
    // 60 min
    [
      { key: 'tag', min: 8 },
      { key: 'warm_ball', min: 10 },
      { key: 'pass_pair', min: 10 },
      { key: '1v1', min: 10 },
      { key: 'drink', min: 2 },
      { key: 'ssg', min: 20 }
    ],
    // 75 min (inkl parallel keepertrening)
    [
      { key: 'tag', min: 8 },
      { key: 'warm_ball', min: 10 },
      { key: 'pass_square', min: 12 },
      { key: 'drink', min: 2, },
      { parallel: true, a: { key: '2v1', min: 12 }, b: { key: 'keeper', min: 12 } },
      { key: 'ssg', min: 25 },
      { key: 'competitions', min: 6 }
    ],
    // 90 min
    [
      { key: 'tag', min: 10 },
      { key: 'warm_ball', min: 12 },
      { key: 'driving', min: 10 },
      { key: 'drink', min: 2 },
      { key: 'pass_turn', min: 12 },
      { key: 'overload', min: 12 },
      { key: 'ssg', min: 28 },
      { key: 'competitions', min: 4 }
    ]
  ];

  function suggestWorkout() {
    const idx = Math.floor(Math.random() * SUGGESTIONS.length);
    const tpl = SUGGESTIONS[idx];

    const blocks = [];
    for (const step of tpl) {
      if (step.parallel) {
        const b = makeBlock('parallel');
        b.a.exerciseKey = step.a.key;
        b.a.minutes = step.a.min;
        b.b.exerciseKey = step.b.key;
        b.b.minutes = step.b.min;
        blocks.push(b);
      } else {
        const b = makeBlock('single');
        b.a.exerciseKey = step.key;
        b.a.minutes = step.min;
        blocks.push(b);
      }
    }

    state.blocks = blocks;
    state.groupsCache.clear();
    state.parallelPickB.clear();

    renderBlocks();
    if (typeof window.showNotification === 'function') window.showNotification('Forslag generert – juster fritt', 'success');
  }

  // -------------------------
  // Export (HTML print -> PDF)
  // -------------------------
  function exportWorkout() {
    const date = String($('woDate')?.value || '').trim();
    const title = String($('woTitle')?.value || '').trim() || (date ? `Trening ${date}` : 'Treningsøkt');
    const total = totalMinutes();

    const players = getPlayersSnapshot();
    const map = playerMap(players);
    const selectedPlayers = Array.from(state.selected).map(id => map.get(id)).filter(Boolean);

    function renderGroupLists(block, track) {
      const key = `${block.id}:${track}`;
      const cached = state.groupsCache.get(key);
      if (!cached || !Array.isArray(cached)) return '';
      return `
        <div class="exp-groups"><div class="exp-groups-h">Gruppeinndeling</div>
          ${cached.map((g, i) => `
            <div class="exp-group">
              <div class="exp-group-title">${cached.length === 1 ? 'Deltakere' : `Gruppe ${i + 1}`} (${g.length})</div>
              <div class="exp-group-list">${g.map(p => escapeHtml(p.name)).join(' • ')}</div>
            </div>
          `).join('')}
        </div>
      `;
    }

    const blocksHtml = state.blocks.map((b, idx) => {
      const isPar = b.kind === 'parallel';
      const minutesA = clampInt(b.a?.minutes, 0, 300, 0);
      const minutesB = isPar ? clampInt(b.b?.minutes, 0, 300, 0) : 0;
      const blockMin = isPar ? Math.max(minutesA, minutesB) : minutesA;

      const exAName = displayName(b.a);
      const exBName = isPar ? displayName(b.b) : '';

      const commentA = String(b.a?.comment || '').trim();
      const commentB = isPar ? String(b.b?.comment || '').trim() : '';

      const groupsA = renderGroupLists(b, 'a');
      const groupsB = isPar ? renderGroupLists(b, 'b') : '';

      if (!isPar) {
        return `
          <tr>
            <td class="exp-col-idx">${idx + 1}</td>
            <td class="exp-col-ex">
              <div class="exp-ex-name">${escapeHtml(exAName)}</div>
              ${commentA ? `<div class="exp-comment">${escapeHtml(commentA)}</div>` : ''}
              ${groupsA}
            </td>
            <td class="exp-col-min">${blockMin}</td>
          </tr>
        `;
      }

      return `
        <tr>
          <td class="exp-col-idx">${idx + 1}</td>
          <td class="exp-col-ex">
            <div class="exp-parallel">
              <div class="exp-par">
                <div class="exp-par-h">Øvelse A</div>
                <div class="exp-ex-name">${escapeHtml(exAName)} <span class="exp-mini">(${minutesA} min)</span></div>
                ${commentA ? `<div class="exp-comment">${escapeHtml(commentA)}</div>` : ''}
                ${groupsA}
              </div>
              <div class="exp-par">
                <div class="exp-par-h">Øvelse B (parallelt)</div>
                <div class="exp-ex-name">${escapeHtml(exBName)} <span class="exp-mini">(${minutesB} min)</span></div>
                ${commentB ? `<div class="exp-comment">${escapeHtml(commentB)}</div>` : ''}
                ${groupsB}
              </div>
            </div>
          </td>
          <td class="exp-col-min">${blockMin}</td>
        </tr>
      `;
    }).join('');

    const attendanceHtml = state.usePlayers
      ? `
        <div class="exp-attendance">
          <div class="exp-att-h">Oppmøte (${selectedPlayers.length})</div>
          <div class="exp-att-list">${selectedPlayers.map(p => escapeHtml(p.name)).join(' • ') || '—'}</div>
        </div>
      `
      : '';

    const logoUrl = (() => {
      // Prefer the exact same logo the user sees on the front page (login) for consistent branding.
      // Fallbacks: app header logo -> apple-touch-icon -> icon-192.
      try {
        const front = document.querySelector('.login-logo');
        if (front && front.getAttribute('src')) return new URL(front.getAttribute('src'), window.location.href).href;
        const appLogo = document.querySelector('.app-logo');
        if (appLogo && appLogo.getAttribute('src')) return new URL(appLogo.getAttribute('src'), window.location.href).href;
        return new URL('apple-touch-icon.png', window.location.href).href;
      } catch {
        return 'apple-touch-icon.png';
      }
    })();
    const html = `
<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} – Barnefotballtrener</title>
  <style>
    :root{
      --bg:#0b1220;
      --card:#ffffff;
      --muted:#556070;
      --line:#e6e9ef;
      --brand:#0b5bd3;
      --brand2:#19b0ff;
      --soft:#f6f8fc;
    }
    *{box-sizing:border-box}
    body{margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial; background:var(--soft); color:#111; line-height:1.45;}
    .wrap{max-width:980px; margin:0 auto; padding:18px;}
    .header{
      background: linear-gradient(135deg, var(--brand), var(--brand2));
      color:#fff; border-radius:18px; padding:16px 18px;
      display:flex; gap:14px; align-items:center;
      box-shadow: 0 6px 18px rgba(11,91,211,0.20);
    }
    .logo{width:44px; height:44px; border-radius:12px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden;}
    .logo img{width:44px; height:44px; object-fit:cover;}
    .h-title{font-size:18px; font-weight:900; line-height:1.2;}
    .h-sub{opacity:0.9; font-size:13px; margin-top:2px;}
    .meta{margin-left:auto; text-align:right;}
    .meta .m1{font-weight:800;}
    .meta .m2{opacity:0.9; font-size:13px; margin-top:2px;}
    .card{background:var(--card); border:1px solid var(--line); border-radius:18px; padding:14px; margin-top:12px;}
    table{width:100%; border-collapse:separate; border-spacing:0;}
    th,td{vertical-align:top; padding:10px 10px; border-bottom:1px solid var(--line);}
    th{font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); text-align:left;}
    .exp-col-idx{width:44px; color:var(--muted); font-weight:800;}
    .exp-col-min{width:86px; text-align:right; font-weight:900;}
    .exp-ex-name{font-weight:900; margin-bottom:3px;}
    .exp-mini{font-weight:700; color:var(--muted); font-size:12px;}
    .exp-comment{color:var(--muted); font-size:13px; margin-top:6px; margin-bottom:12px; line-height:1.45;}
    .exp-parallel{display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:6px;}
    .exp-par{border:1px solid var(--line); border-radius:14px; padding:10px; background:#fff;}
    .exp-par-h{font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-weight:800; margin-bottom:6px;}
    .exp-groups{margin-top:12px; display:flex; flex-direction:column; gap:10px;}
    .exp-groups-h{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:900; margin-bottom:6px; margin-top:4px;}
    .exp-group{background:var(--soft); border:1px solid var(--line); border-left:4px solid rgba(11,91,211,0.35); border-radius:12px; padding:10px;}
    .exp-group-title{font-weight:900; font-size:13px; color:#1a2333; margin-bottom:6px;}
    .exp-group-list{color:var(--muted); font-size:13px; line-height:1.55;}
    .exp-attendance{margin-top:10px; padding-top:10px; border-top:1px dashed var(--line);}
    .exp-att-h{font-weight:900;}
    .exp-att-list{color:var(--muted); font-size:13px; margin-top:6px; line-height:1.45;}
    .actions{display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;}
    .btn{
      border:0; border-radius:12px; padding:10px 12px; font-weight:800;
      background:var(--brand); color:#fff; cursor:pointer;
    }
    .btn.secondary{background:#1f2a3d;}
    .note{color:var(--muted); font-size:12px; margin-top:8px;}
    @media (max-width:720px){
      .exp-parallel{grid-template-columns:1fr;}
      .meta{display:none;}
      th:nth-child(1),td:nth-child(1){display:none;}
      .exp-col-min{width:70px;}
    }
    @media print{
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body{background:#fff;}
      .wrap{max-width:none; padding:0;}
      .actions,.note{display:none !important;}
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
        <div class="h-title">${escapeHtml(title)}</div>
        <div class="h-sub">${date ? `Dato: ${escapeHtml(date)} • ` : ''}Total tid: ${total} min</div>
      </div>
      <div class="meta">
        <div class="m1">Barnefotballtrener</div>
        <div class="m2">Deling / PDF</div>
      </div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Øvelse</th>
            <th style="text-align:right;">Min</th>
          </tr>
        </thead>
        <tbody>
          ${blocksHtml}
        </tbody>
      </table>
      ${attendanceHtml}
    </div>

    <div class="actions">
      <button class="btn" onclick="window.print()">Skriv ut / Lagre som PDF</button>
      <button class="btn secondary" onclick="window.close()">Lukk</button>
    </div>
    <div class="note">Tips: I utskriftsdialogen velger du “Lagre som PDF”. På mobil kan dette ligge under Del → Skriv ut.</div>
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

  // -------------------------
  // Draft persistence
  // -------------------------
  function persistDraft() {
    const title = String($('woTitle')?.value || '');
    const date = String($('woDate')?.value || '');

    const parallelPickBObj = {};
    for (const [bid, setB] of state.parallelPickB.entries()) {
      parallelPickBObj[bid] = Array.from(setB);
    }

    const draft = {
      version: 2,
      title,
      date,
      usePlayers: !!state.usePlayers,
      selected: Array.from(state.selected),
      parallelPickB: parallelPickBObj,
      blocks: state.blocks.map(b => {
        if (b.kind === 'parallel') {
          return {
            id: b.id,
            kind: 'parallel',
            a: { ...b.a },
            b: { ...b.b }
          };
        }
        return { id: b.id, kind: 'single', a: { ...b.a } };
      })
    };
    saveDraft(draft);
  }

  function restoreDraftIfAny() {
    const draft = loadDraft();
    if (!draft || !Array.isArray(draft.blocks)) return false;

    state.usePlayers = !!draft.usePlayers;
    state.selected = new Set(Array.isArray(draft.selected) ? draft.selected : []);

    // restore title/date (if present)
    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (dateEl && typeof draft.date === 'string') dateEl.value = draft.date;
    if (titleEl && typeof draft.title === 'string') titleEl.value = draft.title;

    // restore parallel selections (track B) - keep block ids stable so mapping survives reload
    state.parallelPickB = new Map();
    if (draft.parallelPickB && typeof draft.parallelPickB === 'object') {
      for (const [bid, arr] of Object.entries(draft.parallelPickB)) {
        if (Array.isArray(arr)) state.parallelPickB.set(bid, new Set(arr));
      }
    }

    state.blocks = draft.blocks.map(b => {
      const bid = (b && typeof b.id === 'string' && b.id) ? b.id : uuid('b_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: { ...makeDefaultExercise(), ...b.a }, b: { ...makeDefaultExercise(), ...b.b }, _showPickB: false };
      }
      return { id: bid, kind: 'single', a: { ...makeDefaultExercise(), ...b.a } };
    });

    return true;
  }

  // -------------------------
  // Init / bind
  // -------------------------
  function initIfPresent() {
    const root = $('workout');
    if (!root) return;

    if (state.bound) return;
    state.bound = true;

    const usePlayersToggle = $('woUsePlayersToggle');
    const addBtn = $('woAddExerciseBtn');
    const suggestBtn = $('woSuggestBtn');
    const saveBtn = $('woSaveTemplateBtn');
    const saveWorkoutBtn = $('woSaveWorkoutBtn');
    const exportBtn = $('woExportBtn');
    const dlJsonBtn = $('woDownloadJsonBtn');
    const shareJsonBtn = $('woShareJsonBtn');
    const importJsonBtn = $('woImportJsonBtn');
    const importFile = $('woImportFile');
    const selectAllBtn = $('woSelectAllBtn');
    const clearAllBtn = $('woClearAllBtn');

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (dateEl) dateEl.addEventListener('change', () => persistDraft());
    if (titleEl) titleEl.addEventListener('input', () => persistDraft());


    // restore draft or start with one block
    if (!restoreDraftIfAny()) {
      state.blocks = [makeBlock('single')];
      persistDraft();
    }

    if (usePlayersToggle) {
      usePlayersToggle.checked = !!state.usePlayers;
      usePlayersToggle.addEventListener('change', () => {
        state.usePlayers = !!usePlayersToggle.checked;

        // NB: Vi autovelger ikke spillere. Bruk 'Velg alle' eller velg manuelt.

        state.groupsCache.clear();
        renderPlayersPanel();
        renderBlocks();
      });
    }

    if (addBtn) addBtn.addEventListener('click', () => addBlock('single'));
    if (suggestBtn) suggestBtn.addEventListener('click', () => suggestWorkout());
    if (saveBtn) saveBtn.addEventListener('click', () => saveTemplate());
    if (saveWorkoutBtn) saveWorkoutBtn.addEventListener('click', () => saveWorkout());
    if (exportBtn) exportBtn.addEventListener('click', () => exportWorkout());

    if (dlJsonBtn) dlJsonBtn.addEventListener('click', () => downloadWorkoutFile());
    if (shareJsonBtn) shareJsonBtn.addEventListener('click', () => shareWorkoutFile());
    if (importJsonBtn) importJsonBtn.addEventListener('click', () => importWorkoutFileFromPicker());
    if (importFile) importFile.addEventListener('change', handleWorkoutFileInputChange);

    if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
      if (!state.usePlayers) return;
      const players = getPlayersSnapshot();
      state.selected = new Set(players.map(p => p.id));
      state.groupsCache.clear();
      renderPlayersPanel();
      renderBlocks();
      if (typeof window.showNotification === 'function') window.showNotification('Valgte alle aktive spillere', 'success');
    });

    if (clearAllBtn) clearAllBtn.addEventListener('click', () => {
      if (!state.usePlayers) return;
      state.selected = new Set();
      state.groupsCache.clear();
      renderPlayersPanel();
      renderBlocks();
      if (typeof window.showNotification === 'function') window.showNotification('Fjernet alle valgte spillere', 'info');
    });

    // initial render
    renderPlayersPanel();
    renderBlocks();
    renderTemplates();
    renderWorkouts();

    // Keep player UI in sync with core.js
    window.addEventListener('players:updated', () => {
      const players = getPlayersSnapshot();
      const valid = new Set(players.map(p => p.id));

      // Prune selections if players were removed/deactivated in core.js
      const nextSel = new Set();
      for (const id of state.selected) {
        if (valid.has(id)) nextSel.add(id);
      }
      const selectionChanged = nextSel.size !== state.selected.size;
      state.selected = nextSel;

      // Prune track-B picks as well
      for (const [bid, setB] of state.parallelPickB.entries()) {
        const nextB = new Set();
        for (const id of setB) {
          if (valid.has(id)) nextB.add(id);
        }
        state.parallelPickB.set(bid, nextB);
      }

      if (selectionChanged) state.groupsCache.clear();
      renderPlayersPanel();
      renderBlocks();
    });

    console.log('[workout.js] init complete');

    // Auth timing fix: templates/workouts/draft may have been loaded with 'anon'
    // key if auth wasn't ready at DOMContentLoaded. Rehydrate once auth resolves.
    (function rehydrateAfterAuth() {
      const initialPrefix = getUserKeyPrefix();
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        const currentPrefix = getUserKeyPrefix();
        if (currentPrefix !== initialPrefix) {
          // Auth resolved with real uid — re-render with correct keys
          clearInterval(timer);
          console.log('[workout.js] auth resolved, rehydrating storage from', initialPrefix, '→', currentPrefix);
          renderTemplates();
          renderWorkouts();
          restoreDraftIfAny();
        } else if (attempts >= 40) {
          // 40 × 150ms = 6s — give up, auth likely stuck or user is genuinely anon
          clearInterval(timer);
        }
      }, 150);
    })();
  }

  document.addEventListener('DOMContentLoaded', initIfPresent);

})();
