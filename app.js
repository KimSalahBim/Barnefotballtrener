// Fotball Trener App (app.js)
// Inneholder: passord (1234), spillere, trening, kamp, liga + felles UI-hjelpere.
// NB: Kampdag ligger i egen fil: kampdag.js

// ==============================
// GLOBALE VARIABLER
// ==============================
let players = [];
let ligaData = null;
let appInitialized = false;

// ==============================
// INNSTILLING: FERDIGHETSNIVÅ AV/PÅ
// ==============================
let skillEnabled = true; // default på
const LS_SKILL_ENABLED = 'fotballSkillEnabled';

function loadSkillEnabled() {
  const v = localStorage.getItem(LS_SKILL_ENABLED);
  if (v === null) return true;
  return v === 'true';
}
function saveSkillEnabled(value) {
  localStorage.setItem(LS_SKILL_ENABLED, String(!!value));
}
function getEffectiveSkill(player) {
  // Når nivå er deaktivert: behandles alle som "middels" (3)
  return skillEnabled ? (parseInt(player.skill, 10) || 3) : 3;
}

// ==============================
// LOCALSTORAGE KEYS
// ==============================
const LS_PLAYERS = 'fotballPlayersV3';
const LS_LOGIN = 'fotballLoggedIn';
const LS_LOGIN_TIME = 'fotballLoginTime';
const LS_LIGA = 'fotballLigaDataV2';

// ==============================
// SEED RNG (reproduserbar per generering)
// ==============================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ==============================
// HJELPERE
// ==============================
function $(id) {
  return document.getElementById(id);
}
function uid() {
  return `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function showNotification(msg, type = 'info') {
  const el = $('notification');
  if (!el) return;
  el.textContent = msg;
  el.className = `notification ${type}`;
  el.style.display = 'block';
  clearTimeout(showNotification._t);
  showNotification._t = setTimeout(() => {
    el.style.display = 'none';
  }, 2400);
}

// Inline knapper i index.html bruker denne
window.changeNumber = function changeNumber(inputId, delta) {
  const input = $(inputId);
  if (!input) return;
  const min = input.min !== '' ? parseInt(input.min, 10) : -Infinity;
  const max = input.max !== '' ? parseInt(input.max, 10) : Infinity;
  let v = parseInt(input.value || '0', 10);
  if (Number.isNaN(v)) v = 0;
  v = clamp(v + delta, min, max);
  input.value = String(v);

  // trigger input event for evt lyttere
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

// ==============================
// LOGIN (PASSORD 1234)
// ==============================
function showPasswordScreen() {
  $('passwordProtection').style.display = 'flex';
  $('mainApp').style.display = 'none';
}
function showMainApp() {
  $('passwordProtection').style.display = 'none';
  $('mainApp').style.display = 'block';
  updateHeaderBrand();
}

function checkLoginStatus() {
  const isLoggedIn = localStorage.getItem(LS_LOGIN);
  const loginTime = localStorage.getItem(LS_LOGIN_TIME);
  if (isLoggedIn === 'true' && loginTime) {
    const hours = (Date.now() - parseInt(loginTime, 10)) / (1000 * 60 * 60);
    if (hours < 12) {
      showMainApp();
      initApp();
      return;
    }
  }
  showPasswordScreen();
  bindLoginEvents();
}

function bindLoginEvents() {
  const btn = $('loginBtn');
  if (!btn) return;

  btn.onclick = () => {
    const pwd = prompt('Skriv passord:');
    if (pwd === '1234') {
      localStorage.setItem(LS_LOGIN, 'true');
      localStorage.setItem(LS_LOGIN_TIME, String(Date.now()));
      $('passwordError').style.display = 'none';
      showMainApp();
      initApp();
    } else {
      $('passwordError').style.display = 'block';
    }
  };

  const logout = $('logoutBtn');
  if (logout) {
    logout.onclick = () => {
      localStorage.removeItem(LS_LOGIN);
      localStorage.removeItem(LS_LOGIN_TIME);
      showPasswordScreen();
      showNotification('Logget ut', 'info');
    };
  }
}

// ==============================
// HEADER BRAND (ingen Egge/Sørlia-logo)
// ==============================
function updateHeaderBrand() {
  const container = $('logoContainer');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <div style="width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.05);">
        <span style="font-size:20px;">⚽</span>
      </div>
      <div style="line-height:1.1;">
        <div style="font-weight:800;">Barnefotballtrener</div>
        <div style="font-size:12px; opacity:0.7;">Enkel trener-app</div>
      </div>
    </div>
  `;
}

