// Barnefotballtrener - core.js
// ================================================
// Kjernelogikk for appen (spillere, navigasjon, trening, kamp, liga).
// Mål: stabil drift uten "white screen" + robust state.
// Viktig: Vis aldri ferdighetsnivå i Trening/Kamp (kun i Spillere).

/* global showNotification */

(function () {
  'use strict';

  // -----------------------------
  // Utilities
  // -----------------------------

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function clamp(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Randomiser ties innenfor samme ferdighetsnivå hver gang (for variasjon)
  function sortBySkillWithRandomTies(players) {
    const buckets = new Map();
    for (const p of players) {
      const key = Number(p.skill) || 0;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }
    const keys = Array.from(buckets.keys()).sort((a, b) => b - a);
    const out = [];
    for (const k of keys) {
      out.push(...shuffle(buckets.get(k)));
    }
    return out;
  }

  function safeParseJSON(text, fallback) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  // -----------------------------
  // State
  // -----------------------------

  const DEFAULT_STATE = {
    players: [],
    settings: {
      useSkill: true,
    },
    liga: null,
  };

  const state = {
    players: [],
    settings: { ...DEFAULT_STATE.settings },
    liga: null,
  };

  // Robust lagring (kan feile i Edge/Tracking Prevention)
  const STORAGE_KEY = 'bft_state_v1';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = safeParseJSON(raw, null);
      if (!parsed) return;

      if (Array.isArray(parsed.players)) state.players = parsed.players;
      if (parsed.settings && typeof parsed.settings === 'object') {
        state.settings.useSkill = Boolean(parsed.settings.useSkill);
      }
      if (parsed.liga && typeof parsed.liga === 'object') state.liga = parsed.liga;
    } catch {
      // fallback: nothing
    }
  }

  function saveState() {
    try {
      const payload = JSON.stringify({
        players: state.players,
        settings: state.settings,
        liga: state.liga,
      });
      localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      // ignore
    }
  }

  function emitPlayersUpdated() {
    try {
      window.dispatchEvent(new CustomEvent('players:updated', { detail: { players: state.players } }));
    } catch {
      // ignore
    }
  }

  // Expose global players for kampdag.js compatibility
  function syncGlobalPlayers() {
    window.players = state.players;
  }

  // -----------------------------
  // Tabs / navigation
  // -----------------------------

  function setActiveTab(tabId) {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach((btn) => btn.classList.remove('active'));
    contents.forEach((c) => c.classList.remove('active'));

    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const tabContent = $(tabId);

    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');
  }

  function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        if (!tabId) return;
        setActiveTab(tabId);

        // Liga trenger en render-hook
        if (tabId === 'liga') {
          renderLigaFromState();
        }
      });
    });
  }

  // -----------------------------
  // Players UI
  // -----------------------------

  function normalizePlayer(p) {
    const name = String(p?.name ?? '').trim();
    const skill = clamp(p?.skill ?? 3, 1, 6);
    const goalie = Boolean(p?.goalie);
    const id = String(p?.id ?? crypto.randomUUID());
    return { id, name, skill, goalie };
  }

  function addPlayer(player) {
    const p = normalizePlayer(player);
    if (!p.name) {
      showNotification?.('Skriv inn navn', 'error');
      return;
    }
    state.players.push(p);
    saveState();
    syncGlobalPlayers();
    renderPlayersUI();
    emitPlayersUpdated();
  }

  function updatePlayer(id, patch) {
    const idx = state.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const prev = state.players[idx];
    state.players[idx] = normalizePlayer({ ...prev, ...patch, id: prev.id });
    saveState();
    syncGlobalPlayers();
    renderPlayersUI();
    emitPlayersUpdated();
  }

  function removePlayer(id) {
    state.players = state.players.filter((p) => p.id !== id);
    saveState();
    syncGlobalPlayers();
    renderPlayersUI();
    emitPlayersUpdated();
  }

  function clearPlayers() {
    state.players = [];
    saveState();
    syncGlobalPlayers();
    renderPlayersUI();
    emitPlayersUpdated();
  }

  function renderPlayersUI() {
    // Counters
    const total = state.players.length;
    const goalies = state.players.filter((p) => p.goalie).length;
    const active = total;

    if ($('playerCount')) $('playerCount').textContent = String(total);
    if ($('goalieCount')) $('goalieCount').textContent = String(goalies);
    if ($('activeCount')) $('activeCount').textContent = String(active);

    // List
    const list = $('playerList');
    if (list) {
      list.innerHTML = '';
      state.players.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'player-row';

        // NB: Ferdighetsnivå vises kun her (Spillere)
        row.innerHTML = `
          <div class="player-info">
            <div class="player-name">${escapeHtml(p.name)} ${p.goalie ? ' 🧤' : ''}</div>
            <div class="player-meta">${state.settings.useSkill ? `Ferdighetsnivå: ${p.skill}` : ''}</div>
          </div>
          <div class="player-actions">
            <button class="btn-small edit" data-id="${escapeHtml(p.id)}">Rediger</button>
            <button class="btn-small delete" data-id="${escapeHtml(p.id)}">Fjern</button>
          </div>
        `;
        list.appendChild(row);
      });

      // bind buttons
      list.querySelectorAll('button.edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const p = state.players.find((x) => x.id === id);
          if (!p) return;

          // Simple inline edit via prompt (minimalt inngrep)
          const newName = prompt('Navn:', p.name);
          if (newName === null) return;

          let skill = p.skill;
          if (state.settings.useSkill) {
            const newSkill = prompt('Ferdighetsnivå (1-6):', String(p.skill));
            if (newSkill === null) return;
            const v = Number(newSkill);
            if (Number.isFinite(v)) skill = Math.max(1, Math.min(6, Math.round(v)));
          }

          const newGoalie = confirm('Kan stå i mål? (OK = Ja, Avbryt = Nei)');
          updatePlayer(p.id, { name: newName, skill, goalie: newGoalie });
        });
      });

      list.querySelectorAll('button.delete').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          if (!id) return;
          removePlayer(id);
        });
      });
    }

    // Update training & match selections
    renderTrainingSelection();
    renderMatchSelection();
    renderKampdagSelection();

    // If liga exists, keep it aligned with players (optional)
    // (We do not auto-delete league teams; user can reset)
 Нав
  }

  function setupPlayersUI() {
    const useSkillToggle = $('useSkillToggle');
    if (useSkillToggle) {
      useSkillToggle.checked = !!state.settings.useSkill;
      useSkillToggle.addEventListener('change', () => {
        state.settings.useSkill = !!useSkillToggle.checked;
        saveState();
        renderPlayersUI();
      });
    }

    const nameInput = $('playerName');
    const skillSelect = $('playerSkill');
    const goalieCheckbox = $('playerGoalie');
    const addBtn = $('addPlayerBtn');
    const clearBtn = $('clearPlayersBtn');

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const name = String(nameInput?.value ?? '').trim();
        const skill = Number(skillSelect?.value ?? 3);
        const goalie = !!goalieCheckbox?.checked;
        addPlayer({ name, skill, goalie });

        if (nameInput) nameInput.value = '';
        if (goalieCheckbox) goalieCheckbox.checked = false;
        if (skillSelect) skillSelect.value = String(3);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Er du sikker på at du vil slette alle spillere?')) {
          clearPlayers();
        }
      });
    }

    // Export / Import
    const exportBtn = $('exportPlayersBtn');
    const importBtn = $('importPlayersBtn');
    const importInput = $('importPlayersInput');

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const data = JSON.stringify(state.players, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spillere.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      });
    }

    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = safeParseJSON(text, null);
          if (!Array.isArray(parsed)) throw new Error('Ugyldig filformat');
          state.players = parsed.map(normalizePlayer);
          saveState();
          syncGlobalPlayers();
          renderPlayersUI();
          emitPlayersUpdated();
          showNotification?.('Spillere importert', 'success');
        } catch (e) {
          console.error(e);
          showNotification?.('Kunne ikke importere fil', 'error');
        } finally {
          importInput.value = '';
        }
      });
    }
  }

  // -----------------------------
  // Training
  // -----------------------------

  function renderTrainingSelection() {
    const container = $('trainingSelection');
    if (!container) return;
    container.innerHTML = '';

    state.players.forEach((p) => {
      const label = document.createElement('label');
      label.className = 'checkbox-row';
      label.innerHTML = `
        <input type="checkbox" data-id="${escapeHtml(p.id)}" checked>
        <span>${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</span>
      `;
      container.appendChild(label);
    });
  }

  function getSelectedPlayers(selectionContainerId) {
    const container = $(selectionContainerId);
    if (!container) return [];
    const ids = Array.from(container.querySelectorAll('input[type="checkbox"][data-id]'))
      .filter((inp) => inp.checked)
      .map((inp) => inp.getAttribute('data-id'))
      .filter(Boolean);

    return state.players.filter((p) => ids.includes(p.id));
  }

  // DIFFERENSIERING: grupper i rekkefølge (beste sammen, osv.)
  function makeDifferentiatedGroups(players, groupCount) {
    const n = Math.max(2, Math.min(6, Number(groupCount) || 2));
    if (!state.settings.useSkill) {
      return null; // håndteres i UI
    }

    const list = sortBySkillWithRandomTies(players);
    const total = list.length;

    const base = Math.floor(total / n);
    const extra = total % n; // de første "extra" gruppene får +1
    const sizes = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));

    const groups = [];
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const size = sizes[i];
      groups.push(list.slice(cursor, cursor + size));
      cursor += size;
    }
    return groups;
  }

  // Generisk "jevne lag" for 2..6 lag. Bruker "snake draft" for nivå-balanse.
  function makeEvenTeams(players, teamCount) {
    const n = Math.max(2, Math.min(6, Number(teamCount) || 2));

    let list = players;
    if (state.settings.useSkill) {
      list = sortBySkillWithRandomTies(players); // sortert men random innen nivå
    } else {
      list = shuffle(players);
    }

    // Fordel keepere først, én pr lag hvis mulig
    const goalies = list.filter((p) => p.goalie);
    const field = list.filter((p) => !p.goalie);

    const teams = Array.from({ length: n }, (_, i) => ({
      name: `Lag ${i + 1}`,
      players: [],
      sum: 0,
    }));

    // helper: velg laget med lavest sum, så færrest spillere
    const pickLowest = () =>
      teams
        .slice()
        .sort((a, b) => (a.sum - b.sum) || (a.players.length - b.players.length))[0];

    for (const g of goalies) {
      const t = pickLowest();
      t.players.push(g);
      t.sum += state.settings.useSkill ? (g.skill || 0) : 0;
    }

    // Snake distribution for feltspillere gir jevnere enn ren greedy ved mange lag
    let direction = 1;
    let idx = 0;

    for (const p of field) {
      teams[idx].players.push(p);
      teams[idx].sum += state.settings.useSkill ? (p.skill || 0) : 0;

      idx += direction;
      if (idx >= n) {
        direction = -1;
        idx = n - 1;
      } else if (idx < 0) {
        direction = 1;
        idx = 0;
      }
    }

    return teams;
  }

  function renderTrainingResults(groups) {
    const el = $('trainingResults');
    if (!el) return;

    el.innerHTML = groups
      .map((g, i) => {
        return `
        <div class="results-card">
          <h3>Gruppe ${i + 1} <span class="small-text" style="opacity:0.8;">(${g.length} spillere)</span></h3>
          <div class="results-list">
            ${g.map((p) => `<div class="result-item">${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</div>`).join('')}
          </div>
        </div>
      `;
      })
      .join('');
  }

  function setupTrainingUI() {
    const groupCountEl = $('trainingGroups');
    const makeBtn = $('makeGroupsBtn');
    const resultsEl = $('trainingResults');

    if (makeBtn) {
      makeBtn.addEventListener('click', () => {
        const selected = getSelectedPlayers('trainingSelection');
        if (selected.length < 2) {
          showNotification?.('Velg minst 2 spillere', 'error');
          return;
        }

        const n = Number(groupCountEl?.value ?? 2);

        if (state.settings.useSkill) {
          const groups = makeDifferentiatedGroups(selected, n);
          if (!groups) {
            showNotification?.('Kunne ikke lage grupper', 'error');
            return;
          }
          renderTrainingResults(groups);
        } else {
          // uten nivå -> tilfeldig grupper
          const list = shuffle(selected);
          const groups = Array.from({ length: Math.max(2, Math.min(6, n)) }, () => []);
          list.forEach((p, i) => groups[i % groups.length].push(p));
          renderTrainingResults(groups);
        }

        // ingen nivå-visning her
      });
    }

    if (resultsEl) resultsEl.innerHTML = '';
  }

  // -----------------------------
  // Match
  // -----------------------------

  function renderMatchSelection() {
    const container = $('matchSelection');
    if (!container) return;
    container.innerHTML = '';

    state.players.forEach((p) => {
      const label = document.createElement('label');
      label.className = 'checkbox-row';
      label.innerHTML = `
        <input type="checkbox" data-id="${escapeHtml(p.id)}" checked>
        <span>${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</span>
      `;
      container.appendChild(label);
    });
  }

  function renderMatchResults(teams) {
    const el = $('matchResults');
    if (!el) return;

    el.innerHTML = teams
      .map((t) => {
        return `
        <div class="results-card">
          <h3>${escapeHtml(t.name)} <span class="small-text" style="opacity:0.8;">(${t.players.length} spillere)</span></h3>
          <div class="results-list">
            ${t.players.map((p) => `<div class="result-item">${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</div>`).join('')}
          </div>
        </div>
      `;
      })
      .join('');
  }

  function setupMatchUI() {
    const teamCountEl = $('matchTeams');
    const makeBtn = $('makeTeamsBtn');
    const resultsEl = $('matchResults');

    if (makeBtn) {
      makeBtn.addEventListener('click', () => {
        const selected = getSelectedPlayers('matchSelection');
        if (selected.length < 2) {
          showNotification?.('Velg minst 2 spillere', 'error');
          return;
        }

        const n = Number(teamCountEl?.value ?? 2);
        const teams = makeEvenTeams(selected, n);
        renderMatchResults(teams);
      });
    }

    if (resultsEl) resultsEl.innerHTML = '';
  }

  // -----------------------------
  // Kampdag (selection only)
  // -----------------------------

  function renderKampdagSelection() {
    const container = $('kdPlayerSelection');
    if (!container) return;
    container.innerHTML = '';

    state.players.forEach((p) => {
      const label = document.createElement('label');
      label.className = 'checkbox-row';
      label.innerHTML = `
        <input type="checkbox" data-id="${escapeHtml(p.id)}" checked>
        <span>${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</span>
      `;
      container.appendChild(label);
    });
  }

  // -----------------------------
  // Liga
  // -----------------------------

  function createLeague(teamCount, rounds) {
    const n = Math.max(2, Math.min(12, Number(teamCount) || 2));
    const r = Math.max(1, Math.min(4, Number(rounds) || 1));

    const teams = Array.from({ length: n }, (_, i) => ({
      id: `t${i + 1}`,
      name: `Lag ${i + 1}`,
    }));

    // Round-robin "circle method"
    const ids = teams.map((t) => t.id);
    let list = [...ids];

    const isOdd = list.length % 2 === 1;
    if (isOdd) list.push('BYE');

    const half = list.length / 2;

    const roundsOne = [];
    for (let roundIdx = 0; roundIdx < list.length - 1; roundIdx++) {
      const pairs = [];
      for (let i = 0; i < half; i++) {
        const a = list[i];
        const b = list[list.length - 1 - i];
        if (a !== 'BYE' && b !== 'BYE') pairs.push([a, b]);
      }
      roundsOne.push(pairs);

      // rotate
      const fixed = list[0];
      const rest = list.slice(1);
      rest.unshift(rest.pop());
      list = [fixed, ...rest];
    }

    const matches = [];
    let mid = 1;

    for (let rep = 1; rep <= r; rep++) {
      roundsOne.forEach((pairs, ridx) => {
        pairs.forEach(([home, away], pidx) => {
          // alternate home/away each repetition for fairness
          const swap = rep % 2 === 0;
          const h = swap ? away : home;
          const a = swap ? home : away;

          matches.push({
            id: `m${rep}-${ridx + 1}-${pidx + 1}-${mid++}`,
            rep,
            round: ridx + 1,
            homeId: h,
            awayId: a,
            homeGoals: null,
            awayGoals: null,
          });
        });
      });
    }

    return {
      createdAt: Date.now(),
      teamCount: n,
      rounds: r,
      teams,
      matches,
    };
  }

  function teamNameById(league, id) {
    return league.teams.find((t) => t.id === id)?.name || id;
  }

  function calcTable(league) {
    const rows = new Map();
    league.teams.forEach((t) => {
      rows.set(t.id, {
        id: t.id,
        name: t.name,
        p: 0,
        w: 0,
        d: 0,
        l: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        pts: 0,
      });
    });

    for (const m of league.matches) {
      if (m.homeGoals === null || m.awayGoals === null) continue;

      const home = rows.get(m.homeId);
      const away = rows.get(m.awayId);
      if (!home || !away) continue;

      home.p += 1;
      away.p += 1;

      home.gf += m.homeGoals;
      home.ga += m.awayGoals;
      away.gf += m.awayGoals;
      away.ga += m.homeGoals;

      if (m.homeGoals > m.awayGoals) {
        home.w += 1;
        away.l += 1;
        home.pts += 3;
      } else if (m.homeGoals < m.awayGoals) {
        away.w += 1;
        home.l += 1;
        away.pts += 3;
      } else {
        home.d += 1;
        away.d += 1;
        home.pts += 1;
        away.pts += 1;
      }
    }

    rows.forEach((r) => {
      r.gd = r.gf - r.ga;
    });

    const list = Array.from(rows.values());
    list.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.name.localeCompare(b.name, 'nb');
    });

    return list;
  }

  function renderLigaFromState() {
    const league = state.liga;
    const teamsEl = $('ligaTeamNames');
    const matchesEl = $('ligaMatches');
    const tableEl = $('ligaTable');
    const startBtn = $('startLigaBtn');

    if (!teamsEl || !matchesEl || !tableEl || !startBtn) return;

    if (!league) {
      teamsEl.innerHTML = '';
      matchesEl.innerHTML = '';
      tableEl.innerHTML = '';
      return;
    }

    // Team name inputs
    teamsEl.innerHTML = `
      <div class="liga-team-names">
        ${league.teams
          .map(
            (t) => `
          <div class="liga-team-name-row">
            <label>${escapeHtml(t.id.toUpperCase())}</label>
            <input type="text" class="liga-team-name" data-tid="${escapeHtml(t.id)}" value="${escapeHtml(t.name)}">
          </div>
        `
          )
          .join('')}
      </div>
    `;

    teamsEl.querySelectorAll('input.liga-team-name').forEach((inp) => {
      inp.addEventListener('input', () => {
        const tid = inp.getAttribute('data-tid');
        if (!tid) return;
        const t = league.teams.find((x) => x.id === tid);
        if (!t) return;
        t.name = String(inp.value ?? '').trim() || t.name;
        state.liga = league;
        saveState();

        // refresh match labels + table
        renderLigaFromState();
      });
    });

    // Matches grouped by rep+round
    const groupKey = (m) => `${m.rep}-${m.round}`;
    const groups = new Map();
    league.matches.forEach((m) => {
      const k = groupKey(m);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    });

    const keys = Array.from(groups.keys()).sort((a, b) => {
      const [ar, arnd] = a.split('-').map(Number);
      const [br, brnd] = b.split('-').map(Number);
      return (ar - br) || (arnd - brnd);
    });

    matchesEl.innerHTML = keys
      .map((k) => {
        const [rep, round] = k.split('-').map(Number);
        const ms = groups.get(k) || [];
        return `
        <div class="liga-round">
          <h3>Runde ${round}${league.rounds > 1 ? ` (serie ${rep})` : ''}</h3>
          <div class="liga-matches">
            ${ms
              .map((m) => {
                const h = teamNameById(league, m.homeId);
                const a = teamNameById(league, m.awayId);
                const hv = m.homeGoals === null ? '' : String(m.homeGoals);
                const av = m.awayGoals === null ? '' : String(m.awayGoals);

                // Moderne: Ingen "bekreft" – input oppdaterer automatisk, tabell oppdateres når begge er satt
                return `
                  <div class="liga-match" data-mid="${escapeHtml(m.id)}">
                    <div class="liga-team">${escapeHtml(h)}</div>
                    <input class="liga-score" inputmode="numeric" pattern="[0-9]*" min="0" type="number" data-mid="${escapeHtml(
                      m.id
                    )}" data-side="home" value="${escapeHtml(hv)}" placeholder="0">
                    <span class="liga-sep">-</span>
                    <input class="liga-score" inputmode="numeric" pattern="[0-9]*" min="0" type="number" data-mid="${escapeHtml(
                      m.id
                    )}" data-side="away" value="${escapeHtml(av)}" placeholder="0">
                    <div class="liga-team right">${escapeHtml(a)}</div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
      })
      .join('');

    // bind score inputs
    matchesEl.querySelectorAll('input.liga-score').forEach((inp) => {
      inp.addEventListener('input', () => {
        const mid = inp.getAttribute('data-mid');
        const side = inp.getAttribute('data-side');
        if (!mid || !side) return;
        const match = league.matches.find((x) => x.id === mid);
        if (!match) return;

        const wasComplete = (match.homeGoals !== null && match.awayGoals !== null);

        const v = inp.value === '' ? null : Number(inp.value);
        const val = (v === null || !Number.isFinite(v) || v < 0) ? null : Math.floor(v);

        if (side === 'home') match.homeGoals = val;
        else match.awayGoals = val;

        const isComplete = (match.homeGoals !== null && match.awayGoals !== null);

        // Oppdater tabellen når begge mål er satt (eller når et tidligere resultat endres/fjernes)
        if (isComplete || wasComplete) {
          state.liga = league;
          saveState();

          // re-render only table for speed
          const rows2 = calcTable(league);
          tableEl.innerHTML = `
            <div style="overflow:auto;">
              <table class="liga-table">
                <thead>
                  <tr>
                    <th>Lag</th><th>K</th><th>V</th><th>U</th><th>T</th><th>+</th><th>-</th><th>Diff</th><th>P</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows2
                    .map(
                      (r) => `
                    <tr>
                      <td>${escapeHtml(r.name)}</td>
                      <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
                      <td>${r.gf}</td><td>${r.ga}</td><td>${r.gd}</td><td><strong>${r.pts}</strong></td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `;
        }
      });
    });

    // Table
    const rows = calcTable(league);
    tableEl.innerHTML = `
      <div style="overflow:auto;">
        <table class="liga-table">
          <thead>
            <tr>
              <th>Lag</th><th>K</th><th>V</th><th>U</th><th>T</th><th>+</th><th>-</th><th>Diff</th><th>P</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
                <td>${r.gf}</td><td>${r.ga}</td><td>${r.gd}</td><td><strong>${r.pts}</strong></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function setupLigaUI() {
    const teamsEl = $('ligaTeams');
    const roundsEl = $('ligaRounds');
    const startBtn = $('startLigaBtn');
    const resetBtn = $('resetLigaBtn');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const teamCount = Number(teamsEl?.value ?? 3);
        const rounds = Number(roundsEl?.value ?? 1);

        state.liga = createLeague(teamCount, rounds);
        saveState();
        renderLigaFromState();
        showNotification?.('Liga opprettet', 'success');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('Nullstill liga?')) return;
        state.liga = null;
        saveState();
        renderLigaFromState();
      });
    }
  }

  // -----------------------------
  // Public helpers used by HTML controls
  // -----------------------------

  window.changeNumber = function (id, delta) {
    const el = $(id);
    if (!el) return;
    const min = Number(el.min ?? 0);
    const max = Number(el.max ?? 999);
    const cur = Number(el.value ?? 0);
    const next = clamp(cur + delta, min, max);
    el.value = String(next);
  };

  // -----------------------------
  // initApp entry point (called by auth.js)
  // -----------------------------

  window.initApp = function initApp() {
    try {
      loadState();
      syncGlobalPlayers();

      setupTabs();
      setupPlayersUI();
      setupTrainingUI();
      setupMatchUI();
      setupLigaUI();

      // default tab
      setActiveTab('players');

      renderPlayersUI();
      renderLigaFromState();

      // If other modules rely on players updates:
      window.addEventListener('players:updated', () => {
        renderTrainingSelection();
        renderMatchSelection();
        renderKampdagSelection();
      });

      console.log('✅ core.js initApp ferdig');
    } catch (e) {
      console.error('❌ initApp feilet', e);
      showNotification?.('Noe gikk galt ved oppstart', 'error');
    }
  };
})();