// © 2026 Barnefotballtrener.no. All rights reserved.
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
  // Exercise catalog (Øvelsesbank)
  // -------------------------
  // Øvelsesdata lastes fra exercises-data.js (window.EXERCISES_DATA)
  const EXERCISES = window.EXERCISES_DATA || [
    { key: 'drink', label: 'Drikkepause', defaultMin: 2, category: 'special',
      nffCategory: 'pause', themes: [], nffPhases: [], learningGoals: [],
      intensity: 'none', hasOpposition: false },
    { key: 'custom', label: 'Skriv inn selv', defaultMin: 10, isCustom: true, category: 'special',
      nffCategory: 'sjef_over_ballen', themes: [], nffPhases: [], learningGoals: [],
      intensity: 'medium', hasOpposition: false }
  ];


  // Migration map for removed/renamed exercise keys
  const KEY_MIGRATION = {
    'warm_no_ball': 'tag',
    'long_pass': 'pass_pair',
    'pass_turn': 'receive_turn',
    'juggle': 'custom',
    'competitions': 'custom',
    'overload': '2v1',
    'possession_joker': 'possession',
    'possession_even': 'possession',
    'square_german': 'square_game',
    'surprise': 'ssg',
  };

  function migrateExerciseKey(key) {
    return KEY_MIGRATION[key] || key;
  }

  // Migrate a stored exercise object: remap old keys, preserve customName for custom fallback
  function migrateExerciseObj(exObj) {
    if (!exObj || !exObj.exerciseKey) return exObj;
    const oldKey = exObj.exerciseKey;
    const newKey = migrateExerciseKey(oldKey);
    if (newKey !== oldKey) {
      exObj.exerciseKey = newKey;
      if (newKey === 'custom' && !exObj.customName) {
        const oldMeta = { 'juggle': 'Triksing med ball', 'competitions': 'Konkurranser' };
        exObj.customName = oldMeta[oldKey] || oldKey;
      }
    }
    // Safety net: if key doesn't exist in current EXERCISES catalog, treat as custom
    if (exObj.exerciseKey !== 'custom' && !EX_BY_KEY.has(exObj.exerciseKey)) {
      const lostName = exObj.exerciseKey;
      exObj.exerciseKey = 'custom';
      if (!exObj.customName) exObj.customName = lostName;
      console.warn('[workout.js] Ukjent \u00f8velses-key migrert til custom:', lostName);
    }
    return exObj;
  }

  const EX_BY_KEY = new Map(EXERCISES.map(x => [x.key, x]));

  // NFF-data lastes fra nff-data.js (window.NFF_DATA)
  const _nff = window.NFF_DATA || {};
  const EXERCISE_CATEGORIES = _nff.EXERCISE_CATEGORIES || [];
  const NFF_CATEGORIES = _nff.NFF_CATEGORIES || [];
  const NFF_CATEGORY_BY_ID = Object.fromEntries(NFF_CATEGORIES.map(c => [c.id, c]));

  /** Get age-appropriate label for NFF category */
  function catLabel(cat, ageGroup) {
    return (ageGroup === '13-16' && cat.label1316) ? cat.label1316 : cat.label;
  }
  function catShort(cat, ageGroup) {
    return (ageGroup === '13-16' && cat.short1316) ? cat.short1316 : cat.short;
  }

  const NFF_THEMES = _nff.NFF_THEMES || [];
  const NFF_THEME_BY_ID = Object.fromEntries(NFF_THEMES.map(t => [t.id, t]));
  const NFF_THEMES_BY_AGE = _nff.NFF_THEMES_BY_AGE || {};
  const NFF_TIME_DISTRIBUTION = _nff.NFF_TIME_DISTRIBUTION || {};
  const NFF_LEARNING_GOALS = _nff.NFF_LEARNING_GOALS || {};

  /**
   * Hent læringsmomenter for et gitt tema og aldersgruppe.
   * Fallback til nærmeste eldre aldersgruppe hvis ingen spesifikk finnes.
   */
  function getLearningGoals(themeId, ageGroup) {
    const themeGoals = NFF_LEARNING_GOALS[themeId];
    if (!themeGoals) return [];
    if (themeGoals[ageGroup]) return themeGoals[ageGroup];
    // Fallback: prøv eldre aldersgrupper
    const fallback = ['6-7', '8-9', '10-12', '13-16'];
    const idx = fallback.indexOf(ageGroup);
    for (let i = idx - 1; i >= 0; i--) {
      if (themeGoals[fallback[i]]) return themeGoals[fallback[i]];
    }
    return [];
  }


  /**
   * Beregn NFF-tidsfordeling for en liste med blokker.
   * Returnerer { kategori: minutter } og sammenligner med anbefalt fordeling.
   */
  function calculateNffBalance(blocks, ageGroup) {
    const actual = { sjef_over_ballen: 0, spille_med_og_mot: 0, smalagsspill: 0, scoringstrening: 0 };
    let totalMin = 0;

    for (const block of blocks) {
      const trackA = block.a || block;
      const meta = EX_BY_KEY.get(trackA.exerciseKey);
      if (!meta || meta.category === 'special') continue;
      const cat = meta.nffCategory;
      const minutes = trackA.minutes || meta.defaultMin || 0;
      if (cat && actual.hasOwnProperty(cat)) {
        actual[cat] += minutes;
      }
      totalMin += minutes;

      // Parallell: bruk den lengste varigheten (allerede telt via track A),
      // men kategoriser B-spor separat om det er en annen kategori
      if (block.kind === 'parallel' && block.b) {
        const metaB = EX_BY_KEY.get(block.b.exerciseKey);
        if (metaB && metaB.nffCategory && metaB.nffCategory !== cat) {
          // B-spor kjører samtidig, bidrar til kategori men ikke totaltid
          const minB = block.b.minutes || metaB.defaultMin || 0;
          if (actual.hasOwnProperty(metaB.nffCategory)) {
            actual[metaB.nffCategory] += minB;
          }
        }
      }
    }

    const recommended = NFF_TIME_DISTRIBUTION[ageGroup] || NFF_TIME_DISTRIBUTION['8-9'];
    const balance = {};
    for (const cat of Object.keys(actual)) {
      const actualPct = totalMin > 0 ? Math.round((actual[cat] / totalMin) * 100) : 0;
      const recPct = recommended[cat] || 0;
      balance[cat] = { minutes: actual[cat], actualPct, recommendedPct: recPct, diff: actualPct - recPct };
    }

    return { actual, totalMinutes: totalMin, balance, ageGroup };
  }

  // =========================================================
  // BOTTOM SHEET EXERCISE PICKER
  // Replaces native <select> for exercise selection.
  // Singleton DOM element, shown/hidden with class toggle.
  // =========================================================

  const _bs = {
    el: null,        // root overlay element
    sheet: null,     // sheet panel
    body: null,      // scrollable body
    search: null,    // search input
    blockId: null,   // which block triggered
    track: null,     // 'a' or 'b'
    onSelect: null,  // callback(exerciseKey)
    ctxOverride: null, // { ageGroup, blocks } — set by sesong-workout.js via openExercisePicker
  };

  /** Group exercises by NFF category for bottom sheet display */
  function _bsGroupExercises() {
    const groups = new Map();
    const age = (_bs.ctxOverride ? _bs.ctxOverride.ageGroup : state.ageGroup) || null;
    for (const cat of NFF_CATEGORIES) {
      groups.set(cat.id, []);
    }
    for (const ex of EXERCISES) {
      if (ex.category === 'special') continue;
      // Filter by age if set
      if (age && ex.ages && !ex.ages.includes(age)) continue;
      const catId = ex.nffCategory;
      if (groups.has(catId)) {
        groups.get(catId).push(ex);
      }
    }
    return groups;
  }

  /** Get set of exercise keys currently in the session */
  function _bsKeysInSession() {
    const keys = new Set();
    const blocks = (_bs.ctxOverride && _bs.ctxOverride.blocks) ? _bs.ctxOverride.blocks : state.blocks;
    for (const b of blocks) {
      if (b.a?.exerciseKey) keys.add(b.a.exerciseKey);
      if (b.kind === 'parallel' && b.b?.exerciseKey) keys.add(b.b.exerciseKey);
    }
    return keys;
  }

  /** Get NFF categories not covered by current session */
  function _bsMissingCategories() {
    const covered = new Set();
    const blocks = (_bs.ctxOverride && _bs.ctxOverride.blocks) ? _bs.ctxOverride.blocks : state.blocks;
    for (const b of blocks) {
      const metaA = EX_BY_KEY.get(b.a?.exerciseKey);
      if (metaA && metaA.nffCategory && metaA.nffCategory !== 'pause') covered.add(metaA.nffCategory);
      if (b.kind === 'parallel' && b.b) {
        const metaB = EX_BY_KEY.get(b.b.exerciseKey);
        if (metaB && metaB.nffCategory && metaB.nffCategory !== 'pause') covered.add(metaB.nffCategory);
      }
    }
    return NFF_CATEGORIES.filter(c => !covered.has(c.id));
  }

  /** Create the bottom sheet DOM (once) */
  function _bsCreate() {
    if (_bs.el) return;

    const overlay = document.createElement('div');
    overlay.className = 'wo-bs-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Velg øvelse');

    overlay.innerHTML = `
      <div class="wo-bs-backdrop"></div>
      <div class="wo-bs-sheet">
        <div class="wo-bs-header">
          <div class="wo-bs-drag-handle"></div>
          <div class="wo-bs-title">Velg øvelse</div>
          <button class="wo-bs-close" type="button" aria-label="Lukk">\u2715</button>
        </div>
        <div class="wo-bs-search-wrap">
          <input class="wo-bs-search" type="search" placeholder="S\u00f8k etter \u00f8velse..." autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="wo-bs-pills"></div>
        <div class="wo-bs-drink-wrap">
          <button class="wo-bs-drink-btn" type="button">
            \uD83D\uDCA7 Drikkepause <span class="wo-bs-drink-min">2 min</span>
          </button>
        </div>
        <div class="wo-bs-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    _bs.el = overlay;
    _bs.sheet = overlay.querySelector('.wo-bs-sheet');
    _bs.body = overlay.querySelector('.wo-bs-body');
    _bs.search = overlay.querySelector('.wo-bs-search');

    // Backdrop close
    const backdrop = overlay.querySelector('.wo-bs-backdrop');
    backdrop.addEventListener('click', closeBottomSheet);
    backdrop.style.touchAction = 'none';

    // Close button
    overlay.querySelector('.wo-bs-close').addEventListener('click', closeBottomSheet);

    // Drikkepause button
    overlay.querySelector('.wo-bs-drink-btn').addEventListener('click', () => {
      _bsSelectExercise('drink');
    });

    // Search
    _bs.search.addEventListener('input', _bsFilterSearch);

    // Escape key
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeBottomSheet();
    });

    // Build category pills
    _bsRenderPills();

    console.log('[workout.js] bottom sheet created');
  }

  /** Render category pills */
  function _bsRenderPills() {
    const wrap = _bs.el.querySelector('.wo-bs-pills');
    const age = (_bs.ctxOverride ? _bs.ctxOverride.ageGroup : state.ageGroup);
    wrap.innerHTML = NFF_CATEGORIES.map(cat =>
      '<button class="wo-bs-pill" type="button" data-cat="' + cat.id + '"' +
      ' style="--pill-color:' + cat.color + '">' +
      catLabel(cat, age) + '</button>'
    ).join('');

    wrap.querySelectorAll('.wo-bs-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const catId = btn.dataset.cat;
        const section = _bs.body.querySelector('.wo-bs-section[data-cat="' + catId + '"]');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        btn.classList.add('wo-bs-pill-active');
        setTimeout(() => btn.classList.remove('wo-bs-pill-active'), 600);
      });
    });
  }

  /** Render the body content (called each time sheet opens) */
  function _bsRenderBody() {
    const groups = _bsGroupExercises();
    const inSession = _bsKeysInSession();
    const missing = _bsMissingCategories();
    const currentTheme = (_bs.ctxOverride && _bs.ctxOverride.theme) ? _bs.ctxOverride.theme : state.theme;
    const effectiveAge = (_bs.ctxOverride ? _bs.ctxOverride.ageGroup : state.ageGroup) || null;
    const favs = loadFavorites();

    let html = '';

    // Missing categories hint
    if (missing.length > 0 && missing.length < NFF_CATEGORIES.length) {
      html += '<div class="wo-bs-hint">';
      html += '<span class="wo-bs-hint-icon">\uD83D\uDCA1</span> ';
      html += 'Mangler i \u00f8kta: ';
      html += missing.map(c => '<strong>' + escapeHtml(catShort(c, effectiveAge)) + '</strong>').join(', ');
      html += '</div>';
    }

    // Favorites section
    if (favs.size > 0) {
      const age = effectiveAge;
      const favExercises = EXERCISES.filter(ex =>
        ex.category !== 'special' && favs.has(ex.key) &&
        (!age || !ex.ages || ex.ages.includes(age))
      );
      if (favExercises.length > 0) {
        html += '<div class="wo-bs-section wo-bs-section-theme">';
        html += '<div class="wo-bs-section-head wo-bs-section-head-theme">\u2605 Favoritter</div>';
        for (const ex of favExercises) {
          html += _bsRenderCard(ex, inSession, favs);
        }
        html += '</div>';
      }
    }

    // Theme section (if theme is set via generer-flow)
    if (currentTheme) {
      const themeMeta = NFF_THEME_BY_ID[currentTheme];
      if (themeMeta) {
        const age = effectiveAge;
        const themeExercises = EXERCISES.filter(ex =>
          ex.category !== 'special' && ex.themes && ex.themes.includes(currentTheme) &&
          (!age || !ex.ages || ex.ages.includes(age))
        );
        if (themeExercises.length > 0) {
          html += '<div class="wo-bs-section wo-bs-section-theme">';
          html += '<div class="wo-bs-section-head wo-bs-section-head-theme">';
          html += escapeHtml(themeMeta.icon) + ' Passer til \u00ab' + escapeHtml(themeMeta.label) + '\u00bb</div>';
          for (const ex of themeExercises) {
            html += _bsRenderCard(ex, inSession, favs);
          }
          html += '</div>';
        }
      }
    }

    // NFF category sections (favorites sorted first)
    for (const cat of NFF_CATEGORIES) {
      const exs = groups.get(cat.id) || [];
      if (!exs.length) continue;

      // Sort: favorites first, then by frequency
      const freq = loadFrequency();
      exs.sort((a, b) => {
        const fa = favs.has(a.key) ? 1 : 0;
        const fb = favs.has(b.key) ? 1 : 0;
        if (fb !== fa) return fb - fa;
        return (freq[b.key] || 0) - (freq[a.key] || 0);
      });

      html += '<div class="wo-bs-section" data-cat="' + cat.id + '">';
      html += '<div class="wo-bs-section-head" style="--cat-color:' + cat.color + '">';
      html += catLabel(cat, effectiveAge) + '</div>';

      for (const ex of exs) {
        html += _bsRenderCard(ex, inSession, favs);
      }
      html += '</div>';
    }

    // "Skriv inn selv" at bottom
    html += '<button class="wo-bs-custom-btn" type="button">\u270f\ufe0f Skriv inn selv\u2026</button>';

    _bs.body.innerHTML = html;

    // Bind card clicks (select exercise)
    _bs.body.querySelectorAll('.wo-bs-card').forEach(card => {
      card.addEventListener('click', () => {
        const key = card.dataset.key;
        if (key) _bsSelectExercise(key);
      });
    });

    // Bind favorite star clicks
    _bs.body.querySelectorAll('.wo-bs-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't select the exercise
        const key = btn.dataset.fav;
        if (key) {
          toggleFavorite(key);
          _bsRenderBody(); // re-render to update stars and sections
        }
      });
    });

    // Bind custom button
    const customBtn = _bs.body.querySelector('.wo-bs-custom-btn');
    if (customBtn) {
      customBtn.addEventListener('click', () => _bsSelectExercise('custom'));
    }
  }

  /** Render a single exercise card */
  function _bsRenderCard(ex, inSession, favs) {
    const cat = NFF_CATEGORY_BY_ID[ex.nffCategory];
    const color = cat ? cat.color : '#888';
    const isInSession = inSession.has(ex.key);
    const isFav = favs && favs.has(ex.key);

    // Description: truncate to ~60 chars
    const desc = ex.description
      ? (ex.description.length > 70 ? ex.description.slice(0, 67) + '\u2026' : ex.description)
      : '';

    // Equipment line (compact)
    const equipLine = ex.equipment
      ? '<div class="wo-bs-card-equip">' + escapeHtml(ex.equipment) + '</div>'
      : '';

    // Meta chips
    const metaParts = [];
    metaParts.push(ex.defaultMin + ' min');
    if (ex.ages && ex.ages.length) {
      if (ex.ages.length > 2) {
        const first = ex.ages[0].split('-')[0];
        const last = ex.ages[ex.ages.length - 1].split('-')[1];
        metaParts.push(first + '\u2013' + last + ' \u00e5r');
      } else {
        metaParts.push(ex.ages.map(a => a + ' \u00e5r').join(', '));
      }
    }
    if (ex.hasOpposition) {
      metaParts.push('<span class="wo-bs-tag-opp">Motspill</span>');
    }

    return '<div class="wo-bs-card' + (isInSession ? ' wo-bs-card-insession' : '') + '"' +
      ' data-key="' + ex.key + '"' +
      ' data-name="' + escapeHtml(ex.label.toLowerCase()) + '"' +
      ' data-desc="' + escapeHtml((ex.description || '').toLowerCase().slice(0, 100)) + '">' +
      '<div class="wo-bs-card-stripe" style="background:' + color + '"></div>' +
      '<div class="wo-bs-card-body">' +
        '<div class="wo-bs-card-name">' + escapeHtml(ex.label) +
          '<button type="button" class="wo-bs-fav" data-fav="' + ex.key + '" title="' + (isFav ? 'Fjern favoritt' : 'Legg til favoritt') + '" style="min-width:40px;min-height:40px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;margin:-8px -6px -8px 0;padding:0;">' +
            (isFav ? '\u2605' : '\u2606') +
          '</button>' +
        '</div>' +
        (desc ? '<div class="wo-bs-card-desc">' + escapeHtml(desc) + '</div>' : '') +
        equipLine +
        '<div class="wo-bs-card-meta">' + metaParts.join(' \u00b7 ') + '</div>' +
      '</div>' +
      (isInSession ? '<div class="wo-bs-badge">I \u00f8kta</div>' : '') +
    '</div>';
  }

  /** Filter exercises based on search input */
  function _bsFilterSearch() {
    const q = (_bs.search.value || '').trim().toLowerCase();
    const cards = _bs.body.querySelectorAll('.wo-bs-card');
    const sections = _bs.body.querySelectorAll('.wo-bs-section');

    if (!q) {
      cards.forEach(c => { c.style.display = ''; });
      sections.forEach(s => { s.style.display = ''; });
      const cb = _bs.body.querySelector('.wo-bs-custom-btn');
      if (cb) cb.style.display = '';
      return;
    }

    cards.forEach(card => {
      const name = card.dataset.name || '';
      const desc = card.dataset.desc || '';
      const match = name.includes(q) || desc.includes(q);
      card.style.display = match ? '' : 'none';
    });

    // Hide sections where all cards are hidden
    sections.forEach(section => {
      const visible = section.querySelectorAll('.wo-bs-card[style=""], .wo-bs-card:not([style])');
      // More reliable: count non-hidden
      let hasVisible = false;
      section.querySelectorAll('.wo-bs-card').forEach(c => {
        if (c.style.display !== 'none') hasVisible = true;
      });
      section.style.display = hasVisible ? '' : 'none';
    });

    const cb = _bs.body.querySelector('.wo-bs-custom-btn');
    if (cb) cb.style.display = '';
  }

  /** Handle exercise selection */
  function _bsSelectExercise(key) {
    if (_bs.onSelect) {
      _bs.onSelect(key);
    }
    closeBottomSheet();
  }

  /** Open the bottom sheet for a specific block/track */
  function openBottomSheet(blockId, track, onSelect) {
    _bsCreate();

    _bs.blockId = blockId;
    _bs.track = track;
    _bs.onSelect = onSelect;

    _bsRenderBody();

    // Reset search
    _bs.search.value = '';
    _bsFilterSearch();

    // Save scroll position before body lock (iOS fix)
    _bs._savedScrollY = window.scrollY;
    document.body.style.top = '-' + window.scrollY + 'px';

    // Show
    _bs.el.classList.add('wo-bs-open');
    document.body.classList.add('wo-bs-body-lock');

    // Focus search after animation
    setTimeout(() => {
      if (_bs.search) _bs.search.focus({ preventScroll: true });
    }, 300);

    if (_bs.body) _bs.body.scrollTop = 0;
  }

  /** Close the bottom sheet */
  function closeBottomSheet() {
    if (!_bs.el) return;
    _bs.el.classList.remove('wo-bs-open');
    document.body.classList.remove('wo-bs-body-lock');

    // Restore scroll position (iOS fix)
    document.body.style.top = '';
    if (typeof _bs._savedScrollY === 'number') {
      window.scrollTo(0, _bs._savedScrollY);
    }

    _bs.onSelect = null;
    _bs.blockId = null;
    _bs.track = null;
    _bs.ctxOverride = null;
    if (_bs.search) _bs.search.blur();
  }

  // =========================================================
  // TRIGGER BUTTON (replaces <select> in exercise editor)
  // =========================================================

  /** Render trigger button HTML for exercise picker */
  function renderExerciseTrigger(blockId, track, ex) {
    const idp = 'wo_' + blockId + '_' + track;
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    const cat = meta ? NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    const color = cat ? cat.color : '#ccc';
    const name = displayName(ex);
    const desc = (meta && meta.description)
      ? (meta.description.length > 50 ? meta.description.slice(0, 47) + '\u2026' : meta.description)
      : '';
    const isDrink = ex.exerciseKey === 'drink';

    return '<button type="button" class="wo-trigger" id="' + idp + '_trigger"' +
      ' style="--trigger-color:' + color + '">' +
      '<div class="wo-trigger-stripe"></div>' +
      '<div class="wo-trigger-content">' +
        '<div class="wo-trigger-name">' + (isDrink ? '\uD83D\uDCA7 ' : '') + escapeHtml(name) + '</div>' +
        (desc ? '<div class="wo-trigger-desc">' + escapeHtml(desc) + '</div>' : '') +
      '</div>' +
      '<div class="wo-trigger-chevron">Endre \u25be</div>' +
    '</button>';
  }

  // -------------------------
  // SVG Diagram Renderer
  // -------------------------
  // Counter for unique SVG marker IDs (avoids collision when multiple SVGs on same page, e.g. PDF export)
  let _svgIdCounter = 0;

  function renderDrillSVG(diagram) {
    if (!diagram) return '';
    const { width, height, field, elements } = diagram;
    const uid = '_s' + (++_svgIdCounter);
    let s = '<svg viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:280px;height:auto;">';
    s += '<defs>';
    s += '<marker id="wo_ap' + uid + '" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#fff" opacity="0.9"/></marker>';
    s += '<marker id="wo_ar' + uid + '" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#fff" opacity="0.7"/></marker>';
    s += '<marker id="wo_as' + uid + '" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><path d="M0,0 L10,3.5 L0,7" fill="#FDD835"/></marker>';
    s += '</defs>';
    // Field background
    if (field === 'small' || field === 'quarter') {
      s += '<rect x="8" y="8" width="' + (width - 16) + '" height="' + (height - 16) + '" rx="4" fill="#3d8b37" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>';
    } else if (field === 'half') {
      s += '<rect x="8" y="8" width="' + (width - 16) + '" height="' + (height - 16) + '" rx="4" fill="#3d8b37" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>';
      s += '<line x1="' + (width / 2) + '" y1="8" x2="' + (width / 2) + '" y2="' + (height - 8) + '" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>';
    }
    for (const el of elements) {
      switch (el.type) {
        case 'player': {
          const fill = el.team === 'b' ? '#1E88E5' : el.team === 'neutral' ? '#FF9800' : '#E53935';
          s += '<circle cx="' + el.x + '" cy="' + el.y + '" r="11" fill="' + fill + '" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>';
          if (el.label) s += '<text x="' + el.x + '" y="' + (el.y + 4) + '" text-anchor="middle" fill="white" font-size="9" font-weight="700" font-family="sans-serif">' + el.label + '</text>';
          break;
        }
        case 'keeper':
          s += '<circle cx="' + el.x + '" cy="' + el.y + '" r="11" fill="#FDD835" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>';
          s += '<text x="' + el.x + '" y="' + (el.y + 4) + '" text-anchor="middle" fill="#333" font-size="9" font-weight="700" font-family="sans-serif">K</text>';
          break;
        case 'ball':
          s += '<circle cx="' + el.x + '" cy="' + el.y + '" r="5" fill="white" stroke="#333" stroke-width="1"/>';
          break;
        case 'cone':
          s += '<polygon points="' + el.x + ',' + (el.y - 6) + ' ' + (el.x - 5) + ',' + (el.y + 4) + ' ' + (el.x + 5) + ',' + (el.y + 4) + '" fill="#FF9800" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>';
          break;
        case 'goal': {
          s += '<rect x="' + el.x + '" y="' + el.y + '" width="' + el.w + '" height="' + el.h + '" rx="2" fill="rgba(255,255,255,0.15)" stroke="white" stroke-width="1.5"/>';
          if (!el.vertical) {
            for (let nx = el.x + 8; nx < el.x + el.w; nx += 10)
              s += '<line x1="' + nx + '" y1="' + el.y + '" x2="' + nx + '" y2="' + (el.y + el.h) + '" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>';
          }
          break;
        }
        case 'arrow': {
          const [x1, y1] = el.from, [x2, y2] = el.to;
          if (el.style === 'pass')
            s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" marker-end="url(#wo_ap' + uid + ')"/>';
          else if (el.style === 'run')
            s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="rgba(255,255,255,0.55)" stroke-width="1.5" stroke-dasharray="5,3" marker-end="url(#wo_ar' + uid + ')"/>';
          else if (el.style === 'shot')
            s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#FDD835" stroke-width="2.5" marker-end="url(#wo_as' + uid + ')"/>';
          break;
        }
        case 'zone_line':
          s += '<line x1="' + el.x1 + '" y1="' + el.y1 + '" x2="' + el.x2 + '" y2="' + el.y2 + '" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="6,4"/>';
          break;
      }
    }
    s += '</svg>';
    return s;
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
      const tid = window._bftTeamId || 'default';
      return `bft:${uid}:${tid}`;
    } catch {
      return 'bft:anon:default';
    }
  }
  function k(suffix) { return `${getUserKeyPrefix()}:${suffix}`; }

  // Lazy-evaluated keys: uid may not be available at IIFE-init (auth is async).
  // Computing per-call ensures correct key even after auth completes.
  function STORE_KEY()    { return k('workout_templates_v1'); }
  function WORKOUTS_KEY() { return k('workout_sessions_v1'); }
  function DRAFT_KEY()    { return k('workout_draft_v1'); }
  function FREQ_KEY()     { return k('exercise_freq_v1'); }
  const SCHEMA_VERSION = 1;

  // Exercise frequency tracking
  function loadFrequency() {
    try {
      const raw = safeGet(FREQ_KEY());
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function trackExerciseUsage(exerciseKey) {
    if (!exerciseKey || exerciseKey === 'drink') return; // don't track drink break
    try {
      const freq = loadFrequency();
      freq[exerciseKey] = (freq[exerciseKey] || 0) + 1;
      safeSet(FREQ_KEY(), JSON.stringify(freq));
    } catch {}
  }

  // Exercise favorites (localStorage cache + Supabase sync)
  function FAV_KEY() { return k('exercise_favorites_v1'); }
  let _favCache = null;

  function loadFavorites() {
    if (_favCache) return _favCache;
    try {
      const raw = safeGet(FAV_KEY());
      _favCache = raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { _favCache = new Set(); }
    return _favCache;
  }
  function saveFavorites(favs) {
    _favCache = favs;
    try { safeSet(FAV_KEY(), JSON.stringify([...favs])); } catch {}
    _woSaveFavoritesToDb(favs);
  }
  async function _woSaveFavoritesToDb(favs) {
    const sb = _woGetSb();
    const uid = _woGetUid();
    const tid = _woGetTeamId();
    if (!sb || !uid || uid === 'anon') return;
    try {
      const existing = await sb.from('workouts')
        .select('id').eq('user_id', uid).eq('team_id', tid).eq('source', 'favorites')
        .maybeSingle();
      const row = {
        user_id: uid, team_id: tid,
        title: '_favorites', blocks: [...favs],
        is_template: false, source: 'favorites',
        updated_at: new Date().toISOString()
      };
      if (existing?.data?.id) {
        await sb.from('workouts').update(row).eq('id', existing.data.id);
      } else {
        await sb.from('workouts').insert(row);
      }
    } catch (e) {
      console.warn('[workout.js] Favorites sync failed:', e.message || e);
    }
  }
  async function _woLoadFavoritesFromDb() {
    const sb = _woGetSb();
    const uid = _woGetUid();
    const tid = _woGetTeamId();
    if (!sb || !uid || uid === 'anon') return;
    try {
      const res = await sb.from('workouts')
        .select('blocks').eq('user_id', uid).eq('team_id', tid).eq('source', 'favorites')
        .maybeSingle();
      if (res?.data?.blocks && Array.isArray(res.data.blocks)) {
        const dbFavs = new Set(res.data.blocks);
        const localFavs = loadFavorites();
        let merged = false;
        for (const k of dbFavs) {
          if (!localFavs.has(k)) { localFavs.add(k); merged = true; }
        }
        _favCache = localFavs;
        if (merged) { try { safeSet(FAV_KEY(), JSON.stringify([...localFavs])); } catch {} }
      }
    } catch (e) {
      console.warn('[workout.js] Favorites load from db failed:', e.message || e);
    }
  }
  function toggleFavorite(exerciseKey) {
    const favs = loadFavorites();
    if (favs.has(exerciseKey)) {
      favs.delete(exerciseKey);
    } else {
      favs.add(exerciseKey);
    }
    saveFavorites(favs);
    return favs;
  }


  function defaultStore() {
    return { schemaVersion: SCHEMA_VERSION, templates: [] };
  }

  // =========================================================
  // Supabase-backed storage for workouts + templates
  // Draft + frequency stay in localStorage (flyktig data)
  // =========================================================

  function _woGetSb() {
    var sb = window.supabase || window.supabaseClient;
    return (sb && sb.from) ? sb : null;
  }
  function _woGetUid() {
    return window.__BF_getOwnerUid ? window.__BF_getOwnerUid() : (window.authService ? window.authService.getUserId() : null);
  }
  function _woGetTeamId() {
    return window._bftTeamId || (window.__BF_getTeamId ? window.__BF_getTeamId() : 'default');
  }

  // In-memory cache (populated async, rendered sync)
  const _woCache = {
    templates: [],   // { id, title, blocks, ... } from Supabase
    workouts: [],    // { id, title, blocks, ... } from Supabase
    loaded: false,
    loading: false,
  };

  /** Load templates + workouts from Supabase into cache */
  async function _woLoadFromDb() {
    const sb = _woGetSb();
    const uid = _woGetUid();
    const tid = _woGetTeamId();
    if (!sb || !uid || uid === 'anon' || !tid || tid === 'default') return;
    if (_woCache.loading) return;
    _woCache.loading = true;

    try {
      const res = await sb.from('workouts')
        .select('*')
        .eq('user_id', uid)
        .eq('team_id', tid)
        .order('updated_at', { ascending: false });

      if (res.error) throw res.error;

      const rows = res.data || [];
      _woCache.templates = rows.filter(r => r.is_template && r.source !== 'favorites');
      _woCache.workouts = rows.filter(r => !r.is_template && r.source !== 'favorites');
      _woCache.loaded = true;

      console.log('[workout.js] Loaded ' + rows.length + ' workouts from db (' + _woCache.templates.length + ' maler, ' + _woCache.workouts.length + ' økter)');

      renderTemplates();
      renderWorkouts();
    } catch (e) {
      console.warn('[workout.js] _woLoadFromDb feilet:', e.message || e);

      // Fallback: vis localStorage-data hvis Supabase ikke er tilgjengelig
      // (f.eks. workouts-tabell finnes ikke enda, eller nettverksfeil)
      if (!_woCache.loaded) {
        const localTpl = loadStore().data.templates || [];
        const localWo = loadWorkoutsStore().data.workouts || [];
        if (localTpl.length || localWo.length) {
          console.log('[workout.js] Bruker localStorage-fallback: ' + localTpl.length + ' maler, ' + localWo.length + ' \u00f8kter');
          _woCache.templates = localTpl.map(t => ({
            id: t.id,
            title: t.title,
            blocks: t.blocks,
            is_template: true,
            created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
            updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
            _local: true
          }));
          _woCache.workouts = localWo.map(w => ({
            id: w.id,
            title: w.title,
            workout_date: w.date || null,
            blocks: w.blocks,
            is_template: false,
            created_at: w.createdAt ? new Date(w.createdAt).toISOString() : null,
            updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
            _local: true
          }));
          renderTemplates();
          renderWorkouts();
        }
      }
    } finally {
      _woCache.loading = false;
    }
  }

  /** Save a workout/template to Supabase, return row or null */
  async function _woSaveToDb(data) {
    const sb = _woGetSb();
    const uid = _woGetUid();
    const tid = _woGetTeamId();
    if (!sb || !uid || uid === 'anon') return null;

    const row = {
      user_id: uid,
      team_id: tid,
      title: data.title || null,
      workout_date: data.date || null,
      duration_minutes: data.duration_minutes || null,
      age_group: data.age_group || state.ageGroup || null,
      theme: data.theme || state.theme || null,
      blocks: data.blocks || [],
      is_template: !!data.is_template,
      season_id: data.season_id || null,
      event_id: data.event_id || null,
      source: data.source || 'manual',
      updated_at: new Date().toISOString()
    };

    try {
      if (data.dbId) {
        // Update existing
        const res = await sb.from('workouts').update(row).eq('id', data.dbId).select().single();
        if (res.error) throw res.error;
        return res.data;
      } else {
        // Insert new
        const res = await sb.from('workouts').insert(row).select().single();
        if (res.error) throw res.error;
        return res.data;
      }
    } catch (e) {
      console.error('[workout.js] _woSaveToDb feilet:', e.message || e);
      if (typeof window.showNotification === 'function') {
        window.showNotification('Lagring feilet. Prøv igjen.', 'error');
      }
      return null;
    }
  }

  /** Delete a workout/template from Supabase */
  async function _woDeleteFromDb(dbId) {
    const sb = _woGetSb();
    const uid = _woGetUid();
    if (!sb || !uid || !dbId) return false;

    try {
      const res = await sb.from('workouts').delete().eq('id', dbId).eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[workout.js] _woDeleteFromDb feilet:', e.message || e);
      return false;
    }
  }

  /** Rename a workout/template in Supabase */
  async function _woRenameInDb(dbId, newTitle) {
    const sb = _woGetSb();
    const uid = _woGetUid();
    if (!sb || !uid || !dbId) return false;

    try {
      const res = await sb.from('workouts')
        .update({ title: newTitle, updated_at: new Date().toISOString() })
        .eq('id', dbId).eq('user_id', uid);
      if (res.error) throw res.error;
      return true;
    } catch (e) {
      console.error('[workout.js] _woRenameInDb feilet:', e.message || e);
      return false;
    }
  }

  // === Legacy compatibility: keep localStorage functions for fallback ===
  function loadStore() {
    const raw = safeGet(STORE_KEY());
    if (!raw) return { ok: true, data: defaultStore(), corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad');
      if (!Array.isArray(parsed.templates)) parsed.templates = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: defaultStore(), corrupt: true, error: e };
    }
  }

  function loadWorkoutsStore() {
    const raw = safeGet(WORKOUTS_KEY());
    if (!raw) return { ok: true, data: { workouts: [] }, corrupt: false };
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.workouts)) parsed.workouts = [];
      return { ok: true, data: parsed, corrupt: false };
    } catch (e) {
      return { ok: false, data: { workouts: [] }, corrupt: true };
    }
  }

  /** One-time migration: localStorage + user_data → workouts table */
  async function _woMigrateToDb() {
    const tid = _woGetTeamId();
    const migKey = 'bf_wo_migrated_' + tid;
    if (safeGet(migKey)) return;

    const sb = _woGetSb();
    const uid = _woGetUid();
    if (!sb || !uid || uid === 'anon' || !tid || tid === 'default') return;

    // Gather templates and workouts from BOTH localStorage and user_data cloud
    let templates = [];
    let workouts = [];

    // Source 1: localStorage
    const localTemplates = loadStore().data.templates || [];
    const localWorkouts = loadWorkoutsStore().data.workouts || [];
    templates.push(...localTemplates);
    workouts.push(...localWorkouts);

    // Source 2: user_data cloud (handles "ny enhet" case where localStorage is empty)
    try {
      if (window._bftCloud && window._bftCloud.loadAll) {
        const cloudRows = await window._bftCloud.loadAll();
        if (cloudRows && Array.isArray(cloudRows)) {
          for (const row of cloudRows) {
            if (row.key === 'workout_templates_v1' && row.value) {
              const cloudStore = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
              if (cloudStore && Array.isArray(cloudStore.templates)) {
                const localIds = new Set(templates.map(t => t.id));
                for (const ct of cloudStore.templates) {
                  if (ct.id && !localIds.has(ct.id)) templates.push(ct);
                }
              }
            }
            if (row.key === 'workout_sessions_v1' && row.value) {
              const cloudStore = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
              if (cloudStore && Array.isArray(cloudStore.workouts)) {
                const localIds = new Set(workouts.map(w => w.id));
                for (const cw of cloudStore.workouts) {
                  if (cw.id && !localIds.has(cw.id)) workouts.push(cw);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[workout.js] Cloud data lesing under migrasjon feilet:', e.message || e);
    }

    if (templates.length === 0 && workouts.length === 0) {
      safeSet(migKey, '1');
      return;
    }

    // Check what's already in workouts table (handles partial migration / other device)
    // Dedup key: title + is_template + created_at (normalized to epoch ms)
    let existingKeys = new Set();
    try {
      const existing = await sb.from('workouts')
        .select('title, is_template, created_at')
        .eq('user_id', uid).eq('team_id', tid);
      if (existing.data) {
        for (const r of existing.data) {
          // Normalize: Supabase returns '2024-03-07T16:40:00+00:00', JS produces '.000Z'
          var epoch = r.created_at ? new Date(r.created_at).getTime() : 0;
          existingKeys.add((r.title || '') + '|' + (r.is_template ? '1' : '0') + '|' + epoch);
        }
      }
    } catch (e) {
      // If we can't check, proceed carefully
      console.warn('[workout.js] Kunne ikke sjekke eksisterende rader:', e.message || e);
    }

    const rows = [];
    for (const t of templates) {
      const createdIso = t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString();
      var epoch = t.createdAt ? new Date(t.createdAt).getTime() : new Date(createdIso).getTime();
      const key = (t.title || 'Mal') + '|1|' + epoch;
      if (existingKeys.has(key)) continue; // allerede migrert
      rows.push({
        user_id: uid,
        team_id: tid,
        title: t.title || 'Mal',
        blocks: t.blocks || [],
        is_template: true,
        source: 'migrated',
        created_at: createdIso,
        updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : createdIso
      });
    }
    for (const w of workouts) {
      const createdIso = w.createdAt ? new Date(w.createdAt).toISOString() : new Date().toISOString();
      var wEpoch = w.createdAt ? new Date(w.createdAt).getTime() : new Date(createdIso).getTime();
      const key = (w.title || '\u00d8kt') + '|0|' + wEpoch;
      if (existingKeys.has(key)) continue; // allerede migrert
      rows.push({
        user_id: uid,
        team_id: tid,
        title: w.title || '\u00d8kt',
        workout_date: w.date || null,
        blocks: w.blocks || [],
        is_template: false,
        source: 'migrated',
        created_at: createdIso,
        updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : createdIso
      });
    }

    if (rows.length === 0) {
      // Alt er allerede migrert (f.eks. fra annen enhet)
      safeSet(migKey, '1');
      return;
    }

    console.log('[workout.js] Migrerer ' + rows.length + ' \u00f8kter/maler til workouts-tabell');

    try {
      // Single insert (no batching) — atomisk: alt eller ingenting
      const res = await sb.from('workouts').insert(rows);
      if (res.error) throw res.error;
      safeSet(migKey, '1');
      console.log('[workout.js] Migrasjon fullf\u00f8rt: ' + rows.length + ' rader');
    } catch (e) {
      console.warn('[workout.js] Migrasjon feilet:', e.message || e);
      // Don't mark as migrated — retry next load
    }
  }

  function loadDraft() {
    const raw = safeGet(DRAFT_KEY());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveDraft(draft) {
    try { safeSet(DRAFT_KEY(), JSON.stringify(draft)); } catch {}
    // Draft er flyktig — lagres kun i localStorage, ikke i Supabase
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
    blocks: [],
    expandedBlockId: null, // Hybrid 1: only one block expanded at a time
    theme: null,      // NFF theme id (set by generer-flow, used by bottom sheet)
    ageGroup: null,   // '6-7' | '8-9' | '10-12' (set by generer-flow)
    eventId: null,    // Supabase event UUID (set by sesong-kobling)
    seasonId: null    // Supabase season UUID (set by sesong-kobling)
  };

  function makeDefaultExercise() {
    return {
      exerciseKey: 'tag',
      customName: '',
      minutes: 10,
      groupCount: 1,
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
    if (meta) return meta.label;
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
    // ── Meta-bar: replaces simple "Total tid" with rich overview ──
    const el = $('woMetaBar');
    const total = totalMinutes();
    const blockCount = state.blocks.filter(b => b.a?.exerciseKey !== 'drink').length;

    // NFF balance
    const balance = calculateNffBalance(state.blocks, state.ageGroup || '8-9');

    // Theme pill
    const themeMeta = state.theme ? NFF_THEME_BY_ID[state.theme] : null;
    const themePill = themeMeta
      ? '<span class="wo-meta-theme">' +
          escapeHtml(themeMeta.icon) + ' ' + escapeHtml(themeMeta.label) +
          ' <button type="button" class="wo-meta-theme-x" id="woMetaThemeX" aria-label="Fjern tema">\u2715</button>' +
        '</span>'
      : '';

    // Age class badge
    const ageBadge = state.ageGroup
      ? '<span class="wo-meta-age">' + escapeHtml(state.ageGroup) + ' \u00e5r</span>'
      : '';

    // NFF balance bar
    let balanceHtml = '<div class="wo-meta-balance">';
    for (const cat of NFF_CATEGORIES) {
      const b = balance.balance[cat.id];
      if (!b) continue;
      const pct = balance.totalMinutes > 0 ? Math.round((b.minutes / balance.totalMinutes) * 100) : 0;
      const recPct = b.recommendedPct || 0;
      const _age = state.ageGroup || '8-9';
      balanceHtml += '<div class="wo-meta-bal-seg" style="--bal-color:' + cat.color + '; --bal-pct:' + pct + '%" ' +
        'title="' + escapeHtml(catShort(cat, _age)) + ': ' + b.minutes + ' min (' + pct + '%) \u2014 anbefalt ' + recPct + '%">' +
        '<div class="wo-meta-bal-fill"></div>' +
        '<span class="wo-meta-bal-label">' + escapeHtml(catShort(cat, _age)) + '</span>' +
      '</div>';
    }
    balanceHtml += '</div>';

    if (el) {
      el.innerHTML =
        '<div class="wo-meta-row">' +
          '<div class="wo-meta-total">' + total + '<span class="wo-meta-total-unit">min</span></div>' +
          '<div class="wo-meta-info">' +
            '<span class="wo-meta-count">' + blockCount + ' \u00f8velser</span>' +
            ageBadge +
            themePill +
          '</div>' +
        '</div>' +
        balanceHtml;

      // Bind theme remove
      const themeX = $('woMetaThemeX');
      if (themeX) {
        themeX.addEventListener('click', () => {
          state.theme = null;
          updateTotalUI();
        });
      }
    }

    // Legacy: keep bottom total in sync if it still exists
    const elB = $('woTotalBottom');
    if (elB) elB.textContent = total + ' min';

    // Fallback: update old woTotalTop if meta-bar not yet in DOM
    if (!el) {
      const elTop = $('woTotalTop');
      if (elTop) elTop.textContent = total + ' min';
    }
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
    const _pcColors = ['#93c5fd','#a5b4fc','#f9a8d4','#fcd34d','#6ee7b7','#fca5a5','#67e8f9','#c4b5fd','#f0abfc','#5eead4','#fdba74','#bef264','#fb7185','#7dd3fc','#d8b4fe','#86efac','#fed7aa','#99f6e4'];

    container.innerHTML = players.map((p, i) => {
      const checked = state.selected.has(p.id) ? 'checked' : '';
      return `
        <label class="player-checkbox" style="--pc-color:${_pcColors[i % _pcColors.length]}">
          <input type="checkbox" data-id="${escapeHtml(p.id)}" ${checked}>
          <div class="pc-avatar">${escapeHtml((p.name || '?').charAt(0).toUpperCase())}</div>
          <div class="pc-info">
            <div class="player-name">${escapeHtml(p.name)}</div>
            ${p.goalie ? '<span class="pc-keeper">🧤 Keeper</span>' : ''}
          </div>
          <div class="pc-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
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


  function renderExerciseEditor(blockId, track, ex) {
    const idp = `wo_${blockId}_${track}`;
    const showCustom = ex.exerciseKey === 'custom';
    const mode = ex.groupMode || 'even';
    const groupCount = clampInt(ex.groupCount, 1, 20, 2);
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    const hasInfo = meta && meta.description && meta.steps;

    return `
      <div class="wo-subcard">
        <div class="wo-subheader">
          <div class="wo-subtitle">${track === 'a' ? 'Øvelse' : 'Parallell øvelse'}</div>
        </div>

        <div class="wo-row">
          <div class="wo-field">
            <label class="wo-label">Velg øvelse</label>
            <div class="wo-select-row">
              ${renderExerciseTrigger(blockId, track, ex)}
            </div>
            ${hasInfo ? `<button type="button" id="${idp}_info" class="wo-info-expand" aria-label="Vis øvelsesinfo">
              <span class="wo-info-expand-text"><span class="wo-info-expand-icon">📖</span> Vis beskrivelse, diagram og trenertips</span>
              <span class="wo-info-expand-chevron">▼</span>
            </button>` : ''}
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

        <div id="${idp}_infoPanel" class="wo-info-panel wo-hidden"></div>

        <div class="wo-row">
          <div class="wo-field wo-groups-settings">
            <label class="wo-label">Grupper</label>
            <div class="wo-inline">
              <input id="${idp}_groups" class="input wo-input" type="number" min="1" max="20" value="${escapeHtml(String(groupCount))}" style="max-width:90px;">
              <select id="${idp}_mode" class="input wo-input">
                <option value="none" ${mode === 'none' ? 'selected' : ''}>Ingen inndeling</option>
                <option value="even" ${mode === 'even' ? 'selected' : ''}>Jevne grupper</option>
                <option value="diff" ${mode === 'diff' ? 'selected' : ''}>Grupper etter nivå</option>
              </select>
            </div>
            <div class="small-text" style="opacity:0.85; margin-top:6px;">
              ${meta && meta.suggestedGroupSize ? '<span style="color:#2e8b57;">\u2139\ufe0f ' + meta.suggestedGroupSize + ' per gruppe (tilpasset antall deltakere)</span>' : ''}
              ${track === 'b' ? 'Parallelt: grupper lages p\u00e5 deltakere til denne \u00f8velsen.' : ''}
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
            <div style="font-weight:500;">Fordel spillere mellom parallelle øvelser</div>
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
            ${(() => { const _pcC = ['#93c5fd','#a5b4fc','#f9a8d4','#fcd34d','#6ee7b7','#fca5a5','#67e8f9','#c4b5fd','#f0abfc','#5eead4','#fdba74','#bef264','#fb7185','#7dd3fc','#d8b4fe','#86efac','#fed7aa','#99f6e4']; return eligible.map((p, i) => {
              const checked = cleaned.has(p.id) ? 'checked' : '';
              return `
                <label class="player-checkbox" style="--pc-color:${_pcC[i % _pcC.length]}">
                  <input type="checkbox" data-pickb="${escapeHtml(p.id)}" ${checked}>
                  <div class="pc-avatar">${escapeHtml((p.name || '?').charAt(0).toUpperCase())}</div>
                  <div class="pc-info">
                    <div class="player-name">${escapeHtml(p.name)}</div>
                    ${p.goalie ? '<span class="pc-keeper">🧤 Keeper</span>' : ''}
                  </div>
                  <div class="pc-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
                </label>
              `;
            }).join(''); })()}
          </div>

          <div class="small-text" style="opacity:0.85; margin-top:6px;">
            Tips: Velg keepere til øvelse B (keepertrening). Resten går automatisk til øvelse A.
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================
  // HYBRID 1 LAYOUT — Compact cards with accordion
  // =========================================================

  /**
   * Get the NFF category for a block (based on track A).
   * Returns the NFF_CATEGORIES object or null.
   */
  function _blockNffCategory(block) {
    const meta = EX_BY_KEY.get(block.a?.exerciseKey);
    if (!meta) return null;
    if (meta.nffCategory === 'pause') return null; // drikkepause has no NFF section
    return NFF_CATEGORY_BY_ID[meta.nffCategory] || null;
  }

  /**
   * Compute section marker data: where NFF category changes between blocks.
   * Returns array of { beforeIndex, cat, minutes } objects.
   */
  function _computeSectionMarkers() {
    const markers = [];
    let prevCatId = null;
    let sectionStart = 0;

    for (let i = 0; i < state.blocks.length; i++) {
      const cat = _blockNffCategory(state.blocks[i]);
      const catId = cat ? cat.id : null;

      if (catId && catId !== prevCatId) {
        // Compute minutes for this new section
        let sectionMin = 0;
        for (let j = i; j < state.blocks.length; j++) {
          const jCat = _blockNffCategory(state.blocks[j]);
          const jCatId = jCat ? jCat.id : null;
          if (j > i && jCatId !== catId) break;
          // Only count blocks that belong to this category
          if (jCatId === catId) {
            const b = state.blocks[j];
            if (b.kind === 'parallel') {
              sectionMin += Math.max(clampInt(b.a?.minutes, 0, 300, 0), clampInt(b.b?.minutes, 0, 300, 0));
            } else {
              sectionMin += clampInt(b.a?.minutes, 0, 300, 0);
            }
          }
        }
        markers.push({ beforeIndex: i, cat, minutes: sectionMin });
      }
      if (catId) prevCatId = catId;
    }
    return markers;
  }

  /**
   * Render a collapsed card for a block.
   */
  function renderCollapsedCard(block, idx) {
    const bid = block.id;
    const isParallel = block.kind === 'parallel';
    const meta = EX_BY_KEY.get(block.a?.exerciseKey);
    const cat = meta ? NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    const color = cat ? cat.color : '#ccc';
    const name = displayName(block.a);
    const isDrink = block.a?.exerciseKey === 'drink';
    const minutes = isParallel
      ? Math.max(clampInt(block.a?.minutes, 0, 300, 0), clampInt(block.b?.minutes, 0, 300, 0))
      : clampInt(block.a?.minutes, 0, 300, 0);

    // Badges
    const badges = [];
    if (isParallel) {
      const nameB = displayName(block.b);
      badges.push('<span class="wo-h1-badge wo-h1-badge-par">\u2016 ' + escapeHtml(nameB) + '</span>');
    }
    if (block.a?.groupMode && block.a.groupMode !== 'none' && block.a.groupCount > 1) {
      badges.push('<span class="wo-h1-badge">\uD83D\uDC65 ' + block.a.groupCount + ' gr</span>');
    }
    if ((block.a?.comment || '').trim()) {
      badges.push('<span class="wo-h1-badge">\uD83D\uDCDD</span>');
    }

    return '<div class="wo-h1-card wo-h1-collapsed" data-bid="' + bid + '" style="--h1-color:' + color + '">' +
      '<div class="wo-h1-stripe"></div>' +
      '<div class="wo-h1-main">' +
        '<div class="wo-h1-name">' + (isDrink ? '\uD83D\uDCA7 ' : '') + escapeHtml(name) + '</div>' +
        (badges.length ? '<div class="wo-h1-badges">' + badges.join('') + '</div>' : '') +
      '</div>' +
      '<div class="wo-h1-min" id="wo_' + bid + '_minTap">' + minutes + '<span class="wo-h1-min-unit">min</span></div>' +
    '</div>';
  }

  /**
   * Render an expanded card for a block.
   */
  function renderExpandedCard(block, idx) {
    const bid = block.id;
    const isParallel = block.kind === 'parallel';
    const meta = EX_BY_KEY.get(block.a?.exerciseKey);
    const cat = meta ? NFF_CATEGORY_BY_ID[meta.nffCategory] : null;
    const color = cat ? cat.color : '#ccc';

    const editorA = renderExerciseEditor(bid, 'a', block.a);
    const editorB = isParallel ? renderParallelPicker(block) + renderExerciseEditor(bid, 'b', block.b) : '';

    const helpText = isParallel
      ? '<div class="small-text" style="opacity:0.85; margin-top:6px;">Parallelt: total tid teller lengste varighet av \u00f8velse A/B.</div>'
      : '';

    return '<div class="wo-h1-card wo-h1-expanded" data-bid="' + bid + '" style="--h1-color:' + color + '">' +
      '<div class="wo-h1-stripe"></div>' +
      '<div class="wo-h1-exp-body">' +
        editorA +
        editorB +
        helpText +
        '<div class="wo-h1-actions">' +
          '<button class="btn-small" type="button" id="wo_' + bid + '_up" title="Flytt opp">\u2191</button>' +
          '<button class="btn-small" type="button" id="wo_' + bid + '_down" title="Flytt ned">\u2193</button>' +
          (isParallel ? '' : '<button class="btn-small" type="button" id="wo_' + bid + '_addParallel" title="Legg til parallell \u00f8velse">\u2016 Parallelt</button>') +
          '<button class="btn-small btn-danger" type="button" id="wo_' + bid + '_del" title="Slett">\uD83D\uDDD1 Slett</button>' +
          '<button class="btn-small" type="button" id="wo_' + bid + '_collapse" title="Lukk">\u25b2 Lukk</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /**
   * Render a section marker.
   */
  function renderSectionMarker(cat, minutes) {
    return '<div class="wo-h1-marker" style="--marker-color:' + cat.color + '">' +
      '<span class="wo-h1-marker-label">' + catLabel(cat, state.ageGroup) + '</span>' +
      '<span class="wo-h1-marker-min">' + minutes + ' min</span>' +
    '</div>';
  }

  function renderBlocks() {
    const container = $('woBlocks');
    if (!container) return;

    const markers = _computeSectionMarkers();
    const markerMap = new Map(markers.map(m => [m.beforeIndex, m]));

    let html = '';
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];

      // Insert section marker if needed
      const marker = markerMap.get(i);
      if (marker) {
        html += renderSectionMarker(marker.cat, marker.minutes);
      }

      // Render card (collapsed or expanded)
      const isExpanded = state.expandedBlockId === b.id;
      if (isExpanded) {
        html += renderExpandedCard(b, i);
      } else {
        html += renderCollapsedCard(b, i);
      }
    }

    container.innerHTML = html;

    // Bind events
    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      const isExpanded = state.expandedBlockId === b.id;

      if (isExpanded) {
        // Expanded: bind editors + action buttons
        const up = $(`wo_${b.id}_up`);
        const down = $(`wo_${b.id}_down`);
        const del = $(`wo_${b.id}_del`);
        const addPar = $(`wo_${b.id}_addParallel`);
        const collapse = $(`wo_${b.id}_collapse`);

        if (up) up.addEventListener('click', () => moveBlock(b.id, -1));
        if (down) down.addEventListener('click', () => moveBlock(b.id, +1));
        if (del) del.addEventListener('click', () => { state.expandedBlockId = null; deleteBlock(b.id); });
        if (addPar) addPar.addEventListener('click', () => convertToParallel(b.id));
        if (collapse) collapse.addEventListener('click', () => {
          state.expandedBlockId = null;
          renderBlocks();
        });

        bindExerciseEditor(b, 'a');
        if (b.kind === 'parallel') {
          bindParallelPicker(b);
          bindExerciseEditor(b, 'b');
        }
      } else {
        // Collapsed: click to expand
        const card = container.querySelector('.wo-h1-collapsed[data-bid="' + b.id + '"]');
        if (card) {
          card.addEventListener('click', (e) => {
            // Don't expand if user clicked the inline minute tap area
            if (e.target.closest('.wo-h1-min')) return;
            state.expandedBlockId = b.id;
            renderBlocks();
          });
        }

        // Inline minute editing on tap
        const minTap = $(`wo_${b.id}_minTap`);
        if (minTap) {
          minTap.addEventListener('click', (e) => {
            e.stopPropagation();
            _inlineEditMinutes(b, minTap);
          });
        }
      }
    }

    updateTotalUI();
    persistDraft();
  }

  /**
   * Inline minute editing for collapsed cards.
   * Replaces the minute display with an input field.
   */
  function _inlineEditMinutes(block, el) {
    const currentMin = block.kind === 'parallel'
      ? Math.max(clampInt(block.a?.minutes, 0, 300, 0), clampInt(block.b?.minutes, 0, 300, 0))
      : clampInt(block.a?.minutes, 0, 300, 0);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'wo-h1-min-input';
    input.min = '0';
    input.max = '300';
    input.value = String(currentMin);

    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const val = clampInt(input.value, 0, 300, currentMin);
      block.a.minutes = val;
      if (block.kind === 'parallel' && block.b) {
        // Keep B in sync if it was the longer one
        if (clampInt(block.b.minutes, 0, 300, 0) >= currentMin) {
          block.b.minutes = val;
        }
      }
      renderBlocks();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') { input.value = String(currentMin); input.blur(); }
    });
  }

  function renderInfoPanel(exerciseKey) {
    const meta = EX_BY_KEY.get(exerciseKey);
    if (!meta || !meta.description || !meta.steps) return '';
    const tags = [];
    if (meta.ages && meta.ages.length) {
      if (meta.ages.length > 2) {
        const first = meta.ages[0].split('-')[0];
        const last = meta.ages[meta.ages.length - 1].split('-')[1];
        tags.push('📍 ' + first + '\u2013' + last + ' år');
      } else {
        meta.ages.forEach(a => tags.push('📍 ' + a + ' år'));
      }
    }
    if (meta.players) tags.push('👥 ' + meta.players);
    if (meta.equipment) tags.push('⚙️ ' + meta.equipment);
    let html = '<div class="wo-info-content">';
    html += '<p class="wo-info-desc">' + escapeHtml(meta.description) + '</p>';
    if (tags.length) {
      html += '<div class="wo-info-tags">' + tags.map(t => '<span class="wo-info-tag">' + escapeHtml(t) + '</span>').join('') + '</div>';
    }
    // Learning goals (per exercise)
    if (meta.learningGoals && meta.learningGoals.length) {
      html += '<div class="wo-info-section">🎯 Læringsmål</div><ul class="wo-info-coaching">';
      for (const g of meta.learningGoals) html += '<li>' + escapeHtml(g) + '</li>';
      html += '</ul>';
    }
    if (meta.diagram) {
      html += '<div class="wo-info-svg">' + renderDrillSVG(meta.diagram) + '</div>';
    }
    html += '<div class="wo-info-section">Oppsett</div>';
    html += '<p class="wo-info-text">' + escapeHtml(meta.setup || '') + '</p>';
    html += '<div class="wo-info-section">Gjennomføring</div><ol class="wo-info-steps">';
    for (const step of meta.steps) html += '<li>' + escapeHtml(step) + '</li>';
    html += '</ol>';
    if (meta.coaching && meta.coaching.length) {
      html += '<div class="wo-info-section">Coachingpunkter</div><ul class="wo-info-coaching">';
      for (const c of meta.coaching) html += '<li>' + escapeHtml(c) + '</li>';
      html += '</ul>';
    }
    if (meta.variations && meta.variations.length) {
      html += '<div class="wo-info-section">Variasjoner</div>';
      for (const v of meta.variations) html += '<p class="wo-info-variation">🔄 ' + escapeHtml(v) + '</p>';
    }
    html += '</div>';
    return html;
  }

  function bindExerciseEditor(block, track) {
    const bid = block.id;
    const ex = track === 'a' ? block.a : block.b;
    const idp = `wo_${bid}_${track}`;

    const trigger = $(`${idp}_trigger`);
    const customWrap = $(`${idp}_customWrap`);
    const custom = $(`${idp}_custom`);
    const min = $(`${idp}_min`);
    const groups = $(`${idp}_groups`);
    const mode = $(`${idp}_mode`);
    const comment = $(`${idp}_comment`);
    const makeBtn = $(`${idp}_make`);
    const refreshBtn = $(`${idp}_refresh`);
    const infoBtn = $(`${idp}_info`);
    const infoPanel = $(`${idp}_infoPanel`);

    // Info panel toggle (lazy render)
    if (infoBtn && infoPanel) {
      infoBtn.addEventListener('click', () => {
        const isOpen = !infoPanel.classList.contains('wo-hidden');
        if (isOpen) {
          infoPanel.classList.add('wo-hidden');
          infoBtn.classList.remove('wo-info-expand-active');
          const txt = infoBtn.querySelector('.wo-info-expand-text');
          if (txt) txt.innerHTML = '<span class="wo-info-expand-icon">📖</span> Vis beskrivelse, diagram og trenertips';
        } else {
          if (!infoPanel.dataset.rendered) {
            infoPanel.innerHTML = renderInfoPanel(ex.exerciseKey);
            infoPanel.dataset.rendered = '1';
          }
          infoPanel.classList.remove('wo-hidden');
          infoBtn.classList.add('wo-info-expand-active');
          const txt = infoBtn.querySelector('.wo-info-expand-text');
          if (txt) txt.innerHTML = '<span class="wo-info-expand-icon">📖</span> Skjul øvelsesinfo';
        }
      });
    }

    // Trigger button → opens bottom sheet
    if (trigger) {
      trigger.addEventListener('click', () => {
        openBottomSheet(bid, track, (newKey) => {
          ex.exerciseKey = newKey;
          ex._groupCountManual = false; // reset for auto-sizing
          trackExerciseUsage(newKey);
          const meta = EX_BY_KEY.get(newKey);
          if (meta && Number(ex.minutes) <= 0) ex.minutes = meta.defaultMin ?? 10;

          if (newKey === 'custom') {
            if (customWrap) customWrap.classList.remove('wo-hidden');
          } else {
            if (customWrap) customWrap.classList.add('wo-hidden');
            ex.customName = '';
          }

          // grupper stale
          state.groupsCache.delete(`${bid}:${track}`);
          renderBlocks();
        });
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
        ex.groupCount = clampInt(groups.value, 1, 20, 2);
        ex._groupCountManual = true; // user explicitly set group count
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
    const idp = `wo_${bid}_${track}`;

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
    let groupCount = clampInt(ex.groupCount, 1, 20, 2);

    // Auto-calculate group count from suggestedGroupSize if available
    const meta = EX_BY_KEY.get(ex.exerciseKey);
    if (meta && meta.suggestedGroupSize && meta.suggestedGroupSize >= 2) {
      const autoCount = Math.max(1, Math.ceil(participants.length / meta.suggestedGroupSize));
      // Only auto-set if user hasn't manually overridden (groupCount still at default 2)
      // or if groupCount * suggestedGroupSize is way off from participant count
      if (!ex._groupCountManual) {
        groupCount = autoCount;
        ex.groupCount = autoCount;
        // Update UI input
        const groupInput = $(`${idp}_groups`);
        if (groupInput) groupInput.value = String(autoCount);
      }
    }

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
    const hasMultiple = groups.length > 1;

    groupsOut.innerHTML = `
      <div class="wo-groups-compact">
        ${hasMultiple ? '<div class="grpdd-hint small-text" style="opacity:0.6; margin-bottom:4px; text-align:center; font-size:11px;"><i class="fas fa-hand-pointer" style="margin-right:3px;"></i> Hold inne for \u00e5 bytte/flytte</div>' : ''}
        ${groups.map((g, idx) => `
          <div class="wo-group-card grpdd-group" data-grpdd-gi="${idx}">
            <div class="wo-group-title grpdd-group" data-grpdd-gi="${idx}">${groups.length === 1 ? 'Deltakere' : `Gruppe ${idx + 1}`} <span style="opacity:0.7;">(${g.length})</span></div>
            <div class="wo-group-names">${g.map((p, pi) => `<span class="wo-group-name grpdd-player" data-grpdd-gi="${idx}" data-grpdd-pi="${pi}">${escapeHtml(p.name)}${p.goalie ? ' 🧤' : ''}</span>`).join('')}</div>
          </div>
        `).join('')}
      </div>
    `;

    // Attach shared drag-drop (only for multi-group)
    if (hasMultiple && window.GroupDragDrop && window.GroupDragDrop.enable) {
      window.GroupDragDrop.enable(groupsOut, groups, function (updatedGroups) {
        state.groupsCache.set(outKey, updatedGroups);
        renderGroupsOut(blockId, track);
      }, {
        notify: typeof window.showNotification === 'function' ? window.showNotification : function () {}
      });
    }
  }

  // -------------------------
  // Block operations
  // -------------------------
  function addBlock(kind = 'single') {
    const b = makeBlock(kind);
    state.blocks.push(b);
    state.expandedBlockId = b.id; // auto-expand new block
    renderBlocks();
  }

  function clearSession() {
    if (state.blocks.length > 0) {
      const ok = window.confirm('Tøm hele økta og start på nytt?');
      if (!ok) return;
    }
    state.blocks = [];
    state.groupsCache.clear();
    state.parallelPickB.clear();
    state.expandedBlockId = null;
    state.theme = null;
    state.ageGroup = null;
    state.eventId = null;
    state.seasonId = null;
    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (dateEl) dateEl.value = '';
    if (titleEl) titleEl.value = '';
    safeRemove(DRAFT_KEY());
    renderBlocks();
    updateTotalUI();
    if (typeof window.showNotification === 'function') {
      window.showNotification('Økta er tømt. Klar for ny planlegging.', 'info');
    }
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
          a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }),
          b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }),
          _showPickB: false
        };
      }
      return { id: uuid('b_'), kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    state.groupsCache.clear();
    state.parallelPickB.clear();
    state.expandedBlockId = null;
    state.eventId = null;
    state.seasonId = null;
    renderBlocks();
  }

  function renderTemplates() {
    const wrap = $('woTemplates');
    if (!wrap) return;

    const list = _woCache.templates.slice().sort((a, b) => {
      const ta = a.updated_at || a.created_at || '';
      const tb = b.updated_at || b.created_at || '';
      return tb.localeCompare(ta);
    });

    if (!list.length) {
      wrap.innerHTML = '<div class="small-text" style="opacity:0.85;">Ingen maler lagret enn\u00e5.</div>';
      return;
    }

    wrap.innerHTML = list.map(t => {
      const dt = new Date(t.updated_at || t.created_at || Date.now());
      const when = dt.toLocaleString('nb-NO', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      const canEdit = !t._local; // Local-only items can't be renamed/deleted until Supabase loads
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:500;">${escapeHtml(t.title || 'Uten navn')}</div>
            <div class="small-text" style="opacity:0.85;">Sist endret: ${escapeHtml(when)}</div>
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(t.id)}">Last inn</button>
            ${canEdit ? '<button class="btn-small" type="button" data-wo-rename="' + escapeHtml(t.id) + '">Gi nytt navn</button>' : ''}
            ${canEdit ? '<button class="btn-small btn-danger" type="button" data-wo-del="' + escapeHtml(t.id) + '">Slett</button>' : ''}
          </div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const tpl = _woCache.templates.find(x => x.id === id);
        if (!tpl) return;
        applyTemplateToState(tpl);
        if (typeof window.showNotification === 'function') window.showNotification('Mal lastet inn', 'success');
      });
    });

    wrap.querySelectorAll('button[data-wo-rename]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-wo-rename');
        const tpl = _woCache.templates.find(x => x.id === id);
        if (!tpl) return;
        const name = window.prompt('Nytt navn p\u00e5 malen:', tpl.title || '');
        if (name === null) return;
        const v = String(name).trim();
        if (!v) return;
        const ok = await _woRenameInDb(id, v);
        if (ok) {
          tpl.title = v;
          tpl.updated_at = new Date().toISOString();
          renderTemplates();
          if (typeof window.showNotification === 'function') window.showNotification('Navn oppdatert', 'success');
        }
      });
    });

    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne malen?');
        if (!ok) return;
        const deleted = await _woDeleteFromDb(id);
        if (deleted) {
          _woCache.templates = _woCache.templates.filter(x => x.id !== id);
          renderTemplates();
          if (typeof window.showNotification === 'function') window.showNotification('Mal slettet', 'info');
        }
      });
    });
  }

  async function saveTemplate() {
    const title = String($('woTitle')?.value || '').trim();
    const date = String($('woDate')?.value || '').trim();

    const blocks = state.blocks.map(b => {
      if (b.kind === 'parallel') {
        return { kind: 'parallel', a: { ...b.a }, b: { ...b.b } };
      }
      return { kind: 'single', a: { ...b.a } };
    });

    const saved = await _woSaveToDb({
      title: title || (date ? 'Trening ' + date : 'Ny trenings\u00f8kt'),
      blocks,
      is_template: true,
    });

    if (saved) {
      _woCache.templates.unshift(saved);
      renderTemplates();
      if (typeof window.showNotification === 'function') window.showNotification('Mal lagret', 'success');
    } else {
      // Supabase feilet — lagre i localStorage som sikkerhetsnett
      _woFallbackSaveLocal(title || (date ? 'Trening ' + date : 'Ny trenings\u00f8kt'), null, blocks, true);
    }
  }

  /**
   * Fallback: lagre til localStorage når Supabase er utilgjengelig.
   * Dataen plukkes opp av _woMigrateToDb neste gang Supabase fungerer.
   */
  function _woFallbackSaveLocal(title, date, blocks, isTemplate) {
    try {
      if (isTemplate) {
        const store = loadStore().data;
        store.templates.push({
          id: uuid('tpl_'),
          title: title,
          blocks: blocks,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        safeSet(STORE_KEY(), JSON.stringify(store));
        // Reset migration flag so next load migrates this item
        safeRemove('bf_wo_migrated_' + _woGetTeamId());
        // Add to visible cache
        _woCache.templates.unshift({
          id: store.templates[store.templates.length - 1].id,
          title: title, blocks: blocks, is_template: true, _local: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        renderTemplates();
      } else {
        const store = loadWorkoutsStore().data;
        store.workouts.unshift({
          id: uuid('w_'),
          title: title,
          date: date || '',
          blocks: blocks,
          usePlayers: !!state.usePlayers,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        safeSet(WORKOUTS_KEY(), JSON.stringify(store));
        safeRemove('bf_wo_migrated_' + _woGetTeamId());
        _woCache.workouts.unshift({
          id: store.workouts[0].id,
          title: title, workout_date: date, blocks: blocks, is_template: false, _local: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        renderWorkouts();
      }
      if (typeof window.showNotification === 'function') {
        window.showNotification('Lagret lokalt (synkroniseres ved neste lasting)', 'success');
      }
    } catch (e) {
      console.error('[workout.js] Lokal fallback-lagring feilet:', e.message || e);
      if (typeof window.showNotification === 'function') {
        window.showNotification('Lagring feilet. Eksporter \u00f8kta som PDF for \u00e5 bevare den.', 'error');
      }
    }
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

  // Exercise key — migrate old keys first
  if (out.exerciseKey && KEY_MIGRATION[out.exerciseKey]) {
    const migrated = KEY_MIGRATION[out.exerciseKey];
    if (migrated === 'custom' && !out.customName) {
      // Preserve original name for custom fallback
      const oldMeta = { 'juggle': 'Triksing med ball', 'competitions': 'Konkurranser' };
      out.customName = clampText(oldMeta[out.exerciseKey] || out.exerciseKey, 60);
    }
    out.exerciseKey = migrated;
  }

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
  state.expandedBlockId = null;
  state.eventId = null;
  state.seasonId = null;

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


  function applyWorkoutToState(w) {
    if (!w || !Array.isArray(w.blocks)) return;

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (titleEl) titleEl.value = String(w.title || '');
    // Support both old format (.date) and Supabase format (.workout_date)
    const dateVal = w.workout_date || w.date || '';
    if (dateEl && dateVal) dateEl.value = dateVal;

    state.usePlayers = !!w.usePlayers;
    const t = $('woUsePlayersToggle');
    if (t) t.checked = !!state.usePlayers;

    state.selected = new Set();
    state.parallelPickB.clear();
    state.groupsCache.clear();
    state.expandedBlockId = null;
    state.eventId = w.event_id || null;
    state.seasonId = w.season_id || null;
    state.theme = w.theme || null;
    state.ageGroup = w.age_group || w.ageGroup || null;

    state.blocks = w.blocks.map(b => {
      const bid = uuid('b_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }), b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }), _showPickB: false };
      }
      return { id: bid, kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    renderPlayersPanel();
    renderBlocks();
    persistDraft();
  }

  /** Duplicate a saved workout as a new unsaved session */
  function duplicateWorkout(w) {
    if (!w || !Array.isArray(w.blocks)) return;

    const dateEl = $('woDate');
    const titleEl = $('woTitle');
    if (titleEl) titleEl.value = 'Kopi av ' + String(w.title || 'Trenings\u00f8kt');
    if (dateEl) dateEl.value = ''; // blank date — user sets new date

    state.usePlayers = !!w.usePlayers;
    const t = $('woUsePlayersToggle');
    if (t) t.checked = !!state.usePlayers;

    state.selected = new Set();
    state.parallelPickB.clear();
    state.groupsCache.clear();
    state.expandedBlockId = null;
    // Clear event/season links — this is a NEW session
    state.eventId = null;
    state.seasonId = null;
    // Keep theme and age from original
    state.theme = w.theme || null;
    state.ageGroup = w.age_group || w.ageGroup || null;

    state.blocks = w.blocks.map(b => {
      const bid = uuid('b_');
      if (b.kind === 'parallel') {
        return { id: bid, kind: 'parallel', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }), b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }), _showPickB: false };
      }
      return { id: bid, kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    renderPlayersPanel();
    renderBlocks();
    persistDraft();

    if (typeof window.showNotification === 'function') {
      window.showNotification('\u00d8kt duplisert \u2013 sett ny dato og juster fritt', 'success');
    }
  }

  function renderWorkouts() {
    const wrap = $('woWorkouts');
    if (!wrap) return;

    const list = _woCache.workouts.slice().sort((a, b) => {
      const ta = a.updated_at || a.created_at || '';
      const tb = b.updated_at || b.created_at || '';
      return tb.localeCompare(ta);
    });

    if (!list.length) {
      wrap.innerHTML = '<div class="small-text" style="opacity:0.75;">Ingen lagrede \u00f8kter enn\u00e5.</div>';
      return;
    }

    wrap.innerHTML = list.map(w => {
      const dateTxt = w.workout_date ? '<span class="small-text" style="opacity:0.8;">' + escapeHtml(w.workout_date) + '</span>' : '';
      const eventBadge = w.event_id ? ' <span class="wo-h1-badge" style="vertical-align:middle;">\uD83D\uDCC5 Sesong</span>' : '';
      const canEdit = !w._local;
      return `
        <div class="wo-template-item">
          <div>
            <div style="font-weight:500;">${escapeHtml(w.title || 'Trenings\u00f8kt')}${eventBadge}</div>
            ${dateTxt}
          </div>
          <div class="wo-template-actions">
            <button class="btn-small" type="button" data-wo-load="${escapeHtml(w.id)}"><i class="fas fa-upload"></i> Last</button>
            <button class="btn-small" type="button" data-wo-dup="${escapeHtml(w.id)}" title="Dupliser som ny \u00f8kt">\uD83D\uDCCB Kopi</button>
            ${canEdit ? '<button class="btn-small" type="button" data-wo-del="' + escapeHtml(w.id) + '"><i class="fas fa-trash"></i> Slett</button>' : ''}
          </div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('button[data-wo-load]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-load');
        const w = _woCache.workouts.find(x => x.id === id);
        if (w) applyWorkoutToState(w);
      });
    });
    wrap.querySelectorAll('button[data-wo-dup]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-wo-dup');
        const w = _woCache.workouts.find(x => x.id === id);
        if (w) duplicateWorkout(w);
      });
    });
    wrap.querySelectorAll('button[data-wo-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-wo-del');
        const ok = window.confirm('Slette denne \u00f8kta?');
        if (!ok) return;
        const deleted = await _woDeleteFromDb(id);
        if (deleted) {
          _woCache.workouts = _woCache.workouts.filter(x => x.id !== id);
          renderWorkouts();
        }
      });
    });
  }

  async function saveWorkout() {
    const date = String($('woDate')?.value || '').trim();
    if (!date) {
      const ok = window.confirm('Ingen dato valgt. Vil du lagre \u00f8kta likevel?');
      if (!ok) return;
    }

    const title = String($('woTitle')?.value || '').trim();
    const blocks = state.blocks.map(b => {
      if (b.kind === 'parallel') {
        return { kind: 'parallel', a: { ...b.a }, b: { ...b.b } };
      }
      return { kind: 'single', a: { ...b.a } };
    });

    const saved = await _woSaveToDb({
      title: title || (date ? 'Trening ' + date : 'Trenings\u00f8kt'),
      date: date || null,
      blocks,
      is_template: false,
      event_id: state.eventId || null,
      season_id: state.seasonId || null,
      duration_minutes: totalMinutes() || null,
    });

    if (saved) {
      _woCache.workouts.unshift(saved);
      renderWorkouts();
      if (typeof window.showNotification === 'function') window.showNotification('\u00d8kt lagret', 'success');

      // Notify season.js if linked to event
      if (saved.event_id) {
        window.dispatchEvent(new CustomEvent('workout:saved', {
          detail: { eventId: saved.event_id, workoutId: saved.id }
        }));
      }
    } else {
      // Supabase feilet — lagre i localStorage som sikkerhetsnett
      _woFallbackSaveLocal(title || (date ? 'Trening ' + date : 'Trenings\u00f8kt'), date, blocks, false);
    }
  }


  // -------------------------
  // Pre-built session templates (ferdige øktmaler)
  // -------------------------
  const NFF_TEMPLATES = (_nff && _nff.NFF_TEMPLATES) || {};


  // Legacy SUGGESTIONS (used as fallback only)
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
      { key: 'drink', min: 2 },
      { parallel: true, a: { key: '2v1', min: 12 }, b: { key: 'keeper', min: 12 } },
      { key: 'ssg', min: 25 },
      { key: 'shot_race', min: 6 }
    ],
    // 90 min
    [
      { key: 'tag', min: 10 },
      { key: 'warm_ball', min: 12 },
      { key: 'driving', min: 10 },
      { key: 'drink', min: 2 },
      { key: 'receive_turn', min: 12 },
      { key: '3v2', min: 12 },
      { key: 'ssg', min: 28 },
      { key: 'shot', min: 4 }
    ]
  ];

  // =========================================================
  // "LAG EN TRENINGSØKT FOR MEG" — NFF-aware generator
  // =========================================================

  const _gen = {
    open: false,
    selectedTheme: null,
    selectedDuration: 60,
    selectedAge: '8-9',
  };

  /** Render the generer-flow panel */
  function renderGenererFlow() {
    const el = $('woGenererPanel');
    if (!el) return;

    if (!_gen.open) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';

    // Get available themes for selected age
    const availableThemes = NFF_THEMES_BY_AGE[_gen.selectedAge] || NFF_THEMES_BY_AGE['8-9'];

    // Theme pills
    let themesHtml = '<div class="wo-gen-label">\u00d8ktens tema</div><div class="wo-gen-themes">';
    for (const themeId of availableThemes) {
      const t = NFF_THEME_BY_ID[themeId];
      if (!t) continue;
      const sel = _gen.selectedTheme === themeId ? ' wo-gen-pill-sel' : '';
      themesHtml += '<button type="button" class="wo-gen-pill' + sel + '" data-theme="' + themeId + '">' +
        escapeHtml(t.icon) + ' ' + escapeHtml(t.label) + '</button>';
    }
    themesHtml += '</div>';

    // Learning goals (shown when theme selected)
    let goalsHtml = '';
    if (_gen.selectedTheme) {
      const goals = getLearningGoals(_gen.selectedTheme, _gen.selectedAge);
      if (goals.length) {
        goalsHtml = '<div class="wo-gen-goals">' +
          '<div class="wo-gen-goals-title">\uD83C\uDFAF L\u00e6ringsm\u00e5l</div>' +
          goals.map(g => '<div class="wo-gen-goal">' + escapeHtml(g) + '</div>').join('') +
        '</div>';
      }
    }

    // Age selector
    let ageHtml = '<div class="wo-gen-label">\u00c5rsklasse</div><div class="wo-gen-ages">';
    for (const age of ['6-7', '8-9', '10-12', '13-16']) {
      const sel = _gen.selectedAge === age ? ' wo-gen-pill-sel' : '';
      ageHtml += '<button type="button" class="wo-gen-pill' + sel + '" data-age="' + age + '">' + age + ' \u00e5r</button>';
    }
    ageHtml += '</div>';

    // Duration selector
    let durHtml = '<div class="wo-gen-label">Varighet</div><div class="wo-gen-durations">';
    for (const dur of [45, 60, 75, 90]) {
      const sel = _gen.selectedDuration === dur ? ' wo-gen-pill-sel' : '';
      durHtml += '<button type="button" class="wo-gen-pill' + sel + '" data-dur="' + dur + '">' + dur + ' min</button>';
    }
    durHtml += '</div>';

    // Quick templates for selected age
    const templates = NFF_TEMPLATES[_gen.selectedAge] || [];
    let tplHtml = '';
    if (templates.length) {
      tplHtml = '<div class="wo-gen-label">Ferdige \u00f8ktmaler</div><div class="wo-gen-themes">';
      templates.forEach((tpl, idx) => {
        tplHtml += '<button type="button" class="wo-gen-pill" data-tpl="' + idx + '">\uD83D\uDCCB ' + escapeHtml(tpl.title) + '</button>';
      });
      tplHtml += '</div>';
    }

    el.innerHTML =
      ageHtml +
      tplHtml +
      '<div style="border-top:1px solid var(--border, #e2e8f0);margin:12px 0;padding-top:10px;"><div class="wo-gen-label" style="opacity:0.6;font-size:12px;">...eller bygg selv:</div></div>' +
      themesHtml +
      goalsHtml +
      durHtml +
      '<button type="button" class="wo-gen-submit" id="woGenSubmit"' +
        (_gen.selectedTheme ? '' : ' disabled') + '>' +
        'Generer trenings\u00f8kt \u2192' +
      '</button>';

    // Bind theme pills
    el.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        _gen.selectedTheme = btn.dataset.theme === _gen.selectedTheme ? null : btn.dataset.theme;
        renderGenererFlow();
      });
    });

    // Bind age pills
    el.querySelectorAll('[data-age]').forEach(btn => {
      btn.addEventListener('click', () => {
        _gen.selectedAge = btn.dataset.age;
        _gen.selectedTheme = null; // reset theme since available themes change
        renderGenererFlow();
      });
    });

    // Bind template pills
    el.querySelectorAll('[data-tpl]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpls = NFF_TEMPLATES[_gen.selectedAge] || [];
        const tpl = tpls[parseInt(btn.dataset.tpl, 10)];
        if (!tpl) return;
        loadTemplate(tpl);
        _gen.open = false;
        renderGenererFlow();
      });
    });

    // Bind duration pills
    el.querySelectorAll('[data-dur]').forEach(btn => {
      btn.addEventListener('click', () => {
        _gen.selectedDuration = parseInt(btn.dataset.dur, 10);
        renderGenererFlow();
      });
    });

    // Bind generate button
    const submit = $('woGenSubmit');
    if (submit) {
      submit.addEventListener('click', () => {
        generateNffWorkout(_gen.selectedTheme, _gen.selectedDuration, _gen.selectedAge);
        _gen.open = false;
        renderGenererFlow();
      });
    }
  }

  /** Toggle generer-flow panel */
  function toggleGenererFlow() {
    _gen.open = !_gen.open;
    renderGenererFlow();

    // Update CTA button state
    const btn = $('woGenererBtn');
    if (btn) {
      btn.classList.toggle('wo-gen-cta-open', _gen.open);
    }
  }

  /**
   * NFF-aware workout generator.
   * Builds a complete workout based on theme, duration, and age group.
   */
  function generateNffWorkout(themeId, durationMin, ageGroup) {
    const dist = NFF_TIME_DISTRIBUTION[ageGroup] || NFF_TIME_DISTRIBUTION['8-9'];
    const drinkMin = 2;
    const available = durationMin - drinkMin;
    const is1316 = ageGroup === '13-16';

    // Calculate minutes per category
    const catMinutes = {};
    let totalPct = 0;
    for (const [cat, pct] of Object.entries(dist)) {
      totalPct += pct;
    }
    for (const [cat, pct] of Object.entries(dist)) {
      catMinutes[cat] = Math.round((pct / totalPct) * available);
    }

    // Find exercises for each category, preferring those matching the theme
    function pickExercise(nffCatId, excludeKeys, preferKey) {
      const candidates = EXERCISES.filter(ex =>
        ex.category !== 'special' &&
        ex.nffCategory === nffCatId &&
        !excludeKeys.has(ex.key) &&
        (!ex.ages || ex.ages.includes(ageGroup))
      );

      // If a specific key is preferred (e.g. 'prepp' for 13-16 oppvarming)
      if (preferKey) {
        const preferred = candidates.find(ex => ex.key === preferKey);
        if (preferred) return preferred;
      }

      // Prefer theme-matching exercises
      const themed = candidates.filter(ex => ex.themes && ex.themes.includes(themeId));
      if (themed.length > 0) return themed[Math.floor(Math.random() * themed.length)];
      if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
      return null;
    }

    const blocks = [];
    const usedKeys = new Set();

    // Category order differs for 13-16 (Prepp → Situasjonsøving → Scoring → Spill)
    // Same categories, but sjef=Prepp, med/mot=Situasjonsøving, spill=Spill
    const categoryOrder = ['sjef_over_ballen', 'spille_med_og_mot', 'scoringstrening', 'smalagsspill'];

    for (const catId of categoryOrder) {
      let remaining = catMinutes[catId] || 0;
      if (remaining <= 0) continue;

      // For 13-16 sjef_over_ballen: prefer 'prepp' exercise
      const preferKey = (is1316 && catId === 'sjef_over_ballen') ? 'prepp' : null;

      // For large allocations, try to pick 2 exercises
      const numExercises = remaining >= 20 ? 2 : 1;
      const perExercise = Math.round(remaining / numExercises);

      for (let i = 0; i < numExercises; i++) {
        const ex = pickExercise(catId, usedKeys, i === 0 ? preferKey : null);
        if (!ex) break;
        usedKeys.add(ex.key);

        const b = makeBlock('single');
        b.a.exerciseKey = ex.key;
        b.a.minutes = i === numExercises - 1 ? (remaining - perExercise * i) : perExercise;
        blocks.push(b);
      }

      // Insert drikkepause after spille_med_og_mot
      if (catId === 'spille_med_og_mot') {
        const drink = makeBlock('single');
        drink.a.exerciseKey = 'drink';
        drink.a.minutes = drinkMin;
        blocks.push(drink);
      }
    }

    // Fallback: if no blocks generated, use old SUGGESTIONS
    if (blocks.length < 2) {
      suggestWorkoutLegacy();
      return;
    }

    state.blocks = blocks;
    state.groupsCache.clear();
    state.parallelPickB.clear();
    state.expandedBlockId = null;
    state.theme = themeId;
    state.ageGroup = ageGroup;

    renderBlocks();
    if (typeof window.showNotification === 'function') {
      const themeMeta = NFF_THEME_BY_ID[themeId];
      window.showNotification(
        (themeMeta ? themeMeta.label : 'Trenings\u00f8kt') + ' (' + durationMin + ' min) generert \u2013 juster fritt',
        'success'
      );
    }
  }

  /** Legacy suggest (fallback from old SUGGESTIONS array) */
  function suggestWorkoutLegacy() {
    const idx = Math.floor(Math.random() * SUGGESTIONS.length);
    const tpl = SUGGESTIONS[idx];
    loadTemplate({ blocks: tpl.map(s => s.parallel ? s : { key: s.key, min: s.min }), title: 'Forslag' });
  }

  /** Load a pre-built template into the editor */
  function loadTemplate(tpl) {
    const blocks = [];
    for (const step of tpl.blocks) {
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
    state.expandedBlockId = null;
    if (tpl.theme) state.theme = tpl.theme;
    if (_gen.selectedAge) state.ageGroup = _gen.selectedAge;

    renderBlocks();
    if (typeof window.showNotification === 'function') {
      window.showNotification((tpl.title || '\u00d8ktmal') + ' lastet inn \u2013 juster fritt', 'success');
    }
  }

  // Keep old name for backward compat (button binding)
  function suggestWorkout() {
    // If generer-flow is available, toggle it open instead of random generation
    if ($('woGenererPanel')) {
      toggleGenererFlow();
    } else {
      suggestWorkoutLegacy();
    }
  }

  // -------------------------
  // Export (HTML print -> PDF)
  // -------------------------
  function exportWorkout() {
    const date = String($('woDate')?.value || '').trim();
    const title = String($('woTitle')?.value || '').trim() || (date ? `Trening ${date}` : 'Treningsøkt');
    const total = totalMinutes();
    const includeExInfo = !!($('woExportDetailToggle')?.checked);

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

    // Build table rows with NFF section headers and accumulated minutes
    let prevNffCat = null;
    let accumMin = 0;
    const blocksHtml = state.blocks.map((b, idx) => {
      const isPar = b.kind === 'parallel';
      const minutesA = clampInt(b.a?.minutes, 0, 300, 0);
      const minutesB = isPar ? clampInt(b.b?.minutes, 0, 300, 0) : 0;
      const blockMin = isPar ? Math.max(minutesA, minutesB) : minutesA;
      accumMin += blockMin;

      // NFF section header row
      const metaA = EX_BY_KEY.get(b.a?.exerciseKey);
      const curNffCat = (metaA && metaA.nffCategory !== 'pause') ? metaA.nffCategory : null;
      let sectionRow = '';
      if (curNffCat && curNffCat !== prevNffCat) {
        const catObj = NFF_CATEGORY_BY_ID[curNffCat];
        if (catObj) {
          sectionRow = '<tr class="exp-nff-section"><td colspan="4" style="border-left:3px solid ' + catObj.color + ';padding:6px 12px;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.04em;color:' + catObj.color + ';background:#f9fafb;">' + escapeHtml(catLabel(catObj, state.ageGroup)) + '</td></tr>';
        }
      }
      if (curNffCat) prevNffCat = curNffCat;

      const exAName = displayName(b.a);
      const exBName = isPar ? displayName(b.b) : '';

      const commentA = String(b.a?.comment || '').trim();
      const commentB = isPar ? String(b.b?.comment || '').trim() : '';

      const groupsA = renderGroupLists(b, 'a');
      const groupsB = isPar ? renderGroupLists(b, 'b') : '';

      function renderExInfo(ex) {
        if (!includeExInfo) return '';
        const meta = EX_BY_KEY.get(ex?.exerciseKey);
        if (!meta || !meta.description) return '';
        let info = '';
        info += '<div class="exp-description">' + escapeHtml(meta.description) + '</div>';
        if (meta.equipment) {
          info += '<div class="exp-coaching" style="margin-top:4px;"><span class="exp-coaching-h">Utstyr:</span> ' + escapeHtml(meta.equipment) + '</div>';
        }
        if (meta.setup) {
          info += '<div class="exp-coaching" style="margin-top:4px;"><span class="exp-coaching-h">Oppsett:</span> ' + escapeHtml(meta.setup) + '</div>';
        }
        if (meta.steps && meta.steps.length) {
          info += '<div style="margin-top:4px;"><span class="exp-coaching-h">Gjennomføring:</span><ol style="margin:2px 0 0 16px;padding:0;font-size:12px;line-height:1.5;color:var(--muted);">';
          for (const s of meta.steps) info += '<li>' + escapeHtml(s) + '</li>';
          info += '</ol></div>';
        }
        if (meta.coaching && meta.coaching.length) {
          info += '<div class="exp-coaching"><span class="exp-coaching-h">Tips:</span> ' + meta.coaching.map(c => escapeHtml(c)).join(' \u00b7 ') + '</div>';
        }
        if (meta.diagram) {
          info += '<div class="exp-svg">' + renderDrillSVG(meta.diagram) + '</div>';
        }
        return info;
      }

      const infoA = renderExInfo(b.a);
      const infoB = isPar ? renderExInfo(b.b) : '';

      if (!isPar) {
        return `
          ${sectionRow}
          <tr>
            <td class="exp-col-idx">${idx + 1}</td>
            <td class="exp-col-ex">
              <div class="exp-ex-name">${escapeHtml(exAName)}</div>
              ${infoA}
              ${commentA ? `<div class="exp-comment">${escapeHtml(commentA)}</div>` : ''}
              ${groupsA}
            </td>
            <td class="exp-col-min">${blockMin}</td>
            <td class="exp-col-acc">${accumMin}'</td>
          </tr>
        `;
      }

      return `
        ${sectionRow}
        <tr>
          <td class="exp-col-idx">${idx + 1}</td>
          <td class="exp-col-ex">
            <div class="exp-parallel">
              <div class="exp-par">
                <div class="exp-par-h">Øvelse A</div>
                <div class="exp-ex-name">${escapeHtml(exAName)} <span class="exp-mini">(${minutesA} min)</span></div>
                ${infoA}
                ${commentA ? `<div class="exp-comment">${escapeHtml(commentA)}</div>` : ''}
                ${groupsA}
              </div>
              <div class="exp-par">
                <div class="exp-par-h">Øvelse B (parallelt)</div>
                <div class="exp-ex-name">${escapeHtml(exBName)} <span class="exp-mini">(${minutesB} min)</span></div>
                ${infoB}
                ${commentB ? `<div class="exp-comment">${escapeHtml(commentB)}</div>` : ''}
                ${groupsB}
              </div>
            </div>
          </td>
          <td class="exp-col-min">${blockMin}</td>
          <td class="exp-col-acc">${accumMin}'</td>
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
      --brand:#456C4B;
      --brand2:#5a8a60;
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
    .logo{width:96px; height:96px; border-radius:14px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden;}
    .logo img{width:96px; height:96px; object-fit:cover;}
    .h-title{font-size:18px; font-weight:700; line-height:1.2;}
    .h-sub{opacity:0.9; font-size:13px; margin-top:2px;}
    .meta{margin-left:auto; text-align:right;}
    .meta .m1{font-weight:500;}
    .meta .m2{opacity:0.9; font-size:13px; margin-top:2px;}
    .card{background:var(--card); border:1px solid var(--line); border-radius:18px; padding:14px; margin-top:12px;}
    table{width:100%; border-collapse:separate; border-spacing:0;}
    th,td{vertical-align:top; padding:10px 10px; border-bottom:1px solid var(--line);}
    th{font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); text-align:left;}
    .exp-col-idx{width:44px; color:var(--muted); font-weight:500;}
    .exp-col-min{width:86px; text-align:right; font-weight:500;}
    .exp-col-acc{width:60px; text-align:right; font-weight:500; color:var(--muted); font-size:12px;}
    .exp-ex-name{font-weight:500; margin-bottom:3px;}
    .exp-mini{font-weight:500; color:var(--muted); font-size:12px;}
    .exp-comment{color:var(--muted); font-size:13px; margin-top:6px; margin-bottom:12px; line-height:1.45;}
    .exp-description{color:#374151; font-size:12.5px; margin-top:4px; margin-bottom:6px; line-height:1.5;}
    .exp-coaching{color:var(--muted); font-size:12px; margin-bottom:8px; line-height:1.5;}
    .exp-coaching-h{font-weight:500; color:#374151;}
    .exp-svg{margin:8px 0; display:flex; justify-content:center;}
    .exp-svg svg{max-width:220px; width:100%; height:auto; background:#3d8b37; border-radius:8px; padding:6px;}
    .exp-parallel{display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:6px;}
    .exp-par{border:1px solid var(--line); border-radius:14px; padding:10px; background:#fff;}
    .exp-par-h{font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-weight:500; margin-bottom:6px;}
    .exp-groups{margin-top:12px; display:flex; flex-direction:column; gap:10px;}
    .exp-groups-h{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:500; margin-bottom:6px; margin-top:4px;}
    .exp-group{background:var(--soft); border:1px solid var(--line); border-left:4px solid rgba(11,91,211,0.35); border-radius:12px; padding:10px;}
    .exp-group-title{font-weight:500; font-size:13px; color:#1a2333; margin-bottom:6px;}
    .exp-group-list{color:var(--muted); font-size:13px; line-height:1.55;}
    .exp-attendance{margin-top:10px; padding-top:10px; border-top:1px dashed var(--line);}
    .exp-att-h{font-weight:500;}
    .exp-att-list{color:var(--muted); font-size:13px; margin-top:6px; line-height:1.45;}
    .actions{display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;}
    .btn{
      border:0; border-radius:12px; padding:10px 12px; font-weight:500;
      background:var(--brand); color:#fff; cursor:pointer;
    }
    .btn.secondary{background:#1f2a3d;}
    .note{color:var(--muted); font-size:12px; margin-top:8px;}
    .guide{margin-top:12px;}
    .guide-title{font-weight:500; font-size:13px; margin-bottom:8px; color:#1a2333;}
    .guide-steps{display:flex; flex-direction:column; gap:6px;}
    .guide-step{display:flex; align-items:center; gap:8px; font-size:13px; color:#374151; padding:8px 10px; background:var(--soft); border-radius:10px; border-left:3px solid var(--brand);}
    .step-num{background:var(--brand); color:#fff; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:500; flex-shrink:0;}
    .step-icon{font-size:16px;}
    .footer{text-align:center; margin-top:20px; font-size:11px; color:var(--muted); padding:10px 0; border-top:1px solid var(--line);}
    tr{page-break-inside:avoid;}
    @media (max-width:720px){
      .exp-parallel{grid-template-columns:1fr;}
      .meta{display:none;}
      th:nth-child(1),td:nth-child(1){display:none;}
      th:nth-child(4),td:nth-child(4),.exp-col-acc{display:none;}
      .exp-col-min{width:70px;}
    }
    @media print{
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body{background:#fff;}
      .wrap{max-width:none; padding:0;}
      .actions,.note,.guide{display:none !important;}
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
        <div class="h-sub">${date ? `Dato: ${escapeHtml(date)} \u00b7 ` : ''}Total tid: ${total} min${state.ageGroup ? ` \u00b7 ${escapeHtml(state.ageGroup)} \u00e5r` : ''}</div>
        ${(() => {
          if (!state.theme) return '';
          const tm = NFF_THEME_BY_ID[state.theme];
          if (!tm) return '';
          let s = '<div class="h-sub" style="margin-top:4px;">Tema: <strong>' + escapeHtml(tm.label) + '</strong></div>';
          const goals = getLearningGoals(state.theme, state.ageGroup || '8-9');
          if (goals.length) {
            s += '<div class="h-sub" style="margin-top:2px;font-size:11px;opacity:0.8;">' + goals.map(g => escapeHtml(g)).join(' \u00b7 ') + '</div>';
          }
          return s;
        })()}
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
            <th>\u00d8velse</th>
            <th style="text-align:right;">Min</th>
            <th style="text-align:right;">Akk.</th>
          </tr>
        </thead>
        <tbody>
          ${blocksHtml}
        </tbody>
      </table>
      ${attendanceHtml}
    </div>

    ${(() => {
      // NFF balance bar for PDF
      const bal = calculateNffBalance(state.blocks, state.ageGroup || '8-9');
      if (bal.totalMinutes <= 0) return '';
      let s = '<div class="card" style="margin-top:12px;padding:12px 16px;">';
      s += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:500;margin-bottom:8px;">NFF-fordeling</div>';
      s += '<div style="display:flex;gap:6px;height:28px;">';
      for (const cat of NFF_CATEGORIES) {
        const b = bal.balance[cat.id];
        if (!b) continue;
        const pct = bal.totalMinutes > 0 ? Math.max(5, Math.round((b.minutes / bal.totalMinutes) * 100)) : 0;
        s += '<div style="flex:' + pct + ';background:' + cat.color + '20;border-left:3px solid ' + cat.color + ';border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:500;color:' + cat.color + ';">' + b.minutes + 'm</div>';
      }
      s += '</div></div>';
      return s;
    })()}

    <div class="card" style="text-align:center; margin-top:16px; padding:12px;">
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:500;">Oppsummering</div>
      <div style="font-size:1.5rem; font-weight:500; margin-top:4px;">Total tid: ${totalMinutes()} min</div>
    </div>

    <div class="actions">
      <button class="btn" onclick="window.print()">Lagre som PDF</button>
      <button class="btn secondary" onclick="window.close()">Lukk</button>
    </div>
    <div class="guide" id="saveGuide"></div>
    <script>
    (function(){
      var ua = navigator.userAgent;
      var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
      var isAndroid = /Android/i.test(ua);
      var g = document.getElementById('saveGuide');
      if (!g) return;
      if (isIOS) {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF på iPhone/iPad</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Trykk på <b>Del-ikonet</b> <span class="step-icon">↑</span> øverst i Valg-dialogen</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Velg <b>Arkiver i Filer</b> for å lagre PDF-en</div>' +
          '</div>';
      } else if (isAndroid) {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF på Android</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Velg <b>Lagre som PDF</b> som skriver</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Trykk på den gule <b>Last ned</b>-knappen</div>' +
          '</div>';
      } else {
        g.innerHTML =
          '<div class="guide-title">Slik lagrer du som PDF</div>' +
          '<div class="guide-steps">' +
          '<div class="guide-step"><span class="step-num">1</span> Trykk på <b>Lagre som PDF</b>-knappen over</div>' +
          '<div class="guide-step"><span class="step-num">2</span> Velg <b>Lagre som PDF</b> i stedet for en skriver</div>' +
          '<div class="guide-step"><span class="step-num">3</span> Klikk <b>Lagre</b></div>' +
          '</div>';
      }
    })();
    </script>
    <div class="footer">Laget med Barnefotballtrener.no</div>
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
      theme: state.theme || null,
      ageGroup: state.ageGroup || null,
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
    if (draft.theme) state.theme = draft.theme;
    if (draft.ageGroup) state.ageGroup = draft.ageGroup;

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
        return { id: bid, kind: 'parallel', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }), b: migrateExerciseObj({ ...makeDefaultExercise(), ...b.b }), _showPickB: false };
      }
      return { id: bid, kind: 'single', a: migrateExerciseObj({ ...makeDefaultExercise(), ...b.a }) };
    });

    return true;
  }

  // =========================================================
  // Help dialogs for Del / Importer
  // =========================================================

  function _woShowHelpDialog(type) {
    // Remove any existing dialog
    const existing = document.querySelector('.wo-help-dialog');
    if (existing) existing.remove();

    const actionsEl = document.querySelector('.wo-actions');
    if (!actionsEl) return;

    const dialog = document.createElement('div');
    dialog.className = 'wo-help-dialog';

    if (type === 'share') {
      dialog.innerHTML =
        '<strong><i class="fas fa-share-from-square" style="margin-right:6px;color:#456C4B;"></i>Del \u00f8kta med medtrener</strong>' +
        '<div>Sender \u00f8kta som en \u00f8ktfil (.json) som medtreneren kan importere i sin egen app.</div>' +
        '<ol>' +
          '<li>Trykk <b>Send \u00f8ktfil</b> under</li>' +
          '<li>Velg SMS, e-post, AirDrop eller annen delingsm\u00e5te</li>' +
          '<li>Medtreneren \u00e5pner filen i Barnefotballtrener og trykker <b>Importer</b></li>' +
        '</ol>' +
        '<div style="font-size:12px;opacity:0.75;margin-top:6px;">\u00d8ktfilen inneholder kun \u00f8velser og tider, ikke spillere. Medtreneren velger egne spillere etter import.</div>' +
        '<div class="wo-help-actions">' +
          '<button class="wo-help-cancel" type="button">Avbryt</button>' +
          '<button class="wo-help-go" type="button"><i class="fas fa-share-from-square" style="margin-right:5px;"></i>Send \u00f8ktfil</button>' +
        '</div>';

      actionsEl.after(dialog);

      dialog.querySelector('.wo-help-cancel').addEventListener('click', () => dialog.remove());
      dialog.querySelector('.wo-help-go').addEventListener('click', () => {
        dialog.remove();
        // Use Web Share if available, otherwise download
        if (navigator.share) {
          shareWorkoutFile();
        } else {
          downloadWorkoutFile();
        }
      });

    } else if (type === 'import') {
      dialog.innerHTML =
        '<strong><i class="fas fa-file-import" style="margin-right:6px;color:#456C4B;"></i>Importer \u00f8kt fra medtrener</strong>' +
        '<div>Har du f\u00e5tt en \u00f8ktfil (.json) fra en medtrener? Importer den her.</div>' +
        '<ol>' +
          '<li>Trykk <b>Velg fil</b> under</li>' +
          '<li>Finn \u00f8ktfilen (.json) du har mottatt</li>' +
          '<li>\u00d8kta lastes inn og du kan justere \u00f8velser og tider</li>' +
        '</ol>' +
        '<div style="font-size:12px;opacity:0.75;margin-top:6px;">Spillere importeres ikke. Velg spillere til \u00f8kta med bryteren over. Husk \u00e5 lagre om du vil ta vare p\u00e5 \u00f8kta.</div>' +
        '<div class="wo-help-actions">' +
          '<button class="wo-help-cancel" type="button">Avbryt</button>' +
          '<button class="wo-help-go" type="button"><i class="fas fa-file-import" style="margin-right:5px;"></i>Velg fil</button>' +
        '</div>';

      actionsEl.after(dialog);

      dialog.querySelector('.wo-help-cancel').addEventListener('click', () => dialog.remove());
      dialog.querySelector('.wo-help-go').addEventListener('click', () => {
        dialog.remove();
        importWorkoutFileFromPicker();
      });
    }
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
    const addBtnBottom = $('woAddExerciseBtnBottom');
    const suggestBtn = $('woSuggestBtn');
    const saveBtn = $('woSaveTemplateBtn');
    const saveWorkoutBtn = $('woSaveWorkoutBtn');
    const exportBtn = $('woExportBtn');
    const dlJsonBtn = $('woDownloadJsonBtn');
    const shareJsonBtn = $('woShareJsonBtn');
    const importJsonBtn = $('woImportJsonBtn');
    const importFile = $('woImportFile');
    const shareBtn = $('woShareBtn');
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
    if (addBtnBottom) addBtnBottom.addEventListener('click', () => addBlock('single'));
    if (suggestBtn) suggestBtn.addEventListener('click', () => suggestWorkout());

    // Generer-flow CTA button
    const genererBtn = $('woGenererBtn');
    if (genererBtn) {
      genererBtn.addEventListener('click', () => toggleGenererFlow());
      // Inject "Ny økt" button inline with generer via flex wrapper
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;gap:8px;align-items:stretch;';
      genererBtn.parentNode.insertBefore(wrapper, genererBtn);
      genererBtn.style.flex = '1';
      wrapper.appendChild(genererBtn);
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn-secondary';
      clearBtn.style.cssText = 'font-size:13px;padding:10px 14px;white-space:nowrap;border-radius:14px;';
      clearBtn.textContent = '\uD83D\uDDD1\ufe0f Ny';
      clearBtn.title = 'T\u00f8m alle \u00f8velser og start p\u00e5 nytt';
      clearBtn.addEventListener('click', clearSession);
      wrapper.appendChild(clearBtn);
    }
    if (saveBtn) saveBtn.addEventListener('click', () => saveTemplate());
    if (saveWorkoutBtn) saveWorkoutBtn.addEventListener('click', () => saveWorkout());
    if (exportBtn) exportBtn.addEventListener('click', () => exportWorkout());

    // Legacy hidden buttons (keep for backward compat)
    if (dlJsonBtn) dlJsonBtn.addEventListener('click', () => downloadWorkoutFile());
    if (shareJsonBtn) shareJsonBtn.addEventListener('click', () => shareWorkoutFile());

    // "Del med medtrener" — show help dialog first
    if (shareBtn) shareBtn.addEventListener('click', () => {
      _woShowHelpDialog('share');
    });

    // "Importer øktfil" — show help dialog first
    if (importJsonBtn) importJsonBtn.addEventListener('click', () => {
      _woShowHelpDialog('import');
    });
    if (importFile) importFile.addEventListener('change', handleWorkoutFileInputChange);

    // "Mer" dropdown toggle (opens downward)
    const moreBtn = $('woMoreBtn');
    const moreMenu = $('woMoreMenu');
    if (moreBtn && moreMenu) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = moreMenu.style.display === 'block';
        moreMenu.style.display = isOpen ? 'none' : 'block';
      });
      document.addEventListener('click', () => {
        if (moreMenu) moreMenu.style.display = 'none';
      });
      moreMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

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

    // Pre-populate cache from localStorage for instant first render
    // (Supabase overwrites later when loadWorkoutCloudData completes)
    if (!_woCache.loaded) {
      const lsTpl = loadStore().data.templates || [];
      const lsWo = loadWorkoutsStore().data.workouts || [];
      if (lsTpl.length || lsWo.length) {
        _woCache.templates = lsTpl.map(t => ({
          id: t.id, title: t.title, blocks: t.blocks, is_template: true,
          created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
          updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
          _local: true  // flag: not yet in Supabase, disable delete/rename
        }));
        _woCache.workouts = lsWo.map(w => ({
          id: w.id, title: w.title, workout_date: w.date || null, blocks: w.blocks, is_template: false,
          created_at: w.createdAt ? new Date(w.createdAt).toISOString() : null,
          updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
          _local: true
        }));
      }
    }

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

    // Re-render team-scoped storage when team changes
    window.addEventListener('team:changed', function(e) {
      try {
        console.log('[workout.js] team:changed', e && e.detail ? e.detail.teamId : '');
        state.groupsCache.clear();
        state.eventId = null;
        state.seasonId = null;

        // Clear cache and pre-populate from new team's localStorage
        _woCache.templates = [];
        _woCache.workouts = [];
        _woCache.loaded = false;
        var lsTpl = loadStore().data.templates || [];
        var lsWo = loadWorkoutsStore().data.workouts || [];
        if (lsTpl.length || lsWo.length) {
          _woCache.templates = lsTpl.map(function(t) {
            return { id: t.id, title: t.title, blocks: t.blocks, is_template: true,
              created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
              updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
              _local: true };
          });
          _woCache.workouts = lsWo.map(function(w) {
            return { id: w.id, title: w.title, workout_date: w.date || null, blocks: w.blocks, is_template: false,
              created_at: w.createdAt ? new Date(w.createdAt).toISOString() : null,
              updated_at: w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
              _local: true };
          });
        }

        renderTemplates();
        renderWorkouts();
        restoreDraftIfAny();
        renderPlayersPanel();
        renderBlocks();

        // Last data fra Supabase for nytt lag (migrerer + laster)
        loadWorkoutCloudData();
      } catch (err) {
        console.warn('[workout.js] team:changed handler feilet:', err && err.message ? err.message : err);
      }
    });

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

          // Last cloud-data for treningsøkter
          loadWorkoutCloudData();
        } else if (attempts >= 40) {
          // 40 × 150ms = 6s — give up, auth likely stuck or user is genuinely anon
          clearInterval(timer);
        }
      }, 150);
    })();
  }

  // Load workouts from Supabase (replaces old user_data cloud sync)
  async function loadWorkoutCloudData() {
    try {
      await _woMigrateToDb();
      await _woLoadFromDb();
      await _woLoadFavoritesFromDb();
    } catch (e) {
      console.warn('[workout.js] loadWorkoutCloudData feilet:', e.message || e);
    }
  }

  // =========================================================
  // SESONG-INTEGRASJON: workoutPrefill bridge
  // =========================================================

  /**
   * Pre-fill workout editor from a season training event.
   * Called by season.js when user clicks "Planlegg treningsøkt".
   */
  window.workoutPrefill = function(opts) {
    if (!opts) return;
    console.log('[workout.js] workoutPrefill:', opts.eventId || 'standalone');

    // Set date
    const dateEl = $('woDate');
    if (dateEl && opts.date) dateEl.value = opts.date;

    // Set title
    const titleEl = $('woTitle');
    if (titleEl && opts.title) titleEl.value = opts.title;

    // Set session metadata
    state.ageGroup = opts.ageGroup || state.ageGroup;
    state.theme = opts.theme || null;
    state.eventId = opts.eventId || null;
    state.seasonId = opts.seasonId || null;

    // Set player attendance if provided
    if (opts.playerIds && Array.isArray(opts.playerIds)) {
      state.usePlayers = true;
      state.selected = new Set(opts.playerIds);
      const toggle = $('woUsePlayersToggle');
      if (toggle) toggle.checked = true;
      renderPlayersPanel();
    }

    // If existing workout for this event, load it
    if (opts.eventId && _woCache.loaded) {
      const existing = _woCache.workouts.find(w => w.event_id === opts.eventId);
      if (existing) {
        applyWorkoutToState(existing);
        if (typeof window.showNotification === 'function') {
          window.showNotification('Eksisterende \u00f8kt lastet inn', 'info');
        }
        return;
      }
    }

    // If duration provided, set up generer-flow defaults
    if (opts.duration) {
      _gen.selectedDuration = opts.duration;
    }

    // Render fresh state
    updateTotalUI();
    renderBlocks();
    persistDraft();
  };

  document.addEventListener('DOMContentLoaded', initIfPresent);

  // =========================================================
  // SHARED API: Exposed for sesong-workout.js embedding
  // =========================================================

  /**
   * Open the exercise picker (bottom sheet) from an external context.
   * ctxOverride = { ageGroup, blocks } — sesong-workout.js passes its own state.
   */
  function openExercisePicker(onSelect, ctxOverride) {
    _bs.ctxOverride = ctxOverride || null;
    // Re-render pills with the overridden age group
    if (_bs.el) _bsRenderPills();
    openBottomSheet('__ext__', 'a', function(key) {
      _bs.ctxOverride = null;
      onSelect(key);
    });
  }

  window._woShared = {
    EXERCISES: EXERCISES,
    EX_BY_KEY: EX_BY_KEY,
    NFF_CATEGORIES: NFF_CATEGORIES,
    NFF_CATEGORY_BY_ID: NFF_CATEGORY_BY_ID,
    NFF_THEMES: NFF_THEMES,
    NFF_THEME_BY_ID: NFF_THEME_BY_ID,
    NFF_THEMES_BY_AGE: NFF_THEMES_BY_AGE,
    NFF_TIME_DISTRIBUTION: NFF_TIME_DISTRIBUTION,
    NFF_LEARNING_GOALS: NFF_LEARNING_GOALS,
    NFF_TEMPLATES: NFF_TEMPLATES,
    renderDrillSVG: renderDrillSVG,
    catLabel: catLabel,
    catShort: catShort,
    getLearningGoals: getLearningGoals,
    calculateNffBalance: calculateNffBalance,
    escapeHtml: escapeHtml,
    // Extended API for sesong-workout.js
    openExercisePicker: openExercisePicker,
    renderExerciseTrigger: renderExerciseTrigger,
    renderInfoPanel: renderInfoPanel,
    displayName: displayName,
    saveWorkoutToDb: _woSaveToDb,
    clampInt: clampInt,
  };

})();