// ==============================
// DATA: SPILLERE
// ==============================
function loadPlayers() {
  try {
    const raw = localStorage.getItem(LS_PLAYERS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Normaliser
    return arr.map(p => ({
      id: p.id || uid(),
      name: String(p.name || '').trim(),
      skill: String(p.skill ?? '3'),
      goalie: !!p.goalie,
      active: p.active !== false
    })).filter(p => p.name.length > 0);
  } catch {
    return [];
  }
}
function savePlayers() {
  localStorage.setItem(LS_PLAYERS, JSON.stringify(players));
  // Eksponer for kampdag.js
  window.players = players;
  window.dispatchEvent(new Event('playersUpdated'));
}

function getActivePlayers() {
  return players.filter(p => p.active);
}

// ==============================
// UI: NAV / TABS
// ==============================
function setupTabs() {
  const navBtns = Array.from(document.querySelectorAll('.nav-btn'));
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.getAttribute('data-tab');
      Array.from(document.querySelectorAll('.tab-content')).forEach(sec => {
        sec.classList.remove('active');
      });
      const target = document.getElementById(tab);
      if (target) target.classList.add('active');

      if (tab === 'training') renderTrainingSelection();
      if (tab === 'match') renderMatchSelection();
      if (tab === 'kampdag') window.dispatchEvent(new Event('playersUpdated'));
      if (tab === 'liga') renderLigaUI();
    });
  });
}

// ==============================
// UI: SPILLERE
// ==============================
function setupSkillToggle() {
  skillEnabled = loadSkillEnabled();
  const toggle = $('skillToggle');
  const hint = $('skillToggleHint');
  if (!toggle) return;

  toggle.checked = skillEnabled;
  if (hint) {
    hint.textContent = skillEnabled
      ? 'Nivå er aktivert. (Brukes i gruppering og lagdeling.)'
      : 'Nivå er deaktivert. (Trening/Kamp blir random.)';
  }

  toggle.addEventListener('change', () => {
    skillEnabled = toggle.checked;
    saveSkillEnabled(skillEnabled);

    const playerSkill = $('playerSkill');
    if (playerSkill) playerSkill.disabled = !skillEnabled;

    if (hint) {
      hint.textContent = skillEnabled
        ? 'Nivå er aktivert. (Brukes i gruppering og lagdeling.)'
        : 'Nivå er deaktivert. (Trening/Kamp blir random.)';
    }

    showNotification(skillEnabled ? 'Nivå: PÅ' : 'Nivå: AV', 'info');
  });

  const playerSkill = $('playerSkill');
  if (playerSkill) playerSkill.disabled = !skillEnabled;
}

function updatePlayerStats() {
  const totalPlayers = $('totalPlayers');
  const totalGoalies = $('totalGoalies');
  const playerCount = $('playerCount');

  const all = players.length;
  const goalies = players.filter(p => p.goalie).length;
  const active = getActivePlayers().length;

  if (totalPlayers) totalPlayers.textContent = String(all);
  if (totalGoalies) totalGoalies.textContent = String(goalies);
  if (playerCount) playerCount.textContent = String(active);
}

