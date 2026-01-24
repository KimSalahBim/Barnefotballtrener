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
    }
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

    // selections (optional)
    state.selection.training = new Set();
    state.selection.match = new Set();
  }

  function saveState() {
    safeSet(k('settings'), JSON.stringify(state.settings));
    safeSet(k('players'), JSON.stringify(state.players));
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
              ${state.settings.useSkill ? `Nivå ${p.skill} · ` : ''}${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}
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
              ${state.settings.useSkill ? `Nivå ${p.skill} · ` : ''}${p.goalie ? '🧤 Keeper' : '⚽ Utespiller'}
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
    el.innerHTML = `<div style="display:flex; align-items:center; gap:10px;">
      <div style="font-size:22px;">⚽</div>
      <div style="font-weight:800; letter-spacing:0.2px;">Barnefotballtrener</div>
    </div>`;
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

  function makeBalancedGroups(players, groupCount) {
    const n = Math.max(2, Math.min(6, Number(groupCount) || 2));
    let list = players;

    if (state.settings.useSkill) {
      list = [...players].sort((a, b) => (b.skill - a.skill) || a.name.localeCompare(b.name, 'nb'));
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

  function renderTrainingResults(groups) {
    const el = $('trainingResults');
    if (!el) return;

    el.innerHTML = groups.map((g, i) => {
      const avg = g.length ? (g.reduce((s, p) => s + (p.skill || 0), 0) / g.length) : 0;
      return `
        <div class="results-card">
          <h3>Gruppe ${i + 1} <span class="small-text" style="opacity:0.8;">(${g.length} spillere${state.settings.useSkill ? ` · snitt ${avg.toFixed(1)}` : ''})</span></h3>
          <div class="results-list">
            ${g.map(p => `<div class="result-item">${escapeHtml(p.name)} ${state.settings.useSkill ? `<span class="small-text">(N${p.skill})</span>` : ''}${p.goalie ? ' 🧤' : ''}</div>`).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function makeBalancedTeams(players) {
    let list = players;
    if (state.settings.useSkill) {
      list = [...players].sort((a, b) => (b.skill - a.skill) || a.name.localeCompare(b.name, 'nb'));
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
        <h3>Lag A <span class="small-text" style="opacity:0.8;">(${teamA.length} spillere${state.settings.useSkill ? ` · snitt ${avgA}` : ''})</span></h3>
        <div class="results-list">
          ${teamA.map(p => `<div class="result-item">${escapeHtml(p.name)} ${state.settings.useSkill ? `<span class="small-text">(N${p.skill})</span>` : ''}${p.goalie ? ' 🧤' : ''}</div>`).join('')}
        </div>
      </div>

      <div class="results-card">
        <h3>Lag B <span class="small-text" style="opacity:0.8;">(${teamB.length} spillere${state.settings.useSkill ? ` · snitt ${avgB}` : ''})</span></h3>
        <div class="results-list">
          ${teamB.map(p => `<div class="result-item">${escapeHtml(p.name)} ${state.settings.useSkill ? `<span class="small-text">(N${p.skill})</span>` : ''}${p.goalie ? ' 🧤' : ''}</div>`).join('')}
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

    btn.addEventListener('click', () => {
      const players = getSelectedPlayers(state.selection.training);
      if (players.length < 2) return showNotification('Velg minst 2 spillere', 'error');

      const groupCount = Number($('trainingGroups')?.value ?? 2);
      const groups = makeBalancedGroups(players, groupCount);
      renderTrainingResults(groups);
      showNotification('Grupper laget', 'success');
    });
  }

  function setupMatchUI() {
    const btn = $('createMatchTeamsBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const players = getSelectedPlayers(state.selection.match);
      if (players.length < 2) return showNotification('Velg minst 2 spillere', 'error');

      const res = makeBalancedTeams(players);
      renderMatchResults(res);
      showNotification('Lagdeling klar', 'success');
    });
  }

  function setupLigaUI() {
    // Ikke kritisk for stabilitet – unngå feil ved å gi en enkel melding.
    const startBtn = $('startLigaBtn');
    const resetBtn = $('resetLigaBtn');
    if (startBtn) startBtn.addEventListener('click', () => showNotification('Liga: kommer i neste iterasjon', 'info'));
    if (resetBtn) resetBtn.addEventListener('click', () => showNotification('Liga: kommer i neste iterasjon', 'info'));
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
