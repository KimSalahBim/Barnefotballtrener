// © 2026 Barnefotballtrener.no. All rights reserved.
/* Liga-modul – ekstrahert fra core.js
   Standalone IIFE, same pattern as sesong-kampdag.js
*/
(function () {
  'use strict';

  // ── Local helpers ──
  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Dependencies (set by init) ──
  var _state = null;
  var _saveState = null;
  var _initialized = false;

  // ════════════════════════════════════════
  // IIFE-level functions (moved from setupLigaUI)
  // ════════════════════════════════════════

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

  function ensureNameInputs(n) {
    var namesWrap = $('ligaTeamNames');
    if (!namesWrap) return;
    var count = Math.max(2, Math.min(5, Number(n) || 2));
    var existing = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
    if (existing.length === count) return;

    var prevValues = existing.map(function(i) { return String(i.value || '').trim(); }).filter(Boolean);
    namesWrap.innerHTML = '';

    for (var i = 0; i < count; i++) {
      var v = prevValues[i] || 'Lag ' + (i + 1);
      var row = document.createElement('div');
      row.className = 'team-name-row';
      row.innerHTML =
        '<label class="team-name-label">Lag ' + (i + 1) + '</label>' +
        '<input class="input team-name-input" data-team-name="' + (i+1) + '" type="text" value="' + escapeHtml(v) + '" />';
      namesWrap.appendChild(row);
    }
  }

  function renderLeague(league) {
    var matchesEl = $('ligaMatches');
    var tableEl = $('ligaTable');
    if (!matchesEl || !tableEl) return;

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
            <div class="liga-match-card" style="display:flex; align-items:stretch; justify-content:space-between; gap:8px; padding:8px 10px; border:1px solid rgba(0,0,0,0.06); border-radius:10px; background:var(--bg-card); box-shadow:0 1px 4px rgba(0,0,0,0.03);">
              <div class="liga-side home" style="flex:1; min-width:0;">
                <div style="font-size:10px; font-weight:500; opacity:.5; margin-bottom:2px;">Hjemme</div>
                <div class="liga-team-name" style="font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:4px;">${escapeHtml(m.home)}</div>
                <input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="${m.id}" data-side="home"
                  placeholder="0" value="${m.homeGoals ?? ''}"
                  style="width:100%; text-align:center; font-size:16px; font-weight:500; padding:6px 8px; border-radius:8px;">
              </div>
              <div class="liga-mid" aria-hidden="true" style="display:flex; align-items:center; justify-content:center; width:16px; font-weight:500; opacity:.4; font-size:14px;">–</div>
              <div class="liga-side away" style="flex:1; min-width:0;">
                <div style="font-size:10px; font-weight:500; opacity:.5; margin-bottom:2px; text-align:right;">Borte</div>
                <div class="liga-team-name" style="font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:4px; text-align:right;">${escapeHtml(m.away)}</div>
                <input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="${m.id}" data-side="away"
                  placeholder="0" value="${m.awayGoals ?? ''}"
                  style="width:100%; text-align:center; font-size:16px; font-weight:500; padding:6px 8px; border-radius:8px;">
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

        _state.liga = league;
        _saveState();
        // re-render only table for speed
        const rows2 = calcTable(league);
        var tableEl2 = $('ligaTable');
        if (!tableEl2) return;
        tableEl2.innerHTML = `
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

    // Liga: Editable team names after league is started
    const editNamesHtml = `
        <div style="margin-bottom:12px;">
          <div style="font-weight:500; font-size:13px; margin-bottom:6px;">Rediger lagnavn:</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${league.teams.map((t, i) => `
              <input class="input liga-edit-name" data-team-idx="${i}" type="text" value="${escapeHtml(t.name)}" 
                style="flex:1; min-width:100px; max-width:180px; font-size:13px; padding:6px 8px;">
            `).join('')}
          </div>
        </div>
      `;
    matchesEl.insertAdjacentHTML('afterbegin', editNamesHtml);

    matchesEl.querySelectorAll('input.liga-edit-name').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = Number(inp.getAttribute('data-team-idx'));
        const newName = String(inp.value || '').trim();
        if (!newName || idx < 0 || idx >= league.teams.length) return;

        const oldName = league.teams[idx].name;
        if (oldName === newName) return;

        league.teams[idx].name = newName;
        for (const m of league.matches) {
          if (m.home === oldName) m.home = newName;
          if (m.away === oldName) m.away = newName;
        }

        _state.liga = league;
        _saveState();
        renderLeague(league);
        window.showNotification(`Lagnavn endret: ${oldName} → ${newName}`, 'success');
      });
    });
  }

  function resetLeague() {
    _state.liga = null;
    _saveState();
    var matchesEl = $('ligaMatches');
    var tableEl = $('ligaTable');
    if (matchesEl) matchesEl.innerHTML = '';
    if (tableEl) tableEl.innerHTML = '';
    var teamsInput = $('ligaTeams');
    if (teamsInput) ensureNameInputs(teamsInput.value);
    window.showNotification('Liga nullstilt', 'info');
  }

  function render() {
    if (!_state) return;
    var liga = _state.liga;
    if (liga && liga.teams && liga.matches) {
      var teamsInput = $('ligaTeams');
      var namesWrap = $('ligaTeamNames');
      if (teamsInput) {
        teamsInput.value = String(liga.teams.length);
        ensureNameInputs(liga.teams.length);
        if (namesWrap) {
          var inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
          liga.teams.forEach(function (t, i) {
            if (inputs[i]) inputs[i].value = t.name;
          });
        }
      }
      renderLeague(liga);
    } else {
      var matchesEl = $('ligaMatches');
      var tableEl = $('ligaTable');
      if (matchesEl) matchesEl.innerHTML = '';
      if (tableEl) tableEl.innerHTML = '';
    }
  }

  function init(deps) {
    if (_initialized) return;
    _initialized = true;
    _state = deps.state;
    _saveState = deps.saveState;
    setup();
  }

  window.liga = { init: init, render: render };

  function setup() {
    var teamsInput = $('ligaTeams');
    var roundsInput = $('ligaRounds');
    var namesWrap = $('ligaTeamNames');
    var matchesEl = $('ligaMatches');
    var tableEl = $('ligaTable');
    var startBtn = $('startLigaBtn');
    var resetBtn = $('resetLigaBtn');

    if (!teamsInput || !roundsInput || !namesWrap || !matchesEl || !tableEl) return;

    function getTeamNames() {
      const inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      return inputs.map((i, idx) => {
        const v = String(i.value || '').trim();
        return v || `Lag ${idx + 1}`;
      });
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

    ensureNameInputs(teamsInput.value);

    teamsInput.addEventListener('change', function () {
      ensureNameInputs(teamsInput.value);
    });

    if (startBtn) {
      startBtn.addEventListener('click', function () {
        var league = buildLeague();
        _state.liga = league;
        _saveState();
        renderLeague(league);
        window.showNotification('Liga opprettet', 'success');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetLeague();
      });
    }

    if (_state.liga && _state.liga.teams && _state.liga.matches) {
      var n = _state.liga.teams.length;
      teamsInput.value = String(n);
      ensureNameInputs(n);
      var inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      _state.liga.teams.forEach(function (t, i) { if (inputs[i]) inputs[i].value = t.name; });
      renderLeague(_state.liga);
    }
  }

  window.addEventListener('team:changed', function () {
    render();
  });

})();