function renderPlayersList() {
  const list = $('playerList');
  if (!list) return;

  if (players.length === 0) {
    list.innerHTML = `
      <div class="results-container" style="text-align:center; opacity:0.75;">
        Ingen spillere enda. Legg til en spiller over.
      </div>
    `;
    updatePlayerStats();
    return;
  }

  list.innerHTML = '';

  players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';

    const levelText = skillEnabled ? `Nivå ${parseInt(p.skill, 10) || 3}` : 'Nivå: av';
    const roleText = p.goalie ? 'Keeper' : 'Utespiller';
    const roleIcon = p.goalie ? '🧤' : '⚽';

    card.innerHTML = `
      <div class="player-card-inner" style="display:flex; justify-content:space-between; gap:12px; align-items:center;">
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="font-weight:800; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(p.name)}
            </div>
            <span style="opacity:0.85;">${roleIcon}</span>
          </div>
          <div class="small-text" style="opacity:0.75; margin-top:2px;">
            ${escapeHtml(roleText)} • ${escapeHtml(levelText)}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
          <label class="checkbox-label" style="margin:0;">
            <input type="checkbox" data-action="active" data-id="${p.id}" ${p.active ? 'checked' : ''}>
            <span>Aktiv</span>
          </label>

          <button class="icon-btn" type="button" title="Rediger" data-action="edit" data-id="${p.id}">
            <i class="fas fa-pen"></i>
          </button>
          <button class="icon-btn" type="button" title="Slett" data-action="delete" data-id="${p.id}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  // Delegert handling
  list.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    const idx = players.findIndex(x => x.id === id);
    if (idx === -1) return;

    if (action === 'delete') {
      if (confirm(`Slette ${players[idx].name}?`)) {
        players.splice(idx, 1);
        savePlayers();
        renderPlayersList();
        renderTrainingSelection();
        renderMatchSelection();
        updatePlayerStats();
        showNotification('Spiller slettet', 'info');
      }
    }

    if (action === 'edit') {
      const p = players[idx];
      const newName = prompt('Endre navn:', p.name);
      if (newName === null) return;
      const cleaned = newName.trim();
      if (!cleaned) return showNotification('Navn kan ikke være tomt', 'error');

      let newSkill = p.skill;
      if (skillEnabled) {
        const sk = prompt('Endre nivå (1–6):', String(parseInt(p.skill, 10) || 3));
        if (sk !== null) {
          const v = clamp(parseInt(sk, 10) || 3, 1, 6);
          newSkill = String(v);
        }
      }

      const canGoalie = confirm('Kan stå i mål? (OK = ja, Avbryt = nei)');
      players[idx] = { ...p, name: cleaned, skill: newSkill, goalie: !!canGoalie };
      savePlayers();
      renderPlayersList();
      renderTrainingSelection();
      renderMatchSelection();
      updatePlayerStats();
      showNotification('Spiller oppdatert', 'info');
    }
  };

  list.onchange = (e) => {
    const el = e.target.closest('input[data-action="active"]');
    if (!el) return;
    const id = el.getAttribute('data-id');
    const idx = players.findIndex(x => x.id === id);
    if (idx === -1) return;
    players[idx].active = el.checked;
    savePlayers();
    updatePlayerStats();
    renderTrainingSelection();
    renderMatchSelection();
  };

  updatePlayerStats();
}

function setupAddPlayer() {
  const btn = $('addPlayerBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const nameEl = $('playerName');
    const skillEl = $('playerSkill');
    const goalieEl = $('playerGoalie');

    const name = (nameEl?.value || '').trim();
    if (!name) {
      showNotification('Skriv inn navn', 'error');
      return;
    }

    const skill = skillEnabled ? String(clamp(parseInt(skillEl?.value || '3', 10) || 3, 1, 6)) : '3';
    const goalie = !!goalieEl?.checked;

    players.push({
      id: uid(),
      name,
      skill,
      goalie,
      active: true
    });

    savePlayers();
    renderPlayersList();
    renderTrainingSelection();
    renderMatchSelection();
    updatePlayerStats();

    if (nameEl) nameEl.value = '';
    if (goalieEl) goalieEl.checked = false;

    showNotification('Spiller lagt til', 'success');
  });
}

function setupImportExportClear() {
  const exportBtn = $('exportBtn');
  const importBtn = $('importBtn');
  const importFile = $('importFile');
  const clearBtn = $('clearAllBtn');

  if (exportBtn) {
    exportBtn.onclick = () => {
      const blob = new Blob([JSON.stringify(players, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spillere.json';
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  if (importBtn && importFile) {
    importBtn.onclick = () => importFile.click();
    importFile.onchange = async () => {
      const file = importFile.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('Ugyldig fil');
        const normalized = arr.map(p => ({
          id: p.id || uid(),
          name: String(p.name || '').trim(),
          skill: String(p.skill ?? '3'),
          goalie: !!p.goalie,
          active: p.active !== false
        })).filter(p => p.name.length > 0);

        players = normalized;
        savePlayers();
        renderPlayersList();
        renderTrainingSelection();
        renderMatchSelection();
        updatePlayerStats();
        showNotification('Importert!', 'success');
      } catch {
        showNotification('Kunne ikke importere fil', 'error');
      } finally {
        importFile.value = '';
      }
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (!confirm('Slette alle spillere?')) return;
      players = [];
      savePlayers();
      renderPlayersList();
      renderTrainingSelection();
      renderMatchSelection();
      updatePlayerStats();
      showNotification('Alle spillere slettet', 'info');
    };
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ==============================
// TRENING
// ==============================
const trainingSelected = new Set();

function renderTrainingSelection() {
  const container = $('trainingPlayerSelection');
  const countEl = $('trainingSelectedCount');
  if (!container) return;

  const active = getActivePlayers();
  // Rydd bort ids som ikke finnes lenger
  for (const id of Array.from(trainingSelected)) {
    if (!active.some(p => p.id === id)) trainingSelected.delete(id);
  }

  if (countEl) countEl.textContent = String(trainingSelected.size);

  container.innerHTML = '';
  if (active.length === 0) {
    container.innerHTML = `<div class="small-text" style="opacity:0.75;">Ingen aktive spillere. Gå til Spillere.</div>`;
    return;
  }

  active.forEach(p => {
    const row = document.createElement('label');
    row.className = 'player-select-item';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '10px';

    const roleIcon = p.goalie ? '🧤' : '⚽';
    const roleText = p.goalie ? 'Keeper' : 'Utespiller';

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <input type="checkbox" data-id="${p.id}" ${trainingSelected.has(p.id) ? 'checked' : ''}>
        <div style="min-width:0;">
          <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.name)}</div>
          <div class="small-text" style="opacity:0.75;">${roleIcon} ${escapeHtml(roleText)}</div>
        </div>
      </div>
      <div class="small-text" style="opacity:0.65;">${skillEnabled ? `Nivå ${getEffectiveSkill(p)}` : ''}</div>
    `;

    container.appendChild(row);
  });

  container.onchange = (e) => {
    const cb = e.target;
    if (!(cb instanceof HTMLInputElement)) return;
    const id = cb.getAttribute('data-id');
    if (!id) return;
    if (cb.checked) trainingSelected.add(id);
    else trainingSelected.delete(id);
    if (countEl) countEl.textContent = String(trainingSelected.size);
  };

  // Knapper
  const allBtn = $('selectAllTraining');
  const noneBtn = $('deselectAllTraining');
  if (allBtn) allBtn.onclick = () => {
    active.forEach(p => trainingSelected.add(p.id));
    renderTrainingSelection();
  };
  if (noneBtn) noneBtn.onclick = () => {
    trainingSelected.clear();
    renderTrainingSelection();
  };
}

