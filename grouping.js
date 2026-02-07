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
  function makeBalancedGroups(players, groupCount, useSkill) {
    const n = clampInt(groupCount, 2, 6, 2);
    const list = useSkill ? sortBySkillWithRandomTies(players) : shuffle(players);

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

  // Differensierte grupper: "beste sammen, neste beste sammen ..."
  // Krever useSkill=true for å gi mening.
  function makeDifferentiatedGroups(players, groupCount, useSkill) {
    const n = clampInt(groupCount, 2, 6, 2);
    if (!useSkill) return null;

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

  // 2..6 lag. Fordeler keepere først, deretter snake-draft.
  function makeEvenTeams(players, teamCount, useSkill) {
    const n = clampInt(teamCount, 2, 6, 2);
    const list = useSkill ? sortBySkillWithRandomTies(players) : shuffle(players);

    const goalies = list.filter(p => p?.goalie);
    const field = list.filter(p => !p?.goalie);

    const teams = Array.from({ length: n }, () => ({ players: [], sum: 0 }));

    // fordel keepere først (så jevnt som mulig)
    for (let i = 0; i < goalies.length; i++) {
      const t = teams[i % n];
      t.players.push(goalies[i]);
      t.sum += (Number(goalies[i]?.skill) || 0);
    }

    // snake draft for resten
    let dir = 1;
    let idx2 = 0;
    for (const p of field) {
      const t = teams[idx2];
      t.players.push(p);
      t.sum += (Number(p?.skill) || 0);

      idx2 += dir;
      if (idx2 === n) { dir = -1; idx2 = n - 1; }
      if (idx2 === -1) { dir = 1; idx2 = 0; }
    }

    return { teams };
  }

  window.Grouping = window.Grouping || {};
  window.Grouping.makeBalancedGroups = makeBalancedGroups;
  window.Grouping.makeDifferentiatedGroups = makeDifferentiatedGroups;
  window.Grouping.makeEvenTeams = makeEvenTeams;
})();
