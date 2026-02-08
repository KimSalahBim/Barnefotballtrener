/* Barnefotballtrener – Konkurranser (Mesternes mester)
   - Vanilla JS
   - No regressions: isolert logikk + namespacede klasser (.comp-*)
   - Lagring per bruker: samme prefix-logikk som core.js
*/

(function () {
  'use strict';

  // -------------------------
  // Små helpers
  // -------------------------
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const pad2 = (n) => String(n).padStart(2, '0');

  function nowISO() {
    return new Date().toISOString();
  }

  function toYearMonth(dateISO) {
    const d = new Date(dateISO);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function uuid() {
    // Ikke-crypto UUID som er "good enough" for localStorage IDs
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // -------------------------
  // Lagring (samme mønster som core.js)
  // -------------------------
  const _mem = new Map();

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return _mem.get(key) ?? null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      _mem.set(key, value);
    }
  }

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      _mem.delete(key);
    }
  }

  function getUserKeyPrefix() {
    try {
      const uid =
        (window.authService && typeof window.authService.getUserId === 'function'
          ? window.authService.getUserId()
          : null) || 'anon';
      return `bft:${uid}:`;
    } catch (e) {
      return 'bft:anon:';
    }
  }

  function k(name) {
    return `${getUserKeyPrefix()}${name}`;
  }

  // Lazy-evaluated key: uid may not be available at IIFE-init (auth is async).
  // Computing per-call ensures correct key even after auth completes.
  function STORAGE_KEY() { return k('competitions'); }
  const SCHEMA_VERSION = 1;

  function defaultStore() {
    return { schemaVersion: SCHEMA_VERSION, competitions: [] };
  }

  function loadStore() {
    const raw = safeGet(STORAGE_KEY());
    if (!raw) return { ok: true, data: defaultStore(), corrupt: false };

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('Ugyldig objekt');
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        throw new Error('Ukjent schemaVersion');
      }
      if (!Array.isArray(parsed.competitions)) parsed.competitions = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: defaultStore(), corrupt: true, error: e };
    }
  }

  function saveStore(store) {
    safeSet(STORAGE_KEY(), JSON.stringify(store));
  }

  // -------------------------
  // Spillerdata (hentes fra eksisterende app)
  // -------------------------
  function getPlayersSnapshot() {
    console.log('[Competitions] getPlayersSnapshot kalles');
    console.log('[Competitions] window.players:', window.players);
    
    const list = Array.isArray(window.players) ? window.players : null;

    if (list && list.length) {
      console.log('[Competitions] ✅ Fant', list.length, 'spillere i window.players');
      // Viktig: ikke bruk/vis ferdighetsnivå i UI
      return list.map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active !== false
      }));
    }

    // Fallback: les direkte fra storage (samme key som core.js bruker)
    console.log('[Competitions] ⚠️ window.players tom, prøver localStorage...');
    try {
      const raw = safeGet(k('players'));
      console.log('[Competitions] localStorage:', raw ? 'fant data' : 'tom');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      
      // Støtt både gammelt format {players: [...]} og nytt format [...]
      let arr = [];
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.players)) {
        arr = parsed.players;
      } else if (Array.isArray(parsed)) {
        arr = parsed;
      }
      
      console.log('[Competitions] ✅ Fant', arr.length, 'spillere i localStorage');
      return arr.map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active !== false
      }));
    } catch (e) {
      console.error('[Competitions] ❌ Feil ved lesing fra storage:', e);
      return [];
    }
  }

  // -------------------------
  // Konkurranse-logikk
  // -------------------------
  function scoringPoints(scoringMode, placeIndex, nPlayers) {
    const place = placeIndex + 1;
    if (scoringMode === 'rank') {
      return Math.max(0, nPlayers - place + 1);
    }
    if (place === 1) return 3;
    if (place === 2) return 2;
    if (place === 3) return 1;
    return 0;
  }

  function computeTotals(competition) {
    const totals = {};
    for (const pid of competition.participantIds) totals[pid] = 0;

    for (const ex of competition.exercises) {
      const seen = new Set();
      const ranking = Array.isArray(ex.ranking) ? ex.ranking : [];
      for (let i = 0; i < ranking.length; i++) {
        const pid = ranking[i];
        if (!pid) continue;
        if (seen.has(pid)) continue;
        seen.add(pid);
        totals[pid] += scoringPoints(competition.scoring, i, competition.participantIds.length);
      }
    }
    return totals;
  }

  function sortedLeaderboard(totals, nameMap) {
    const rows = Object.entries(totals).map(([pid, pts]) => ({
      playerId: pid,
      name: nameMap[pid] || 'Ukjent',
      points: pts
    }));
    rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'nb'));
    return rows;
  }

  // -------------------------
  // UI / State
  // -------------------------
  const ui = {
    view: 'setup', // setup | running | history | detail
    activeCompetitionId: null,
    activeExerciseIndex: 0,
    historyMode: 'month', // month | year
    historyYear: new Date().getFullYear(),
    historyMonth: new Date().getMonth() + 1,
    detailId: null
  };

  function getRoot() {
    return $('competitionsRoot') || $('competitions');
  }

  function render() {
    console.log('[Competitions] render() kalles');
    const root = getRoot();
    console.log('[Competitions] root element:', root ? 'funnet' : 'IKKE FUNNET');
    if (!root) return;

    const storeRes = loadStore();
    const store = storeRes.data;

    const players = getPlayersSnapshot().filter((p) => p.active);
    console.log('[Competitions] Aktive spillere:', players.length);
    const playerNameMap = Object.fromEntries(players.map((p) => [p.id, p.name]));

    const active = ui.activeCompetitionId
      ? store.competitions.find((c) => c.id === ui.activeCompetitionId)
      : null;

    if (ui.view === 'running' && !active) {
      ui.view = 'setup';
      ui.activeCompetitionId = null;
      ui.activeExerciseIndex = 0;
    }

    const corruptBanner = storeRes.corrupt
      ? `<div class="comp-banner comp-banner--warn">
           <div><strong>Obs:</strong> Konkurranse-data i lagring ser ødelagt ut.</div>
           <button class="btn-secondary comp-btn" data-comp-action="resetStore">Nullstill konkurranser</button>
         </div>`
      : '';

    const noPlayers = players.length === 0;
    console.log('[Competitions] noPlayers:', noPlayers);

    root.innerHTML = `
      <div class="comp-root">
        ${corruptBanner}
        ${noPlayers ? renderNoPlayers() : ''}
        ${!noPlayers ? renderTabs(active, store, players, playerNameMap) : ''}
      </div>
    `;

    bindUI(store, players);
  }

  function renderNoPlayers() {
    return `
      <div class="comp-card comp-empty">
        <h3>Ingen spillere funnet</h3>
        <p>For å bruke <strong>Konkurranser</strong> må du først legge inn spillere.</p>
        <button class="btn-primary comp-btn" data-comp-action="goPlayers">Gå til Spillere</button>
      </div>
    `;
  }

  function renderTabs(active, store, players, playerNameMap) {
    const setupActive = ui.view === 'setup' ? 'is-active' : '';
    const runActive = ui.view === 'running' ? 'is-active' : '';
    const histActive = ui.view === 'history' || ui.view === 'detail' ? 'is-active' : '';

    return `
      <div class="comp-topnav">
        <button class="comp-pill ${setupActive}" data-comp-view="setup">Opprett</button>
        <button class="comp-pill ${runActive}" data-comp-view="running" ${active ? '' : 'disabled'}>Pågår</button>
        <button class="comp-pill ${histActive}" data-comp-view="history">Historikk</button>
      </div>

      <div class="comp-view">
        ${ui.view === 'setup' ? renderSetup(players) : ''}
        ${ui.view === 'running' ? renderRunning(active, playerNameMap) : ''}
        ${ui.view === 'history' ? renderHistory(store, playerNameMap) : ''}
        ${ui.view === 'detail' ? renderDetail(store, playerNameMap) : ''}
      </div>
    `;
  }

  function renderSetup(players) {
    const list = players
      .map(
        (p) => `
      <label class="comp-check">
        <input type="checkbox" data-comp-player="${escapeHtml(p.id)}">
        <span>${escapeHtml(p.name)}</span>
      </label>`
      )
      .join('');

    return `
      <div class="comp-card">
        <h3>Opprett ny konkurranse</h3>
        <p class="comp-help">
          <strong>Mesternes mester</strong>: Velg deltakere, legg inn øvelser og registrer plasseringer.
          Poengsummer oppdateres automatisk.
        </p>

        <div class="comp-grid">
          <div class="comp-panel">
            <h4>1) Velg deltakere</h4>
            <div class="comp-actions">
              <button class="btn-secondary comp-btn" data-comp-action="selectAll">Velg alle</button>
              <button class="btn-secondary comp-btn" data-comp-action="selectNone">Velg ingen</button>
            </div>
            <div class="comp-list comp-list--players">
              ${list}
            </div>
          </div>

          <div class="comp-panel">
            <h4>2) Øvelser</h4>
            <div class="comp-row">
              <label class="comp-label">Antall øvelser</label>
              <input id="compExerciseCount" class="comp-input" type="number" inputmode="numeric" min="1" max="50" value="5">
              <button class="btn-secondary comp-btn" data-comp-action="generateExercises">Lag felter</button>
            </div>

            <div id="compExerciseNames" class="comp-exercises"></div>

            <div class="comp-actions">
              <button class="btn-secondary comp-btn" data-comp-action="addExercise">+ Legg til øvelse</button>
              <button class="btn-secondary comp-btn" data-comp-action="removeExercise">Fjern siste</button>
            </div>
          </div>

          <div class="comp-panel">
            <h4>3) Poengstruktur</h4>
        <label class="comp-radio">
  <input type="radio" name="compScoring" value="rank" checked>
  <span>
    <strong>Plasseringspoeng</strong><br>
    <span class="comp-muted">
      Eksempel: Ved <strong>5 deltakere</strong> får vinneren <strong>5 poeng</strong>, nr. 2 får <strong>4</strong>, nr. 3 får <strong>3</strong> – helt ned til sisteplass.
    </span>
  </span>
</label>

<label class="comp-radio">
  <input type="radio" name="compScoring" value="321">
  <span>
    <strong>3–2–1</strong><br>
    <span class="comp-muted">
      Vinneren får <strong>3 poeng</strong>, nr. 2 får <strong>2</strong>, nr. 3 får <strong>1</strong>. Resten får <strong>0</strong>.
    </span>
  </span>
</label>
    

            <div class="comp-row">
              <label class="comp-label">Navn på konkurransen (valgfritt)</label>
              <input id="compTitle" class="comp-input" type="text" placeholder="F.eks. Januar-testen">
            </div>

            <button class="btn-primary comp-btn comp-start" data-comp-action="startCompetition">
              Start konkurranse
            </button>

            <p class="comp-muted">
              Tips: Du kan ha “uendelig” mange øvelser – bare legg til øvelser før du starter.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  function renderRunning(competition, nameMap) {
    if (!competition) {
      return `<div class="comp-card"><p>Ingen aktiv konkurranse.</p></div>`;
    }

    const totals = computeTotals(competition);
    const leaderboard = sortedLeaderboard(totals, competition.participantNames || nameMap);

    const n = competition.participantIds.length;
    const exercises = competition.exercises || [];
    const activeIndex = Math.max(0, Math.min(ui.activeExerciseIndex, exercises.length - 1));

    const exTabs = exercises
      .map((ex, idx) => {
        const active = idx === activeIndex ? 'is-active' : '';
        return `<button class="comp-ex-tab ${active}" data-comp-ex="${idx}">${escapeHtml(ex.name || `Øvelse ${idx + 1}`)}</button>`;
      })
      .join('');

    const ex = exercises[activeIndex];
    const nameById = competition.participantNames || nameMap;

    const ranking = Array.isArray(ex?.ranking) ? ex.ranking : Array(n).fill(null);
    const used = new Set(ranking.filter(Boolean));

    const rows = Array.from({ length: n }).map((_, i) => {
      const place = i + 1;
      const pid = ranking[i] || '';
      const pts = scoringPoints(competition.scoring, i, n);
      const options = competition.participantIds
        .map((id) => {
          const selected = id === pid ? 'selected' : '';
          const disabled = id !== pid && used.has(id) ? 'disabled' : '';
          return `<option value="${escapeHtml(id)}" ${selected} ${disabled}>${escapeHtml(nameById[id] || 'Ukjent')}</option>`;
        })
        .join('');
      return `
        <div class="comp-place-row">
          <div class="comp-place">${place}.</div>
          <select class="comp-select" data-comp-place="${i}">
            <option value="">Velg spiller…</option>
            ${options}
          </select>
          <div class="comp-pts">${pts}p</div>
        </div>
      `;
    });

    return `
      <div class="comp-card">
        <div class="comp-running-head">
          <div>
            <h3>${escapeHtml(competition.title || 'Konkurranse')}</h3>
            <div class="comp-meta">
              ${escapeHtml(new Date(competition.createdAt).toLocaleString('nb-NO'))} •
              ${competition.scoring === 'rank' ? 'Plasseringspoeng' : '3–2–1'}
            </div>
          </div>
          <div class="comp-actions">
            <button class="btn-secondary comp-btn" data-comp-action="finishCompetition">Fullfør</button>
            <button class="btn-secondary comp-btn" data-comp-action="exitToHistory">Historikk</button>
          </div>
        </div>

        <div class="comp-exercises-bar">
          <div class="comp-ex-tabs">${exTabs}</div>
        </div>

        <div class="comp-grid comp-grid--running">
          <div class="comp-panel">
            <h4>${escapeHtml(ex?.name || 'Øvelse')}</h4>
            <p class="comp-muted">Velg hvem som fikk hvilken plassering. Hver spiller kan velges én gang per øvelse.</p>
            <div class="comp-places" data-comp-ex-active="${activeIndex}">
              ${rows.join('')}
            </div>
            <div class="comp-actions">
              <button class="btn-secondary comp-btn" data-comp-action="clearExercise">Tøm øvelse</button>
              <button class="btn-secondary comp-btn" data-comp-action="copyPrevExercise" ${activeIndex === 0 ? 'disabled' : ''}>
                Kopi fra forrige
              </button>
            </div>
          </div>

          <div class="comp-panel">
            <h4>Poengtavle</h4>
            <div class="comp-leaderboard">
              ${leaderboard.map((r, idx) => `
                <div class="comp-lb-row">
                  <div class="comp-lb-rank">${idx + 1}.</div>
                  <div class="comp-lb-name">${escapeHtml(r.name)}</div>
                  <div class="comp-lb-points">${r.points}p</div>
                </div>`).join('')}
            </div>

            <div class="comp-actions">
              <button class="btn-primary comp-btn" data-comp-action="saveCompetition">Lagre</button>
            </div>
            <p class="comp-muted">Lagrer automatisk når du endrer plasseringer – “Lagre” er ekstra trygghet.</p>
          </div>
        </div>
      </div>
    `;
  }

  function renderHistory(store, nameMap) {
    const comps = store.competitions.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const years = Array.from(new Set(comps.map((c) => c.year).filter(Boolean))).sort((a, b) => b - a);
    const yearOptions = years.length ? years : [new Date().getFullYear()];

    if (!years.includes(ui.historyYear)) ui.historyYear = yearOptions[0];

    const filtered = comps.filter((c) => {
      if (ui.historyMode === 'year') return c.year === ui.historyYear;
      return c.year === ui.historyYear && c.month === ui.historyMonth;
    });

    const totalsAgg = {};
    for (const c of filtered) {
      const totals = computeTotals(c);
      for (const [pid, pts] of Object.entries(totals)) totalsAgg[pid] = (totalsAgg[pid] || 0) + pts;
    }

    const leaderboard = sortedLeaderboard(totalsAgg, nameMap);

    return `
      <div class="comp-card">
        <div class="comp-history-head">
          <h3>Historikk</h3>
          <div class="comp-actions">
            <button class="btn-secondary comp-btn" data-comp-action="newCompetition">Ny konkurranse</button>
          </div>
        </div>

        <div class="comp-history-filters">
          <div class="comp-seg">
            <button class="comp-seg-btn ${ui.historyMode === 'month' ? 'is-active' : ''}" data-comp-action="setHistoryMode" data-comp-value="month">Måned</button>
            <button class="comp-seg-btn ${ui.historyMode === 'year' ? 'is-active' : ''}" data-comp-action="setHistoryMode" data-comp-value="year">År</button>
          </div>

          <div class="comp-row">
            <label class="comp-label">År</label>
            <select id="compHistYear" class="comp-select">
              ${yearOptions.map((y) => `<option value="${y}" ${y === ui.historyYear ? 'selected' : ''}>${y}</option>`).join('')}
            </select>

            <label class="comp-label ${ui.historyMode === 'year' ? 'is-hidden' : ''}">Måned</label>
            <select id="compHistMonth" class="comp-select ${ui.historyMode === 'year' ? 'is-hidden' : ''}">
              ${Array.from({ length: 12 }).map((_, i) => {
                const m = i + 1;
                return `<option value="${m}" ${m === ui.historyMonth ? 'selected' : ''}>${pad2(m)}</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <div class="comp-grid comp-grid--history">
          <div class="comp-panel">
            <h4>Toppliste (${ui.historyMode === 'year' ? ui.historyYear : `${pad2(ui.historyMonth)}-${ui.historyYear}`})</h4>
            ${leaderboard.length ? `
              <div class="comp-leaderboard">
                ${leaderboard.slice(0, 20).map((r, idx) => `
                  <div class="comp-lb-row">
                    <div class="comp-lb-rank">${idx + 1}.</div>
                    <div class="comp-lb-name">${escapeHtml(r.name)}</div>
                    <div class="comp-lb-points">${r.points}p</div>
                  </div>
                `).join('')}
              </div>
            ` : `<p class="comp-muted">Ingen konkurranser i valgt periode.</p>`}
          </div>

          <div class="comp-panel">
            <h4>Konkurranser i perioden</h4>
            ${filtered.length ? `
              <div class="comp-history-list">
                ${filtered.map((c) => `
                  <button class="comp-history-item" data-comp-action="openDetail" data-comp-id="${escapeHtml(c.id)}">
                    <div class="comp-history-title">${escapeHtml(c.title || 'Konkurranse')}</div>
                    <div class="comp-history-meta">${escapeHtml(new Date(c.createdAt).toLocaleString('nb-NO'))} • ${c.scoring === 'rank' ? 'Plasseringspoeng' : '3–2–1'}</div>
                  </button>
                `).join('')}
              </div>
            ` : `<p class="comp-muted">Ingen konkurranser i perioden.</p>`}

            <div class="comp-actions">
              <button class="btn-secondary comp-btn" data-comp-action="resetStore">Nullstill konkurranser</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderDetail(store, nameMap) {
    const comp = store.competitions.find((c) => c.id === ui.detailId);
    if (!comp) {
      ui.view = 'history';
      return '';
    }

    const totals = computeTotals(comp);
    const leaderboard = sortedLeaderboard(totals, comp.participantNames || nameMap);
    const n = comp.participantIds.length;

    const exList = (comp.exercises || []).map((ex, exIdx) => {
      const ranking = Array.isArray(ex.ranking) ? ex.ranking : [];
      const rows = ranking.map((pid, i) => {
        if (!pid) return '';
        const pts = scoringPoints(comp.scoring, i, n);
        const nm = (comp.participantNames || nameMap)[pid] || 'Ukjent';
        return `<div class="comp-detail-row"><span>${i + 1}.</span> <span>${escapeHtml(nm)}</span> <span class="comp-detail-pts">${pts}p</span></div>`;
      }).join('') || `<div class="comp-muted">Ingen registreringer</div>`;

      return `
        <div class="comp-detail-ex">
          <div class="comp-detail-exhead">
            <h4>${escapeHtml(ex.name || `Øvelse ${exIdx + 1}`)}</h4>
          </div>
          ${rows}
        </div>
      `;
    }).join('');

    return `
      <div class="comp-card">
        <div class="comp-history-head">
          <div>
            <h3>${escapeHtml(comp.title || 'Konkurranse')}</h3>
            <div class="comp-meta">${escapeHtml(new Date(comp.createdAt).toLocaleString('nb-NO'))} • ${comp.scoring === 'rank' ? 'Plasseringspoeng' : '3–2–1'}</div>
          </div>
          <div class="comp-actions">
            <button class="btn-secondary comp-btn" data-comp-action="backToHistory">Tilbake</button>
          </div>
        </div>

        <div class="comp-grid comp-grid--detail">
          <div class="comp-panel">
            <h4>Poengtavle</h4>
            <div class="comp-leaderboard">
              ${leaderboard.map((r, idx) => `
                <div class="comp-lb-row">
                  <div class="comp-lb-rank">${idx + 1}.</div>
                  <div class="comp-lb-name">${escapeHtml(r.name)}</div>
                  <div class="comp-lb-points">${r.points}p</div>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="comp-panel">
            <h4>Øvelser</h4>
            <div class="comp-detail-exlist">
              ${exList}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bindUI(store, players) {
    const root = getRoot();
    if (!root) return;

    root.onclick = (ev) => {
      const btn = ev.target.closest('[data-comp-action],[data-comp-view],[data-comp-ex]');
      if (!btn) return;

      const view = btn.getAttribute('data-comp-view');
      if (view) {
        if (view === 'running' && !ui.activeCompetitionId) return;
        ui.view = view;
        render();
        return;
      }

      const exIdx = btn.getAttribute('data-comp-ex');
      if (exIdx !== null && exIdx !== undefined) {
        ui.activeExerciseIndex = Number(exIdx) || 0;
        render();
        return;
      }

      const action = btn.getAttribute('data-comp-action');
      const value = btn.getAttribute('data-comp-value');
      const id = btn.getAttribute('data-comp-id');

      if (action === 'goPlayers') {
        const playersBtn = qs('.nav-btn[data-tab="players"]') || qs('[data-tab="players"]');
        if (playersBtn) playersBtn.click();
        return;
      }

      if (action === 'resetStore') {
        safeRemove(STORAGE_KEY());
        ui.view = 'setup';
        ui.activeCompetitionId = null;
        ui.detailId = null;
        render();
        return;
      }

      if (action === 'selectAll' || action === 'selectNone') {
        qsa('[data-comp-player]', root).forEach((el) => {
          el.checked = action === 'selectAll';
        });
        return;
      }

      if (action === 'generateExercises') {
        const count = Math.max(1, Math.min(50, Number(qs('#compExerciseCount', root)?.value || 5)));
        setExerciseInputs(count);
        return;
      }

      if (action === 'addExercise') {
        const container = $('compExerciseNames');
        if (!container) return;
        const current = qsa('.comp-ex-name', container).length;
        setExerciseInputs(Math.min(50, current + 1), true);
        return;
      }

      if (action === 'removeExercise') {
        const container = $('compExerciseNames');
        if (!container) return;
        const current = qsa('.comp-ex-name', container).length;
        setExerciseInputs(Math.max(1, current - 1), true);
        return;
      }

      if (action === 'startCompetition') {
        const selected = qsa('[data-comp-player]', root)
          .filter((el) => el.checked)
          .map((el) => el.getAttribute('data-comp-player'))
          .filter(Boolean);

        if (selected.length < 2) return showToast('Velg minst 2 deltakere', 'error');

        const exNames = qsa('.comp-ex-name', root)
          .map((inp) => String(inp.value || '').trim())
          .filter((v) => v.length > 0);

        if (exNames.length < 1) return showToast('Legg inn minst 1 øvelse', 'error');

        const scoring = (qs('input[name="compScoring"]:checked', root)?.value || 'rank') === '321' ? '321' : 'rank';
        const title = String(qs('#compTitle', root)?.value || '').trim();

        const createdAt = nowISO();
        const ym = toYearMonth(createdAt);

        const participantNames = {};
        for (const pid of selected) {
          const p = players.find((x) => x.id === pid);
          participantNames[pid] = p ? p.name : 'Ukjent';
        }

        const competition = {
          schemaVersion: 1,
          id: uuid(),
          title: title || '',
          createdAt,
          year: ym.year,
          month: ym.month,
          scoring,
          participantIds: selected,
          participantNames,
          exercises: exNames.map((name) => ({
            id: uuid(),
            name,
            ranking: Array(selected.length).fill(null)
          })),
          status: 'draft'
        };

        const storeRes = loadStore();
        const s = storeRes.data;
        s.competitions.push(competition);
        saveStore(s);

        ui.activeCompetitionId = competition.id;
        ui.view = 'running';
        ui.activeExerciseIndex = 0;
        render();
        return;
      }

      if (action === 'clearExercise' || action === 'copyPrevExercise') {
        const storeRes = loadStore();
        const s = storeRes.data;
        const comp = s.competitions.find((c) => c.id === ui.activeCompetitionId);
        if (!comp) return;

        const exIdx = ui.activeExerciseIndex;
        const ex = comp.exercises?.[exIdx];
        if (!ex) return;

        if (action === 'clearExercise') {
          ex.ranking = Array(comp.participantIds.length).fill(null);
        } else {
          const prev = comp.exercises?.[exIdx - 1];
          if (prev?.ranking) ex.ranking = prev.ranking.slice(0, comp.participantIds.length);
        }

        saveStore(s);
        render();
        return;
      }

      if (action === 'saveCompetition') {
        const storeRes = loadStore();
        saveStore(storeRes.data);
        showToast('Lagret', 'success');
        return;
      }

      if (action === 'finishCompetition') {
        const storeRes = loadStore();
        const s = storeRes.data;
        const comp = s.competitions.find((c) => c.id === ui.activeCompetitionId);
        if (!comp) return;
        comp.status = 'completed';
        saveStore(s);
        ui.view = 'history';
        ui.detailId = null;
        render();
        return;
      }

      if (action === 'exitToHistory') {
        ui.view = 'history';
        ui.detailId = null;
        render();
        return;
      }

      if (action === 'newCompetition') {
        ui.view = 'setup';
        ui.activeCompetitionId = null;
        ui.detailId = null;
        render();
        return;
      }

      if (action === 'setHistoryMode') {
        ui.historyMode = value === 'year' ? 'year' : 'month';
        render();
        return;
      }

      if (action === 'openDetail') {
        ui.view = 'detail';
        ui.detailId = id;
        render();
        return;
      }

      if (action === 'backToHistory') {
        ui.view = 'history';
        ui.detailId = null;
        render();
        return;
      }
    };

    root.onchange = (ev) => {
      const t = ev.target;

      if (t && t.matches('.comp-select[data-comp-place]')) {
        const placeIdx = Number(t.getAttribute('data-comp-place') || 0);

        const storeRes = loadStore();
        const s = storeRes.data;
        const comp = s.competitions.find((c) => c.id === ui.activeCompetitionId);
        if (!comp) return;

        const ex = comp.exercises?.[ui.activeExerciseIndex];
        if (!ex) return;

        if (!Array.isArray(ex.ranking)) ex.ranking = Array(comp.participantIds.length).fill(null);
        ex.ranking[placeIdx] = t.value || null;

        const seen = new Set();
        for (let i = 0; i < ex.ranking.length; i++) {
          const pid = ex.ranking[i];
          if (!pid) continue;
          if (seen.has(pid)) ex.ranking[i] = null;
          else seen.add(pid);
        }

        saveStore(s);
        render();
        return;
      }

      if (t && t.id === 'compHistYear') {
        ui.historyYear = Number(t.value) || ui.historyYear;
        render();
        return;
      }

      if (t && t.id === 'compHistMonth') {
        ui.historyMonth = Number(t.value) || ui.historyMonth;
        render();
        return;
      }
    };

    if (ui.view === 'setup') {
      setExerciseInputs(5, false);
    }
  }

  function setExerciseInputs(count, keepExisting) {
    const container = $('compExerciseNames');
    if (!container) return;

    const existing = keepExisting ? qsa('.comp-ex-name', container).map((i) => i.value) : [];
    container.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const val = existing[i] || '';
      container.insertAdjacentHTML(
        'beforeend',
        `<div class="comp-row">
           <label class="comp-label">Øvelse ${i + 1}</label>
           <input class="comp-input comp-ex-name" type="text" placeholder="F.eks. Dribleløype" value="${escapeHtml(val)}">
         </div>`
      );
    }
  }

  function showToast(msg, type) {
    if (typeof window.showNotification === 'function') {
      window.showNotification(msg, type === 'error' ? 'error' : 'success');
      return;
    }
    console.log(`[Konkurranser] ${type || 'info'}: ${msg}`);
  }

  // Hooks: render når tab åpnes, og når spillere endres
  
  // Migrate data from anon key to real user key (fixes early-evaluation bug)
  function migrateAnonData() {
    try {
      const prefix = getUserKeyPrefix();
      if (prefix === 'bft:anon:') return; // Still anon, nothing to migrate
      
      const anonKey = 'bft:anon:competitions';
      const anonRaw = safeGet(anonKey);
      if (!anonRaw) return; // No anon data to migrate
      
      const realKey = STORAGE_KEY();
      const realRaw = safeGet(realKey);
      
      if (!realRaw) {
        // No data under real key yet — move anon data there
        safeSet(realKey, anonRaw);
        safeRemove(anonKey);
        console.log('[Competitions] Migrated data from anon key to', realKey);
      } else {
        // Both exist — merge competitions arrays
        try {
          const anonData = JSON.parse(anonRaw);
          const realData = JSON.parse(realRaw);
          const existingIds = new Set((realData.competitions || []).map(c => c.id));
          const newComps = (anonData.competitions || []).filter(c => !existingIds.has(c.id));
          if (newComps.length > 0) {
            realData.competitions = [...(realData.competitions || []), ...newComps];
            safeSet(realKey, JSON.stringify(realData));
            console.log('[Competitions] Merged', newComps.length, 'competitions from anon key');
          }
          safeRemove(anonKey);
        } catch (e) {
          console.warn('[Competitions] Migration merge failed:', e);
        }
      }
    } catch (e) {
      console.warn('[Competitions] Migration failed:', e);
    }
  }

  // Register event listener IMMEDIATELY
  console.log('[Competitions] Script loaded - registering event listener');
  window.addEventListener('players:updated', (e) => {
    console.log('[Competitions] players:updated event mottatt:', e.detail);
    render();
  });
  
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn[data-tab="competitions"]');
    if (btn) {
      console.log('[Competitions] Tab klikket - renderer nå');
      if (ui.view === 'detail') ui.view = 'history';
      render();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Competitions] DOMContentLoaded - sjekker players...');
    // Render umiddelbart hvis spillere finnes
    const players = getPlayersSnapshot();
    console.log('[Competitions] Initial players:', players.length);
    if (players.length > 0) {
      console.log('[Competitions] Spillere allerede tilgjengelig - renderer');
      render();
    }
  });

  window.competitions = {
    render,
    _debug: {
      get key() { return STORAGE_KEY(); },
      loadStore,
      saveStore
    }
  };

  // Auth timing fix: competitions may have been loaded/saved with 'anon' key
  // if auth wasn't ready at IIFE execution. Rehydrate once auth resolves.
  (function rehydrateAfterAuth() {
    const initialPrefix = getUserKeyPrefix();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const currentPrefix = getUserKeyPrefix();
      if (currentPrefix !== initialPrefix) {
        clearInterval(timer);
        console.log('[Competitions] auth resolved, rehydrating storage from', initialPrefix, '→', currentPrefix);
        migrateAnonData();
        render();
      } else if (attempts >= 40) {
        // 40 × 150ms = 6s — give up
        clearInterval(timer);
      }
    }, 150);
  })();
})();