function makeTrainingGroups(selectedPlayers, groupCount, rng) {
  const groups = Array.from({ length: groupCount }, (_, i) => ({
    name: `Gruppe ${String.fromCharCode(65 + i)}`,
    players: [],
    goalieCount: 0
  }));

  const pool = [...selectedPlayers];

  // Nivå AV => random
  if (!skillEnabled) {
    shuffleInPlace(pool, rng);
    pool.forEach((p, idx) => {
      const g = groups[idx % groupCount];
      g.players.push(p);
      g.goalieCount += p.goalie ? 1 : 0;
    });
    return groups;
  }

  // Nivå PÅ => DIFFERENSIERING (A høyest nivå, B neste, osv.)
  // Litt kontrollert random: jitter innenfor samme nivå
  const scored = pool.map(p => ({
    p,
    score: getEffectiveSkill(p) + (rng() - 0.5) * 0.35
  })).sort((a, b) => b.score - a.score);

  // Chunking: fyll A først, så B...
  scored.forEach(({ p }, idx) => {
    const gi = Math.floor(idx * groupCount / scored.length);
    const g = groups[gi];
    g.players.push(p);
    g.goalieCount += p.goalie ? 1 : 0;
  });

  // Litt random i rekkefølge i gruppa
  groups.forEach(g => shuffleInPlace(g.players, rng));
  return groups;
}

