// Â© 2026 Barnefotballtrener.no. All rights reserved.
/* cup-scheduler.js â€” Ren funksjonell schedulermotor for cup/turnering.
   Delt mellom minicup (Liga-fanen) og full cupmodul (/cup).
   Ingen DOM, ingen side-effekter. Kun pure functions.
   
   Eksponert som window.CupScheduler = { ... }
*/

(function () {
  'use strict';

  // =========================================================================
  //  NFF REGELVERK â€” aldersklasse -> spillformat
  // =========================================================================
  const NFF_RULES = {
    '6':  { playFormat: '3v3',  matchMinutes: 20, halfCount: 2, halfMinutes: 10, minPlayers: 3, maxPlayers: 6,  noPlayoffs: true,  noRanking: true  },
    '7':  { playFormat: '3v3',  matchMinutes: 20, halfCount: 2, halfMinutes: 10, minPlayers: 3, maxPlayers: 6,  noPlayoffs: true,  noRanking: true  },
    '8':  { playFormat: '5v5',  matchMinutes: 30, halfCount: 2, halfMinutes: 15, minPlayers: 5, maxPlayers: 10, noPlayoffs: true,  noRanking: true  },
    '9':  { playFormat: '5v5',  matchMinutes: 30, halfCount: 2, halfMinutes: 15, minPlayers: 5, maxPlayers: 10, noPlayoffs: true,  noRanking: true  },
    '10': { playFormat: '5v5',  matchMinutes: 30, halfCount: 2, halfMinutes: 15, minPlayers: 5, maxPlayers: 10, noPlayoffs: true,  noRanking: true  },
    '11': { playFormat: '7v7',  matchMinutes: 30, halfCount: 2, halfMinutes: 15, minPlayers: 7, maxPlayers: 14, noPlayoffs: true,  noRanking: true  },
    '12': { playFormat: '9v9',  matchMinutes: 30, halfCount: 2, halfMinutes: 15, minPlayers: 9, maxPlayers: 16, noPlayoffs: true,  noRanking: true  },
    '13': { playFormat: '11v11', matchMinutes: 60, halfCount: 2, halfMinutes: 30, minPlayers: 11, maxPlayers: 18, noPlayoffs: false, noRanking: false },
    '14': { playFormat: '11v11', matchMinutes: 70, halfCount: 2, halfMinutes: 35, minPlayers: 11, maxPlayers: 18, noPlayoffs: false, noRanking: false },
    '15': { playFormat: '11v11', matchMinutes: 70, halfCount: 2, halfMinutes: 35, minPlayers: 11, maxPlayers: 18, noPlayoffs: false, noRanking: false },
    '16': { playFormat: '11v11', matchMinutes: 80, halfCount: 2, halfMinutes: 40, minPlayers: 11, maxPlayers: 22, noPlayoffs: false, noRanking: false },
  };

  // Cup-tilpassede kamptider (kortere enn serie for aa faa plass til mange kamper)
  const CUP_MATCH_MINUTES = {
    '6': 16, '7': 16,           // 2x8 min
    '8': 20, '9': 20, '10': 20, // 2x10 min
    '11': 25, '12': 25,         // 2x12.5 min (runder opp til 25)
    '13': 40, '14': 50,         // 2x20 / 2x25
    '15': 50, '16': 60,
  };

  /**
   * Hent NFF-regler for en aldersklasse.
   * @param {string|number} age - f.eks. '10' eller 10
   * @returns {object|null}
   */
  function getNffRules(age) {
    const key = String(age);
    return NFF_RULES[key] || null;
  }

  /**
   * Hent anbefalt cupkamptid for en aldersklasse.
   * @param {string|number} age
   * @returns {number} minutter
   */
  function getCupMatchMinutes(age) {
    return CUP_MATCH_MINUTES[String(age)] || 30;
  }


  // =========================================================================
  //  SEEDED PRNG (Mulberry32)
  // =========================================================================
  /**
   * Opprett en deterministisk pseudorandom-generator.
   * @param {number} seed - heltall
   * @returns {function} rng() -> tall mellom 0 og 1
   */
  function createRng(seed) {
    let s = seed | 0;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Fisher-Yates shuffle med seeded rng.
   * Muterer array in-place, returnerer den.
   */
  function shuffleArray(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Generer en tilfeldig seed.
   */
  function randomSeed() {
    return Math.floor(Math.random() * 2147483647) + 1;
  }


  // =========================================================================
  //  STEG 1: KAMPGENERERING (round-robin circle method)
  // =========================================================================
  /**
   * Generer alle kamper for en round-robin-turnering.
   * @param {string[]} teamIds - array med lag-IDer
   * @returns {{ matches: Array<{round, homeId, awayId}>, hasBye: boolean }}
   */
  function generateRoundRobin(teamIds) {
    if (!teamIds || teamIds.length < 2) {
      return { matches: [], hasBye: false };
    }

    const list = [...teamIds];
    let hasBye = false;
    if (list.length % 2 === 1) {
      list.push('__BYE__');
      hasBye = true;
    }

    const n = list.length;
    const totalRounds = n - 1;
    const half = n / 2;
    const matches = [];
    let arr = [...list];

    for (let r = 0; r < totalRounds; r++) {
      for (let i = 0; i < half; i++) {
        const home = arr[i];
        const away = arr[n - 1 - i];
        if (home === '__BYE__' || away === '__BYE__') continue;
        matches.push({
          round: r + 1,
          homeId: home,
          awayId: away,
        });
      }
      // Roter: hold index 0 fast, flytt resten ett hakk
      const fixed = arr[0];
      const rest = arr.slice(1);
      rest.unshift(rest.pop());
      arr = [fixed, ...rest];
    }

    return { matches, hasBye };
  }


  // =========================================================================
  //  STEG 2: SLOT-BYGGING
  // =========================================================================
  /**
   * Parse tidstreng "HH:MM" til minutter fra midnatt.
   */
  function parseTime(str) {
    if (typeof str === 'number') return str;
    const parts = String(str).split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
  }

  /**
   * Formater minutter fra midnatt til "HH:MM".
   */
  function formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  /**
   * Robust tall-parsing: lar 0 vaere gyldig, faller tilbake ved null/undefined/""/NaN.
   */
  function numOrDefault(v, def) {
    if (v === null || v === undefined || v === '') return def;
    var n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  // =========================================================================
  //  FORMAT-HIERARKI OG BANE-KOMPATIBILITET
  // =========================================================================

  var FORMAT_HIERARCHY = ['3v3', '5v5', '7v7', '9v9', '11v11'];

  // Katalog over tillatte oppdelinger per fysisk banestørrelse
  var PITCH_DIVISIONS = {
    '11v11': [
      { label: 'Hel bane (11v11)',          subs: ['11v11'] },
      { label: '2× 7v7',                    subs: ['7v7', '7v7'] },
      { label: '2× 5v5',                    subs: ['5v5', '5v5'] },
      { label: '3× 5v5',                    subs: ['5v5', '5v5', '5v5'] },
      { label: '1× 7v7 + 1× 5v5',           subs: ['7v7', '5v5'] },
      { label: '4× 3v3',                    subs: ['3v3', '3v3', '3v3', '3v3'] },
      { label: '2× 5v5 + 2× 3v3',           subs: ['5v5', '5v5', '3v3', '3v3'] },
      { label: '1× 7v7 + 2× 3v3',           subs: ['7v7', '3v3', '3v3'] },
      { label: '1× 9v9 + 1× 5v5',           subs: ['9v9', '5v5'] },
    ],
    '9v9': [
      { label: 'Hel bane (9v9)',            subs: ['9v9'] },
      { label: '2× 5v5',                    subs: ['5v5', '5v5'] },
      { label: '1× 5v5 + 2× 3v3',           subs: ['5v5', '3v3', '3v3'] },
      { label: '4× 3v3',                    subs: ['3v3', '3v3', '3v3', '3v3'] },
    ],
    '7v7': [
      { label: 'Hel bane (7v7)',            subs: ['7v7'] },
      { label: '2× 5v5',                    subs: ['5v5', '5v5'] },
      { label: '2× 3v3',                    subs: ['3v3', '3v3'] },
    ],
    '5v5': [
      { label: 'Hel bane (5v5)',            subs: ['5v5'] },
      { label: '2× 3v3',                    subs: ['3v3', '3v3'] },
    ],
    '3v3': [
      { label: 'Hel bane (3v3)',            subs: ['3v3'] },
    ],
  };

  function formatIndex(fmt) {
    var i = FORMAT_HIERARCHY.indexOf(fmt);
    return i >= 0 ? i : -1;
  }

  /**
   * Sjekk om en bane er kompatibel med et spillformat.
   * En bane med maxFormat='11v11' kan brukes til alle formater.
   * En bane med maxFormat='5v5' kan brukes til 5v5 og 3v3.
   */
  function isFormatCompatible(pitch, classFormat) {
    if (!pitch || !classFormat) return true; // bakoverkompatibel: ingen data = alt tillatt
    var pitchCap = formatIndex(pitch.maxFormat);
    var classNeed = formatIndex(classFormat);
    if (pitchCap < 0 || classNeed < 0) return true; // ukjent format = tillat
    return classNeed <= pitchCap;
  }

  /**
   * Ekspander fysiske baner til virtuelle baner basert på splits/activeMode.
   * Brukes for bane-deling (statisk konfigurasjon per cup).
   *
   * Eksempel: En 11v11-bane med activeMode='7v7' og splits=[{format:'7v7',count:2}]
   * genererer 2 virtuelle baner: "Bane 1 A" (7v7) og "Bane 1 B" (7v7).
   *
   * Bakoverkompatibel: baner uten splits/activeMode returneres uendret.
   */
  function expandPitches(physicalPitches) {
    var result = [];
    var list = physicalPitches || [];

    function autoName(base, idx) {
      return String(base || 'Bane') + ' ' + String.fromCharCode(65 + idx);
    }

    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var physicalFormat = p.physicalFormat || p.maxFormat || '11v11';
      var subs = Array.isArray(p.subPitches) ? p.subPitches : null;

      // Ny modell: subPitches
      if (subs && subs.length > 0) {
        for (var si = 0; si < subs.length; si++) {
          var sub = subs[si] || {};
          result.push({
            id: sub.id || (p.id ? (p.id + '_' + (si + 1)) : ('pitch_' + i + '_' + (si + 1))),
            name: sub.name || autoName(p.name, si),
            maxFormat: sub.format || physicalFormat,
            parentPitchId: p.id || null,
          });
        }
        continue;
      }

      // Legacy modell: splits/activeMode (fallback hvis migrering ikke er kjørt)
      if (p.splits && p.activeMode) {
        var mode = null;
        for (var li = 0; li < p.splits.length; li++) {
          if (p.splits[li].format === p.activeMode) { mode = p.splits[li]; break; }
        }
        if (mode && mode.count && mode.count > 1) {
          for (var vi = 0; vi < mode.count; vi++) {
            result.push({
              id: (p.id ? (p.id + '_' + (vi + 1)) : ('pitch_' + i + '_' + (vi + 1))),
              name: String(p.name || 'Bane') + ' ' + String.fromCharCode(65 + vi),
              maxFormat: mode.format,
              parentPitchId: p.id || null,
            });
          }
        } else if (mode) {
          result.push({
            id: p.id,
            name: p.name,
            maxFormat: mode.format,
          });
        } else {
          result.push({ id: p.id, name: p.name, maxFormat: physicalFormat });
        }
        continue;
      }

      // Ingen oppdeling: returner som hel bane
      result.push({
        id: p.id,
        name: p.name,
        maxFormat: physicalFormat,
      });
    }
    return result;
  }


  /**
   * Bygg tidsslots filtrert for en spesifikk klasse.
   * Tar hensyn til bane-format-kompatibilitet og tillatte dager.
   * Bevarer original dayIndex fra den globale days-arrayen.
   */
  function buildTimeSlotsForClass(cls, pitches, days) {
    var compatiblePitches = [];
    for (var i = 0; i < (pitches || []).length; i++) {
      if (isFormatCompatible(pitches[i], cls.playFormat)) {
        compatiblePitches.push(pitches[i]);
      }
    }

    var matchMin = numOrDefault(cls.matchMinutes, 20);
    var bufferMin = numOrDefault(cls.bufferMinutes, 5);

    // Bygg slots for ALLE dager (bevarer dayIndex), filtrer etterpaa
    var allSlots = buildTimeSlots(compatiblePitches, days || [], matchMin, bufferMin);

    // Filtrer paa allowedDayIds
    if (cls.allowedDayIds && cls.allowedDayIds.length > 0) {
      var allowedDayIndices = {};
      for (var di = 0; di < (days || []).length; di++) {
        if (days[di].id && cls.allowedDayIds.indexOf(days[di].id) >= 0) {
          allowedDayIndices[di] = true;
        }
      }
      // Hvis ingen dager matchet (stale IDs), behold alle
      var hasAnyMatch = Object.keys(allowedDayIndices).length > 0;
      if (hasAnyMatch) {
        var filtered = [];
        for (var fi = 0; fi < allSlots.length; fi++) {
          if (allowedDayIndices[allSlots[fi].dayIndex]) {
            filtered.push(allSlots[fi]);
          }
        }
        return filtered;
      }
    }

    return allSlots;
  }

  /**
   * Migrer cup-data for bakoverkompatibilitet.
   * Legger til manglende felter (day.id, pitch.maxFormat, class.allowedDayIds, etc.)
   */
  function migrateCupData(cup) {
    if (!cup) return cup;

    // Dager: legg til id hvis mangler
    for (var di = 0; di < (cup.days || []).length; di++) {
      if (!cup.days[di].id) cup.days[di].id = cupUuid();
    }

    // Baner: migrer til ny modell (physicalFormat + subPitches)
    for (var pi = 0; pi < (cup.pitches || []).length; pi++) {
      var p = cup.pitches[pi] || {};
      if (!p.id) p.id = cupUuid();
      if (!p.name) p.name = 'Bane ' + (pi + 1);

      // Bakoverkompat: fysisk format arver fra maxFormat
      if (!p.physicalFormat) {
        p.physicalFormat = p.maxFormat || '11v11';
      }
      // Hold maxFormat synkronisert for eldre UI-logikk
      if (!p.maxFormat) p.maxFormat = p.physicalFormat;

      if (!Array.isArray(p.subPitches)) {
        p.subPitches = [];
      }

      // Konverter legacy splits/activeMode -> subPitches (stabile IDs)
      if (p.splits && p.activeMode && (!p.subPitches || p.subPitches.length === 0)) {
        var mode = null;
        for (var si = 0; si < (p.splits || []).length; si++) {
          if (p.splits[si].format === p.activeMode) { mode = p.splits[si]; break; }
        }
        if (mode && mode.count && mode.count > 1) {
          p.subPitches = [];
          for (var vi = 0; vi < mode.count; vi++) {
            p.subPitches.push({
              id: p.id + '_' + (vi + 1),
              name: String(p.name) + ' ' + String.fromCharCode(65 + vi),
              format: mode.format,
            });
          }
        } else if (mode) {
          // count<=1: behold pitch-id for bakoverkompat
          p.subPitches = [{ id: p.id, name: p.name, format: mode.format }];
        }

        // Rydd opp for å unngå dobbel-modell
        try { delete p.splits; } catch (e) {}
        try { delete p.activeMode; } catch (e2) {}
      }

      // Sikre subPitch-form
      for (var spi = 0; spi < (p.subPitches || []).length; spi++) {
        var sp = p.subPitches[spi] || {};
        if (!sp.id) sp.id = p.id + '_' + (spi + 1);
        if (!sp.name) sp.name = String(p.name) + ' ' + String.fromCharCode(65 + spi);
        if (!sp.format) sp.format = p.physicalFormat;
        p.subPitches[spi] = sp;
      }

      cup.pitches[pi] = p;
    }

    // Klasser: legg til nye felter hvis mangler
    for (var ci = 0; ci < (cup.classes || []).length; ci++) {
      var cls = cup.classes[ci];
      if (!cls.allowedDayIds) cls.allowedDayIds = null;
      if (cls.maxMatchesPerTeamPerDay === undefined) cls.maxMatchesPerTeamPerDay = null;
      if (cls.usePooling === undefined) cls.usePooling = false;
    }

    // Cup defaults
    if (!cup.defaults) cup.defaults = {};
    if (cup.defaults.maxMatchesPerTeamPerDay === undefined) cup.defaults.maxMatchesPerTeamPerDay = 3;
    return cup;
  }


  /**
   * Bygg tidsslots for alle baner og dager.
   * 
   * @param {Array} pitches - [{ id, name }]
   * @param {Array} days - [{ date, startTime: "HH:MM", endTime: "HH:MM", breaks: [{ start: "HH:MM", end: "HH:MM" }] }]
   * @param {number} slotMinutes - varighet per kamp (inkl. spilletid)
   * @param {number} bufferMinutes - pause mellom kamper paa samme bane
   * @returns {Array<{ pitchId, dayIndex, start, end }>} - sortert kronologisk
   */
  function buildTimeSlots(pitches, days, slotMinutes, bufferMinutes) {
    const slots = [];

    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      const day = days[dayIdx];
      const dayStart = parseTime(day.startTime);
      const dayEnd = parseTime(day.endTime);
      const breaks = (day.breaks || []).map(function (b) {
        return {
          start: parseTime(b.start),
          end: parseTime(b.end),
        };
      }).sort(function (a, b) { return a.start - b.start; });

      for (var p = 0; p < pitches.length; p++) {
        var pitch = pitches[p];
        var cursor = dayStart;

        while (cursor + slotMinutes <= dayEnd) {
          // Sjekk om cursoren overlapper med en pause
          var insideBreak = false;
          for (var bi = 0; bi < breaks.length; bi++) {
            var brk = breaks[bi];
            if (cursor < brk.end && cursor + slotMinutes > brk.start) {
              cursor = brk.end;
              insideBreak = true;
              break;
            }
          }
          if (insideBreak) continue;

          if (cursor + slotMinutes <= dayEnd) {
            slots.push({
              pitchId: pitch.id,
              dayIndex: dayIdx,
              start: cursor,
              end: cursor + slotMinutes,
            });
            cursor += slotMinutes + bufferMinutes;
          } else {
            break;
          }
        }
      }
    }

    // Sorter kronologisk: dag -> starttid -> bane
    slots.sort(function (a, b) {
      return (a.dayIndex - b.dayIndex) || (a.start - b.start) || a.pitchId.localeCompare(b.pitchId);
    });

    return slots;
  }


  // =========================================================================
  //  STEG 3: GREEDY KAMPPLASSERING
  // =========================================================================

  /**
   * Sjekk om en bane allerede er opptatt i tidsrommet (hard constraint).
   * Fanger overlapp pÃ¥ tvers av klasser og med lÃ¥ste kamper.
   */
  function pitchBusy(placed, pitchId, dayIndex, start, end) {
    for (var i = 0; i < placed.length; i++) {
      var pm = placed[i];
      if (pm.dayIndex !== dayIndex) continue;
      if (pm.pitchId !== pitchId) continue;
      if (start < pm.end && end > pm.start) return true;
    }
    return false;
  }

  /**
   * Sjekk om et lag allerede spiller i en slot (hard constraint).
   */
  function teamBusy(placed, teamId, dayIndex, start, end) {
    for (var i = 0; i < placed.length; i++) {
      var pm = placed[i];
      if (pm.dayIndex !== dayIndex) continue;
      if (pm.homeId !== teamId && pm.awayId !== teamId) continue;
      if (start < pm.end && end > pm.start) return true;
    }
    return false;
  }

  /**
   * Sjekk minimum hviletid for et lag mellom kamper (hard constraint).
   */
  function teamRestOk(placed, teamId, dayIndex, start, end, minRestMinutes) {
    for (var i = 0; i < placed.length; i++) {
      var pm = placed[i];
      if (pm.dayIndex !== dayIndex) continue;
      if (pm.homeId !== teamId && pm.awayId !== teamId) continue;
      var gap = Math.max(start - pm.end, pm.start - end);
      if (gap >= 0 && gap < minRestMinutes) return false;
    }
    return true;
  }

  /**
   * Beregn soft-penalty for en plassering.
   * Lavere = bedre.
   */
  function calcSoftPenalty(placed, match, slot) {
    var penalty = 0;

    // Straff: lang dodtid for et lag (> 60 min uten kamp)
    var tids = [match.homeId, match.awayId];
    for (var ti = 0; ti < tids.length; ti++) {
      var tid = tids[ti];
      var lastEnd = -1;
      for (var pi = 0; pi < placed.length; pi++) {
        var pm = placed[pi];
        if (pm.dayIndex !== slot.dayIndex) continue;
        if (pm.homeId !== tid && pm.awayId !== tid) continue;
        if (pm.end > lastEnd) lastEnd = pm.end;
      }
      if (lastEnd >= 0) {
        var gap = slot.start - lastEnd;
        if (gap > 60) penalty += (gap - 60) * 0.5;
      }
    }

    // Straff: unodvendig banebytte for lag
    for (var ti2 = 0; ti2 < tids.length; ti2++) {
      var tid2 = tids[ti2];
      for (var pi2 = 0; pi2 < placed.length; pi2++) {
        var pm2 = placed[pi2];
        if (pm2.dayIndex !== slot.dayIndex) continue;
        if (pm2.homeId !== tid2 && pm2.awayId !== tid2) continue;
        if (pm2.pitchId !== slot.pitchId) {
          penalty += 5;
          break;
        }
      }
    }

    return penalty;
  }

  /**
   * Plasser kamper i tidsslots med greedy-algoritme.
   */
  function placeMatches(matches, slots, opts) {
    var minRestMinutes = numOrDefault(opts && opts.minRestMinutes, 15);
    var maxPerDay = (opts && opts.maxMatchesPerTeamPerDay != null) ? opts.maxMatchesPerTeamPerDay : null;
    var lockedMatches = (opts && opts.lockedMatches) || [];
    var placed = lockedMatches.slice();
    var usedSlots = {};
    for (var li = 0; li < lockedMatches.length; li++) {
      var lm = lockedMatches[li];
      usedSlots[lm.pitchId + '-' + lm.dayIndex + '-' + lm.start] = true;
    }
    var unplaced = [];
    var totalPenalty = 0;
    var warnings = [];

    // Teller kamper per lag per dag (for daglig budsjett)
    var teamDayCount = {};
    function getTeamDayKey(tid, dIdx) { return tid + '|' + dIdx; }
    function getTeamDayCount(tid, dIdx) { return teamDayCount[getTeamDayKey(tid, dIdx)] || 0; }
    function incTeamDayCount(tid, dIdx) {
      var k = getTeamDayKey(tid, dIdx);
      teamDayCount[k] = (teamDayCount[k] || 0) + 1;
    }
    // Initialiser fra eksisterende plasserte kamper
    for (var tdi = 0; tdi < placed.length; tdi++) {
      var tdm = placed[tdi];
      incTeamDayCount(tdm.homeId, tdm.dayIndex);
      incTeamDayCount(tdm.awayId, tdm.dayIndex);
    }

    for (var mi = 0; mi < matches.length; mi++) {
      var match = matches[mi];

      // Sjekk om kampen allerede er laast (matchId-basert, med fallback til home/away)
      var isLocked = false;
      for (var lj = 0; lj < lockedMatches.length; lj++) {
        var locked = lockedMatches[lj];
        var idMatch = match.id && locked.id && (match.id === locked.id) && (match.classId === locked.classId);
        var pairMatch = (locked.classId === match.classId) &&
          ((locked.homeId === match.homeId && locked.awayId === match.awayId) ||
           (locked.homeId === match.awayId && locked.awayId === match.homeId));
        if (idMatch || pairMatch) {
          isLocked = true;
          break;
        }
      }
      if (isLocked) continue;

      var bestSlot = null;
      var bestPenalty = Infinity;

      for (var si = 0; si < slots.length; si++) {
        var slot = slots[si];
        var slotKey = slot.pitchId + '-' + slot.dayIndex + '-' + slot.start;
        if (usedSlots[slotKey]) continue;

        // Hard constraints
        if (pitchBusy(placed, slot.pitchId, slot.dayIndex, slot.start, slot.end)) continue;
        if (teamBusy(placed, match.homeId, slot.dayIndex, slot.start, slot.end)) continue;
        if (teamBusy(placed, match.awayId, slot.dayIndex, slot.start, slot.end)) continue;
        if (!teamRestOk(placed, match.homeId, slot.dayIndex, slot.start, slot.end, minRestMinutes)) continue;
        if (!teamRestOk(placed, match.awayId, slot.dayIndex, slot.start, slot.end, minRestMinutes)) continue;

        // Soft constraints
        var penalty = calcSoftPenalty(placed, match, slot);

        // Daglig kampbudsjett (soft penalty)
        if (maxPerDay != null) {
          var hCount = getTeamDayCount(match.homeId, slot.dayIndex);
          var aCount = getTeamDayCount(match.awayId, slot.dayIndex);
          if (hCount >= maxPerDay) penalty += 5000 + (hCount - maxPerDay + 1) * 500;
          if (aCount >= maxPerDay) penalty += 5000 + (aCount - maxPerDay + 1) * 500;
        }

        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          bestSlot = slot;
        }
      }

      if (bestSlot) {
        var bKey = bestSlot.pitchId + '-' + bestSlot.dayIndex + '-' + bestSlot.start;
        usedSlots[bKey] = true;
        placed.push({
          id: match.id,
          classId: match.classId,
          round: match.round,
          homeId: match.homeId,
          awayId: match.awayId,
          pitchId: bestSlot.pitchId,
          dayIndex: bestSlot.dayIndex,
          start: bestSlot.start,
          end: bestSlot.end,
          locked: false,
          score: match.score || { home: null, away: null },
        });
        totalPenalty += bestPenalty;
        incTeamDayCount(match.homeId, bestSlot.dayIndex);
        incTeamDayCount(match.awayId, bestSlot.dayIndex);
      } else {
        unplaced.push(match);
      }
    }

    if (unplaced.length > 0) {
      warnings.push(unplaced.length + ' kamp(er) fikk ikke plass i programmet.');
    }

    return {
      placed: placed,
      unplaced: unplaced,
      softPenalty: totalPenalty,
      score: totalPenalty + unplaced.length * 1000,
      warnings: warnings,
    };
  }

  /**
   * Kjor plassering med flere forsok (random restarts).
   */
  function scheduleMultiAttempt(allClassMatches, slots, opts) {
    var minRestMinutes = numOrDefault(opts && opts.minRestMinutes, 15);
    var lockedMatches = (opts && opts.lockedMatches) || [];
    var attempts = (opts && opts.attempts) || 100;
    var seed = (opts && opts.seed) || randomSeed();

    var rng = createRng(seed);
    var best = null;

    for (var i = 0; i < attempts; i++) {
      var shuffled = allClassMatches.slice();
      shuffleArray(shuffled, rng);

      var result = placeMatches(shuffled, slots, { minRestMinutes: minRestMinutes, lockedMatches: lockedMatches });

      if (!best || result.score < best.score) {
        best = result;
      }

      if (best.score === 0 && best.unplaced.length === 0) break;
    }

    return {
      placed: best.placed,
      unplaced: best.unplaced,
      score: best.score,
      warnings: best.warnings,
      seed: seed,
      attempts: attempts,
    };
  }


  // =========================================================================
  //  GJENNOMFORBARHETSKALKULATOR
  // =========================================================================
  function checkFeasibility(classes, pitches, days) {
    var warnings = [];
    var totalMatches = 0;
    var matchesPerClass = [];

    for (var ci = 0; ci < classes.length; ci++) {
      var cls = classes[ci];
      var nTeams = cls.teams ? cls.teams.length : 0;
      if (nTeams < 2) {
        matchesPerClass.push({ classId: cls.id, name: cls.name, matches: 0 });
        continue;
      }
      var nMatches = (nTeams * (nTeams - 1)) / 2;
      totalMatches += nMatches;
      matchesPerClass.push({ classId: cls.id, name: cls.name, matches: nMatches, teams: nTeams });
    }

    var maxSlotMinutes = 0;
    var maxBuffer = 0;
    for (var ci2 = 0; ci2 < classes.length; ci2++) {
      var cls2 = classes[ci2];
      var mMin = cls2.matchMinutes || 20;
      var bMin = numOrDefault(cls2.bufferMinutes, 5);
      if (mMin + bMin > maxSlotMinutes + maxBuffer) {
        maxSlotMinutes = mMin;
        maxBuffer = bMin;
      }
    }
    if (maxSlotMinutes === 0) maxSlotMinutes = 20;

    var slots = buildTimeSlots(pitches, days, maxSlotMinutes, maxBuffer);
    var totalSlots = slots.length;
    var utilizationPct = totalSlots > 0 ? Math.round((totalMatches / totalSlots) * 100) : 0;
    var feasible = totalMatches <= totalSlots;

    if (!feasible) {
      var deficit = totalMatches - totalSlots;
      warnings.push(deficit + ' kamp(er) for mange. Du trenger flere baner, lengre dag, eller kortere kampvarighet.');
    }

    if (utilizationPct > 85 && feasible) {
      warnings.push('Hoy utnyttelsesgrad (' + utilizationPct + '%). Vanskelig aa unngaa konflikter. Vurder litt ekstra tid.');
    }

    for (var ci3 = 0; ci3 < classes.length; ci3++) {
      var cls3 = classes[ci3];
      var nTeams3 = cls3.teams ? cls3.teams.length : 0;
      if (nTeams3 < 2) continue;
      var matchesPerTeam = nTeams3 - 1;
      var matchTime = numOrDefault(cls3.matchMinutes, 20);
      var rest = numOrDefault(cls3.minRestMinutes, 15);
      var totalTeamTime = matchesPerTeam * matchTime + (matchesPerTeam - 1) * rest;

      var maxDayMinutes = 0;
      for (var di = 0; di < days.length; di++) {
        var day = days[di];
        var dayLen = parseTime(day.endTime) - parseTime(day.startTime);
        var breakTime = 0;
        var brks = day.breaks || [];
        for (var bi = 0; bi < brks.length; bi++) {
          breakTime += parseTime(brks[bi].end) - parseTime(brks[bi].start);
        }
        var netMin = dayLen - breakTime;
        if (netMin > maxDayMinutes) maxDayMinutes = netMin;
      }

      if (totalTeamTime > maxDayMinutes && days.length === 1) {
        warnings.push(
          cls3.name + ': Et lag trenger ' + totalTeamTime + ' min (' +
          matchesPerTeam + ' kamper + hvile), men dagen er bare ' + maxDayMinutes + ' min.'
        );
      }
    }

    return {
      feasible: feasible,
      totalMatches: totalMatches,
      totalSlots: totalSlots,
      utilizationPct: utilizationPct,
      matchesPerClass: matchesPerClass,
      warnings: warnings,
    };
  }


  // =========================================================================
  //  TABELL / RESULTATER
  // =========================================================================
  function calcStandings(teams, matches) {
    var rows = {};
    for (var ti = 0; ti < teams.length; ti++) {
      var t = teams[ti];
      rows[t.id] = {
        teamId: t.id,
        name: t.name,
        played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0,
      };
    }

    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      if (!m.score || m.score.home == null || m.score.away == null) continue;
      var h = rows[m.homeId];
      var a = rows[m.awayId];
      if (!h || !a) continue;

      h.played++; a.played++;
      h.goalsFor += m.score.home; h.goalsAgainst += m.score.away;
      a.goalsFor += m.score.away; a.goalsAgainst += m.score.home;

      if (m.score.home > m.score.away) {
        h.won++; a.lost++; h.points += 3;
      } else if (m.score.home < m.score.away) {
        a.won++; h.lost++; a.points += 3;
      } else {
        h.drawn++; a.drawn++; h.points += 1; a.points += 1;
      }
    }

    var result = [];
    for (var key in rows) {
      if (rows.hasOwnProperty(key)) {
        var r = rows[key];
        r.goalDiff = r.goalsFor - r.goalsAgainst;
        // Bakoverkompatible aliaser (cup.js bruker korte navn)
        r.teamName = r.name;
        r.p = r.played;
        r.w = r.won;
        r.d = r.drawn;
        r.l = r.lost;
        r.gf = r.goalsFor;
        r.ga = r.goalsAgainst;
        r.gd = r.goalDiff;
        r.pts = r.points;
        result.push(r);
      }
    }

    // Build head-to-head lookup for tiebreaking
    var h2hPoints = {};
    for (var hi = 0; hi < matches.length; hi++) {
      var hm = matches[hi];
      if (!hm.score || hm.score.home == null || hm.score.away == null) continue;
      var key1 = hm.homeId + ':' + hm.awayId;
      var key2 = hm.awayId + ':' + hm.homeId;
      if (!h2hPoints[key1]) h2hPoints[key1] = 0;
      if (!h2hPoints[key2]) h2hPoints[key2] = 0;
      if (hm.score.home > hm.score.away) {
        h2hPoints[key1] += 3;
      } else if (hm.score.home < hm.score.away) {
        h2hPoints[key2] += 3;
      } else {
        h2hPoints[key1] += 1;
        h2hPoints[key2] += 1;
      }
    }

    result.sort(function (x, y) {
      // 1. Points
      var d = y.points - x.points;
      if (d !== 0) return d;
      // 2. Goal difference
      d = y.goalDiff - x.goalDiff;
      if (d !== 0) return d;
      // 3. Goals scored
      d = y.goalsFor - x.goalsFor;
      if (d !== 0) return d;
      // 4. Head-to-head points
      var h2hX = (h2hPoints[x.teamId + ':' + y.teamId] || 0);
      var h2hY = (h2hPoints[y.teamId + ':' + x.teamId] || 0);
      d = h2hY - h2hX;
      if (d !== 0) return d;
      // 5. Alphabetical fallback
      return x.name.localeCompare(y.name, 'nb');
    });

    return result;
  }


  // =========================================================================
  //  KONFLIKTSJEKK (for manuell redigering / drag & drop)
  // =========================================================================
  function checkMoveConflicts(allPlaced, movedMatch, minRestMinutes) {
    var conflicts = [];
    var others = allPlaced.filter(function (pm) {
      return !(pm.homeId === movedMatch.homeId && pm.awayId === movedMatch.awayId && pm.classId === movedMatch.classId);
    });

    // Sjekk at banen ikke er opptatt i tidsrommet (time-range overlap)
    if (pitchBusy(others, movedMatch.pitchId, movedMatch.dayIndex, movedMatch.start, movedMatch.end)) {
      conflicts.push('Bane ' + movedMatch.pitchId + ' kl ' + formatTime(movedMatch.start) + ' er allerede opptatt.');
    }

    var tids = [movedMatch.homeId, movedMatch.awayId];
    for (var ti = 0; ti < tids.length; ti++) {
      var tid = tids[ti];
      if (teamBusy(others, tid, movedMatch.dayIndex, movedMatch.start, movedMatch.end)) {
        conflicts.push('Laget "' + tid + '" har allerede en kamp som overlapper.');
      }
      if (!teamRestOk(others, tid, movedMatch.dayIndex, movedMatch.start, movedMatch.end, minRestMinutes)) {
        conflicts.push('Laget "' + tid + '" faar ikke nok hvile (min ' + minRestMinutes + ' min).');
      }
    }

    return {
      valid: conflicts.length === 0,
      conflicts: conflicts,
    };
  }


  // =========================================================================
  //  HJELPEFUNKSJONER
  // =========================================================================
  function cupUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function createEmptyCup(title) {
    return {
      id: cupUuid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: title || 'Ny cup',
      venue: '',
      rulesMode: 'nff',
      defaults: {
        maxMatchesPerTeamPerDay: 3,
      },
      days: [{
        id: cupUuid(),
        date: new Date().toISOString().slice(0, 10),
        startTime: '09:00',
        endTime: '16:00',
        breaks: [{ start: '12:00', end: '12:30' }],
      }],
      pitches: [
        { id: cupUuid(), name: 'Bane 1', maxFormat: '11v11' },
      ],
      classes: [],
    };
  }

  function createClass(name, age, gender) {
    var rules = getNffRules(age);
    var matchMin = getCupMatchMinutes(age);
    return {
      id: cupUuid(),
      name: name || ((gender === 'J' ? 'J' : 'G') + age),
      age: String(age),
      gender: gender || 'G',
      playFormat: rules ? rules.playFormat : '5v5',
      matchMinutes: matchMin,
      bufferMinutes: 5,
      minRestMinutes: 15,
      allowedDayIds: null,
      maxMatchesPerTeamPerDay: null,
      teams: [],
      matches: [],
      generation: null,
    };
  }

  function createTeam(name, club) {
    return {
      id: cupUuid(),
      name: name || 'Lag',
      club: club || '',
      contact: '',
    };
  }


  // =========================================================================
  //  KOMPLETT GENERERINGSFLYT
  // =========================================================================
  function generateSchedule(cup, opts) {
    var attempts = (opts && opts.attempts) || 100;
    var seed = (opts && opts.seed) || randomSeed();
    var lockedMatches = (opts && opts.lockedMatches) || [];

    // 1. Generer kamper for alle klasser
    var allMatches = [];
    for (var ci = 0; ci < cup.classes.length; ci++) {
      var cls = cup.classes[ci];
      if (!cls.teams || cls.teams.length < 2) continue;
      var teamIds = cls.teams.map(function (t) { return t.id; });
      var gen = generateRoundRobin(teamIds);

      for (var mi = 0; mi < gen.matches.length; mi++) {
        var m = gen.matches[mi];
        allMatches.push({
          id: cupUuid(),
          classId: cls.id,
          round: m.round,
          homeId: m.homeId,
          awayId: m.awayId,
          score: { home: null, away: null },
          locked: false,
        });
      }
    }

    // 2. Bygg slots basert paa den lengste kampvarianten
    var maxSlot = 0;
    var maxBuffer = 5;
    var maxRest = 15;
    for (var ci2 = 0; ci2 < cup.classes.length; ci2++) {
      var cls2 = cup.classes[ci2];
      if ((cls2.matchMinutes || 0) > maxSlot) {
        maxSlot = cls2.matchMinutes;
        maxBuffer = numOrDefault(cls2.bufferMinutes, 5);
      }
      if ((cls2.minRestMinutes || 0) > maxRest) {
        maxRest = cls2.minRestMinutes;
      }
    }
    if (maxSlot === 0) maxSlot = 20;

    var slots = buildTimeSlots(cup.pitches, cup.days, maxSlot, maxBuffer);

    // 3. Multi-attempt scheduling
    var result = scheduleMultiAttempt(allMatches, slots, {
      minRestMinutes: maxRest,
      lockedMatches: lockedMatches,
      attempts: attempts,
      seed: seed,
    });

    // 4. Fordel plasserte kamper tilbake til klassene
    var updatedCup = JSON.parse(JSON.stringify(cup));
    for (var ci3 = 0; ci3 < updatedCup.classes.length; ci3++) {
      var cls3 = updatedCup.classes[ci3];
      cls3.matches = [];
      for (var pi = 0; pi < result.placed.length; pi++) {
        var pm = result.placed[pi];
        if (pm.classId !== cls3.id) continue;
        cls3.matches.push({
          id: pm.id,
          round: pm.round,
          homeId: pm.homeId,
          awayId: pm.awayId,
          pitchId: pm.pitchId,
          dayIndex: pm.dayIndex,
          start: pm.start,
          end: pm.end,
          locked: pm.locked || false,
          score: pm.score || { home: null, away: null },
        });
      }
      cls3.generation = {
        seed: result.seed,
        attempts: result.attempts,
        bestScore: result.score,
        warnings: result.warnings,
        generatedAt: new Date().toISOString(),
      };
    }
    updatedCup.updatedAt = new Date().toISOString();

    return {
      cup: updatedCup,
      result: {
        placed: result.placed,
        unplaced: result.unplaced,
        score: result.score,
        seed: result.seed,
        attempts: result.attempts,
        warnings: result.warnings,
      },
    };
  }


  // =========================================================================
  //  BAKOVERKOMPATIBLE WRAPPERE (brukt av cup.js full versjon)
  // =========================================================================

  /**
   * getNffDefaults(age) â€” kombinerer getNffRules + getCupMatchMinutes
   * Returnerer { playFormat, matchMinutes, noRanking, noPlayoffs }
   */
  function getNffDefaults(age) {
    var a = Number(age) || 10;
    var rules = getNffRules(a) || {};
    return {
      playFormat: rules.playFormat || '5v5',
      matchMinutes: getCupMatchMinutes(a) || 20,
      halfCount: (rules.halfCount || 2),
      halfMinutes: (rules.halfMinutes || Math.round((getCupMatchMinutes(a) || 20) / (rules.halfCount || 2))),
      noRanking: !!rules.noRanking,
      noPlayoffs: !!rules.noPlayoffs,
    };
  }

  /**
   * generateRoundRobinFull(teams, seed) â€” aksepterer lag-objekter ({id,name,...})
   * og returnerer fulle match-objekter med id, score, locked.
   * Bakoverkompatibel med cup.js som kaller CS.generateRoundRobin(cls.teams, seed).
   */
  function generateRoundRobinFull(teamsOrIds, seed) {
    var ids = teamsOrIds || [];
    if (ids.length && typeof ids[0] === 'object' && ids[0] && ids[0].id) {
      ids = ids.map(function (t) { return t.id; });
    }
    var base = generateRoundRobin(ids);
    var rng = (typeof seed === 'number') ? createRng(seed) : null;
    var out = [];
    for (var i = 0; i < (base.matches || []).length; i++) {
      var m = base.matches[i];
      var h = m.homeId;
      var a = m.awayId;
      // Seed-basert randomisering av hjemme/borte for variasjon
      if (rng && rng() < 0.5) { var tmp = h; h = a; a = tmp; }
      out.push({
        id: cupUuid(),
        round: m.round,
        homeId: h,
        awayId: a,
        pitchId: null,
        dayIndex: null,
        start: null,
        end: null,
        locked: false,
        score: { home: null, away: null },
      });
    }
    return { matches: out, hasBye: base.hasBye };
  }

  /**
   * calcFeasibility(classes, pitches, days) â€” per-klasse array
   * cup.js forventer: [{classId, className, feasible, reason, totalMatches, totalSlots}]
   */
  function calcFeasibility(classes, pitches, days) {
    var results = [];
    for (var i = 0; i < (classes || []).length; i++) {
      var cls = classes[i];
      var teamCount = (cls.teams || []).length;
      if (teamCount < 2) {
        results.push({ classId: cls.id, className: cls.name, feasible: false, reason: 'Trenger minst 2 lag', totalMatches: 0, totalSlots: 0 });
        continue;
      }
      // Pulje-validering: hindrer inkonsistente feasibility-tall ved rotete pools
      if (cls.usePooling && cls.pools && cls.pools.length > 0) {
        var pv = validatePools(cls);
        if (!pv.valid) {
          var badSlots = buildTimeSlotsForClass(cls, pitches || [], days || []);
          results.push({ classId: cls.id, className: cls.name, feasible: false, reason: 'Ugyldig puljeinndeling: ' + pv.errors.join(' | '), totalMatches: 0, totalSlots: badSlots.length });
          continue;
        }
      }
      var matchMin = numOrDefault(cls.matchMinutes, 20);
      var bufferMin = numOrDefault(cls.bufferMinutes, 5);
      var minRest = numOrDefault(cls.minRestMinutes, 15);
      var totalMatches = countClassMatches(cls);

      // Bruk format- og dag-filtrerte slots
      var slots = buildTimeSlotsForClass(cls, pitches || [], days || []);
      var totalSlots = slots.length;
      var feasible = totalSlots >= totalMatches;
      var reason = '';
      var restWarning = '';
      var budgetWarning = '';

      if (!feasible) {
        var deficit = totalMatches - totalSlots;
        // Gi mer kontekst om hvorfor
        var compatPitchCount = 0;
        for (var cp = 0; cp < (pitches || []).length; cp++) {
          if (isFormatCompatible(pitches[cp], cls.playFormat)) compatPitchCount++;
        }
        reason = 'Mangler ' + deficit + ' slot(s). ';
        if (compatPitchCount === 0) {
          reason += 'Ingen baner stoetter ' + (cls.playFormat || '?') + '. Legg til kompatible baner.';
        } else if (compatPitchCount < (pitches || []).length) {
          reason += 'Kun ' + compatPitchCount + ' av ' + (pitches || []).length + ' baner stoetter ' + (cls.playFormat || '?') + '. ';
          reason += 'Forslag: legg til baner, utvid tidsrammen, eller kort ned kamptid.';
        } else {
          reason += 'Forslag: legg til baner, utvid tidsrammen, eller kort ned kamptid.';
        }
      }

      // Rest-aware kapasitetssjekk
      if (feasible && minRest > bufferMin) {
        var restFactor = (matchMin + bufferMin) / (matchMin + minRest);
        var effectiveSlots = Math.floor(totalSlots * restFactor);
        if (effectiveSlots < totalMatches) {
          restWarning = 'Nok slots (' + totalSlots + '), men minste hvile (' + minRest + ' min) er lengre enn buffer (' + bufferMin + ' min). ' +
            'Effektiv kapasitet er ca. ' + effectiveSlots + ' kamper. Noen kamper kan bli umulige aa plassere. ' +
            'Forslag: legg til baner, reduser minste hvile, eller utvid tidsrammen.';
        }
      }

      // Daglig budsjett-sjekk
      var maxPerDay = cls.maxMatchesPerTeamPerDay;
      if (maxPerDay != null && feasible) {
        var matchesPerTeam = maxMatchesPerTeamInClass(cls);
        // Tell unike dager i slots (med allowedDays-filtrering allerede gjort)
        var daySet = {};
        for (var ds = 0; ds < slots.length; ds++) daySet[slots[ds].dayIndex] = true;
        var daysAvailable = Object.keys(daySet).length;
        var minPerDay = Math.ceil(matchesPerTeam / Math.max(1, daysAvailable));
        if (maxPerDay < minPerDay) {
          budgetWarning = 'Hvert lag spiller ' + matchesPerTeam + ' kamper over ' + daysAvailable + ' dag(er). ' +
            'Minimum ' + minPerDay + ' kamper/dag, men maks er satt til ' + maxPerDay + '. ' +
            'Forslag: oek maks kamper per dag, legg til flere dager, eller bruk puljer.';
        }
      }

      results.push({
        classId: cls.id, className: cls.name,
        feasible: feasible, reason: reason,
        restWarning: restWarning,
        budgetWarning: budgetWarning,
        totalMatches: totalMatches, totalSlots: totalSlots,
      });
    }
    return results;
  }

  /**
   * scheduleAllClasses(classes, pitches, days, seed, attempts)
   * Orkestrator som cup.js forventer.
   * Returnerer: { classResults, totalPenalty, totalUnplaced, seed, attempt }
   */
  function scheduleAllClasses(classes, pitches, days, seed, attempts) {
    var numAttempts = attempts || 100;
    var best = null;
    var bestScore = Infinity;

    // Interleaving hjelper spesielt ved flere klasser + hoy utnyttelse.
    var useInterleave = (classes || []).length > 1;

    for (var attempt = 0; attempt < numAttempts; attempt++) {
      var rng = createRng((seed || 1) + attempt);
      var classOrder = (classes || []).slice();
      shuffleArray(classOrder, rng);

      // Samle alle laaste kamper pa tvers av klasser
      var occupied = [];
      var occKey = {};
      for (var ci = 0; ci < (classes || []).length; ci++) {
        var c = classes[ci];
        for (var mi = 0; mi < (c.matches || []).length; mi++) {
          var m = c.matches[mi];
          if (!m || !m.locked) continue;
          var hasP = (m.pitchId !== null && m.pitchId !== undefined) && (m.dayIndex !== null && m.dayIndex !== undefined) && m.start != null && m.end != null;
          if (!hasP) continue;
          var sMin = (typeof m.start === 'number') ? m.start : parseTime(m.start);
          var eMin = (typeof m.end === 'number') ? m.end : parseTime(m.end);
          var k = c.id + '|' + m.id;
          if (!occKey[k]) {
            occKey[k] = true;
            occupied.push({
              id: m.id, classId: c.id, round: m.round,
              homeId: m.homeId, awayId: m.awayId,
              pitchId: m.pitchId, dayIndex: m.dayIndex,
              start: sMin, end: eMin,
              locked: true, score: m.score || { home: null, away: null },
            });
          }
        }
      }

      // Bygg per-klasse state
      var classStates = [];
      for (var oi = 0; oi < classOrder.length; oi++) {
        var cls = classOrder[oi];
        var clsSlots = buildTimeSlotsForClass(cls, pitches || [], days || []);

        var clsMatchesAll = (cls.matches || []).map(function (mm) {
          return {
            id: mm.id, classId: cls.id, round: mm.round,
            homeId: mm.homeId, awayId: mm.awayId,
            score: mm.score || { home: null, away: null },
            locked: !!mm.locked,
          };
        });

        shuffleArray(clsMatchesAll, rng);

        // Pending = alt som ikke allerede er laast/okkupert med plassering
        var pending = [];
        for (var pmx = 0; pmx < clsMatchesAll.length; pmx++) {
          var mmx = clsMatchesAll[pmx];
          var kk = cls.id + '|' + mmx.id;
          if (occKey[kk]) continue;
          pending.push(mmx);
        }

        // Daglig kampbudsjett: klasse-nivaa overrider cup-default
        var clsMaxPerDay = cls.maxMatchesPerTeamPerDay != null ? cls.maxMatchesPerTeamPerDay : null;

        classStates.push({
          cls: cls,
          slots: clsSlots,
          minRest: numOrDefault(cls.minRestMinutes, 20),
          maxPerDay: clsMaxPerDay,
          allMatches: clsMatchesAll,
          pending: pending,
          giveUp: [],
          penalty: 0,
        });
      }

      var totalPenalty = 0;

      if (useInterleave) {
        // Interleaving: plasser 1 kamp per klasse per "runde" for aa unngaa at siste klasse starver.
        var retries = {};
        var retryLimit = 2;
        var totalPending = 0;
        for (var cs0 = 0; cs0 < classStates.length; cs0++) totalPending += classStates[cs0].pending.length;
        var maxIters = totalPending * 3 + 50;

        var progress = true;
        var iter = 0;
        while (progress && iter < maxIters) {
          progress = false;
          var anyPending = false;

          for (var cs = 0; cs < classStates.length; cs++) {
            var st = classStates[cs];
            if (!st.pending.length) continue;
            anyPending = true;

            var match = st.pending.shift();
            var res = placeMatches([match], st.slots, {
              minRestMinutes: st.minRest,
              maxMatchesPerTeamPerDay: st.maxPerDay,
              lockedMatches: occupied,
            });

            var sp = (res.softPenalty || 0);
            totalPenalty += sp;
            st.penalty += sp;

            var added = 0;
            for (var pi = 0; pi < (res.placed || []).length; pi++) {
              var pm = res.placed[pi];
              if (pm.classId !== st.cls.id) continue;
              var kk2 = pm.classId + '|' + pm.id;
              if (!occKey[kk2]) {
                occKey[kk2] = true;
                occupied.push(pm);
                added++;
              }
            }
            if (added > 0) progress = true;

            if (res.unplaced && res.unplaced.length) {
              var u = res.unplaced[0];
              var cid = st.cls.id;
              if (!retries[cid]) retries[cid] = {};
              var cnt = retries[cid][u.id] || 0;
              if (cnt < retryLimit) {
                retries[cid][u.id] = cnt + 1;
                st.pending.push(u);
              } else {
                st.giveUp.push(u);
              }
            }
          }

          if (!anyPending) break;
          iter++;
        }

        // Repair-sweep: forsok aa plassere resten uten aa flytte allerede plasserte kamper
        for (var cs2 = 0; cs2 < classStates.length; cs2++) {
          var st2 = classStates[cs2];
          var remaining = [];
          for (var r1 = 0; r1 < st2.pending.length; r1++) {
            var m1 = st2.pending[r1];
            if (!occKey[st2.cls.id + '|' + m1.id]) remaining.push(m1);
          }
          for (var r2 = 0; r2 < st2.giveUp.length; r2++) {
            var m2 = st2.giveUp[r2];
            if (!occKey[st2.cls.id + '|' + m2.id]) remaining.push(m2);
          }

          if (remaining.length) {
            var res2 = placeMatches(remaining, st2.slots, {
              minRestMinutes: st2.minRest,
              maxMatchesPerTeamPerDay: st2.maxPerDay,
              lockedMatches: occupied,
            });

            var sp2 = (res2.softPenalty || 0);
            totalPenalty += sp2;
            st2.penalty += sp2;

            for (var pi2 = 0; pi2 < (res2.placed || []).length; pi2++) {
              var pm2 = res2.placed[pi2];
              if (pm2.classId !== st2.cls.id) continue;
              var kk3 = pm2.classId + '|' + pm2.id;
              if (!occKey[kk3]) {
                occKey[kk3] = true;
                occupied.push(pm2);
              }
            }
          }
        }
      } else {
        // Enkelt-klasse: original greedy i ett pass
        for (var oi2 = 0; oi2 < classStates.length; oi2++) {
          var stS = classStates[oi2];
          var resS = placeMatches(stS.pending.slice(), stS.slots, {
            minRestMinutes: stS.minRest,
            maxMatchesPerTeamPerDay: stS.maxPerDay,
            lockedMatches: occupied,
          });
          var spS = (resS.softPenalty || 0);
          totalPenalty += spS;
          stS.penalty += spS;
          for (var piS = 0; piS < (resS.placed || []).length; piS++) {
            var pmS = resS.placed[piS];
            if (pmS.classId !== stS.cls.id) continue;
            var kkS = pmS.classId + '|' + pmS.id;
            if (!occKey[kkS]) {
              occKey[kkS] = true;
              occupied.push(pmS);
            }
          }
        }
      }

      // Bygg classResults + tell unplaced
      var classResults = [];
      var totalUnplaced = 0;

      for (var cs3 = 0; cs3 < classStates.length; cs3++) {
        var st3 = classStates[cs3];

        var schedule = [];
        for (var op = 0; op < occupied.length; op++) {
          var pm3 = occupied[op];
          if (pm3.classId !== st3.cls.id) continue;
          schedule.push({
            matchId: pm3.id, homeId: pm3.homeId, awayId: pm3.awayId,
            pitchId: pm3.pitchId, dayIndex: pm3.dayIndex,
            startMin: pm3.start, endMin: pm3.end,
            startTime: formatTime(pm3.start), endTime: formatTime(pm3.end),
            _classId: st3.cls.id,
          });
        }

        schedule.sort(function(a,b){
          if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
          if (a.startMin !== b.startMin) return a.startMin - b.startMin;
          return String(a.pitchId).localeCompare(String(b.pitchId));
        });

        var unplacedIds = [];
        for (var am = 0; am < st3.allMatches.length; am++) {
          var mm3 = st3.allMatches[am];
          var kk4 = st3.cls.id + '|' + mm3.id;
          if (!occKey[kk4]) unplacedIds.push(mm3.id);
        }

        totalUnplaced += unplacedIds.length;
        classResults.push({ classId: st3.cls.id, schedule: schedule, unplaced: unplacedIds, penalty: st3.penalty });
      }

      // Fairness-penalty: straff skjev fordeling av tidlige/sene slots mellom klasser
      var fairnessPenalty = 0;
      if (classResults.length > 1) {
        var means = [];
        for (var fi = 0; fi < classResults.length; fi++) {
          var sched = classResults[fi].schedule;
          if (sched.length === 0) continue;
          var sum = 0;
          for (var si = 0; si < sched.length; si++) sum += sched[si].startMin;
          means.push(sum / sched.length);
        }
        if (means.length > 1) {
          var meanOfMeans = 0;
          for (var mi2 = 0; mi2 < means.length; mi2++) meanOfMeans += means[mi2];
          meanOfMeans /= means.length;
          var variance = 0;
          for (var mi3 = 0; mi3 < means.length; mi3++) {
            var diff = means[mi3] - meanOfMeans;
            variance += diff * diff;
          }
          variance /= means.length;
          fairnessPenalty = Math.sqrt(variance);
        }
      }

      var score = totalPenalty + totalUnplaced * 50000 + fairnessPenalty * 2;
      if (score < bestScore) {
        bestScore = score;
        best = { classResults: classResults, totalPenalty: totalPenalty, totalUnplaced: totalUnplaced, seed: seed, attempt: attempt };
      }

      if (totalUnplaced === 0 && totalPenalty === 0 && fairnessPenalty < 10) break;
    }

    return best;
  }

  /**
   * validateSchedule(classes, entries)
   * Post-schedule validering â€” sjekker bane-overlap og lag-overlap.
   * Returnerer array av { type, message }.
   */
  function validateSchedule(classes, entries) {
    var warnings = [];
    var list = entries || [];

    // Bane-overlap
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j];
        if (a.dayIndex !== b.dayIndex) continue;
        if (a.pitchId !== b.pitchId) continue;
        if (a.startMin < b.endMin && a.endMin > b.startMin) {
          warnings.push({ type: 'pitchOverlap', message: 'Dobbeltbooking: to kamper paa bane ' + a.pitchId + ' overlapper (dag ' + (a.dayIndex + 1) + ').' });
          break;
        }
      }
    }

    // Lag-overlap
    for (var i2 = 0; i2 < list.length; i2++) {
      var x = list[i2];
      for (var j2 = i2 + 1; j2 < list.length; j2++) {
        var y = list[j2];
        if (x.dayIndex !== y.dayIndex) continue;
        if (!(x.startMin < y.endMin && x.endMin > y.startMin)) continue;
        var sameTeam = (x.homeId === y.homeId || x.homeId === y.awayId || x.awayId === y.homeId || x.awayId === y.awayId);
        if (sameTeam) {
          warnings.push({ type: 'teamOverlap', message: 'Lag-overlapp: et lag har to kamper samtidig.' });
          break;
        }
      }
    }

    return warnings;
  }


  // =========================================================================
  //  PULJEINNDELING (pool division)
  // =========================================================================

  /**
   * Tell totalt antall kamper for en klasse, pulje-aware.
   * Med puljer: sum av n*(n-1)/2 per pulje.
   * Uten puljer: teamCount*(teamCount-1)/2.
   */
  function countClassMatches(cls) {
    var teamCount = (cls.teams || []).length;
    if (cls.usePooling && cls.pools && cls.pools.length > 0) {
      var total = 0;
      for (var pi = 0; pi < cls.pools.length; pi++) {
        var n = (cls.pools[pi].teamIds || []).length;
        total += n * (n - 1) / 2;
      }
      return total;
    }
    return (teamCount * (teamCount - 1)) / 2;
  }

  /**
   * Maks kamper per lag innenfor en klasse (for budget-warning).
   * Med puljer: stoerste pulje - 1.
   * Uten puljer: teamCount - 1.
   */
  function maxMatchesPerTeamInClass(cls) {
    var teamCount = (cls.teams || []).length;
    if (cls.usePooling && cls.pools && cls.pools.length > 0) {
      var maxSize = 0;
      for (var pi = 0; pi < cls.pools.length; pi++) {
        var n = (cls.pools[pi].teamIds || []).length;
        if (n > maxSize) maxSize = n;
      }
      return Math.max(0, maxSize - 1);
    }
    return Math.max(0, teamCount - 1);
  }

  /**
   * Anbefalt antall puljer basert paa antall lag.
   * Maal: 3-5 lag per pulje (4 er optimal).
   * @param {number} teamCount
   * @returns {number} 1 = ingen puljer nødvendig
   */
  function autoPoolCount(teamCount) {
    if (teamCount <= 6) return 1;
    if (teamCount <= 8) return 2;
    if (teamCount <= 12) return 2;    // 2x5-6
    if (teamCount <= 16) return 3;    // 3x5-6 eller 4x4
    if (teamCount <= 20) return 4;    // 4x5
    return Math.ceil(teamCount / 5);
  }

  /**
   * Fordel lag i puljer med snake-draft.
   * @param {Array} teams - [{ id, name, ... }]
   * @param {number} poolCount - antall puljer (>= 2)
   * @param {number} seed - PRNG seed for reproduserbar shuffle
   * @returns {Array<{ id, name, teamIds }>} - puljene
   */
  function assignTeamsToPools(teams, poolCount, seed) {
    var n = Math.max(2, Math.min(teams.length, poolCount || 2));
    var rng = createRng(seed || 1);

    var pools = [];
    for (var i = 0; i < n; i++) {
      pools.push({
        id: cupUuid(),
        name: 'Pulje ' + String.fromCharCode(65 + i),  // A, B, C...
        teamIds: []
      });
    }

    // Group teams by club for same-club avoidance
    var clubMap = {};
    var noClub = [];
    for (var ti = 0; ti < teams.length; ti++) {
      var t = teams[ti];
      var club = (t.club || '').trim();
      if (club) {
        if (!clubMap[club]) clubMap[club] = [];
        clubMap[club].push(t);
      } else {
        noClub.push(t);
      }
    }

    // Sort clubs by team count (largest first) for best distribution
    // Then shuffle within same-count groups for randomization
    var clubKeys = Object.keys(clubMap);
    shuffleArray(clubKeys, rng); // Randomize first, then stable-sort by count
    clubKeys.sort(function(a, b) {
      return clubMap[b].length - clubMap[a].length;
    });

    // Assign club teams: spread each club's teams across different pools
    for (var ci = 0; ci < clubKeys.length; ci++) {
      var clubTeams = clubMap[clubKeys[ci]];
      shuffleArray(clubTeams, rng);
      for (var ct = 0; ct < clubTeams.length; ct++) {
        // Find pool with fewest teams that also has fewest from this club
        var bestPool = 0;
        var bestScore = Infinity;
        for (var pi = 0; pi < n; pi++) {
          var sameClubInPool = 0;
          for (var pt = 0; pt < pools[pi].teamIds.length; pt++) {
            var ptid = pools[pi].teamIds[pt];
            for (var cti = 0; cti < clubTeams.length; cti++) {
              if (clubTeams[cti].id === ptid) { sameClubInPool++; break; }
            }
          }
          // Score: heavily penalize same-club, then prefer smaller pools
          var score = sameClubInPool * 1000 + pools[pi].teamIds.length;
          if (score < bestScore) { bestScore = score; bestPool = pi; }
        }
        pools[bestPool].teamIds.push(clubTeams[ct].id);
      }
    }

    // Assign teams without club: fill smallest pools
    shuffleArray(noClub, rng);
    for (var ni = 0; ni < noClub.length; ni++) {
      var minIdx = 0;
      for (var pi2 = 1; pi2 < n; pi2++) {
        if (pools[pi2].teamIds.length < pools[minIdx].teamIds.length) minIdx = pi2;
      }
      pools[minIdx].teamIds.push(noClub[ni].id);
    }

    return pools;
  }

  /**
   * Generer kamper for en klasse med puljeinndeling.
   * Hver pulje spiller full round-robin internt.
   * @param {object} cls - klasseobjekt med teams og pools
   * @param {number} [seed] - PRNG seed
   * @returns {{ matches: Array, hasBye: boolean }}
   */
  function generatePoolMatches(cls, seed) {
    if (!cls.usePooling || !cls.pools || cls.pools.length === 0) {
      // Fallback: vanlig round-robin (full match-shape med id/score/locked)
      var teamIds = (cls.teams || []).map(function(t) { return t.id; });
      return generateRoundRobinFull(teamIds, seed);
    }

    var allMatches = [];
    var anyBye = false;

    for (var pi = 0; pi < cls.pools.length; pi++) {
      var pool = cls.pools[pi];
      // Filtrer til teamIds som faktisk finnes i klassen
      var validIds = [];
      for (var vi = 0; vi < (pool.teamIds || []).length; vi++) {
        var tid = pool.teamIds[vi];
        for (var ti = 0; ti < (cls.teams || []).length; ti++) {
          if (cls.teams[ti].id === tid) { validIds.push(tid); break; }
        }
      }
      if (validIds.length < 2) continue;

      var rr = generateRoundRobin(validIds);
      if (rr.hasBye) anyBye = true;

      // Enrich med poolId og seed-basert h/b-swap
      var rng = (typeof seed === 'number') ? createRng(seed + pi * 7919) : null;
      for (var mi = 0; mi < rr.matches.length; mi++) {
        var m = rr.matches[mi];
        var h = m.homeId;
        var a = m.awayId;
        if (rng && rng() < 0.5) { var tmp = h; h = a; a = tmp; }
        allMatches.push({
          id: cupUuid(),
          round: m.round,
          homeId: h,
          awayId: a,
          poolId: pool.id,
          pitchId: null,
          dayIndex: null,
          start: null,
          end: null,
          locked: false,
          score: { home: null, away: null },
        });
      }
    }

    return { matches: allMatches, hasBye: anyBye };
  }

  /**
   * Valider at puljeinndeling er konsistent.
   * @param {object} cls - klasseobjekt
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validatePools(cls) {
    var errors = [];
    if (!cls.usePooling || !cls.pools || cls.pools.length === 0) {
      return { valid: true, errors: [] };
    }

    var teamIdSet = {};
    for (var ti = 0; ti < (cls.teams || []).length; ti++) {
      teamIdSet[cls.teams[ti].id] = false; // false = not assigned yet
    }

    for (var pi = 0; pi < cls.pools.length; pi++) {
      var pool = cls.pools[pi];
      var validCount = 0;
      for (var i = 0; i < (pool.teamIds || []).length; i++) {
        var tid = pool.teamIds[i];
        if (teamIdSet[tid] === undefined) {
          errors.push('Pulje "' + pool.name + '" inneholder ukjent lag-ID: ' + tid);
        } else if (teamIdSet[tid] === true) {
          errors.push('Lag ' + tid + ' er i flere puljer');
        } else {
          teamIdSet[tid] = true;
          validCount++;
        }
      }
      if (validCount < 2) {
        errors.push('Pulje "' + pool.name + '" har faerre enn 2 lag');
      }
    }

    // Sjekk at alle lag er tildelt
    for (var key in teamIdSet) {
      if (teamIdSet[key] === false) {
        errors.push('Lag ' + key + ' er ikke tildelt noen pulje');
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }


  // =========================================================================
  //  EKSPORTER
  // =========================================================================
  window.CupScheduler = {
    // NFF-regler
    NFF_RULES: NFF_RULES,
    CUP_MATCH_MINUTES: CUP_MATCH_MINUTES,
    getNffRules: getNffRules,
    getCupMatchMinutes: getCupMatchMinutes,
    getNffDefaults: getNffDefaults,          // compat: cup.js

    // PRNG
    createRng: createRng,
    shuffleArray: shuffleArray,
    randomSeed: randomSeed,
    newSeed: randomSeed,                     // compat: cup.js

    // Kampgenerering
    generateRoundRobin: generateRoundRobinFull,  // compat: aksepterer bade teamIds og team-objekter + seed
    _generateRoundRobinRaw: generateRoundRobin,  // original (bare teamIds)

    // Slot-bygging
    parseTime: parseTime,
    formatTime: formatTime,
    buildTimeSlots: buildTimeSlots,
    buildTimeSlotsForClass: buildTimeSlotsForClass,

    // Format og bane-kompatibilitet
    FORMAT_HIERARCHY: FORMAT_HIERARCHY,
    PITCH_DIVISIONS: PITCH_DIVISIONS,
    isFormatCompatible: isFormatCompatible,
    expandPitches: expandPitches,
    migrateCupData: migrateCupData,

    // Plassering
    placeMatches: placeMatches,
    scheduleMultiAttempt: scheduleMultiAttempt,
    scheduleAllClasses: scheduleAllClasses,  // compat: cup.js orkestrator

    // Gjennomforbarhet
    checkFeasibility: checkFeasibility,      // ny API (cup-mini.js)
    calcFeasibility: calcFeasibility,        // compat: cup.js (per-klasse array)

    // Validering
    validateSchedule: validateSchedule,      // compat: cup.js

    // Tabell
    calcStandings: calcStandings,

    // Konfliktsjekk
    checkMoveConflicts: checkMoveConflicts,

    // Fabrikker
    cupUuid: cupUuid,
    uuid: cupUuid,                           // compat: cup.js
    createEmptyCup: createEmptyCup,
    createClass: createClass,
    createTeam: createTeam,

    // Puljeinndeling
    autoPoolCount: autoPoolCount,
    assignTeamsToPools: assignTeamsToPools,
    generatePoolMatches: generatePoolMatches,
    validatePools: validatePools,
    countClassMatches: countClassMatches,

    // Full flyt (cup-mini.js)
    generateSchedule: generateSchedule,
  };

})();
