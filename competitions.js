/* competitions.js – Barnefotballtrener: Konkurranser (Mesternes mester)
   - Vanilla JS
   - Ingen eksterne libs
   - Ingen regresjoner: isolert modul
   - Lagring per bruker med samme key-prefix som core.js: bft:${uid}:*
*/
(function () {
  'use strict';

  // Eneste globale navnrom (krav)
  window.competitions = window.competitions || {};

  // -------------------------------
  // Små helpers (lokale)
  // -------------------------------
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const _mem = new Map(); // fallback hvis storage blokkes

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return _mem.has(key) ? _mem.get(key) : null;
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

  // Samme nøkkelprefix som i core.js
  function getUserKeyPrefix() {
    try {
      const uid = window.authService?.getUserId?.() || 'anon';
      return `bft:${uid}:`;
    } catch {
      return 'bft:anon:';
    }
  }
  const k = (suffix) => getUserKeyPrefix() + suffix;

  // Ikke krasj hvis showNotification ikke finnes
  function notify(msg, type = 'info') {
    if (typeof window.showNotification === 'function') return window.showNotification(msg, type);
    console.log(`[${type}] ${msg}`);
  }

  function uuid() {
    // liten og trygg nok for lokale objekter
    return 'c_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function ymKeyFromISO(iso) {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`; // "2026-01"
  }

  // -------------------------------
  // Datamodell (lokal)
  // -------------------------------
  const SCHEMA_VERSION = 1;

  const defaultStore = () => ({
    schemaVersion: SCHEMA_VERSION,
    items: [] // Competition[]
  });

  // Competition:
  // {
  //   id, schemaVersion,
  //   createdAt, year, month, ym,
  //   name,
  //   scoring: "rank" | "321",
  //   participants: [{ id, name }],
  //   exercises: [{
  //     id, name,
  //     ranking: { "1": playerId, "2": playerId, ... }  // plass -> playerId
  //   }]
  // }

  function loadStore() {
    const raw = safeGet(k('competitions'));
    if (!raw) return { ok: true, data: defaultStore() };

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad json');
      if (!Array.isArray(parsed.items)) throw new Error('bad items');

      // schemaVersion toleranse
      if (!parsed.schemaVersion) parsed.schemaVersion = SCHEMA_VERSION;

      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, error: 'Konkurranse-data ser korrupt ut i lagring.' };
    }
  }

  function saveStore(store) {
    safeSet(k('competitions'), JSON.stringify(store));
  }

  // -------------------------------
  // State for UI (ikke lagret før "Lagre konkurranse")
  // -------------------------------
  const state = {
    started: false,
    draft: null, // Competition under bygging
    players: [], // fra window.players (bare id + name brukes!)
    store: null,
    storeOk: true
  };

  // -------------------------------
  // Hent spillere (uten nivå!)
  // -------------------------------
  function readPlayers() {
    const arr = Array.isArray(window.players) ? window.players : [];
    // IKKE bruk skill/goalie i UI her
    state.players = arr
      .filter(p => p && p.id && p.name)
      .map(p => ({ id: String(p.id), name: String(p.name) }));
  }

  // -------------------------------
  // UI – HTML container må finnes
  // -------------------------------
  function getRoot() {
    return $('competitions');
  }

  function ensureBaseMarkup() {
    const root = getRoot();
    if (!root) return false;

    // Hvis du allerede har markup, lar vi den stå – men vi krever en container å tegne inn i.
    let host = qs('.comp-host', root);
    if (!host) {
      // Hvis du har en placeholder, erstatt innmaten kontrollert
      root.innerHTML = `
        <div class="comp-wrap">
          <div class="comp-header">
            <div class="comp-title">
              <div class="comp-title-row">
                <i class="fa-solid fa-medal comp-icon"></i>
                <h2>Konkurranser</h2>
              </div>
              <p class="comp-sub">Mesternes mester: velg deltakere, legg inn øvelser og registrer plasseringer – poengsummer oppdateres automatisk.</p>
            </div>
          </div>

          <div class="comp-host"></div>
        </div>
      `;
      host = qs('.comp-host', root);
    }
    return !!host;
  }

  function render() {
    const root = getRoot();
    if (!root) return;
    if (!ensureBaseMarkup()) return;

    const host = qs('.comp-host', root);

    // 1) storage korrupt
    if (!state.storeOk) {
      host.innerHTML = `
        <div class="comp-card comp-warning">
          <h3>Kunne ikke lese konkurranse-data</h3>
          <p>Dette kan skje hvis lagringen ble avbrutt eller noe ble lagret feil.</p>
          <div class="comp-actions">
            <button class="comp-btn comp-btn-danger" id="compResetBtn" type="button">Nullstill konkurranser</button>
          </div>
        </div>
      `;
      const btn = $('compResetBtn');
      if (btn) {
        btn.onclick = () => {
          safeRemove(k('competitions'));
          state.storeOk = true;
          state.store = defaultStore();
          state.started = false;
          state.draft = null;
          notify('Konkurranser nullstilt', 'success');
          render();
        };
      }
      return;
    }

    // 2) ingen spillere
    if (!state.players.length) {
      host.innerHTML = `
        <div class="comp-card">
          <h3>Ingen spillere funnet</h3>
          <p>For å bruke Konkurranser må du først legge inn spillere.</p>
          <div class="comp-actions">
            <button class="comp-btn comp-btn-primary" id="compGoPlayersBtn" type="button">Gå til Spillere</button>
          </div>
        </div>
      `;
      const btn = $('compGoPlayersBtn');
      if (btn) {
        btn.onclick = () => {
          // core.js bruker data-tab og hash
          const b = qs('.nav-btn[data-tab="players"]');
          if (b) b.click();
          else location.hash = '#players';
        };
      }
      return;
    }

    // 3) hvis ikke startet: vis opprett + historikk
    if (!state.started || !state.draft) {
      host.innerHTML = `
        <div class="comp-grid">
          <div class="comp-card">
            <h3>Start ny konkurranse</h3>

            <label class="comp-label">Navn (valgfritt)</label>
            <input class="comp-input" id="compName" type="text" placeholder="F.eks. Januar – presisjon & skudd">

            <label class="comp-label">Poengstruktur</label>
            <div class="comp-radio-row">
              <label class="comp-radio">
                <input type="radio" name="compScoring" value="rank" checked>
                <span>Plasseringspoeng (N, N-1, N-2 …)</span>
              </label>
              <label class="comp-radio">
                <input type="radio" name="compScoring" value="321">
                <span>3–2–1 (topp 3)</span>
              </label>
            </div>

            <label class="comp-label">Velg deltakere</label>
            <div class="comp-players" id="compPlayersPick"></div>

            <label class="comp-label">Antall øvelser</label>
            <input class="comp-input" id="compExerciseCount" type="number" min="1" max="40" value="5">

            <div class="comp-actions">
              <button class="comp-btn comp-btn-primary" id="compStartBtn" type="button">Start konkurranse</button>
            </div>

            <p class="comp-hint">Tips: Du kan ha “mange” øvelser, men antallet må settes før start (for å holde flyten enkel på mobil).</p>
          </div>

          <div class="comp-card">
            <div class="comp-history-head">
              <h3>Historikk</h3>
              <div class="comp-history-filters">
                <select class="comp-select" id="compHistoryYear"></select>
                <select class="comp-select" id="compHistoryMonth"></select>
              </div>
            </div>
            <div class="comp-history" id="compHistory"></div>
          </div>
        </div>
      `;

      renderPlayersPicker();
      renderHistoryFilters();
      renderHistoryList();

      const startBtn = $('compStartBtn');
      if (startBtn) startBtn.onclick = startDraft;

      return;
    }

    // 4) started: vis registrering + poengtavle
    host.innerHTML = `
      <div class="comp-grid comp-grid-2">
        <div class="comp-card">
          <div class="comp-live-head">
            <h3>Registrer plasseringer</h3>
            <div class="comp-actions">
              <button class="comp-btn" id="compCancelBtn" type="button">Avbryt</button>
              <button class="comp-btn comp-btn-primary" id="compSaveBtn" type="button">Lagre konkurranse</button>
            </div>
          </div>

          <div class="comp-meta">
            <div><strong>Deltakere:</strong> <span id="compMetaPlayers"></span></div>
            <div><strong>Poeng:</strong> <span id="compMetaScoring"></span></div>
          </div>

          <div id="compExercises"></div>
        </div>

        <div class="comp-card">
          <h3>Poengtavle</h3>
          <div class="comp-table-wrap">
            <table class="comp-table">
              <thead>
                <tr>
                  <th>Spiller</th>
                  <th class="comp-num">Poeng</th>
                </tr>
              </thead>
              <tbody id="compScoreboard"></tbody>
            </table>
          </div>
          <p class="comp-hint">Poeng oppdateres live når du endrer plasseringer.</p>
        </div>
      </div>
    `;

    const cancelBtn = $('compCancelBtn');
    const saveBtn = $('compSaveBtn');
    if (cancelBtn) cancelBtn.onclick = cancelDraft;
    if (saveBtn) saveBtn.onclick = saveDraft;

    renderDraftMeta();
    renderExercises();
    renderScoreboard();

    return;
  }

  function renderPlayersPicker() {
    const box = $('compPlayersPick');
    if (!box) return;

    box.innerHTML = state.players.map(p => `
      <label class="comp-check">
        <input type="checkbox" value="${escapeHtml(p.id)}" checked>
        <span>${escapeHtml(p.name)}</span>
      </label>
    `).join('');
  }

  function renderHistoryFilters() {
    const yearSel = $('compHistoryYear');
    const monthSel = $('compHistoryMonth');
    if (!yearSel || !monthSel) return;

    // år-choices basert på innhold + nåværende år
    const now = new Date();
    const currentYear = now.getFullYear();

    const yearsInData = new Set((state.store?.items || []).map(x => x.year).filter(Boolean));
    yearsInData.add(currentYear);

    const years = Array.from(yearsInData).sort((a, b) => b - a);

    yearSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

    const months = [
      ['01', 'Januar'], ['02', 'Februar'], ['03', 'Mars'], ['04', 'April'],
      ['05', 'Mai'], ['06', 'Juni'], ['07', 'Juli'], ['08', 'August'],
      ['09', 'September'], ['10', 'Oktober'], ['11', 'November'], ['12', 'Desember'],
    ];
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    monthSel.innerHTML = months.map(([m, label]) => `<option value="${m}" ${m === mm ? 'selected' : ''}>${label}</option>`).join('');
    yearSel.value = String(currentYear);

    yearSel.onchange = () => renderHistoryList();
    monthSel.onchange = () => renderHistoryList();
  }

  function renderHistoryList() {
    const wrap = $('compHistory');
    if (!wrap) return;

    const yearSel = $('compHistoryYear');
    const monthSel = $('compHistoryMonth');

    const year = Number(yearSel?.value);
    const month = String(monthSel?.value || '').padStart(2, '0');
    const ym = `${year}-${month}`;

    const items = (state.store?.items || []).filter(c => c.ym === ym);

    if (!items.length) {
      wrap.innerHTML = `
        <div class="comp-empty">
          <p>Ingen konkurranser lagret for ${ym}.</p>
        </div>
      `;
      return;
    }

    // Toppliste for måneden (summerer poeng på tvers av konkurranser i ym)
    const monthTotals = computeTotalsAcross(items);
    const topHtml = monthTotals
      .slice(0, 10)
      .map((r, idx) => `<div class="comp-rank-row"><span>${idx + 1}. ${escapeHtml(r.name)}</span><strong>${r.points}</strong></div>`)
      .join('');

    const listHtml = items
      .slice()
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(c => `
        <button class="comp-history-item" type="button" data-id="${escapeHtml(c.id)}">
          <div class="comp-history-title">${escapeHtml(c.name || 'Konkurranse')}</div>
          <div class="comp-history-meta">${escapeHtml(formatDateShort(c.createdAt))} • ${escapeHtml(c.scoring === 'rank' ? 'Plasseringspoeng' : '3–2–1')} • ${c.participants?.length || 0} deltakere</div>
        </button>
      `).join('');

    wrap.innerHTML = `
      <div class="comp-subcard">
        <div class="comp-subcard-head">
          <h4>Toppliste – måned</h4>
        </div>
        <div>${topHtml}</div>
      </div>

      <div class="comp-subcard">
        <div class="comp-subcard-head">
          <h4>Konkurranser</h4>
        </div>
        <div class="comp-history-list">${listHtml}</div>
      </div>
    `;

    qsa('.comp-history-item', wrap).forEach(btn => {
      btn.onclick = () => openDetails(btn.getAttribute('data-id'));
    });
  }

  function openDetails(id) {
    const c = (state.store?.items || []).find(x => x.id === id);
    if (!c) return;

    // enkel detaljvisning i samme panel (mobilvennlig)
    const wrap = $('compHistory');
    if (!wrap) return;

    const totals = computeTotals(c);

    wrap.innerHTML = `
      <div class="comp-subcard">
        <div class="comp-subcard-head">
          <h4>${escapeHtml(c.name || 'Konkurranse')}</h4>
          <button class="comp-btn" id="compBackToHistory" type="button">Tilbake</button>
        </div>

        <div class="comp-detail-meta">
          <div><strong>Dato:</strong> ${escapeHtml(formatDateLong(c.createdAt))}</div>
          <div><strong>Poeng:</strong> ${escapeHtml(c.scoring === 'rank' ? 'Plasseringspoeng' : '3–2–1')}</div>
          <div><strong>Deltakere:</strong> ${escapeHtml((c.participants || []).map(p => p.name).join(', '))}</div>
        </div>

        <h5 class="comp-h5">Poengtavle</h5>
        <div class="comp-table-wrap">
          <table class="comp-table">
            <thead><tr><th>Spiller</th><th class="comp-num">Poeng</th></tr></thead>
            <tbody>
              ${totals.map(r => `<tr><td>${escapeHtml(r.name)}</td><td class="comp-num">${r.points}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <h5 class="comp-h5">Øvelser</h5>
        <div class="comp-ex-detail">
          ${(c.exercises || []).map(ex => `
            <div class="comp-ex-block">
              <div class="comp-ex-name">${escapeHtml(ex.name || 'Øvelse')}</div>
              <div class="comp-ex-rows">
                ${Object.keys(ex.ranking || {}).sort((a,b)=>Number(a)-Number(b)).map(place => {
                  const pid = ex.ranking[place];
                  const pname = (c.participants || []).find(p => p.id === pid)?.name || '—';
                  return `<div class="comp-ex-row"><span>#${place}</span><strong>${escapeHtml(pname)}</strong></div>`;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const back = $('compBackToHistory');
    if (back) back.onclick = () => renderHistoryList();
  }

  // -------------------------------
  // Start / bygg draft
  // -------------------------------
  function startDraft() {
    const name = String($('compName')?.value || '').trim();
    const scoring = String(qs('input[name="compScoring"]:checked')?.value || 'rank');
    const count = Number($('compExerciseCount')?.value || 0);

    const picked = qsa('#compPlayersPick input[type="checkbox"]:checked')
      .map(ch => String(ch.value))
      .filter(Boolean);

    if (picked.length < 2) return notify('Velg minst 2 deltakere', 'error');
    if (!Number.isFinite(count) || count < 1) return notify('Antall øvelser må være minst 1', 'error');
    if (count > 40) return notify('Maks 40 øvelser (for å holde det raskt på mobil)', 'error');

    const participants = picked
      .map(id => state.players.find(p => p.id === id))
      .filter(Boolean);

    const createdAt = nowISO();
    const d = new Date(createdAt);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const ym = ymKeyFromISO(createdAt);

    const exercises = Array.from({ length: count }).map((_, i) => ({
      id: uuid(),
      name: `Øvelse ${i + 1}`,
      ranking: {} // place->playerId
    }));

    state.draft = {
      id: uuid(),
      schemaVersion: SCHEMA_VERSION,
      createdAt,
      year,
      month,
      ym,
      name,
      scoring: scoring === '321' ? '321' : 'rank',
      participants,
      exercises
    };
    state.started = true;

    render();
  }

  function cancelDraft() {
    if (!confirm('Avbryte konkurransen? (Ingenting lagres)')) return;
    state.started = false;
    state.draft = null;
    render();
  }

  function saveDraft() {
    if (!state.draft) return;

    // enkel validering: alle øvelser bør ha minst 1. plass
    const N = state.draft.participants.length;
    for (const ex of state.draft.exercises) {
      if (!ex.ranking || !ex.ranking['1']) {
        return notify('Fyll inn minst 1. plass i hver øvelse før du lagrer', 'error');
      }
      // valider at ingen spiller er brukt to ganger i samme øvelse (hvis det har skjedd via manipulasjon)
      const seen = new Set();
      for (let p = 1; p <= N; p++) {
        const pid = ex.ranking[String(p)];
        if (!pid) continue;
        if (seen.has(pid)) return notify('Samme spiller kan ikke ha to plasseringer i samme øvelse', 'error');
        seen.add(pid);
      }
    }

    const store = state.store || defaultStore();
    store.items = Array.isArray(store.items) ? store.items : [];
    store.items.push(state.draft);
    saveStore(store);

    state.store = store;
    state.started = false;
    state.draft = null;

    notify('Konkurranse lagret', 'success');
    render();
  }

  // -------------------------------
  // Registrering UI
  // -------------------------------
  function renderDraftMeta() {
    const d = state.draft;
    if (!d) return;

    const metaPlayers = $('compMetaPlayers');
    const metaScoring = $('compMetaScoring');

    if (metaPlayers) metaPlayers.textContent = `${d.participants.length} spillere`;
    if (metaScoring) metaScoring.textContent = d.scoring === 'rank' ? 'Plasseringspoeng' : '3–2–1';
  }

  function renderExercises() {
    const wrap = $('compExercises');
    const d = state.draft;
    if (!wrap || !d) return;

    const N = d.participants.length;

    wrap.innerHTML = d.exercises.map((ex, idx) => {
      const rows = Array.from({ length: N }).map((_, i) => {
        const place = i + 1;
        return `
          <div class="comp-place-row">
            <div class="comp-place-num">#${place}</div>
            <select class="comp-select comp-place-select" data-ex="${escapeHtml(ex.id)}" data-place="${place}">
              ${renderPlaceOptions(d.participants, ex.ranking[String(place)] || '')}
            </select>
          </div>
        `;
      }).join('');

      return `
        <div class="comp-ex-card">
          <div class="comp-ex-head">
            <div class="comp-ex-left">
              <div class="comp-ex-label">Øvelse ${idx + 1}</div>
              <input class="comp-input comp-ex-name" data-ex="${escapeHtml(ex.id)}" type="text" value="${escapeHtml(ex.name || '')}">
            </div>
          </div>
          <div class="comp-place-grid">
            ${rows}
          </div>
        </div>
      `;
    }).join('');

    // bind navneendring
    qsa('.comp-ex-name', wrap).forEach(inp => {
      inp.oninput = () => {
        const exId = inp.getAttribute('data-ex');
        const ex = d.exercises.find(x => x.id === exId);
        if (ex) ex.name = String(inp.value || '').trim().slice(0, 50);
      };
    });

    // bind plassering-selects
    qsa('.comp-place-select', wrap).forEach(sel => {
      sel.onchange = () => {
        const exId = sel.getAttribute('data-ex');
        const place = String(sel.getAttribute('data-place'));
        const ex = d.exercises.find(x => x.id === exId);
        if (!ex) return;

        const pid = String(sel.value || '');
        if (!ex.ranking) ex.ranking = {};

        // set
        if (!pid) delete ex.ranking[place];
        else ex.ranking[place] = pid;

        // håndhev unikhet: hvis samme spiller finnes på annen plass, fjern den (enkelt og tydelig)
        if (pid) {
          Object.keys(ex.ranking).forEach(pl => {
            if (pl !== place && ex.ranking[pl] === pid) delete ex.ranking[pl];
          });
        }

        // re-render bare denne øvelsen sine select options (enkelt og robust)
        renderExercises();
        renderScoreboard();
      };
    });
  }

  function renderPlaceOptions(participants, selectedId) {
    const opts = [`<option value="">— velg spiller —</option>`];
    for (const p of participants) {
      const sel = p.id === selectedId ? 'selected' : '';
      opts.push(`<option value="${escapeHtml(p.id)}" ${sel}>${escapeHtml(p.name)}</option>`);
    }
    return opts.join('');
  }

  function computeTotals(comp) {
    const participants = comp.participants || [];
    const N = participants.length;
    const totals = new Map(participants.map(p => [p.id, { id: p.id, name: p.name, points: 0 }]));

    for (const ex of (comp.exercises || [])) {
      const ranking = ex.ranking || {};
      for (let place = 1; place <= N; place++) {
        const pid = ranking[String(place)];
        if (!pid || !totals.has(pid)) continue;

        let pts = 0;
        if (comp.scoring === 'rank') pts = (N - place + 1);
        else pts = (place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0);

        totals.get(pid).points += pts;
      }
    }

    return Array.from(totals.values()).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }

  function computeTotalsAcross(comps) {
    const totals = new Map(); // pid -> {name, points}
    for (const c of comps) {
      for (const row of computeTotals(c)) {
        const prev = totals.get(row.id) || { id: row.id, name: row.name, points: 0 };
        prev.points += row.points;
        totals.set(row.id, prev);
      }
    }
    return Array.from(totals.values()).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }

  function renderScoreboard() {
    const body = $('compScoreboard');
    const d = state.draft;
    if (!body || !d) return;

    const rows = computeTotals(d);
    body.innerHTML = rows.map(r => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td class="comp-num">${r.points}</td>
      </tr>
    `).join('');
  }

  // -------------------------------
  // Init / events
  // -------------------------------
  function init() {
    // last store
    const loaded = loadStore();
    state.storeOk = loaded.ok;
    state.store = loaded.ok ? loaded.data : null;

    // les spillere
    readPlayers();

    // re-render når spillere endres i Players-modulen
    document.addEventListener('players:updated', () => {
      readPlayers();
      // kun re-render hvis vi er på konkurranser eller på start-skjerm
      renderIfVisible();
    });

    // render ved navigasjon til tab
    window.addEventListener('hashchange', renderIfVisible);

    const navBtn = qs('.nav-btn[data-tab="competitions"]');
    if (navBtn) navBtn.addEventListener('click', () => setTimeout(renderIfVisible, 0));

    // første render hvis tabben allerede er valgt
    renderIfVisible();
  }

  function renderIfVisible() {
    const hash = String(location.hash || '').replace('#', '');
    if (hash === 'competitions') render();
  }

  // små formattere
  function formatDateShort(iso) {
    try {
      const d = new Date(iso);
      return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
    } catch {
      return '';
    }
  }
  function formatDateLong(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('nb-NO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // eksponer minimal API
  window.competitions.reset = function () {
    safeRemove(k('competitions'));
    state.storeOk = true;
    state.store = defaultStore();
    state.started = false;
    state.draft = null;
    notify('Konkurranser nullstilt', 'success');
    renderIfVisible();
  };
})();