function renderGroupCards(container, groups, metaText = '') {
  container.innerHTML = '';
  if (metaText) {
    const meta = document.createElement('div');
    meta.className = 'small-text';
    meta.style.opacity = '0.8';
    meta.style.marginBottom = '10px';
    meta.textContent = metaText;
    container.appendChild(meta);
  }

  const wrap = document.createElement('div');
  wrap.className = 'group-grid';
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(260px, 1fr))';
  wrap.style.gap = '12px';

  groups.forEach((g) => {
    const card = document.createElement('div');
    card.className = 'group-card';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <div class="group-title" style="font-weight:800;">${escapeHtml(g.name)}</div>
      <div class="group-meta small-text" style="opacity:0.75;">
        ${g.players.length} spillere • ${g.goalieCount} målvakt(er)
      </div>
    `;

    const list = document.createElement('div');
    list.className = 'group-players';

    g.players.forEach(p => {
      const item = document.createElement('div');
      item.className = 'player-item';
      const icon = p.goalie ? '🧤' : '⚽';
      item.innerHTML = `
        <span style="margin-right:8px; opacity:0.9;">${icon}</span>
        <span style="font-weight:600;">${escapeHtml(p.name)}</span>
      `;
      list.appendChild(item);
    });

    card.appendChild(header);
    card.appendChild(list);
    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}

function setupTraining() {
  const btn = $('createTrainingGroupsBtn');
  const results = $('trainingResults');
  if (!btn || !results) return;

  btn.onclick = () => {
    const ids = Array.from(trainingSelected);
    const selectedPlayers = getActivePlayers().filter(p => ids.includes(p.id));

    if (selectedPlayers.length < 2) {
      showNotification('Velg minst 2 spillere', 'error');
      return;
    }

    const groupCount = clamp(parseInt($('trainingGroups')?.value || '3', 10) || 3, 2, 6);
    $('trainingGroups').value = String(groupCount);

    const seed = Date.now();
    const rng = mulberry32(seed);

    const groups = makeTrainingGroups(selectedPlayers, groupCount, rng);

    const meta = skillEnabled
      ? 'Nivå: PÅ (differensiert grupper)'
      : 'Nivå: AV (random grupper)';

    renderGroupCards(results, groups, meta);
  };
}

// ==============================
// KAMP (LAG)
// ==============================
const matchSelected = new Set();

function renderMatchSelection() {
  const container = $('matchPlayerSelection');
  const countEl = $('matchSelectedCount');
  if (!container) return;

  const active = getActivePlayers();
  for (const id of Array.from(matchSelected)) {
    if (!active.some(p => p.id === id)) matchSelected.delete(id);
  }
  if (countEl) countEl.textContent = String(matchSelected.size);

  container.innerHTML = '';
  if (active.length === 0) {
    container.innerHTML = `<div class="small-text" style="opacity:0.75;">Ingen aktive spillere. Gå til Spillere.</div>`;
    return;
  }

  active.forEach(p => {
    const row = document.createElement('label');
    row.className = 'player-select-item';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '10px';

    const roleIcon = p.goalie ? '🧤' : '⚽';
    const roleText = p.goalie ? 'Keeper' : 'Utespiller';

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <input type="checkbox" data-id="${p.id}" ${matchSelected.has(p.id) ? 'checked' : ''}>
        <div style="min-width:0;">
          <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.name)}</div>
          <div class="small-text" style="opacity:0.75;">${roleIcon} ${escapeHtml(roleText)}</div>
        </div>
      </div>
      <div class="small-text" style="opacity:0.65;">${skillEnabled ? `Nivå ${getEffectiveSkill(p)}` : ''}</div>
    `;
    container.appendChild(row);
  });

  container.onchange = (e) => {
    const cb = e.target;
    if (!(cb instanceof HTMLInputElement)) return;
    const id = cb.getAttribute('data-id');
    if (!id) return;
    if (cb.checked) matchSelected.add(id);
    else matchSelected.delete(id);
    if (countEl) countEl.textContent = String(matchSelected.size);
  };

  const allBtn = $('selectAllMatch');
  const noneBtn = $('deselectAllMatch');
  if (allBtn) allBtn.onclick = () => {
    active.forEach(p => matchSelected.add(p.id));
    renderMatchSelection();
  };
  if (noneBtn) noneBtn.onclick = () => {
    matchSelected.clear();
    renderMatchSelection();
  };
}

