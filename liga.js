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

  function renderTableHTML(league) {
    var rows = calcTable(league);
    return '<div class="liga-table-wrap">' +
      '<table class="liga-table">' +
      '<thead><tr>' +
      '<th class="liga-th-team">Lag</th><th>K</th><th>V</th><th>U</th><th>T</th>' +
      '<th>Mål</th><th>Diff</th><th class="liga-th-pts">P</th>' +
      '</tr></thead><tbody>' +
      rows.map(function(r) {
        return '<tr>' +
          '<td class="liga-td-team">' + escapeHtml(r.team) + '</td>' +
          '<td>' + r.p + '</td>' +
          '<td>' + r.w + '</td>' +
          '<td>' + r.d + '</td>' +
          '<td>' + r.l + '</td>' +
          '<td>' + r.gf + '-' + r.ga + '</td>' +
          '<td>' + r.gd + '</td>' +
          '<td class="liga-td-pts">' + r.pts + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function renderProgress(league) {
    var total = league.matches.length;
    var played = league.matches.filter(function(m) {
      return m.homeGoals !== null && m.awayGoals !== null;
    }).length;
    if (total === 0) return '';
    return '<div class="liga-progress">' + played + ' av ' + total + ' kamper registrert</div>';
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

  function restoreSetupForm() {
    var setupEl = $('ligaSetup');
    if (!setupEl) return;
    setupEl.innerHTML =
      '<div class="settings-row">' +
        '<div class="settings-label">Antall lag:</div>' +
        '<div class="number-control">' +
          '<button class="number-btn minus" type="button" onclick="changeNumber(\'ligaTeams\', -1)">\u2212</button>' +
          '<input type="number" id="ligaTeams" class="number-input" value="3" min="2" max="5">' +
          '<button class="number-btn plus" type="button" onclick="changeNumber(\'ligaTeams\', 1)">+</button>' +
        '</div>' +
      '</div>' +
      '<div class="settings-row">' +
        '<div class="settings-label">Antall runder:</div>' +
        '<div class="number-control">' +
          '<button class="number-btn minus" type="button" onclick="changeNumber(\'ligaRounds\', -1)">\u2212</button>' +
          '<input type="number" id="ligaRounds" class="number-input" value="2" min="1" max="5">' +
          '<button class="number-btn plus" type="button" onclick="changeNumber(\'ligaRounds\', 1)">+</button>' +
        '</div>' +
      '</div>' +
      '<div id="ligaTeamNames" class="team-names"></div>' +
      '<div class="settings-row liga-setup-actions">' +
        '<button id="startLigaBtn" class="btn-primary" type="button">' +
          '<i class="fas fa-play"></i> Start liga' +
        '</button>' +
        '<button id="resetLigaBtn" class="btn-secondary liga-btn-sm liga-btn-reset" type="button">' +
          '<i class="fas fa-rotate-left"></i> Nullstill' +
        '</button>' +
      '</div>';

    var teamsInput = $('ligaTeams');
    var startBtn = $('startLigaBtn');
    var resetBtn = $('resetLigaBtn');

    if (_state.liga && _state.liga.teams) {
      teamsInput.value = String(_state.liga.teams.length);
    }
    ensureNameInputs(teamsInput.value);

    if (_state.liga && _state.liga.teams) {
      var namesWrap = $('ligaTeamNames');
      var inputs = Array.from(namesWrap.querySelectorAll('input[data-team-name]'));
      _state.liga.teams.forEach(function(t, i) { if (inputs[i]) inputs[i].value = t.name; });
    }

    teamsInput.addEventListener('change', function() {
      ensureNameInputs(teamsInput.value);
    });

    if (startBtn) {
      startBtn.addEventListener('click', function() {
        var namesWrap2 = $('ligaTeamNames');
        var nameInputs = Array.from(namesWrap2.querySelectorAll('input[data-team-name]'));
        var names = nameInputs.map(function(inp, idx) {
          var v = String(inp.value || '').trim();
          return v || 'Lag ' + (idx + 1);
        });
        var uniqueNames = new Set(names.map(function(n) { return n.toLowerCase().trim(); }));
        if (uniqueNames.size < names.length) {
          window.showNotification('Hvert lag må ha et unikt navn', 'error');
          return;
        }
        if (_state.liga && _state.liga.matches && _state.liga.matches.some(function(m) { return m.homeGoals !== null; })) {
          if (!confirm('Du har registrerte resultater. Starte ny liga sletter disse. Fortsett?')) return;
        }
        var nTeams = Math.max(2, Math.min(5, Number($('ligaTeams').value) || 2));
        var nRounds = Math.max(1, Math.min(5, Number($('ligaRounds').value) || 1));
        var result = genRoundRobin(names.slice(0, nTeams));
        var matches = [];
        var mid = 1;
        for (var rep = 0; rep < nRounds; rep++) {
          for (var si = 0; si < result.schedule.length; si++) {
            var sm = result.schedule[si];
            var flip = (rep % 2 === 1);
            matches.push({
              id: 'm_' + (mid++),
              rep: rep + 1,
              round: sm.round,
              home: flip ? sm.away : sm.home,
              away: flip ? sm.home : sm.away,
              homeGoals: null,
              awayGoals: null
            });
          }
        }
        var league = {
          createdAt: Date.now(),
          teams: names.slice(0, nTeams).map(function(name, i) { return { id: 't_' + (i + 1), name: name }; }),
          rounds: nRounds,
          matches: matches
        };
        _state.liga = league;
        _saveState();
        render();
        window.showNotification('Liga opprettet', 'success');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        if (!confirm('Nullstille ligaen? Alle kamper og resultater slettes.')) return;
        resetLeague();
        restoreSetupForm();
      });
    }
  }

  function renderSetupState(hasLiga) {
    var setupEl = $('ligaSetup');
    var tableWrap = $('ligaTableWrap');
    var matchesWrap = $('ligaMatchesWrap');
    if (!setupEl) return;

    if (hasLiga && _state.liga) {
      var league = _state.liga;
      var teamNames = league.teams.map(function(t) { return escapeHtml(t.name); }).join(' \u00b7 ');
      var serieText = league.rounds === 1 ? '1 serie' : league.rounds + ' serier';
      setupEl.innerHTML =
        '<div class="liga-summary">' +
          '<div class="liga-summary-info">' +
            '<span class="liga-summary-teams">' + teamNames + '</span>' +
            '<span class="liga-summary-meta">' + league.teams.length + ' lag \u00b7 ' + serieText + '</span>' +
          '</div>' +
          '<div class="liga-summary-actions">' +
            '<button class="btn-secondary liga-btn-sm" id="ligaExpandSetup" type="button">' +
              '<i class="fas fa-pen"></i> Endre' +
            '</button>' +
            '<button class="btn-secondary liga-btn-sm liga-btn-reset" id="ligaResetCollapsed" type="button">' +
              '<i class="fas fa-rotate-left"></i> Nullstill' +
            '</button>' +
          '</div>' +
        '</div>';

      var expandBtn = $('ligaExpandSetup');
      var resetColBtn = $('ligaResetCollapsed');
      if (expandBtn) {
        expandBtn.addEventListener('click', function() {
          restoreSetupForm();
        });
      }
      if (resetColBtn) {
        resetColBtn.addEventListener('click', function() {
          if (!confirm('Nullstille ligaen? Alle kamper og resultater slettes.')) return;
          resetLeague();
          restoreSetupForm();
        });
      }

      if (tableWrap) tableWrap.style.display = '';
      if (matchesWrap) matchesWrap.style.display = '';
    } else {
      if (tableWrap) tableWrap.style.display = 'none';
      if (matchesWrap) matchesWrap.style.display = 'none';
    }
  }

  function renderLeague(league) {
    var matchesEl = $('ligaMatches');
    var tableEl = $('ligaTable');
    if (!matchesEl || !tableEl) return;

    matchesEl.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'liga-matches';

    var groups = new Map();
    for (var gi = 0; gi < league.matches.length; gi++) {
      var m0 = league.matches[gi];
      var key0 = m0.rep + '-' + m0.round;
      if (!groups.has(key0)) groups.set(key0, []);
      groups.get(key0).push(m0);
    }
    var groupKeys = Array.from(groups.keys()).sort(function(a, b) {
      var ap = a.split('-').map(Number);
      var bp = b.split('-').map(Number);
      return (ap[0] - bp[0]) || (ap[1] - bp[1]);
    });

    var lastRep = null;
    for (var ki = 0; ki < groupKeys.length; ki++) {
      var k2 = groupKeys[ki];
      var parts = k2.split('-').map(Number);
      var rep = parts[0];
      var round = parts[1];

      if (lastRep !== null && rep !== lastRep) {
        var sep = document.createElement('div');
        sep.className = 'liga-series-separator';
        sep.innerHTML = '<span class="liga-series-badge">Serie ' + rep + '</span>';
        wrap.appendChild(sep);
      }
      lastRep = rep;

      var h3 = document.createElement('div');
      h3.className = 'liga-round-header';
      h3.textContent = 'Runde ' + round + ' (serie ' + rep + ')';
      wrap.appendChild(h3);

      var matchGroup = groups.get(k2);
      for (var mi = 0; mi < matchGroup.length; mi++) {
        var m = matchGroup[mi];
        var row = document.createElement('div');
        row.className = 'liga-match-row';
        var isPlayed = (m.homeGoals !== null && m.awayGoals !== null);
        var cardClass = isPlayed ? 'liga-match-card liga-match-played' : 'liga-match-card liga-match-pending';
        var hg = (m.homeGoals != null ? m.homeGoals : '');
        var ag = (m.awayGoals != null ? m.awayGoals : '');
        row.innerHTML =
          '<div class="' + cardClass + '">' +
            '<div class="liga-side">' +
              '<div class="liga-side-label">Hjemme</div>' +
              '<div class="liga-team-name">' + escapeHtml(m.home) + '</div>' +
              '<input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="' + m.id + '" data-side="home" placeholder="\u2013" value="' + hg + '">' +
            '</div>' +
            '<div class="liga-mid" aria-hidden="true">\u2013</div>' +
            '<div class="liga-side liga-side-away">' +
              '<div class="liga-side-label">Borte</div>' +
              '<div class="liga-team-name">' + escapeHtml(m.away) + '</div>' +
              '<input type="number" min="0" step="1" inputmode="numeric" class="input liga-score" data-mid="' + m.id + '" data-side="away" placeholder="\u2013" value="' + ag + '">' +
            '</div>' +
          '</div>';
        wrap.appendChild(row);
      }

      if (league.teams.length % 2 === 1) {
        var matchTeams = new Set();
        for (var bi = 0; bi < matchGroup.length; bi++) {
          matchTeams.add(matchGroup[bi].home);
          matchTeams.add(matchGroup[bi].away);
        }
        var byeTeam = league.teams.find(function(t) { return !matchTeams.has(t.name); });
        if (byeTeam) {
          var byeEl = document.createElement('div');
          byeEl.className = 'liga-bye';
          byeEl.textContent = byeTeam.name + ' har fri';
          wrap.appendChild(byeEl);
        }
      }
    }

    matchesEl.appendChild(wrap);

    var editNamesHtml =
      '<div class="liga-edit-names">' +
        '<div class="liga-edit-names-label">Rediger lagnavn:</div>' +
        '<div class="liga-edit-names-row">' +
          league.teams.map(function(t, i) {
            return '<input class="input liga-edit-name" data-team-idx="' + i + '" type="text" value="' + escapeHtml(t.name) + '">';
          }).join('') +
        '</div>' +
      '</div>';

    matchesEl.insertAdjacentHTML('afterbegin', editNamesHtml);
    matchesEl.insertAdjacentHTML('afterbegin', renderProgress(league));

    tableEl.innerHTML = renderTableHTML(league);

    matchesEl.querySelectorAll('input.liga-score').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var mid = inp.getAttribute('data-mid');
        var side = inp.getAttribute('data-side');
        if (!mid || !side) return;
        var match = league.matches.find(function(x) { return x.id === mid; });
        if (!match) return;

        var v = inp.value === '' ? null : Number(inp.value);
        var val = (v === null || !Number.isFinite(v) || v < 0) ? null : Math.floor(v);

        if (side === 'home') match.homeGoals = val;
        else match.awayGoals = val;

        _state.liga = league;
        _saveState();
        var tableEl2 = $('ligaTable');
        if (!tableEl2) return;
        tableEl2.innerHTML = renderTableHTML(league);
      });
    });

    matchesEl.querySelectorAll('input.liga-edit-name').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var idx = Number(inp.getAttribute('data-team-idx'));
        var newName = String(inp.value || '').trim();
        if (!newName || idx < 0 || idx >= league.teams.length) return;

        var oldName = league.teams[idx].name;
        if (oldName === newName) return;

        league.teams[idx].name = newName;
        for (var mj = 0; mj < league.matches.length; mj++) {
          var mm = league.matches[mj];
          if (mm.home === oldName) mm.home = newName;
          if (mm.away === oldName) mm.away = newName;
        }

        _state.liga = league;
        _saveState();
        renderLeague(league);
        window.showNotification('Lagnavn endret: ' + oldName + ' \u2192 ' + newName, 'success');
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
    var tableWrap = $('ligaTableWrap');
    var matchesWrap = $('ligaMatchesWrap');
    if (tableWrap) tableWrap.style.display = 'none';
    if (matchesWrap) matchesWrap.style.display = 'none';
    window.showNotification('Liga nullstilt', 'info');
  }

  function render() {
    if (!_state) return;
    var liga = _state.liga;
    if (liga && liga.teams && liga.matches) {
      renderSetupState(true);
      renderLeague(liga);
    } else {
      renderSetupState(false);
      restoreSetupForm();
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
        var names = getTeamNames();
        var uniqueNames = new Set(names.map(function(n) { return n.toLowerCase().trim(); }));
        if (uniqueNames.size < names.length) {
          window.showNotification('Hvert lag må ha et unikt navn', 'error');
          return;
        }
        if (_state.liga && _state.liga.matches && _state.liga.matches.some(function(m) { return m.homeGoals !== null; })) {
          if (!confirm('Du har registrerte resultater. Starte ny liga sletter disse. Fortsett?')) return;
        }
        var league = buildLeague();
        _state.liga = league;
        _saveState();
        render();
        window.showNotification('Liga opprettet', 'success');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (!confirm('Nullstille ligaen? Alle kamper og resultater slettes.')) return;
        resetLeague();
        restoreSetupForm();
      });
    }

    if (_state.liga && _state.liga.teams && _state.liga.matches) {
      render();
    }
  }

  window.addEventListener('team:changed', function () {
    render();
  });

})();
