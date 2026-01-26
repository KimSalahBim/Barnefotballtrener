// Barnefotballtrener - core.js
// ================================================
// Kjernelogikk for appen (spillere, navigasjon, trening, kamp).
// Mål: stabil drift uten "white screen" + robust state (window.players = Array).

(function () {
  'use strict';

  // ------------------------------
  // Safe storage (tåler Tracking Prevention / private mode)
  // ------------------------------
  const _mem = new Map();

  function safeGet(key) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? _mem.get(key) ?? null : v;
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

  // ------------------------------
  // Keys (per bruker hvis innlogget)
  // ------------------------------
  function getUserKeyPrefix() {
    try {
      const uid = (window.authService && typeof authService.getUserId === 'function')
        ? (authService.getUserId() || 'anon')
        : 'anon';
      return `bft:${uid}`;
    } catch (e) {
      return 'bft:anon';
    }
  }

  function k(suffix) {
    return `${getUserKeyPrefix()}:${suffix}`;
  }

  // ------------------------------
  // State
  // ------------------------------
  const state = {
    players: [],
    settings: {
      useSkill: true
    },
    selection: {
      training: new Set(),
      match: new Set()
    },
    liga: null
  };

  // Expose for other modules (kampdag.js)
  function publishPlayers() {
    window.players = state.players; // MUST be an Array
    window.dispatchEvent(new CustomEvent('players:updated', { detail: { count: state.players.length } }));
  }

  // ------------------------------
  // Helpers
  // ------------------------------
  function $(id) { return document.getElementById(id); }

  function showNotification(message, type = 'info') {
    const el = $('notification');
    if (!el) return;

    el.textContent = message;
    el.className = `notification ${type}`;
    el.style.display = 'block';

    clearTimeout(showNotification._t);
    showNotification._t = setTimeout(() => {
      el.style.display = 'none';
    }, 2600);
  }

  // make available globally (auth-ui.js uses it)
  window.showNotification = window.showNotification || showNotification;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function uuid() {
    // Small, collision-safe enough for local use
    return 'p_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function normalizePlayers(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    const seen = new Set();
    for (const p of input) {
      if (!p) continue;
      const id = String(p.id || uuid());
      if (seen.has(id)) continue;
      seen.add(id);

      const name = String(p.name || '').trim();
      if (!name) continue;

      let skill = Number(p.skill ?? 3);
      if (!Number.isFinite(skill)) skill = 3;
      skill = Math.max(1, Math.min(6, Math.round(skill)));

      out.push({
        id,
        name,
        skill,
        goalie: Boolean(p.goalie),
        active: p.active === false ? false : true
      });
    }
    return out;
  }

  function loadState() {
    // settings
    const s = safeGet(k('settings'));
    if (s) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed?.useSkill === 'boolean') state.settings.useSkill = parsed.useSkill;
      } catch {}
    }

    // players
    const p = safeGet(k('players'));
    if (p) {
      try {
        state.players = normalizePlayers(JSON.parse(p));
      } catch {
        state.players = [];
      }
    } else {
      state.players = [];
    }

    // liga (optional)
    const l = safeGet(k('liga'));
    if (l) {
      try { state.liga = JSON.parse(l); } catch { state.liga = null; }
    } else {
      state.liga = null;
    }

    // selections (optional)
    state.selection.training = new Set();
    state.selection.match = new Set();
  }

  function saveState() {
    safeSet(k('settings'), JSON.stringify(state.settings));
    safeSet(k('players'), JSON.stringify(state.players));
    safeSet(k('liga'), JSON.stringify(state.liga));
  }

  // ------------------------------
  // Rendering
  // ------------------------------
  function updateStats() {
    const total = state.players.length;
    const goalies = state.players.filter(p => p.goalie).length;
    const active = state.players.filter(p => p.active).length;

    const t = $('totalPlayers'); if (t) t.textContent = String(total);
    const g = $('totalGoalies'); if (g) g.textContent = String(goalies);
    const a = $('playerCount'); if (a) a.textContent = String(active);
  }

  function renderPlayerList() {
    const container = $('playerList');
    if (!container) return;

    const sorted = [...state.players].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    container.innerHTML = sorted.map(p => {
      return `
        <div class="player-card" data-id="${p.id}">
          <label class="player-active">
            <input type="checkbox" class="player-active-toggle" ${p.active ? 'checked' : ''}>
            <span>Aktiv</span>
          </label>

          <div class="player-info">
            <div class="player-name">${escapeHtml(p.name)}</div>
            <div class="player-tags">
              ${state.settings.useSkill ? `<span class="tag">Nivå ${p.skill}</span>` : ''}
              ${p.goalie ? `<span class="tag">🧤 Keeper</span>` : `<span class="tag">⚽ Utespiller</span>`}
            </div>
          </div>

          <div class="player-actions">
            <button class="icon-btn edit" type="button" title="Rediger">✏️</button>
            <button class="icon-btn delete" type="button" title="Slett">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // bind events
    container.querySelectorAll('.player-card').forEach(card => {
      const id = card.getAttribute('data-id');
      const p = state.players.find(x => x.id === id);
      if (!p) return;

      const activeToggle = card.querySelector('.player-active-toggle');
      if (activeToggle) {
        activeToggle.addEventListener('change', () => {
          p.active = !!activeToggle.checked;
          saveState();
          updateStats();
          renderSelections();
          publishPlayers();
        });
      }

      const editBtn = card.querySelector('button.edit');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          const newName = window.prompt('Nytt navn:', p.name);
          if (newName === null) return;
          const name = String(newName).trim();
          if (!name) return showNotification('Navn kan ikke være tomt', 'error');

          let skill = p.skill;
          if (state.settings.useSkill) {
            const newSkill = window.prompt('Ferdighetsnivå (1–6):', String(p.skill));
            if (newSkill === null) return;
            const v = Number(newSkill);
            if (Number.isFinite(v)) skill = Math.max(1, Math.min(6, Math.round(v)));
          }

          const goalie = window.confirm('Skal spilleren kunne stå i mål? (OK = ja, Avbryt = nei)');

          p.name = name;
          p.skill = skill;
          p.goalie = goalie;

          saveState();
          renderAll();
          showNotification('Spiller oppdatert', 'success');
        });
      }

      const delBtn = card.querySelector('button.delete');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          const ok = window.confirm(`Slette "${p.name}"?`);
          if (!ok) return;
          state.players = state.players.filter(x => x.id !== id);
          // remove from selections
          state.selection.training.delete(id);
          state.selection.match.delete(id);

          saveState();
          renderAll();
          publishPlayers();
          showNotification('Spiller slettet', 'info');
        });
      }
    });
  }

  function renderSelections() {
    const trainingEl = $('trainingSelection');
    const matchEl = $('matchSelection');

    // only active players selectable
    const selectable = state.players.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name, 'nb'));

    if (trainingEl) {
      trainingEl.innerHTML = selectable.map(p => `
        <label class="player-checkbox">
          <input type="checkbox" data-id="${p.id}" ${state.selection.training.has(p.id) ? 'checked' : ''}>
          <span class="checkmark"></span>
          <div class="player-details">
            <div class="player-name">${escapeHtml(p.name)}</div>
            <div class="player-meta">
              ${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}
            </div>
          </div>
        </label>
      `).join('');

      trainingEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.getAttribute('data-id');
          if (!id) return;
          if (cb.checked) state.selection.training.add(id);
          else state.selection.training.delete(id);
          const c = $('trainingCount'); if (c) c.textContent = String(state.selection.training.size);
        });
      });

      const c = $('trainingCount'); if (c) c.textContent = String(state.selection.training.size);
    }

    if (matchEl) {
      matchEl.innerHTML = selectable.map(p => `
        <label class="player-checkbox">
          <input type="checkbox" data-id="${p.id}" ${state.selection.match.has(p.id) ? 'checked' : ''}>
          <span class="checkmark"></span>
          <div class="player-details">
            <div class="player-name">${escapeHtml(p.name)}</div>
            <div class="player-meta">
              ${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}
            </div>
          </div>
        </label>
      `).join('');

      matchEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = cb.getAttribute('data-id');
          if (!id) return;
          if (cb.checked) state.selection.match.add(id);
          else state.selection.match.delete(id);
          const c = $('matchCount'); if (c) c.textContent = String(state.selection.match.size);
        });
      });

      const c = $('matchCount'); if (c) c.textContent = String(state.selection.match.size);
    }
  }

  function renderLogo() {
    const el = $('logoContainer');
    if (!el) return;
    el.innerHTML = `
  <div class="app-title">
    <img src="icon-192.png" alt="Barnefotballtrener" class="app-logo" />
    <div class="app-name">Barnefotballtrener</div>
  </div>
`;

  }

  function renderAll() {
    updateStats();
    renderPlayerList();
    renderSelections();
  }

  // ------------------------------
  // Training / Match algorithms
  // ------------------------------
  function getSelectedPlayers(set) {
    const ids = new Set(set);
    return state.players.filter(p => p.active && ids.has(p.id));
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sortBySkillWithRandomTies(players) {
    // Sort by skill descending, but shuffle within the same skill so repeated clicks give variation
    const buckets = new Map();
    for (const p of players) {
      const k = Number(p.skill) || 0;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    const skills = Array.from(buckets.keys()).sort((a, b) => b - a);
    const out = [];
    for (const s of skills) {
      out.push(...shuffle(buckets.get(s)));
    }
    return out;
  }

  function makeBalancedGroups(players, groupCount) {
    const n = Math.max(2, Math.min(6, Number(groupCount) || 2));
    let list = players;

    if (state.settings.useSkill) {
      list = sortBySkillWithRandomTies(players);
    } else {
      list = shuffle(players);
    }

    const groups = Array.from({ length: n }, () => []);
    let dir = 1;
    let idx = 0;
    for (const p of list) {
      groups[idx].push(p);
      idx += dir;
      if (idx === n) { dir = -1; idx = n - 1; }
      if (idx === -1) { dir = 1; idx = 0; }
    }
    return groups;
  }

  // Differensiering: "beste sammen, neste beste sammen ..."
  // Krever ferdighetsnivå aktivert for å gi mening.
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
      list = sortBySkillWithRandomTies(players);
    } else {
      list = shuffle(players);
    }

    const goalies = list.filter(p => p.goalie);
    const field = list.filter(p => !p.goalie);

    const teams = Array.from({ length: n }, () => ({ players: [], sum: 0 }));

    // fordel keepere først (så jevnt som mulig)
    for (let i = 0; i < goalies.length; i++) {
      const t = teams[i % n];
      t.players.push(goalies[i]);
      t.sum += (goalies[i].skill || 0);
    }

    // snake draft for resten
    let dir = 1;
    let idx2 = 0;
    for (const p of field) {
      const t = teams[idx2];
      t.players.push(p);
      t.sum += (p.skill || 0);

      idx2 += dir;
      if (idx2 === n) { dir = -1; idx2 = n - 1; }
      if (idx2 === -1) { dir = 1; idx2 = 0; }
    }

    for (const t of teams) {
      t.avg = t.players.length ? (t.sum / t.players.length) : 0;
    }
    return { teams, teamCount: n };
  }

  function renderMultiTeamResults(res) {
    const el = $('matchResults');
    if (!el) return;

    const teams = res?.teams || [];
    el.innerHTML = teams.map((t, i) => {
      const avgTxt = '';
      return `
        <div class="results-card">
          <h3>Lag ${i + 1} <span class="small-text" style="opacity:0.8;">(${t.players.length} spillere)</span></h3>
          <div class="results-list">
            ${t.players.map(p => `<div class="result-item">${escapeHtml(p.name)} ${p.goalie ? ' 🧤' : ''}</div>`).join('')}
          </div>
        </div>
      `;
    }).join('');
  }


  function renderTrainingResults(groups) {
    const el = $('trainingResults');
    if (!el) return;

    el.innerHTML = groups.map((g, i) => {
      const avg = g.length ? (g.reduce((s, p) => s + (p.skill || 0), 0) / g.length) : 0;
      return `
        <div class="results-card">
          <h3>Gruppe ${i + 1} <span class="small-text" style="opacity:0.8;">(${g.length} spillere)</span></h3>
          <div class="results-list">
            ${g.map(p => `<div class="result-item">${escapeHtml(p.name)} ${p.goalie ? ' 🧤' : ''}</div>`).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function makeBalancedTeams(players) {
    let list = players;
    if (state.settings.useSkill) {
      list = sortBySkillWithRandomTies(players);
    } else {
      list = shuffle(players);
    }

    const goalies = list.filter(p => p.goalie);
    const field = list.filter(p => !p.goalie);

    const teamA = [];
    const teamB = [];
    let sumA = 0, sumB = 0;

    // Distribute goalies first
    for (let i = 0; i < goalies.length; i++) {
      const p = goalies[i];
      if (i % 2 === 0) { teamA.push(p); sumA += p.skill; }
      else { teamB.push(p); sumB += p.skill; }
    }

    // Then fill remaining
    for (const p of field) {
      if (sumA <= sumB) { teamA.push(p); sumA += p.skill; }
      else { teamB.push(p); sumB += p.skill; }
    }

    return { teamA, teamB, sumA, sumB };
  }

  function renderMatchResults(res) {
    const el = $('matchResults');
    if (!el) return;

    const { teamA, teamB, sumA, sumB } = res;

    const avgA = teamA.length ? (sumA / teamA.length).toFixed(1) : '0.0';
    const avgB = teamB.length ? (sumB / teamB.length).toFixed(1) : '0.0';

    el.innerHTML = `
      <div class="results-card">
        <h3>Lag A <span class="small-text" style="opacity:0.8;">(${teamA.length} spillere)</span></h3>
        <div class="results-list">
          ${teamA.map(p => `<div class="result-item">${escapeHtml(p.name)} ${p.goalie ? ' 🧤' : ''}</div>`).join('')}
        </div>
      </div>

      <div class="results-card">
        <h3>Lag B <span class="small-text" style="opacity:0.8;">(${teamB.length} spillere)</span></h3>
        <div class="results-list">
          ${teamB.map(p => `<div class="result-item">${escapeHtml(p.name)} ${p.goalie ? ' 🧤' : ''}</div>`).join('')}
        </div>
      </div>
    `;
  }

  // ------------------------------
  // UI wiring
  // ------------------------------
  function setupTabs() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (!tab) return;

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const content = document.getElementById(tab);
        if (content) content.classList.add('active');

        // keep selections fresh
        renderSelections();
        publishPlayers();
      });
    });
  }

  function setupSkillToggle() {
    const t = $('skillToggle');
    const hint = $('skillToggleHint');
    if (!t) return;

    t.checked = !!state.settings.useSkill;

    const refreshHint = () => {
      if (!hint) return;
      hint.textContent = state.settings.useSkill
        ? 'Nivå er aktivert. (Brukes i gruppering og lagdeling.)'
        : 'Nivå er deaktivert. (Lagdeling blir tilfeldig.)';
    };

    refreshHint();

    t.addEventListener('change', () => {
      state.settings.useSkill = !!t.checked;
      saveState();
      renderAll();
      publishPlayers();
      refreshHint();
    });
  }

  function setupPlayersUI() {
    const addBtn = $('addPlayerBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const nameEl = $('playerName');
        const skillEl = $('playerSkill');
        const goalieEl = $('playerGoalie');

        const name = String(nameEl?.value || '').trim();
        if (!name) return showNotification('Skriv inn et navn først', 'error');

        const skill = Number(skillEl?.value ?? 3);
        const goalie = !!goalieEl?.checked;

        state.players.push({
          id: uuid(),
          name,
          skill: Number.isFinite(skill) ? Math.max(1, Math.min(6, Math.round(skill))) : 3,
          goalie,
          active: true
        });

        // auto-select new player in training/match
        const id = state.players[state.players.length - 1].id;
        state.selection.training.add(id);
        state.selection.match.add(id);

        if (nameEl) nameEl.value = '';
        if (goalieEl) goalieEl.checked = false;

        saveState();
        renderAll();
        publishPlayers();
        showNotification('Spiller lagt til', 'success');
      });
    }

    // Export / Import / Clear
    const exportBtn = $('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: state.settings,
          players: state.players
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'barnefotballtrener-spillere.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    }

    const importBtn = $('importBtn');
    const importFile = $('importFile');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const f = importFile.files?.[0];
        if (!f) return;
        try {
          const text = await f.text();
          const parsed = JSON.parse(text);
          const incomingPlayers = normalizePlayers(parsed.players ?? parsed);
          if (incomingPlayers.length === 0) {
            showNotification('Fant ingen gyldige spillere i filen', 'error');
            importFile.value = '';
            return;
          }
          state.players = incomingPlayers;

          // reset selections to all active players
          state.selection.training = new Set(state.players.filter(p => p.active).map(p => p.id));
          state.selection.match = new Set(state.players.filter(p => p.active).map(p => p.id));

          if (parsed.settings && typeof parsed.settings.useSkill === 'boolean') {
            state.settings.useSkill = parsed.settings.useSkill;
            const t = $('skillToggle'); if (t) t.checked = state.settings.useSkill;
          }

          saveState();
          renderAll();
          publishPlayers();
          showNotification('Importert', 'success');
        } catch (e) {
          console.error(e);
          showNotification('Kunne ikke importere filen', 'error');
        } finally {
          importFile.value = '';
        }
      });
    }

    const clearBtn = $('clearAllBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const ok = window.confirm('Slette alle spillere? Dette kan ikke angres.');
        if (!ok) return;
        state.players = [];
        state.selection.training = new Set();
        state.selection.match = new Set();
        saveState();
        renderAll();
        publishPlayers();
        showNotification('Alle spillere slettet', 'info');
      });
    }
  }

  function setupTrainingUI() {
    const btn = $('createGroupsBtn');
    if (!btn) return;
  // Velg alle / Fjern alle (Trening)
  const selectAllBtn = $('trainingSelectAllBtn');
  const clearAllBtn  = $('trainingClearAllBtn');

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const activeIds = state.players
        .filter(p => p.active)
        .map(p => p.id);

      state.selection.training = new Set(activeIds);
      renderSelections(); // oppdaterer UI + teller
      showNotification('Valgte alle aktive spillere', 'success');
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      state.selection.training = new Set();
      renderSelections();
      showNotification('Fjernet alle valgte spillere', 'success');
    });
  }

    btn.addEventListener('click', () => {
      const players = getSelectedPlayers(state.selection.training);
      if (players.length < 2) return showNotification('Velg minst 2 spillere', 'error');

      const groupCount = Number($('trainingGroups')?.value ?? 2);

      if (!state.settings.useSkill) {
        showNotification('Slå på "Bruk ferdighetsnivå" for å lage differensierte grupper', 'error');
        return;
      }

      const groups = makeDifferentiatedGroups(players, groupCount);
      if (!groups) {
        showNotification('Kunne ikke lage grupper', 'error');
        return;
      }

      renderTrainingResults(groups);
      showNotification('Differensierte grupper laget', 'success');
    });
  }

  function setupMatchUI() {
    const btn = $('createMatchTeamsBtn');
    if (!btn) return;
  // Velg alle / Fjern alle (Kamp)
  const selectAllBtn = $('matchSelectAllBtn');
  const clearAllBtn  = $('matchClearAllBtn');

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const activeIds = state.players
        .filter(p => p.active)
        .map(p => p.id);

      state.selection.match = new Set(activeIds);
      renderSelections();
      showNotification('Valgte alle aktive spillere', 'success');
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      state.selection.match = new Set();
      renderSelections();
      showNotification('Fjernet alle valgte spillere', 'success');
    });
  }

    btn.addEventListener('click', () => {
      const players = getSelectedPlayers(state.selection.match);
      if (players.length < 2) return showNotification('Velg minst 2 spillere', 'error');

      const teamCount = Number($('matchTeams')?.value ?? 2);
      const res = makeEvenTeams(players, teamCount);
      renderMultiTeamResults(res);
      showNotification('Lagdeling klar', 'success');
    });
  }

  function setupLigaUI() {
    const teamsInput = $('ligaTeams');
    const roundsInput = $('ligaRounds');
    const namesWrap = $('ligaTeamNames');
    const matchesEl = $('ligaMatches');
    const tableEl = $('ligaTable');
    const startBtn = $('startLigaBtn');
    const resetBtn = $('resetLigaBtn');

    if (!teamsInput || !roundsInput || !namesWrap || !matchesEl || !tableEl) return;

    function ensureNameInputs(n) {
      const count = Math.max(2, Math.min(5, Number(n) || 2));
      const existing = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      // If correct count, keep values
      if (existing.length === count) return;

      const prevValues = existing.map(i => String(i.value || '').trim()).filter(Boolean);
      namesWrap.innerHTML = '';

      for (let i = 0; i < count; i++) {
        const v = prevValues[i] || `Lag ${i + 1}`;
        const row = document.createElement('div');
        row.className = 'team-name-row';
        row.innerHTML = `
          <label class="team-name-label">Lag ${i + 1}</label>
          <input class="input team-name-input" data-team-name="1" type="text" value="${escapeHtml(v)}" />
        `;
        namesWrap.appendChild(row);
      }
    }

    function getTeamNames() {
      const inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      return inputs.map((i, idx) => {
        const v = String(i.value || '').trim();
        return v || `Lag ${idx + 1}`;
      });
    }

    function genRoundRobin(names) {
      // "circle method" – støtter oddetall med BYE
      const list = [...names];
      let hasBye = false;
      if (list.length % 2 === 1) { list.push('BYE'); hasBye = true; }
      const n = list.length;
      const rounds = n - 1;
      const half = n / 2;

      const schedule = [];
      let arr = [...list];

      for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < half; i++) {
          const home = arr[i];
          const away = arr[n - 1 - i];
          if (home === 'BYE' || away === 'BYE') continue;
          schedule.push({ round: r + 1, home, away, homeGoals: null, awayGoals: null });
        }
        // rotate: keep first fixed
        const fixed = arr[0];
        const rest = arr.slice(1);
        rest.unshift(rest.pop());
        arr = [fixed, ...rest];
      }
      return { schedule, hasBye };
    }

    function buildLeague() {
      const nTeams = Math.max(2, Math.min(5, Number(teamsInput.value) || 2));
      const nRounds = Math.max(1, Math.min(5, Number(roundsInput.value) || 1));
      const names = getTeamNames();

      const { schedule } = genRoundRobin(names.slice(0, nTeams));
      const matches = [];
      let mid = 1;

      for (let rep = 0; rep < nRounds; rep++) {
        for (const m of schedule) {
          const flip = (rep % 2 === 1);
          matches.push({
            id: `m_${mid++}`,
            rep: rep + 1,
            round: m.round,
            home: flip ? m.away : m.home,
            away: flip ? m.home : m.away,
            homeGoals: null,
            awayGoals: null
          });
        }
      }

      return {
        createdAt: Date.now(),
        teams: names.slice(0, nTeams).map((name, i) => ({ id: `t_${i + 1}`, name })),
        rounds: nRounds,
        matches
      };
    }

    function calcTable(league) {
      const rows = new Map();
      for (const t of league.teams) {
        rows.set(t.name, { team: t.name, p:0, w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0 });
      }

      for (const m of league.matches) {
        if (m.homeGoals === null || m.awayGoals === null) continue;
        const h = rows.get(m.home);
        const a = rows.get(m.away);
        if (!h || !a) continue;

        h.p++; a.p++;
        h.gf += m.homeGoals; h.ga += m.awayGoals;
        a.gf += m.awayGoals; a.ga += m.homeGoals;

        if (m.homeGoals > m.awayGoals) { h.w++; a.l++; h.pts += 3; }
        else if (m.homeGoals < m.awayGoals) { a.w++; h.l++; a.pts += 3; }
        else { h.d++; a.d++; h.pts += 1; a.pts += 1; }
      }

      for (const r of rows.values()) r.gd = r.gf - r.ga;

      return Array.from(rows.values()).sort((x, y) =>
        (y.pts - x.pts) || (y.gd - x.gd) || (y.gf - x.gf) || x.team.localeCompare(y.team, 'nb')
      );
    }

    function render(league) {
      // Matches
      matchesEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'liga-matches';

      // group by rep+round
      const groups = new Map();
      for (const m of league.matches) {
        const key = `${m.rep}-${m.round}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
      }
      const groupKeys = Array.from(groups.keys()).sort((a,b)=>{
        const [ar,arnd] = a.split('-').map(Number);
        const [br,brnd] = b.split('-').map(Number);
        return (ar-br) || (arnd-brnd);
      });

      for (const k2 of groupKeys) {
        const [rep, round] = k2.split('-').map(Number);
        const h3 = document.createElement('div');
        h3.style.fontWeight = '800';
        h3.style.margin = '10px 0 6px';
        h3.textContent = `Runde ${round} (serie ${rep})`;
        wrap.appendChild(h3);

        for (const m of groups.get(k2)) {
          const row = document.createElement('div');
          row.className = 'liga-match-row';
          row.innerHTML = `
            <div class="liga-match-card" style="display:flex; align-items:stretch; justify-content:space-between; gap:12px; padding:12px; border:1px solid rgba(0,0,0,0.06); border-radius:14px; background:#fff; box-shadow:0 1px 6px rgba(0,0,0,0.04);">
              <div class="liga-side home" style="flex:1; min-width:0;">
                <div style="font-size:12px; font-weight:800; opacity:.6; margin-bottom:4px;">Hjemme</div>
                <div class="liga-team-name" style="font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:10px;">${escapeHtml(m.home)}</div>
                <input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="${m.id}" data-side="home"
                  placeholder="0" value="${m.homeGoals ?? ''}"
                  style="width:100%; text-align:center; font-size:18px; font-weight:900; padding:10px 12px; border-radius:12px;">
              </div>

              <div class="liga-mid" aria-hidden="true" style="display:flex; align-items:center; justify-content:center; width:22px; font-weight:900; opacity:.55;">–</div>

              <div class="liga-side away" style="flex:1; min-width:0;">
                <div style="font-size:12px; font-weight:800; opacity:.6; margin-bottom:4px; text-align:right;">Borte</div>
                <div class="liga-team-name" style="font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:10px; text-align:right;">${escapeHtml(m.away)}</div>
                <input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="${m.id}" data-side="away"
                  placeholder="0" value="${m.awayGoals ?? ''}"
                  style="width:100%; text-align:center; font-size:18px; font-weight:900; padding:10px 12px; border-radius:12px;">
              </div>
            </div>
          `;
          wrap.appendChild(row);
        }
      }
      matchesEl.appendChild(wrap);

      // Table
      const rows = calcTable(league);
      tableEl.innerHTML = `
        <div style="overflow:auto;">
          <table class="liga-table">
            <thead>
              <tr>
                <th>Lag</th><th>K</th><th>V</th><th>U</th><th>T</th><th>Mål</th><th>Diff</th><th>P</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${escapeHtml(r.team)}</td>
                  <td>${r.p}</td>
                  <td>${r.w}</td>
                  <td>${r.d}</td>
                  <td>${r.l}</td>
                  <td>${r.gf}-${r.ga}</td>
                  <td>${r.gd}</td>
                  <td><strong>${r.pts}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      // bind score inputs
      matchesEl.querySelectorAll('input.liga-score').forEach(inp => {
        inp.addEventListener('input', () => {
          const mid = inp.getAttribute('data-mid');
          const side = inp.getAttribute('data-side');
          if (!mid || !side) return;
          const match = league.matches.find(x => x.id === mid);
          if (!match) return;

          const v = inp.value === '' ? null : Number(inp.value);
          const val = (v === null || !Number.isFinite(v) || v < 0) ? null : Math.floor(v);

          if (side === 'home') match.homeGoals = val;
          else match.awayGoals = val;

          state.liga = league;
          saveState();
          // re-render only table for speed
          const rows2 = calcTable(league);
          tableEl.innerHTML = `
            <div style="overflow:auto;">
              <table class="liga-table">
                <thead>
                  <tr>
                    <th>Lag</th><th>K</th><th>V</th><th>U</th><th>T</th><th>Mål</th><th>Diff</th><th>P</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows2.map(r => `
                    <tr>
                      <td>${escapeHtml(r.team)}</td>
                      <td>${r.p}</td>
                      <td>${r.w}</td>
                      <td>${r.d}</td>
                      <td>${r.l}</td>
                      <td>${r.gf}-${r.ga}</td>
                      <td>${r.gd}</td>
                      <td><strong>${r.pts}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        });
      });
    }

    // initial names
    ensureNameInputs(teamsInput.value);

    teamsInput.addEventListener('change', () => {
      ensureNameInputs(teamsInput.value);
    });

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const league = buildLeague();
        state.liga = league;
        saveState();
        render(league);
        showNotification('Liga opprettet', 'success');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.liga = null;
        saveState();
        matchesEl.innerHTML = '';
        tableEl.innerHTML = '';
        ensureNameInputs(teamsInput.value);
        showNotification('Liga nullstilt', 'info');
      });
    }

    // restore persisted league
    if (state.liga && state.liga.teams && state.liga.matches) {
      // try to restore team names into inputs
      const n = state.liga.teams.length;
      teamsInput.value = String(n);
      ensureNameInputs(n);
      const inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      state.liga.teams.forEach((t, i) => { if (inputs[i]) inputs[i].value = t.name; });
      render(state.liga);
    }
  }


  // Exposed global helper used by inline onclick in HTML
  window.changeNumber = function (inputId, delta) {
    const el = $(inputId);
    if (!el) return;
    const min = Number(el.getAttribute('min') ?? '-999999');
    const max = Number(el.getAttribute('max') ?? '999999');
    const v = Number(el.value || 0);
    const next = Math.max(min, Math.min(max, v + Number(delta || 0)));
    el.value = String(next);
  };

  // ------------------------------
  // initApp (called by auth.js / auth-ui.js)
  // ------------------------------
  window.initApp = function initApp() {
    if (window.appInitialized) return;
    window.appInitialized = true;

    loadState();

    // default select all active players
    state.selection.training = new Set(state.players.filter(p => p.active).map(p => p.id));
    state.selection.match = new Set(state.players.filter(p => p.active).map(p => p.id));

    renderLogo();
    setupTabs();
    setupSkillToggle();
    setupPlayersUI();
    setupTrainingUI();
    setupMatchUI();
    setupLigaUI();

    renderAll();
    publishPlayers();

    console.log('✅ core.js initApp ferdig');
  };

})();