function createBalancedTeams(selectedPlayers, teamCount, rng) {
  const teams = Array.from({ length: teamCount }, (_, i) => ({
    name: `Lag ${i + 1}`,
    players: [],
    goalieCount: 0,
    skillSum: 0
  }));

  const pool = [...selectedPlayers];

  // Nivå AV => random
  if (!skillEnabled) {
    shuffleInPlace(pool, rng);
    pool.forEach((p, idx) => {
      const t = teams[idx % teamCount];
      t.players.push(p);
      t.goalieCount += p.goalie ? 1 : 0;
      t.skillSum += getEffectiveSkill(p);
    });
    return teams;
  }

  // Nivå PÅ => balanserte lag med kontrollert random
  const scored = pool.map(p => ({
    p,
    score: getEffectiveSkill(p) + (rng() - 0.5) * 0.4
  })).sort((a, b) => b.score - a.score);

  scored.forEach(({ p }) => {
    // legg til på laget med lavest sum (tie-break med rng)
    let minSum = Math.min(...teams.map(t => t.skillSum));
    let candidates = teams.filter(t => t.skillSum === minSum);
    const pick = candidates[Math.floor(rng() * candidates.length)];
    pick.players.push(p);
    pick.goalieCount += p.goalie ? 1 : 0;
    pick.skillSum += getEffectiveSkill(p);
  });

  teams.forEach(t => shuffleInPlace(t.players, rng));
  return teams;
}

function enforceGoaliesIfNeeded(teams, rng) {
  // Heuristikk: prøv å få minst 1 goalie i hvert lag hvis mulig
  const totalGoalies = teams.reduce((s, t) => s + t.goalieCount, 0);
  if (totalGoalies < teams.length) return { ok: false, message: 'For få keepere til å dekke alle lag.' };

  let safety = 60;
  while (safety-- > 0) {
    const missing = teams.filter(t => t.goalieCount === 0);
    if (missing.length === 0) break;

    // finn et lag med 2+ keepere
    const donor = teams.find(t => t.goalieCount >= 2);
    if (!donor) break;

    const receiver = missing[Math.floor(rng() * missing.length)];

    // flytt en keeper fra donor til receiver (bytt med en utespiller)
    const donorKeeperIdx = donor.players.findIndex(p => p.goalie);
    const recvOutIdx = receiver.players.findIndex(p => !p.goalie);

    if (donorKeeperIdx === -1 || recvOutIdx === -1) break;

    const donorKeeper = donor.players[donorKeeperIdx];
    const recvOut = receiver.players[recvOutIdx];

    donor.players.splice(donorKeeperIdx, 1);
    receiver.players.splice(recvOutIdx, 1);

    donor.players.push(recvOut);
    receiver.players.push(donorKeeper);

    donor.goalieCount = donor.players.filter(p => p.goalie).length;
    receiver.goalieCount = receiver.players.filter(p => p.goalie).length;
  }

  const stillMissing = teams.some(t => t.goalieCount === 0);
  return { ok: !stillMissing, message: stillMissing ? 'Klarte ikke å fordele keepere helt.' : '' };
}

function setupMatch() {
  const btn = $('createMatchTeamsBtn');
  const results = $('matchResults');
  if (!btn || !results) return;

  btn.onclick = () => {
    const ids = Array.from(matchSelected);
    const selectedPlayers = getActivePlayers().filter(p => ids.includes(p.id));
    if (selectedPlayers.length < 2) {
      showNotification('Velg minst 2 spillere', 'error');
      return;
    }

    const teamCount = clamp(parseInt($('matchTeams')?.value || '2', 10) || 2, 2, 5);
    $('matchTeams').value = String(teamCount);

    const seed = Date.now();
    const rng = mulberry32(seed);

    let teams = createBalancedTeams(selectedPlayers, teamCount, rng);

    const allowWithoutGoalies = $('allowTeamsWithoutGoalies')?.checked !== false;
    if (!allowWithoutGoalies) {
      const res = enforceGoaliesIfNeeded(teams, rng);
      if (!res.ok) showNotification(res.message, 'info');
    }

    const meta = skillEnabled
      ? 'Nivå: PÅ (balanserte lag)'
      : 'Nivå: AV (random lag)';

    // Render som kort
    results.innerHTML = '';
    renderGroupCards(results, teams.map(t => ({
      name: t.name,
      players: t.players,
      goalieCount: t.goalieCount
    })), meta);
  };
}

// ==============================
// LIGA
// ==============================
function loadLiga() {
  try {
    const raw = localStorage.getItem(LS_LIGA);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveLiga() {
  localStorage.setItem(LS_LIGA, JSON.stringify(ligaData));
}

function buildRoundRobinPairs(teamNames) {
  // Klassisk “circle method”
  const n = teamNames.length;
  const teams = teamNames.slice();
  const isOdd = n % 2 === 1;
  if (isOdd) teams.push('BYE');

  const m = teams.length;
  const rounds = m - 1;
  const half = m / 2;

  const schedule = [];

  let arr = teams.slice();
  for (let r = 0; r < rounds; r++) {
    const round = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a !== 'BYE' && b !== 'BYE') round.push([a, b]);
    }
    schedule.push(round);

    // roter
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed, ...rest];
  }

  return schedule;
}

