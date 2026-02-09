// © 2026 Barnefotballtrener.no. All rights reserved.
// grouping.js — shared group/teams algorithms (single source of truth)
// Used by: core.js (Treningsgrupper/Laginndeling) + workout.js (Bygg din treningsøkt)
// Design: pure functions (no app state), caller passes useSkill boolean.
//
// NOTE: Keep this file small and dependency-free.

(() => {
  'use strict';

  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
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
      const k = Number(p?.skill) || 0;
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

  // Jevne grupper: snake-draft for nivå-balanse hvis useSkill=true, ellers tilfeldig.
  // Randomiserer gruppe-tilordning via permutasjon slik at "Gruppe 1" ikke alltid får samme posisjon i draften.
  function makeBalancedGroups(players, groupCount, useSkill) {
    const n = clampInt(groupCount, 2, 6, 2);
    const list = useSkill ? sortBySkillWithRandomTies(players) : shuffle(players);

    const groups = Array.from({ length: n }, () => []);
    // Randomisert permutasjon: snake-draft bruker standard 0,1,...n-1 rekkefølge,
    // men resultatet mappes til tilfeldig rekkefølge av grupper
    const perm = shuffle(Array.from({ length: n }, (_, i) => i));
    let dir = 1;
    let idx = 0;
    for (const p of list) {
      groups[perm[idx]].push(p);
      idx += dir;
      if (idx === n) { dir = -1; idx = n - 1; }
      if (idx === -1) { dir = 1; idx = 0; }
    }
    return groups;
  }

  // Differensierte grupper: "beste sammen, neste beste sammen ..."
  // Krever useSkill=true for å gi mening.
  // Randomiserer hvilke grupper som får ekstra spiller (ikke alltid de første).
  function makeDifferentiatedGroups(players, groupCount, useSkill) {
    const n = clampInt(groupCount, 2, 6, 2);
    if (!useSkill) return null;

    const list = sortBySkillWithRandomTies(players);
    const total = list.length;

    const base = Math.floor(total / n);
    const extra = total % n; // "extra" grupper får +1
    // Randomiser hvilke grupper som får ekstra spiller
    const indices = Array.from({ length: n }, (_, i) => i);
    const shuffledIndices = shuffle(indices);
    const bonusSet = new Set(shuffledIndices.slice(0, extra));
    const sizes = Array.from({ length: n }, (_, i) => base + (bonusSet.has(i) ? 1 : 0));

    const groups = [];
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const size = sizes[i];
      groups.push(list.slice(cursor, cursor + size));
      cursor += size;
    }
    return groups;
  }

  // 2..6 lag. Alle spillere i snake-draft (inkl keepere for bedre nivåbalanse).
  // Post-draft: myk korreksjon — hvis et lag mangler keeper, bytt én utespiller.
  function makeEvenTeams(players, teamCount, useSkill) {
    const n = clampInt(teamCount, 2, 6, 2);
    const list = useSkill ? sortBySkillWithRandomTies(players) : shuffle(players);

    const teams = Array.from({ length: n }, () => ({ players: [], sum: 0 }));

    // Snake draft med permutasjon for variasjon
    const perm = shuffle(Array.from({ length: n }, (_, i) => i));
    let dir = 1;
    let idx = 0;
    for (const p of list) {
      const t = teams[perm[idx]];
      t.players.push(p);
      t.sum += (Number(p?.skill) || 0);

      idx += dir;
      if (idx === n) { dir = -1; idx = n - 1; }
      if (idx === -1) { dir = 1; idx = 0; }
    }

    // Post-draft keeper-korreksjon: sjekk om noen lag mangler keeper
    const totalKeepers = list.filter(p => p?.goalie).length;
    if (totalKeepers > 0 && totalKeepers < list.length) {
      // Finn lag uten keeper og lag med 2+ keepere
      for (let attempt = 0; attempt < n; attempt++) {
        const noKeeper = teams.findIndex(t => t.players.length > 0 && !t.players.some(p => p?.goalie));
        if (noKeeper === -1) break; // alle lag har keeper

        const multiKeeper = teams.findIndex(t => t.players.filter(p => p?.goalie).length >= 2);
        if (multiKeeper === -1) break; // ingen lag har 2+

        // Bytt en keeper fra multiKeeper med en utespiller fra noKeeper
        const keeperIdx = teams[multiKeeper].players.findIndex(p => p?.goalie);
        const fieldIdx = teams[noKeeper].players.findIndex(p => !p?.goalie);
        if (keeperIdx === -1 || fieldIdx === -1) break;

        const keeper = teams[multiKeeper].players[keeperIdx];
        const field = teams[noKeeper].players[fieldIdx];

        teams[multiKeeper].players[keeperIdx] = field;
        teams[noKeeper].players[fieldIdx] = keeper;

        // Oppdater sum
        teams[multiKeeper].sum += (Number(field?.skill) || 0) - (Number(keeper?.skill) || 0);
        teams[noKeeper].sum += (Number(keeper?.skill) || 0) - (Number(field?.skill) || 0);
      }
    }

    return { teams };
  }

  window.Grouping = window.Grouping || {};
  window.Grouping.makeBalancedGroups = makeBalancedGroups;
  window.Grouping.makeDifferentiatedGroups = makeDifferentiatedGroups;
  window.Grouping.makeEvenTeams = makeEvenTeams;
})();