function computeTable(teamNames, matches) {
  const table = {};
  teamNames.forEach(name => {
    table[name] = { team: name, played: 0, won: 0, draw: 0, lost: 0, gf: 0, ga: 0, pts: 0 };
  });

  matches.forEach(m => {
    const { home, away, homeGoals, awayGoals } = m;
    const hg = Number.isFinite(homeGoals) ? homeGoals : null;
    const ag = Number.isFinite(awayGoals) ? awayGoals : null;
    if (hg === null || ag === null) return;

    const H = table[home];
    const A = table[away];
    if (!H || !A) return;

    H.played++; A.played++;
    H.gf += hg; H.ga += ag;
    A.gf += ag; A.ga += hg;

    if (hg > ag) { H.won++; A.lost++; H.pts += 3; }
    else if (hg < ag) { A.won++; H.lost++; A.pts += 3; }
    else { H.draw++; A.draw++; H.pts += 1; A.pts += 1; }
  });

  const arr = Object.values(table);
  arr.sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    const gdY = y.gf - y.ga;
    const gdX = x.gf - x.ga;
    if (gdY !== gdX) return gdY - gdX;
    return y.gf - x.gf;
  });

  return arr;
}

function renderLigaUI() {
  const teamsInput = $('ligaTeams');
  const roundsInput = $('ligaRounds');
  const namesContainer = $('ligaTeamNames');
  if (!teamsInput || !roundsInput || !namesContainer) return;

  const teamCount = clamp(parseInt(teamsInput.value || '3', 10) || 3, 2, 5);
  teamsInput.value = String(teamCount);

  // init ligaData hvis ikke finnes
  if (!ligaData) {
    ligaData = loadLiga() || null;
  }
  if (!ligaData || !ligaData.teamNames || ligaData.teamNames.length !== teamCount) {
    const defaultNames = Array.from({ length: teamCount }, (_, i) => `Lag ${i + 1}`);
    ligaData = {
      teamNames: defaultNames,
      rounds: clamp(parseInt(roundsInput.value || '2', 10) || 2, 1, 5),
      matches: []
    };
    saveLiga();
  }

  // Render navn inputs
  namesContainer.innerHTML = '';
  ligaData.teamNames.forEach((name, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    wrap.innerHTML = `
      <label>Navn lag ${idx + 1}</label>
      <input class="input" type="text" data-teamname="${idx}" value="${escapeHtml(name)}">
    `;
    namesContainer.appendChild(wrap);
  });

  namesContainer.oninput = (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const idx = input.getAttribute('data-teamname');
    if (idx === null) return;
    ligaData.teamNames[parseInt(idx, 10)] = input.value.trim() || `Lag ${parseInt(idx, 10) + 1}`;
    saveLiga();
    renderLigaMatchesAndTable();
  };

  const startBtn = $('startLigaBtn');
  const resetBtn = $('resetLigaBtn');

  if (startBtn) {
    startBtn.onclick = () => {
      ligaData.rounds = clamp(parseInt(roundsInput.value || '2', 10) || 2, 1, 5);
      saveLiga();

      // lag fixture
      const base = buildRoundRobinPairs(ligaData.teamNames);
      const allMatches = [];
      for (let r = 0; r < ligaData.rounds; r++) {
        base.forEach((round, idx) => {
          round.forEach(([a, b]) => {
            // alterner hjemme/borte litt for variasjon
            const swap = (idx + r) % 2 === 1;
            const home = swap ? b : a;
            const away = swap ? a : b;
            allMatches.push({
              id: uid(),
              round: r + 1,
              home,
              away,
              homeGoals: null,
              awayGoals: null
            });
          });
        });
      }
      ligaData.matches = allMatches;
      saveLiga();
      renderLigaMatchesAndTable();
      showNotification('Liga startet', 'success');
    };
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      if (!confirm('Nullstill liga?')) return;
      ligaData = null;
      localStorage.removeItem(LS_LIGA);
      renderLigaUI();
      $('ligaMatches').innerHTML = '';
      $('ligaTable').innerHTML = '';
      showNotification('Liga nullstilt', 'info');
    };
  }

  renderLigaMatchesAndTable();
}

function renderLigaMatchesAndTable() {
  const matchesEl = $('ligaMatches');
  const tableEl = $('ligaTable');
  if (!matchesEl || !tableEl || !ligaData) return;

  const teamNames = ligaData.teamNames;

  // Matches
  if (!ligaData.matches || ligaData.matches.length === 0) {
    matchesEl.innerHTML = `<div class="small-text" style="opacity:0.75;">Trykk “Start liga” for å generere kamper.</div>`;
  } else {
    matchesEl.innerHTML = '';
    ligaData.matches.forEach(m => {
      const row = document.createElement('div');
      row.className = 'match-row';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '1fr 60px 30px 60px 1fr';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.style.padding = '10px 0';
      row.style.borderBottom = '1px solid rgba(0,0,0,0.06)';

      const hg = Number.isFinite(m.homeGoals) ? m.homeGoals : '';
      const ag = Number.isFinite(m.awayGoals) ? m.awayGoals : '';

      row.innerHTML = `
        <div style="font-weight:700;">${escapeHtml(m.home)}</div>
        <input class="input" type="number" min="0" inputmode="numeric" data-mid="${m.id}" data-side="home" value="${hg}">
        <div style="text-align:center; opacity:0.6;">-</div>
        <input class="input" type="number" min="0" inputmode="numeric" data-mid="${m.id}" data-side="away" value="${ag}">
        <div style="font-weight:700; text-align:right;">${escapeHtml(m.away)}</div>
      `;
      matchesEl.appendChild(row);
    });

    matchesEl.oninput = (e) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement)) return;
      const mid = input.getAttribute('data-mid');
      const side = input.getAttribute('data-side');
      if (!mid || !side) return;

      const match = ligaData.matches.find(x => x.id === mid);
      if (!match) return;

      const vRaw = input.value.trim();
      const v = vRaw === '' ? null : clamp(parseInt(vRaw, 10) || 0, 0, 99);

      if (side === 'home') match.homeGoals = v;
      if (side === 'away') match.awayGoals = v;

      saveLiga();
      renderLigaTableOnly();
    };
  }

  renderLigaTableOnly();
}

function renderLigaTableOnly() {
  const tableEl = $('ligaTable');
  if (!tableEl || !ligaData) return;

  const teamNames = ligaData.teamNames;
  const matches = ligaData.matches || [];

  const table = computeTable(teamNames, matches);

  const html = `
    <div style="overflow:auto;">
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="text-align:left; border-bottom:1px solid rgba(0,0,0,0.08);">
            <th style="padding:8px;">Lag</th>
            <th style="padding:8px;">K</th>
            <th style="padding:8px;">S</th>
            <th style="padding:8px;">U</th>
            <th style="padding:8px;">T</th>
            <th style="padding:8px;">Mål</th>
            <th style="padding:8px;">+/-</th>
            <th style="padding:8px;">Poeng</th>
          </tr>
        </thead>
        <tbody>
          ${table.map(r => {
            const gd = r.gf - r.ga;
            const gdStr = gd > 0 ? `+${gd}` : `${gd}`;
            return `
              <tr style="border-bottom:1px solid rgba(0,0,0,0.06);">
                <td style="padding:8px; font-weight:700;">${escapeHtml(r.team)}</td>
                <td style="padding:8px;">${r.played}</td>
                <td style="padding:8px;">${r.won}</td>
                <td style="padding:8px;">${r.draw}</td>
                <td style="padding:8px;">${r.lost}</td>
                <td style="padding:8px;">${r.gf}-${r.ga}</td>
                <td style="padding:8px; font-weight:700;">${gdStr}</td>
                <td style="padding:8px; font-weight:800;">${r.pts}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  tableEl.innerHTML = html;
}

// ==============================
// INIT
// ==============================
function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  setupTabs();

  // Skill toggle
  setupSkillToggle();

  // Load players
  players = loadPlayers();
  window.players = players;

  // UI - players
  setupAddPlayer();
  setupImportExportClear();
  renderPlayersList();
  updatePlayerStats();

  // Training + Match
  renderTrainingSelection();
  renderMatchSelection();
  setupTraining();
  setupMatch();

  // Liga
  ligaData = loadLiga() || null;
  renderLigaUI();

  showNotification('Klar!', 'success');
}

// ==============================
// START
// ==============================
document.addEventListener('DOMContentLoaded', () => {
  checkLoginStatus();
});
