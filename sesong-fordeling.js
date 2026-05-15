/**
 * sesong-fordeling.js — Season distribution: km calculation, opponent mapping
 * IIFE exposing window.sesongFordeling
 * Depends on: window.KOMMUNE_DATA (kommune-data.js), window.supabase (auth.js)
 */
(function() {
  'use strict';

  // =========================================================================
  //  HAVERSINE
  // =========================================================================

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // =========================================================================
  //  OPPONENT → KOMMUNE MATCHING
  // =========================================================================

  /**
   * Try to match an opponent name to a KOMMUNE_DATA key.
   * Step 1: Direct lowercase match
   * Step 2: Strip trailing digits and whitespace ("Verdal 2" → "verdal")
   * Step 3: Check season-level alias mapping (distribution_config.opponent_mapping)
   * Returns { kommune: string, lat: number, lon: number } or null.
   */
  function matchOpponentToKommune(opponentName, opponentMapping) {
    if (!opponentName || !window.KOMMUNE_DATA) return null;

    var name = opponentName.toLowerCase().trim();

    // Step 1: Direct match
    if (window.KOMMUNE_DATA[name]) {
      var d = window.KOMMUNE_DATA[name];
      return { kommune: name, lat: d.lat, lon: d.lon };
    }

    // Step 2: Strip trailing digits + whitespace ("Verdal 2" → "verdal")
    var stripped = name.replace(/\s+\d+$/, '').trim();
    if (stripped !== name && window.KOMMUNE_DATA[stripped]) {
      var d2 = window.KOMMUNE_DATA[stripped];
      return { kommune: stripped, lat: d2.lat, lon: d2.lon };
    }

    // Step 3: Per-season alias mapping
    if (opponentMapping) {
      var alias = opponentMapping[opponentName] || opponentMapping[name];
      if (alias && window.KOMMUNE_DATA[alias]) {
        var d3 = window.KOMMUNE_DATA[alias];
        return { kommune: alias, lat: d3.lat, lon: d3.lon };
      }
    }

    return null;
  }

  // =========================================================================
  //  INTERNAL MATCH DETECTION
  // =========================================================================

  /**
   * Check if opponent is one of the season's own sub-team names.
   * Internal matches: distance_km = 0, count as home for both teams.
   */
  function isInternalMatch(event, season) {
    if (!event.opponent || !season) return false;
    var names = season.sub_team_names || [];
    var opp = event.opponent.toLowerCase();
    for (var i = 0; i < names.length; i++) {
      var entry = names[i];
      var teamName = (typeof entry === 'string' ? entry : (entry && entry.name) || '').toLowerCase();
      if (!teamName) continue;
      if (opp.indexOf(teamName) !== -1 || teamName.indexOf(opp) !== -1) return true;
    }
    return false;
  }

  // =========================================================================
  //  BATCH KM COMPUTATION
  // =========================================================================

  /**
   * Compute distance_km for all match events in a season.
   * forceRecalc=false (default): skip away matches that already have distance_km set.
   * forceRecalc=true: recalculate all (used when home location changes).
   * Home matches and internal matches always get distance_km=0 regardless of forceRecalc.
   *
   * Returns array of { eventId, location_lat, location_lon, distance_km, matched_kommune, auto_matched }
   * Only includes events where a value changed.
   */
  function computeSeasonDistances(season, events, forceRecalc) {
    if (!season || !season.home_lat || !season.home_lon) return [];

    var opponentMapping = (season.distribution_config && season.distribution_config.opponent_mapping) || {};
    var results = [];

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type !== 'match' && ev.type !== 'cup_match') continue;

      // Home match: distance = 0
      if (ev.is_home === true) {
        if (ev.distance_km !== 0) {
          results.push({
            eventId: ev.id,
            location_lat: season.home_lat,
            location_lon: season.home_lon,
            distance_km: 0,
            matched_kommune: null,
            auto_matched: true
          });
        }
        continue;
      }

      // Internal match: distance = 0
      if (isInternalMatch(ev, season)) {
        if (ev.distance_km !== 0) {
          results.push({
            eventId: ev.id,
            location_lat: season.home_lat,
            location_lon: season.home_lon,
            distance_km: 0,
            matched_kommune: '(intern)',
            auto_matched: true
          });
        }
        continue;
      }

      // Away match: try to match opponent → kommune → haversine
      if (ev.is_home === false && ev.opponent) {
        // Skip if already has distance and not forcing recalc
        if (!forceRecalc && ev.distance_km != null) continue;

        var match = matchOpponentToKommune(ev.opponent, opponentMapping);
        if (match) {
          var km = Math.round(haversineKm(season.home_lat, season.home_lon, match.lat, match.lon));
          // Only include if value actually changed
          if (ev.distance_km !== km || ev.location_lat !== match.lat || ev.location_lon !== match.lon) {
            results.push({
              eventId: ev.id,
              location_lat: match.lat,
              location_lon: match.lon,
              distance_km: km,
              matched_kommune: match.kommune,
              auto_matched: true
            });
          }
        }
        // If no match: leave distance_km as NULL (trener corrects manually)
      }
    }

    return results;
  }

  // =========================================================================
  //  SAVE TO SUPABASE
  // =========================================================================

  /**
   * Batch-save computed distances to events table.
   * Returns count of updated events, or -1 on error.
   */
  async function saveDistances(results) {
    if (!results || results.length === 0) return 0;

    var sb = window.supabase || window.supabaseClient;
    var uid = window.__BF_getOwnerUid ? window.__BF_getOwnerUid() : null;
    if (!sb || !uid) return -1;

    var updated = 0;
    try {
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var res = await sb.from('events')
          .update({
            location_lat: r.location_lat,
            location_lon: r.location_lon,
            distance_km: r.distance_km
          })
          .eq('id', r.eventId)
          .eq('user_id', uid);

        if (!res.error) updated++;
      }
    } catch (e) {
      console.error('[sesong-fordeling] saveDistances error:', e);
      return -1;
    }

    return updated;
  }

  /**
   * Convenience: compute and save in one call.
   * Returns { computed: number, saved: number, unmatched: string[] }
   */
  async function computeAndSave(season, events, forceRecalc) {
    var results = computeSeasonDistances(season, events, forceRecalc);

    // Collect unmatched away opponents (no auto-match AND no existing distance)
    var matchedIds = {};
    for (var r = 0; r < results.length; r++) matchedIds[results[r].eventId] = true;

    var unmatched = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type !== 'match' && ev.type !== 'cup_match') continue;
      if (ev.is_home === false && ev.opponent && !matchedIds[ev.id] && ev.distance_km == null) {
        if (unmatched.indexOf(ev.opponent) === -1) unmatched.push(ev.opponent);
      }
    }

    var saved = await saveDistances(results);

    return {
      computed: results.length,
      saved: saved,
      unmatched: unmatched
    };
  }

  // =========================================================================
  //  DISTRIBUTION ALGORITHM
  // =========================================================================

  var PROFILE_WEIGHTS = {
    balanced:     { km: 3, hb: 3, games: 5, variety: 2, stability: 2 },
    fair_driving: { km: 5, hb: 3, games: 5, variety: 1, stability: 0 },
    varied_teams: { km: 1, hb: 2, games: 5, variety: 5, stability: 0 },
    stable_teams: { km: 1, hb: 2, games: 5, variety: 0, stability: 5 }
  };

  function spread(arr) {
    if (arr.length < 2) return 0;
    var min = arr[0], max = arr[0];
    for (var i = 1; i < arr.length; i++) {
      if (arr[i] < min) min = arr[i];
      if (arr[i] > max) max = arr[i];
    }
    return max - min;
  }

  /**
   * Group events by date into match-days.
   * Internal match-days are excluded (all players participate, no optimization needed).
   * Each match-day has: date, type ('paired'|'solo'), teamEvents, playingTeams, eventIds.
   */
  function buildMatchDays(events, season) {
    var subTeamCount = season.sub_team_count || 2;
    var matches = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type === 'match' || ev.type === 'cup_match') matches.push(ev);
    }

    var byDate = {};
    for (var m = 0; m < matches.length; m++) {
      var date = matches[m].start_time ? matches[m].start_time.substring(0, 10) : 'unknown';
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(matches[m]);
    }

    var result = [];
    var dates = Object.keys(byDate).sort();
    for (var d = 0; d < dates.length; d++) {
      var dayEvents = byDate[dates[d]];

      var hasInternal = false;
      for (var di = 0; di < dayEvents.length; di++) {
        if (isInternalMatch(dayEvents[di], season)) { hasInternal = true; break; }
      }
      if (hasInternal) continue;

      var teamEvents = {};
      var playingTeams = [];
      var eventIds = [];
      for (var e = 0; e < dayEvents.length; e++) {
        var st = dayEvents[e].sub_team || (e + 1);
        teamEvents[st] = {
          eventId: dayEvents[e].id,
          km: (dayEvents[e].is_home === false) ? (dayEvents[e].distance_km || 0) : 0,
          isHome: dayEvents[e].is_home !== false
        };
        playingTeams.push(st);
        eventIds.push(dayEvents[e].id);
      }

      result.push({
        date: dates[d],
        type: playingTeams.length >= subTeamCount ? 'paired' : 'solo',
        teamEvents: teamEvents,
        playingTeams: playingTeams,
        eventIds: eventIds
      });
    }
    return result;
  }

  /**
   * Filter players available for a match-day (respects unavailable_until).
   */
  function getAvailablePlayers(playerIds, spMap, matchDate) {
    var available = [];
    for (var i = 0; i < playerIds.length; i++) {
      var sp = spMap[playerIds[i]];
      if (!sp) continue;
      if (sp.unavailable_until && matchDate && matchDate <= sp.unavailable_until) continue;
      available.push(playerIds[i]);
    }
    return available;
  }

  /**
   * Check if a match-day assignment satisfies all hard constraints.
   * never_together and coach_child only enforced for playing teams.
   */
  function checkConstraints(dayAssignment, playingTeams, constraints, subTeamCount) {
    var at = constraints.always_together || [];
    for (var a = 0; a < at.length; a++) {
      var group = at[a];
      var groupTeam = null;
      for (var g = 0; g < group.length; g++) {
        var t = dayAssignment[group[g]];
        if (t === undefined) continue;
        if (groupTeam === null) groupTeam = t;
        else if (t !== groupTeam) return false;
      }
    }

    var playingSet = {};
    for (var pt = 0; pt < playingTeams.length; pt++) playingSet[playingTeams[pt]] = true;

    var nt = constraints.never_together || [];
    for (var n = 0; n < nt.length; n++) {
      var pair = nt[n];
      if (pair.length < 2) continue;
      var t1 = dayAssignment[pair[0]];
      var t2 = dayAssignment[pair[1]];
      if (t1 === undefined || t2 === undefined) continue;
      if (playingSet[t1] && playingSet[t2] && t1 === t2) return false;
    }

    var cc = constraints.coach_child;
    if (cc && cc.coaches) {
      var childToCoach = {};
      for (var cName in cc.coaches) {
        var children = cc.coaches[cName];
        for (var c = 0; c < children.length; c++) {
          childToCoach[children[c]] = cName;
        }
      }
      var minChildren = cc.min_children_per_game || 0;
      var minCoaches = cc.min_coaches_per_game || 0;

      for (var pt2 = 0; pt2 < playingTeams.length; pt2++) {
        var team = playingTeams[pt2];
        var childCount = 0;
        var coachesRepr = {};
        for (var pid in dayAssignment) {
          if (dayAssignment[pid] !== team) continue;
          if (childToCoach[pid]) {
            childCount++;
            coachesRepr[childToCoach[pid]] = true;
          }
        }
        if (childCount < minChildren) return false;
        if (Object.keys(coachesRepr).length < minCoaches) return false;
      }
    }

    return true;
  }

  /**
   * Generate a random valid assignment for one match-day.
   * Respects always_together, rebalances team sizes, validates all constraints.
   */
  function generateDayAssignment(playerIds, subTeamCount, playingTeams, constraints) {
    for (var attempt = 0; attempt < 50; attempt++) {
      var shuffled = playerIds.slice();
      for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
      }

      var assignment = {};
      var teamSize = Math.ceil(shuffled.length / subTeamCount);
      for (var p = 0; p < shuffled.length; p++) {
        assignment[shuffled[p]] = (Math.floor(p / teamSize) % subTeamCount) + 1;
      }

      // Fix always_together: move all group members to first member's team
      var at = constraints.always_together || [];
      for (var a = 0; a < at.length; a++) {
        var targetTeam = null;
        for (var g = 0; g < at[a].length; g++) {
          if (assignment[at[a][g]] !== undefined) {
            if (targetTeam === null) targetTeam = assignment[at[a][g]];
            else assignment[at[a][g]] = targetTeam;
          }
        }
      }

      // Rebalance teams by moving non-grouped players from oversized to undersized
      var teamCounts = {};
      for (var t = 1; t <= subTeamCount; t++) teamCounts[t] = 0;
      for (var pid in assignment) teamCounts[assignment[pid]]++;

      for (var rb = 0; rb < 30; rb++) {
        var bigTeam = 1, smallTeam = 1, bigC = 0, smallC = Infinity;
        for (var t2 = 1; t2 <= subTeamCount; t2++) {
          if (teamCounts[t2] > bigC) { bigC = teamCounts[t2]; bigTeam = t2; }
          if (teamCounts[t2] < smallC) { smallC = teamCounts[t2]; smallTeam = t2; }
        }
        if (bigC - smallC <= 1) break;

        var moved = false;
        for (var pid2 in assignment) {
          if (assignment[pid2] !== bigTeam) continue;
          var inGroup = false;
          for (var ag = 0; ag < at.length; ag++) {
            if (at[ag].indexOf(pid2) !== -1) { inGroup = true; break; }
          }
          if (!inGroup) {
            assignment[pid2] = smallTeam;
            teamCounts[bigTeam]--;
            teamCounts[smallTeam]++;
            moved = true;
            break;
          }
        }
        if (!moved) break;
      }

      if (checkConstraints(assignment, playingTeams, constraints, subTeamCount)) {
        return assignment;
      }
    }
    return null;
  }

  /**
   * Compute per-player statistics from assignments across all match-days.
   * Used for cost function and for UI display.
   */
  function calcAllStats(allAssignments, matchDays, playerIds) {
    var stats = {};
    for (var i = 0; i < playerIds.length; i++) {
      stats[playerIds[i]] = { totalKm: 0, homeGames: 0, awayGames: 0, totalGames: 0, teammates: {} };
    }

    for (var d = 0; d < matchDays.length; d++) {
      var md = matchDays[d];
      var da = allAssignments[d];
      if (!da) continue;

      for (var pid in da) {
        if (!stats[pid]) continue;
        var team = da[pid];
        var ev = md.teamEvents[team];
        if (!ev) continue; // team doesn't play this day

        stats[pid].totalGames++;
        stats[pid].totalKm += ev.km;
        if (ev.isHome) stats[pid].homeGames++;
        else stats[pid].awayGames++;

        for (var pid2 in da) {
          if (pid2 !== pid && da[pid2] === team && md.teamEvents[team]) {
            stats[pid].teammates[pid2] = true;
          }
        }
      }
    }

    for (var p in stats) {
      stats[p].uniqueTeammates = Object.keys(stats[p].teammates).length;
      delete stats[p].teammates;
    }
    return stats;
  }

  /**
   * Weighted cost function. Lower is better.
   */
  function calcCost(allAssignments, matchDays, playerIds, weights) {
    var stats = calcAllStats(allAssignments, matchDays, playerIds);

    var kmArr = [], hbArr = [], gamesArr = [], varietyArr = [];
    for (var i = 0; i < playerIds.length; i++) {
      var s = stats[playerIds[i]];
      kmArr.push(s.totalKm);
      hbArr.push(s.homeGames - s.awayGames);
      gamesArr.push(s.totalGames);
      varietyArr.push(s.uniqueTeammates);
    }

    // Variety: lower invertedMean = more variety = better
    var maxTeammates = playerIds.length - 1;
    var varietyMean = varietyArr.length > 0
      ? varietyArr.reduce(function(a, b) { return a + b; }, 0) / varietyArr.length
      : 0;
    var varietyCost = maxTeammates - varietyMean;

    // Stability: average overlap between consecutive match-days
    var stabilityCost = 0;
    if (weights.stability > 0 && matchDays.length >= 2) {
      var overlapSum = 0, overlapCount = 0;
      for (var d = 1; d < matchDays.length; d++) {
        var prev = allAssignments[d - 1];
        var curr = allAssignments[d];
        if (!prev || !curr) continue;
        var same = 0, total = 0;
        for (var pid in curr) {
          if (prev[pid] !== undefined) {
            total++;
            if (prev[pid] === curr[pid]) same++;
          }
        }
        if (total > 0) { overlapSum += same / total; overlapCount++; }
      }
      var avgOverlap = overlapCount > 0 ? overlapSum / overlapCount : 0;
      stabilityCost = (1 - avgOverlap) * playerIds.length;
    }

    return spread(kmArr) * weights.km
         + spread(hbArr) * weights.hb
         + spread(gamesArr) * weights.games
         + varietyCost * weights.variety
         + stabilityCost * weights.stability;
  }

  /**
   * Convert match-day-indexed assignments to event-indexed assignments.
   */
  function buildEventAssignments(dayAssignments, matchDays) {
    var result = {};
    for (var d = 0; d < matchDays.length; d++) {
      var md = matchDays[d];
      var da = dayAssignments[d];
      if (!da) continue;
      for (var e = 0; e < md.eventIds.length; e++) {
        var copy = {};
        for (var pid in da) copy[pid] = da[pid];
        result[md.eventIds[e]] = copy;
      }
    }
    return result;
  }

  function equalizeGames(dayAssignments, matchDays, allPlayerIds, constraints, subTeamCount) {
    console.log('[EQ] Start: days=' + matchDays.length + ' players=' + allPlayerIds.length);
    var soloDays = 0;
    for (var sd = 0; sd < matchDays.length; sd++) { if (matchDays[sd].playingTeams.length < subTeamCount) soloDays++; }
    console.log('[EQ] Solo days: ' + soloDays + '/' + matchDays.length);
    var at = constraints.always_together || [];
    var nt = constraints.never_together || [];

    // Build always_together group lookup: pid -> group array
    var atGroup = {};
    for (var a = 0; a < at.length; a++) {
      for (var g = 0; g < at[a].length; g++) atGroup[at[a][g]] = at[a];
    }

    // Build never_together peer lookup: pid -> [peer pids]
    var ntPeers = {};
    for (var n = 0; n < nt.length; n++) {
      if (nt[n].length < 2) continue;
      if (!ntPeers[nt[n][0]]) ntPeers[nt[n][0]] = [];
      if (!ntPeers[nt[n][1]]) ntPeers[nt[n][1]] = [];
      ntPeers[nt[n][0]].push(nt[n][1]);
      ntPeers[nt[n][1]].push(nt[n][0]);
    }

    for (var pass = 0; pass < 20; pass++) {
      // Count games per player
      var games = {};
      for (var i = 0; i < allPlayerIds.length; i++) games[allPlayerIds[i]] = 0;
      for (var d = 0; d < matchDays.length; d++) {
        var da = dayAssignments[d];
        if (!da) continue;
        for (var pid in da) {
          if (games[pid] !== undefined && matchDays[d].teamEvents[da[pid]]) games[pid]++;
        }
      }

      // Check spread
      var maxG = 0, minG = Infinity;
      for (var p = 0; p < allPlayerIds.length; p++) {
        var g2 = games[allPlayerIds[p]];
        if (g2 > maxG) maxG = g2;
        if (g2 < minG) minG = g2;
      }
      console.log('[EQ] Pass ' + pass + ': spread=' + (maxG - minG) + ' (' + minG + '-' + maxG + ')');
      if (maxG - minG <= 1) break;

      var improved = false;

      // Shuffle day order to avoid bias
      var dayOrder = [];
      for (var do1 = 0; do1 < matchDays.length; do1++) dayOrder.push(do1);
      for (var si = dayOrder.length - 1; si > 0; si--) {
        var sj = Math.floor(Math.random() * (si + 1));
        var tmp = dayOrder[si]; dayOrder[si] = dayOrder[sj]; dayOrder[sj] = tmp;
      }

      for (var di = 0; di < dayOrder.length; di++) {
        var dayIdx = dayOrder[di];
        var md = matchDays[dayIdx];
        if (md.playingTeams.length >= subTeamCount) continue;

        var da2 = dayAssignments[dayIdx];
        if (!da2) continue;

        var playingTeam = md.playingTeams[0];
        var nonPlayingTeam = null;
        for (var npid in da2) {
          if (da2[npid] !== playingTeam) { nonPlayingTeam = da2[npid]; break; }
        }
        if (!nonPlayingTeam) continue;

        var dayPids = Object.keys(da2);
        var playCount = 0;
        for (var pc = 0; pc < dayPids.length; pc++) {
          if (da2[dayPids[pc]] === playingTeam) playCount++;
        }

        // Sort by games ascending (fewest games first)
        dayPids.sort(function(a2, b) { return games[a2] - games[b]; });

        // Greedy fill: start all on non-playing, add fewest-games first
        var newDa = {};
        for (var np = 0; np < dayPids.length; np++) newDa[dayPids[np]] = nonPlayingTeam;

        var filled = 0;
        var placed = {};

        for (var ci = 0; ci < dayPids.length && filled < playCount; ci++) {
          var cand = dayPids[ci];
          if (placed[cand]) continue;

          // Check never_together: any peer already on playing team?
          var blocked = false;
          if (ntPeers[cand]) {
            for (var ni = 0; ni < ntPeers[cand].length; ni++) {
              if (newDa[ntPeers[cand][ni]] === playingTeam) { blocked = true; break; }
            }
          }
          if (blocked) continue;

          // If in always_together group, place entire group
          var grp = atGroup[cand];
          if (grp) {
            var grpAvail = grp.filter(function(gp) { return newDa[gp] !== undefined && !placed[gp]; });
            if (filled + grpAvail.length > playCount) continue;
            var grpBlocked = false;
            for (var gi = 0; gi < grpAvail.length && !grpBlocked; gi++) {
              if (ntPeers[grpAvail[gi]]) {
                for (var ni2 = 0; ni2 < ntPeers[grpAvail[gi]].length; ni2++) {
                  if (newDa[ntPeers[grpAvail[gi]][ni2]] === playingTeam) { grpBlocked = true; break; }
                }
              }
            }
            if (grpBlocked) continue;
            for (var gi2 = 0; gi2 < grpAvail.length; gi2++) {
              newDa[grpAvail[gi2]] = playingTeam;
              placed[grpAvail[gi2]] = true;
              filled++;
            }
          } else {
            newDa[cand] = playingTeam;
            placed[cand] = true;
            filled++;
          }
        }

        if (filled < playCount) continue;

        var changed = false;
        for (var chk in newDa) {
          if (newDa[chk] !== da2[chk]) { changed = true; break; }
        }
        if (!changed) continue;

        // Update games counts incrementally
        for (var old in da2) {
          if (games[old] !== undefined && md.teamEvents[da2[old]]) games[old]--;
        }
        dayAssignments[dayIdx] = newDa;
        for (var nw in newDa) {
          if (games[nw] !== undefined && md.teamEvents[newDa[nw]]) games[nw]++;
        }
        improved = true;
      }

      if (!improved) { console.log('[EQ] No improvement, stopping at pass ' + pass); break; }
    }
    // Final count
    var fGames = {};
    for (var fi = 0; fi < allPlayerIds.length; fi++) fGames[allPlayerIds[fi]] = 0;
    for (var fd = 0; fd < matchDays.length; fd++) {
      var fda = dayAssignments[fd]; if (!fda) continue;
      for (var fp in fda) { if (fGames[fp] !== undefined && matchDays[fd].teamEvents[fda[fp]]) fGames[fp]++; }
    }
    var fMin = Infinity, fMax = 0;
    for (var fk in fGames) { if (fGames[fk] < fMin) fMin = fGames[fk]; if (fGames[fk] > fMax) fMax = fGames[fk]; }
    console.log('[EQ] FINAL: ' + fMin + '-' + fMax + ' (spread ' + (fMax - fMin) + ')');
  }

  /**
   * Main entry point: run the distribution algorithm.
   *
   * @param {Object} season - Current season object (with distribution_config)
   * @param {Array} events - All events in the season
   * @param {Array} seasonPlayers - All season players
   * @param {Object} [lockedAssignments] - { eventId: { playerId: subTeam } } for played matches
   * @returns {Object} { assignments, stats, cost, matchDays, lockedCount, optimizedCount }
   */
  function runDistribution(season, events, seasonPlayers, lockedAssignments) {
    var config = season.distribution_config || {};
    var profileId = config.profile || 'balanced';
    var weights = PROFILE_WEIGHTS[profileId] || PROFILE_WEIGHTS.balanced;
    var constraints = config.constraints || {};
    var subTeamCount = season.sub_team_count || 2;

    var activePlayers = [];
    var spMap = {};
    for (var i = 0; i < seasonPlayers.length; i++) {
      if (seasonPlayers[i].active !== false) {
        activePlayers.push(seasonPlayers[i]);
        spMap[seasonPlayers[i].player_id] = seasonPlayers[i];
      }
    }
    var allPlayerIds = activePlayers.map(function(p) { return p.player_id; });

    var matchDays = buildMatchDays(events, season);
    var locked = lockedAssignments || {};

    // Build initial assignments (locked days use provided data, others get random)
    var bestAssignments = [];
    var lockedCount = 0;
    var optimizedIndices = [];

    for (var d = 0; d < matchDays.length; d++) {
      var md = matchDays[d];
      var isLocked = false;
      var lockedDay = {};

      for (var e = 0; e < md.eventIds.length; e++) {
        if (locked[md.eventIds[e]]) {
          isLocked = true;
          var la = locked[md.eventIds[e]];
          for (var pid in la) lockedDay[pid] = la[pid];
        }
      }

      if (isLocked && Object.keys(lockedDay).length > 0) {
        bestAssignments.push(lockedDay);
        lockedCount++;
      } else {
        var available = getAvailablePlayers(allPlayerIds, spMap, md.date);
        var dayAssign = generateDayAssignment(available, subTeamCount, md.playingTeams, constraints);
        bestAssignments.push(dayAssign || {});
        optimizedIndices.push(d);
      }
    }

    if (optimizedIndices.length === 0) {
      return {
        assignments: buildEventAssignments(bestAssignments, matchDays),
        stats: calcAllStats(bestAssignments, matchDays, allPlayerIds),
        cost: 0,
        matchDays: matchDays,
        lockedCount: lockedCount,
        optimizedCount: 0
      };
    }

    // Hill-climbing with random restart (incremental cost update)
    var RESTARTS = 8;
    var ITERATIONS = 500;
    var STALE_LIMIT = 60;

    // Player index mapping for fast array access
    var pidIndex = {};
    for (var pi2 = 0; pi2 < allPlayerIds.length; pi2++) pidIndex[allPlayerIds[pi2]] = pi2;
    var P = allPlayerIds.length;

    function buildRunArrays(assignments) {
      var km = new Array(P), hb = new Array(P), games = new Array(P);
      for (var i = 0; i < P; i++) { km[i] = 0; hb[i] = 0; games[i] = 0; }
      for (var d = 0; d < matchDays.length; d++) {
        var da = assignments[d];
        if (!da) continue;
        var md = matchDays[d];
        for (var pid in da) {
          var idx = pidIndex[pid];
          if (idx === undefined) continue;
          var ev = md.teamEvents[da[pid]];
          if (!ev) continue;
          km[idx] += ev.km;
          games[idx]++;
          hb[idx] += ev.isHome ? 1 : -1;
        }
      }
      return { km: km, hb: hb, games: games };
    }

    function fastSpread(arr) {
      var min = arr[0], max = arr[0];
      for (var i = 1; i < P; i++) {
        if (arr[i] < min) min = arr[i];
        if (arr[i] > max) max = arr[i];
      }
      return max - min;
    }

    function fastCost(rs) {
      return fastSpread(rs.km) * weights.km
           + fastSpread(rs.hb) * weights.hb
           + fastSpread(rs.games) * weights.games;
    }

    var bestCost = Infinity;

    for (var restart = 0; restart < RESTARTS; restart++) {
      var current = bestAssignments.slice();
      for (var oi = 0; oi < optimizedIndices.length; oi++) {
        var di = optimizedIndices[oi];
        var md2 = matchDays[di];
        var avail = getAvailablePlayers(allPlayerIds, spMap, md2.date);
        var fresh = generateDayAssignment(avail, subTeamCount, md2.playingTeams, constraints);
        current[di] = fresh || current[di];
      }

      var rs = buildRunArrays(current);
      var currentCost = fastCost(rs);
      var noImprove = 0;

      for (var iter = 0; iter < ITERATIONS; iter++) {
        var dayIdx = optimizedIndices[Math.floor(Math.random() * optimizedIndices.length)];
        var da = current[dayIdx];
        if (!da) continue;

        var teams = {};
        for (var pid in da) {
          var t = da[pid];
          if (!teams[t]) teams[t] = [];
          teams[t].push(pid);
        }
        var teamNums = Object.keys(teams).map(Number);
        if (teamNums.length < 2) continue;

        var ti1 = Math.floor(Math.random() * teamNums.length);
        var ti2 = (ti1 + 1 + Math.floor(Math.random() * (teamNums.length - 1))) % teamNums.length;
        var tA = teamNums[ti1], tB = teamNums[ti2];
        if (!teams[tA].length || !teams[tB].length) continue;

        var pA = teams[tA][Math.floor(Math.random() * teams[tA].length)];
        var pB = teams[tB][Math.floor(Math.random() * teams[tB].length)];

        var idxA = pidIndex[pA], idxB = pidIndex[pB];
        var md3 = matchDays[dayIdx];
        var oldEvA = md3.teamEvents[tA], oldEvB = md3.teamEvents[tB];
        var newEvA = md3.teamEvents[tB], newEvB = md3.teamEvents[tA];

        // Save old array values
        var sKmA = rs.km[idxA], sKmB = rs.km[idxB];
        var sHbA = rs.hb[idxA], sHbB = rs.hb[idxB];
        var sGmA = rs.games[idxA], sGmB = rs.games[idxB];

        // Incremental update for A
        if (oldEvA) { rs.km[idxA] -= oldEvA.km; rs.games[idxA]--; rs.hb[idxA] -= oldEvA.isHome ? 1 : -1; }
        if (newEvA) { rs.km[idxA] += newEvA.km; rs.games[idxA]++; rs.hb[idxA] += newEvA.isHome ? 1 : -1; }
        // Incremental update for B
        if (oldEvB) { rs.km[idxB] -= oldEvB.km; rs.games[idxB]--; rs.hb[idxB] -= oldEvB.isHome ? 1 : -1; }
        if (newEvB) { rs.km[idxB] += newEvB.km; rs.games[idxB]++; rs.hb[idxB] += newEvB.isHome ? 1 : -1; }

        da[pA] = tB;
        da[pB] = tA;

        if (!checkConstraints(da, md3.playingTeams, constraints, subTeamCount)) {
          da[pA] = tA; da[pB] = tB;
          rs.km[idxA] = sKmA; rs.km[idxB] = sKmB;
          rs.hb[idxA] = sHbA; rs.hb[idxB] = sHbB;
          rs.games[idxA] = sGmA; rs.games[idxB] = sGmB;
          continue;
        }

        var newCost = fastCost(rs);
        if (newCost < currentCost) {
          currentCost = newCost;
          noImprove = 0;
        } else {
          da[pA] = tA; da[pB] = tB;
          rs.km[idxA] = sKmA; rs.km[idxB] = sKmB;
          rs.hb[idxA] = sHbA; rs.hb[idxB] = sHbB;
          rs.games[idxA] = sGmA; rs.games[idxB] = sGmB;
          noImprove++;
          if (noImprove >= STALE_LIMIT) break;
        }
      }

      if (currentCost < bestCost) {
        bestCost = currentCost;
        bestAssignments = current.map(function(da) {
          if (!da) return null;
          var copy = {};
          for (var k in da) copy[k] = da[k];
          return copy;
        });
      }
    }

    // Post-processing: equalize games per player (swap between playing/non-playing teams)
    equalizeGames(bestAssignments, matchDays, allPlayerIds, constraints, subTeamCount);

    // Final stats with full teammate tracking (skipped during optimization for performance)
    var finalStats = calcAllStats(bestAssignments, matchDays, allPlayerIds);
    var finalCost = calcCost(bestAssignments, matchDays, allPlayerIds, weights);

    return {
      assignments: buildEventAssignments(bestAssignments, matchDays),
      stats: finalStats,
      cost: finalCost,
      matchDays: matchDays,
      lockedCount: lockedCount,
      optimizedCount: optimizedIndices.length
    };
  }

  // =========================================================================
  //  JERSEY / DRAKTFARGE
  // =========================================================================

  /**
   * Determine jersey color for a specific sub-team in a specific match.
   * Priority: per-match override (events.jersey) > season config > null.
   */
  function getJersey(event, season, subTeamIndex) {
    // Per-match override has priority
    if (event.jersey) return event.jersey;

    if (!season || !season.sub_team_names) return null;
    var config = season.sub_team_names[subTeamIndex - 1];
    if (!config || typeof config === 'string') return null;

    // Same jersey home/away
    if (config.jersey_home && config.jersey_home === config.jersey_away) return config.jersey_home;

    // Choose based on H/B
    if (event.is_home === true) return config.jersey_home || null;
    if (event.is_home === false) return config.jersey_away || null;
    return config.jersey_home || null;
  }

  // =========================================================================
  //  DISTRIBUTION UI
  // =========================================================================

  var PROFILE_LABELS = {
    balanced: 'Balansert',
    fair_driving: 'Rettferdig kj\u00f8ring',
    varied_teams: 'Varierte lag',
    stable_teams: 'Faste lag'
  };

  var _distResult = null;
  var _distDayIdx = 0;
  var _distOpts = null;
  var _distContainer = null;
  var _distModified = false;
  var _sfDragPid = null;
  var _sfGhost = null;
  var _sfOverZone = null;

  var SHORT_MONTHS = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];

  function formatShortDate(isoDate) {
    if (!isoDate) return '?';
    var parts = isoDate.split('-');
    var d = parseInt(parts[2]);
    var m = parseInt(parts[1]) - 1;
    return d + '. ' + (SHORT_MONTHS[m] || '');
  }

  function buildPlayerMap(seasonPlayers) {
    var map = {};
    for (var i = 0; i < seasonPlayers.length; i++) {
      map[seasonPlayers[i].player_id] = seasonPlayers[i];
    }
    return map;
  }

  /**
   * Main UI entry point. Called from season.js renderDistributionView.
   */
  function initUI(container, opts) {
    _distOpts = opts;
    _distDayIdx = 0;
    _distResult = null;
    _distModified = false;

    // Show spinner
    container.innerHTML =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="sfBack"><i class="fas fa-chevron-left"></i> Kalender</button>' +
          '<span class="sn-dash-title">Sesongfordeling</span>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:center;padding:40px 20px;">' +
        '<i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary);margin-bottom:12px;"></i>' +
        '<div style="font-size:14px;color:var(--text-500);">Beregner fordeling\u2026</div>' +
      '</div>';

    document.getElementById('sfBack').addEventListener('click', function() {
      if (opts.onClose) opts.onClose();
    });

    // Run algorithm after DOM update
    setTimeout(function() {
      var preWarnings = validateConstraints(opts.season, opts.seasonPlayers);
      _distResult = runDistribution(opts.season, opts.events, opts.seasonPlayers);

      // Count failed days
      var failedDays = 0;
      for (var fd = 0; fd < _distResult.matchDays.length; fd++) {
        var fda = _distResult.assignments[_distResult.matchDays[fd].eventIds[0]];
        if (!fda || Object.keys(fda).length === 0) failedDays++;
      }
      _distResult._preWarnings = preWarnings;
      _distResult._failedDays = failedDays;

      renderDistributionResult(container);
    }, 50);
  }

  function renderDistributionResult(container) {
    _distContainer = container;
    var opts = _distOpts;
    var result = _distResult;
    if (!opts || !result) return;

    var h = opts.helpers;
    var season = opts.season;
    var matchDays = result.matchDays;
    var config = season.distribution_config || {};
    var profileId = config.profile || 'balanced';
    var profileLabel = PROFILE_LABELS[profileId] || 'Balansert';

    // --- HEADER ---
    var html =
      '<div class="settings-card">' +
        '<div class="sn-dash-header">' +
          '<button class="sn-back" id="sfBack"><i class="fas fa-chevron-left"></i> Kalender</button>' +
          '<span class="sn-dash-title">Sesongfordeling</span>' +
          '<span id="sfModBadge" style="display:none;font-size:11px;color:var(--warning,#eab308);">(endret)</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px;color:var(--text-500);">' +
          '<span style="background:var(--bg);padding:3px 10px;border-radius:20px;font-weight:500;">' + h.escapeHtml(profileLabel) + '</span>' +
          '<span>' + result.optimizedCount + ' kampdager fordelt</span>' +
          (result.lockedCount > 0 ? '<span>\u00b7 ' + result.lockedCount + ' l\u00e5st</span>' : '') +
        '</div>' +
      '</div>';

    // --- PRE-VALIDATION WARNINGS ---
    var hasPreWarnings = result._preWarnings && result._preWarnings.length > 0;
    var hasFailedDays = result._failedDays > 0;
    if (hasPreWarnings || hasFailedDays) {
      html += '<div style="margin-top:8px;padding:10px 14px;border-radius:var(--radius-md);background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);">';
      if (hasPreWarnings) {
        for (var pw = 0; pw < result._preWarnings.length; pw++) {
          html += '<div style="font-size:13px;color:var(--text-800);padding:3px 0;"><i class="fas fa-exclamation-circle" style="color:var(--error,#ef4444);margin-right:6px;"></i>' + h.escapeHtml(result._preWarnings[pw]) + '</div>';
        }
      }
      if (hasFailedDays) {
        html += '<div style="font-size:13px;font-weight:600;color:var(--error,#ef4444);padding:' + (hasPreWarnings ? '6px 0 0' : '3px 0') + ';">' + result._failedDays + ' av ' + result.matchDays.length + ' kampdager kunne ikke fordeles. Sjekk f\u00f8ringene og beregn p\u00e5 nytt.</div>';
      }
      html += '</div>';
    }

    // --- DATE STRIP ---
    if (matchDays.length > 0) {
      html += '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0;">' +
        '<div style="display:flex;gap:6px;padding:2px 4px;min-width:max-content;" id="sfDateStrip">';
      for (var d = 0; d < matchDays.length; d++) {
        var md = matchDays[d];
        var dayLabel = formatShortDate(md.date);
        var isActive = (d === _distDayIdx);
        html += '<button class="sn-filter-tab' + (isActive ? ' active' : '') + '" data-didx="' + d + '" style="white-space:nowrap;padding:6px 12px;font-size:12px;">' + dayLabel + '</button>';
      }
      html += '</div></div>';
    }

    // --- MATCH-DAY CONTENT ---
    html += '<div id="sfDayContent"></div>';

    // --- STATS SUMMARY (rendered separately for live updates) ---
    html += '<div id="sfStatsSection"></div>';

    // --- ACTION BUTTONS ---
    html +=
      '<div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">' +
        '<button class="btn-primary" id="sfSave" style="width:100%;"><i class="fas fa-save" style="margin-right:6px;"></i>Lagre fordeling</button>' +
        '<button class="btn-secondary" id="sfRerun" style="width:100%;font-size:13px;"><i class="fas fa-magic" style="margin-right:5px;"></i>Beregn p\u00e5 nytt</button>' +
      '</div>';

    container.innerHTML = html;

    // --- RENDER CURRENT DAY AND STATS ---
    renderDay();
    renderStatsSection();
    bindProfileSwitchButtons();

    // --- BIND HANDLERS ---
    document.getElementById('sfBack').addEventListener('click', function() {
      if (_distModified && !confirm('Du har ulagrede endringer. Vil du forlate uten \u00e5 lagre?')) return;
      if (opts.onClose) opts.onClose();
    });

    // Date strip navigation
    var dateBtns = container.querySelectorAll('[data-didx]');
    for (var db = 0; db < dateBtns.length; db++) {
      dateBtns[db].addEventListener('click', function() {
        _distDayIdx = parseInt(this.getAttribute('data-didx'));
        var all = container.querySelectorAll('[data-didx]');
        for (var j = 0; j < all.length; j++) all[j].classList.remove('active');
        this.classList.add('active');
        renderDay();
      });
    }

    // Rerun
    document.getElementById('sfRerun').addEventListener('click', function() {
      if (_distModified && !confirm('Manuelle endringer vil g\u00e5 tapt. Beregne p\u00e5 nytt?')) return;
      initUI(container, opts);
    });

    // Save
    document.getElementById('sfSave').addEventListener('click', async function() {
      var btn = document.getElementById('sfSave');
      btn.disabled = true;
      btn.textContent = 'Lagrer\u2026';

      var ok = await saveDistributionResult(result, opts);
      if (ok) {
        h.notify('Fordeling lagret for ' + result.optimizedCount + ' kampdager!', 'success');
        if (opts.onSaved) opts.onSaved();
      } else {
        h.notify('Feil ved lagring.', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save" style="margin-right:6px;"></i>Lagre fordeling';
      }
    });
  }

  // =========================================================================
  //  DRAG-AND-DROP HANDLERS
  // =========================================================================

  var _sfStartX = 0, _sfStartY = 0, _sfDragActive = false;
  var SF_DRAG_THRESHOLD = 8;

  function sfDragStart(e) {
    var chip = e.target.closest('.sf-chip[data-pid]');
    if (!chip) return;
    var pt = e.touches ? e.touches[0] : e;
    _sfStartX = pt.clientX;
    _sfStartY = pt.clientY;
    _sfDragPid = chip.getAttribute('data-pid');
    _sfDragActive = false;

    // Bind document-level listeners for this drag session
    document.addEventListener('touchmove', sfDragMove, { passive: false });
    document.addEventListener('mousemove', sfDragMove);
    document.addEventListener('touchend', sfDragEnd);
    document.addEventListener('mouseup', sfDragEnd);
  }

  function sfDragMove(e) {
    if (!_sfDragPid) return;
    var pt = e.touches ? e.touches[0] : e;

    // Activate drag only after threshold (prevents scroll interference)
    if (!_sfDragActive) {
      var dx = pt.clientX - _sfStartX;
      var dy = pt.clientY - _sfStartY;
      if (Math.abs(dx) + Math.abs(dy) < SF_DRAG_THRESHOLD) return;
      _sfDragActive = true;
      e.preventDefault();

      // Create ghost and mark source
      var chip = document.querySelector('.sf-chip[data-pid="' + _sfDragPid + '"]');
      if (chip) chip.classList.add('sf-dragging-src');

      _sfGhost = document.createElement('div');
      _sfGhost.className = 'sf-ghost';
      if (chip) _sfGhost.innerHTML = chip.innerHTML;
      document.body.appendChild(_sfGhost);
    }

    if (!_sfGhost) return;
    e.preventDefault();
    _sfGhost.style.left = (pt.clientX - 40) + 'px';
    _sfGhost.style.top = (pt.clientY - 20) + 'px';

    // Detect drop zone under pointer (hide ghost to avoid self-hit)
    _sfGhost.style.display = 'none';
    var el = document.elementFromPoint(pt.clientX, pt.clientY);
    _sfGhost.style.display = '';

    var zone = el ? el.closest('.sf-drop-zone[data-drop-team]') : null;
    if (zone !== _sfOverZone) {
      if (_sfOverZone) _sfOverZone.classList.remove('sf-drag-over');
      _sfOverZone = zone;
      if (_sfOverZone) _sfOverZone.classList.add('sf-drag-over');
    }
  }

  function sfDragEnd(e) {
    if (!_sfDragPid) return;

    // Clean up source styling
    var src = document.querySelector('.sf-chip.sf-dragging-src');
    if (src) src.classList.remove('sf-dragging-src');

    // Remove ghost
    if (_sfGhost) { _sfGhost.remove(); _sfGhost = null; }

    // Process drop (skip if dropped on current team)
    if (_sfOverZone && _sfDragActive) {
      _sfOverZone.classList.remove('sf-drag-over');
      var newTeam = parseInt(_sfOverZone.getAttribute('data-drop-team'), 10);
      // Find current team
      var curAssign = _distResult && _distResult.matchDays[_distDayIdx]
        ? _distResult.assignments[_distResult.matchDays[_distDayIdx].eventIds[0]] || {}
        : {};
      var curTeam = curAssign[_sfDragPid];
      if (curTeam === undefined) curTeam = 0;
      if (newTeam !== curTeam) handlePlayerChange(_sfDragPid, newTeam);
    } else if (_sfOverZone) {
      _sfOverZone.classList.remove('sf-drag-over');
    }

    _sfOverZone = null;
    _sfDragPid = null;

    // Unbind document-level listeners
    document.removeEventListener('touchmove', sfDragMove);
    document.removeEventListener('mousemove', sfDragMove);
    document.removeEventListener('touchend', sfDragEnd);
    document.removeEventListener('mouseup', sfDragEnd);
  }

  function bindDragHandlers(container) {
    var chips = container.querySelectorAll('.sf-chip[data-pid]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('touchstart', sfDragStart, { passive: false });
      chips[i].addEventListener('mousedown', sfDragStart);
    }
  }

  function renderDay() {
    var dayEl = document.getElementById('sfDayContent');
    if (!dayEl || !_distResult || !_distOpts) return;

    var opts = _distOpts;
    var h = opts.helpers;
    var season = opts.season;
    var result = _distResult;
    var matchDays = result.matchDays;
    var playerMap = buildPlayerMap(opts.seasonPlayers);
    var constraints = (season.distribution_config || {}).constraints || {};

    if (_distDayIdx >= matchDays.length) { dayEl.innerHTML = ''; return; }

    var md = matchDays[_distDayIdx];
    var subTeamCount = season.sub_team_count || 2;
    var stNames = h.getSubTeamNames(season);

    // Get assignment for this day (from first event)
    var dayAssign = result.assignments[md.eventIds[0]] || {};

    // Build teams + collect absent players
    var teams = {};
    for (var t = 1; t <= subTeamCount; t++) teams[t] = [];
    for (var pid in dayAssign) {
      var team = dayAssign[pid];
      if (!teams[team]) teams[team] = [];
      teams[team].push(pid);
    }
    var absent = [];
    var activePlayers = opts.seasonPlayers.filter(function(p) { return p.active !== false; });
    for (var ap = 0; ap < activePlayers.length; ap++) {
      if (dayAssign[activePlayers[ap].player_id] === undefined) {
        absent.push(activePlayers[ap].player_id);
      }
    }

    // Sort players by name within each team
    for (var tk in teams) {
      teams[tk].sort(function(a, b) {
        var na = playerMap[a] ? playerMap[a].name : a;
        var nb = playerMap[b] ? playerMap[b].name : b;
        return na.localeCompare(nb, 'nb');
      });
    }
    absent.sort(function(a, b) {
      var na = playerMap[a] ? playerMap[a].name : a;
      var nb = playerMap[b] ? playerMap[b].name : b;
      return na.localeCompare(nb, 'nb');
    });

    // Constraint warnings
    var warnings = getConstraintViolations(dayAssign, md.playingTeams, constraints, playerMap);

    var html = '<div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">';

    // Empty day warning
    if (Object.keys(dayAssign).length === 0) {
      html += '<div class="settings-card" style="text-align:center;color:var(--warning,#eab308);padding:16px;">' +
        '<i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>Kunne ikke fordele denne kampdagen. Sjekk f\u00f8ringene.' +
      '</div>';
    }

    // Constraint warnings
    if (warnings.length > 0) {
      html += '<div style="padding:8px 12px;border-radius:var(--radius-md);background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);">';
      for (var w = 0; w < warnings.length; w++) {
        html += '<div style="font-size:12px;color:var(--text-700);padding:2px 0;">' + h.escapeHtml(warnings[w]) + '</div>';
      }
      html += '</div>';
    }

    for (var ti = 1; ti <= subTeamCount; ti++) {
      var teamPlayers = teams[ti] || [];
      var teamName = stNames[ti - 1] || ('Lag ' + String.fromCharCode(64 + ti));
      var color = h.getSubTeamColor(ti);
      var ev = md.teamEvents[ti];
      var isPlaying = !!ev;

      html += '<div class="settings-card" style="padding:0;border-left:4px solid ' + color + ';">';

      // Team header
      html += '<div style="padding:10px 14px;border-bottom:1px solid var(--border-light,#f1f5f9);">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      html += '<span style="font-weight:600;font-size:14px;color:' + color + ';">' + h.escapeHtml(teamName) + '</span>';
      html += '<span style="font-size:12px;color:var(--text-400);">' + teamPlayers.length + ' spillere</span>';
      html += '</div>';

      if (isPlaying) {
        var eventObj = null;
        for (var ei = 0; ei < opts.events.length; ei++) {
          if (opts.events[ei].id === ev.eventId) { eventObj = opts.events[ei]; break; }
        }

        var oppText = eventObj ? h.escapeHtml(eventObj.opponent || '?') : '?';
        var hbText = ev.isHome ? 'Hjemme' : 'Borte';
        var kmText = ev.km > 0 ? ' \u00b7 ' + ev.km + ' km' : '';
        var jerseyText = '';
        var jersey = getJersey(eventObj || {}, season, ti);
        if (jersey) jerseyText = ' \u00b7 ' + h.escapeHtml(jersey);

        html += '<div style="font-size:12px;color:var(--text-500);margin-top:2px;">' +
          'vs ' + oppText + ' (' + hbText + ')' + kmText + jerseyText +
        '</div>';
      } else {
        html += '<div style="font-size:12px;color:var(--text-400);margin-top:2px;font-style:italic;">Har fri denne dagen</div>';
      }
      html += '</div>';

      // Player list (draggable chips in drop zone)
      html += '<div class="sf-drop-zone" data-drop-team="' + ti + '" style="padding:6px 0;min-height:44px;transition:background 0.15s;">';
      if (teamPlayers.length === 0) {
        html += '<div style="padding:8px 14px;font-size:12px;color:var(--text-400);font-style:italic;">Dra spillere hit</div>';
      }
      for (var p = 0; p < teamPlayers.length; p++) {
        var pid2 = teamPlayers[p];
        var sp2 = playerMap[pid2];
        var pName = sp2 ? sp2.name : pid2;
        html += '<div class="sf-chip" data-pid="' + h.escapeHtml(pid2) + '" style="display:flex;align-items:center;gap:8px;padding:6px 14px;margin:2px 6px;font-size:13px;border-radius:6px;cursor:grab;user-select:none;-webkit-user-select:none;">' +
          h.renderSeasonAvatar(pid2, pName, 24) +
          '<span style="flex:1;">' + h.escapeHtml(pName) + '</span>' +
          '<i class="fas fa-grip-vertical" style="color:var(--text-300);font-size:10px;"></i>' +
        '</div>';
      }
      html += '</div></div>';
    }

    // Absent players section (always visible as drop target)
    html += '<div class="settings-card" style="padding:0;border-left:4px solid var(--text-300);' + (absent.length === 0 ? 'opacity:0.4;' : 'opacity:0.7;') + '">';
    html += '<div style="padding:8px 14px;font-size:13px;font-weight:600;color:var(--text-400);border-bottom:1px solid var(--border-light,#f1f5f9);">Frav\u00e6rende' + (absent.length > 0 ? ' (' + absent.length + ')' : '') + '</div>';
    html += '<div class="sf-drop-zone" data-drop-team="0" style="padding:6px 0;min-height:44px;transition:background 0.15s;">';
    if (absent.length === 0) {
      html += '<div style="padding:8px 14px;font-size:12px;color:var(--text-300);font-style:italic;">Dra spillere hit for \u00e5 melde frav\u00e6r</div>';
    }
    for (var ab = 0; ab < absent.length; ab++) {
      var abPid = absent[ab];
      var abSp = playerMap[abPid];
      var abName = abSp ? abSp.name : abPid;
      html += '<div class="sf-chip" data-pid="' + h.escapeHtml(abPid) + '" style="display:flex;align-items:center;gap:8px;padding:6px 14px;margin:2px 6px;font-size:13px;border-radius:6px;cursor:grab;user-select:none;-webkit-user-select:none;">' +
        h.renderSeasonAvatar(abPid, abName, 24) +
        '<span style="flex:1;color:var(--text-400);">' + h.escapeHtml(abName) + '</span>' +
        '<i class="fas fa-grip-vertical" style="color:var(--text-300);font-size:10px;"></i>' +
      '</div>';
    }
    html += '</div></div>';

    html += '</div>';
    dayEl.innerHTML = html;

    // Bind drag handlers
    bindDragHandlers(dayEl);
  }

  // =========================================================================
  //  MANUAL ADJUSTMENTS (move player, mark absent, constraint warnings)
  // =========================================================================

  /**
   * Get human-readable constraint violation warnings for a match-day assignment.
   * Returns array of warning strings (empty = no violations).
   */
  function getConstraintViolations(dayAssignment, playingTeams, constraints, playerMap) {
    var warnings = [];
    var playingSet = {};
    for (var pt = 0; pt < playingTeams.length; pt++) playingSet[playingTeams[pt]] = true;

    // Always together
    var at = constraints.always_together || [];
    for (var a = 0; a < at.length; a++) {
      var group = at[a];
      var groupTeam = null;
      var split = false;
      var names = [];
      for (var g = 0; g < group.length; g++) {
        var name = playerMap[group[g]] ? playerMap[group[g]].name : group[g];
        names.push(name);
        var t = dayAssignment[group[g]];
        if (t === undefined) continue;
        if (groupTeam === null) groupTeam = t;
        else if (t !== groupTeam) split = true;
      }
      if (split) warnings.push('\u26a0\ufe0f ' + names.join(' og ') + ' er satt til alltid sammen');
    }

    // Never together (only on playing teams)
    var nt = constraints.never_together || [];
    for (var n = 0; n < nt.length; n++) {
      var pair = nt[n];
      if (pair.length < 2) continue;
      var t1 = dayAssignment[pair[0]];
      var t2 = dayAssignment[pair[1]];
      if (t1 === undefined || t2 === undefined) continue;
      if (playingSet[t1] && playingSet[t2] && t1 === t2) {
        var n1 = playerMap[pair[0]] ? playerMap[pair[0]].name : pair[0];
        var n2 = playerMap[pair[1]] ? playerMap[pair[1]].name : pair[1];
        warnings.push('\u26a0\ufe0f ' + n1 + ' og ' + n2 + ' skal ikke v\u00e6re p\u00e5 samme lag');
      }
    }

    // Coach child
    var cc = constraints.coach_child;
    if (cc && cc.coaches) {
      var childToCoach = {};
      for (var cName in cc.coaches) {
        var children = cc.coaches[cName];
        for (var c = 0; c < children.length; c++) childToCoach[children[c]] = cName;
      }
      for (var pt2 = 0; pt2 < playingTeams.length; pt2++) {
        var team = playingTeams[pt2];
        var childCount = 0;
        var coachesRepr = {};
        for (var pid in dayAssignment) {
          if (dayAssignment[pid] !== team) continue;
          if (childToCoach[pid]) { childCount++; coachesRepr[childToCoach[pid]] = true; }
        }
        if (childCount < (cc.min_children_per_game || 0)) {
          warnings.push('\u26a0\ufe0f Lag ' + team + ': ' + childCount + ' trenerbarn (min ' + cc.min_children_per_game + ')');
        }
        if (Object.keys(coachesRepr).length < (cc.min_coaches_per_game || 0)) {
          warnings.push('\u26a0\ufe0f Lag ' + team + ': ' + Object.keys(coachesRepr).length + ' trener(e) representert (min ' + cc.min_coaches_per_game + ')');
        }
      }
    }
    return warnings;
  }

  /**
   * Convert event-indexed assignments back to day-indexed array.
   */
  function rebuildDayAssignments(matchDays, eventAssignments) {
    var dayAssigns = [];
    for (var d = 0; d < matchDays.length; d++) {
      dayAssigns.push(eventAssignments[matchDays[d].eventIds[0]] || {});
    }
    return dayAssigns;
  }

  /**
   * Recalculate stats from current (possibly modified) assignments.
   */
  function recalcStats() {
    if (!_distResult || !_distOpts) return;
    var allPids = _distOpts.seasonPlayers
      .filter(function(p) { return p.active !== false; })
      .map(function(p) { return p.player_id; });
    var dayAssigns = rebuildDayAssignments(_distResult.matchDays, _distResult.assignments);
    _distResult.stats = calcAllStats(dayAssigns, _distResult.matchDays, allPids);
  }

  /**
   * Render the stats summary section into #sfStatsSection.
   */
  function renderStatsSection() {
    var el = document.getElementById('sfStatsSection');
    if (!el || !_distResult || !_distOpts) return;

    var opts = _distOpts;
    var h = opts.helpers;
    var stats = _distResult.stats;

    var activePlayers = opts.seasonPlayers.filter(function(p) { return p.active !== false; });
    activePlayers.sort(function(a, b) {
      var sa = stats[a.player_id] || { totalGames: 0 };
      var sb2 = stats[b.player_id] || { totalGames: 0 };
      if (sb2.totalGames !== sa.totalGames) return sb2.totalGames - sa.totalGames;
      return a.name.localeCompare(b.name, 'nb');
    });

    // Compute jersey distribution per player
    var jerseyStats = {};
    var hasJersey = false;
    var result = _distResult;
    for (var jd = 0; jd < result.matchDays.length; jd++) {
      var jmd = result.matchDays[jd];
      var jda = result.assignments[jmd.eventIds[0]] || {};
      for (var jpid in jda) {
        var jteam = jda[jpid];
        var jev = jmd.teamEvents[jteam];
        if (!jev) continue;
        var jevObj = null;
        for (var jei = 0; jei < opts.events.length; jei++) {
          if (opts.events[jei].id === jev.eventId) { jevObj = opts.events[jei]; break; }
        }
        var jcolor = getJersey(jevObj || {}, opts.season, jteam);
        if (!jcolor) continue;
        hasJersey = true;
        if (!jerseyStats[jpid]) jerseyStats[jpid] = {};
        jerseyStats[jpid][jcolor] = (jerseyStats[jpid][jcolor] || 0) + 1;
      }
    }

    var html = '<div class="sn-section" style="margin-top:16px;">Oversikt</div>';
    html += '<div class="settings-card" style="padding:0;overflow-x:auto;">';
    html += '<table class="sn-stat-table"><thead><tr>' +
      '<th>Spiller</th><th>Ka</th><th>Km</th><th>H</th><th>B</th>' +
      (hasJersey ? '<th>Drakt</th>' : '') +
    '</tr></thead><tbody>';

    var kmValues = [], gamesValues = [];
    for (var si = 0; si < activePlayers.length; si++) {
      var sp = activePlayers[si];
      var s = stats[sp.player_id] || { totalGames: 0, totalKm: 0, homeGames: 0, awayGames: 0 };
      kmValues.push(s.totalKm);
      gamesValues.push(s.totalGames);

      html += '<tr>' +
        '<td class="sn-pname"><div style="display:flex;align-items:center;gap:6px;">' +
          h.renderSeasonAvatar(sp.player_id, sp.name, 24) +
          '<span style="font-size:13px;">' + h.escapeHtml(sp.name) + '</span>' +
        '</div></td>' +
        '<td>' + s.totalGames + '</td>' +
        '<td>' + (s.totalKm > 0 ? s.totalKm : '\u2014') + '</td>' +
        '<td>' + s.homeGames + '</td>' +
        '<td>' + s.awayGames + '</td>' +
        (hasJersey ? '<td style="font-size:11px;white-space:nowrap;">' + (function() {
          var js = jerseyStats[sp.player_id];
          if (!js) return '\u2014';
          var parts = [];
          for (var jk in js) parts.push(h.escapeHtml(jk) + '\u00a0\u00d7' + js[jk]);
          return parts.join(', ');
        })() + '</td>' : '') +
      '</tr>';
    }
    html += '</tbody></table></div>';

    // Km fairness
    var realKm = kmValues.filter(function(k) { return k > 0; });
    if (realKm.length >= 3) {
      var kmMin = Math.min.apply(null, realKm);
      var kmMax = Math.max.apply(null, realKm);
      var kmSpread = kmMax - kmMin;
      var kmClass = kmSpread <= 20 ? 'sn-fair-good' : kmSpread <= 50 ? 'sn-fair-ok' : 'sn-fair-bad';
      var kmText = kmSpread <= 20 ? '\u2705 Jevnt fordelt reising' : kmSpread <= 50 ? '\u26a0\ufe0f Noe ujevn reising' : '\u26a0\ufe0f Stor forskjell i reising';
      html += '<div style="text-align:center;margin:10px 0;"><span class="sn-fair-badge ' + kmClass + '">' + kmText + ' (' + kmSpread + ' km)</span></div>';
      if (kmSpread > 50) {
        var currentProfile = ((_distOpts.season.distribution_config || {}).profile) || 'balanced';
        if (currentProfile !== 'fair_driving') {
          html += '<div style="text-align:center;margin:-2px 0 8px;">' +
            '<button class="btn-secondary sf-try-profile" data-profile="fair_driving" style="font-size:12px;padding:5px 14px;">Pr\u00f8v \u00abRettferdig kj\u00f8ring\u00bb \u2192</button>' +
          '</div>';
        } else {
          html += '<div style="text-align:center;font-size:12px;color:var(--text-500);margin:-2px 0 8px;">Profilen \u00abRettferdig kj\u00f8ring\u00bb er allerede aktiv. Km-forskjellen skyldes ujevn kampfordeling mellom lagene.</div>';
        }
      }
    }

    // Games fairness
    if (gamesValues.length >= 3) {
      var gMin = Math.min.apply(null, gamesValues);
      var gMax = Math.max.apply(null, gamesValues);
      var gSpread = gMax - gMin;
      var gClass = gSpread <= 2 ? 'sn-fair-good' : gSpread <= 4 ? 'sn-fair-ok' : 'sn-fair-bad';
      var gText = gSpread <= 2 ? '\u2705 Jevnt antall kamper' : gSpread <= 4 ? '\u26a0\ufe0f Noe ujevnt' : '\u26a0\ufe0f Stor forskjell i kamper';
      html += '<div style="text-align:center;margin:4px 0 10px;"><span class="sn-fair-badge ' + gClass + '">' + gText + ' (' + gSpread + ')</span></div>';
      if (gSpread > 4) {
        var soloCount = 0;
        for (var sc = 0; sc < _distResult.matchDays.length; sc++) {
          if (_distResult.matchDays[sc].playingTeams.length < (_distOpts.season.sub_team_count || 2)) soloCount++;
        }
        html += '<div style="text-align:center;font-size:12px;color:var(--text-500);margin:-2px 0 8px;">' +
          (soloCount > 0 ? soloCount + ' kampdager har bare \u00e9tt lag. ' : '') +
          'Noen spillere f\u00e5r f\u00e6rre kamper totalt.' +
        '</div>';
      }
    }

    el.innerHTML = html;
  }

  function bindProfileSwitchButtons() {
    var btns = document.querySelectorAll('.sf-try-profile');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function() {
        var newProfile = this.getAttribute('data-profile');
        if (!_distOpts || !_distOpts.season) return;
        var config = _distOpts.season.distribution_config || {};
        config.profile = newProfile;
        _distOpts.season.distribution_config = config;
        if (_distContainer) initUI(_distContainer, _distOpts);
      });
    }
  }

  /**
   * Handle manual player team change or mark absent.
   * newTeam = 1..N for team assignment, 0 for absent.
   */
  function handlePlayerChange(pid, newTeam) {
    if (!_distResult || !_distOpts) return;

    var md = _distResult.matchDays[_distDayIdx];
    if (!md) return;

    // Update assignments for ALL events on this match-day
    for (var e = 0; e < md.eventIds.length; e++) {
      var eid = md.eventIds[e];
      var assign = _distResult.assignments[eid];
      if (!assign) continue;
      if (newTeam === 0) {
        delete assign[pid];
      } else {
        assign[pid] = newTeam;
      }
    }

    _distModified = true;
    var modBadge = document.getElementById('sfModBadge');
    if (modBadge) modBadge.style.display = 'inline';

    recalcStats();
    renderDay();
    renderStatsSection();
    bindProfileSwitchButtons();
  }

  /**
   * Validate constraints before running algorithm.
   * Returns array of warning strings explaining why constraints may be impossible.
   */
  function validateConstraints(season, seasonPlayers) {
    var warnings = [];
    var config = (season.distribution_config || {}).constraints || {};
    var subTeamCount = season.sub_team_count || 2;
    var activePlayers = seasonPlayers.filter(function(p) { return p.active !== false; });

    var cc = config.coach_child;
    if (cc && cc.coaches) {
      var coachNames = Object.keys(cc.coaches);
      var totalChildren = 0;
      for (var cn = 0; cn < coachNames.length; cn++) {
        totalChildren += (cc.coaches[coachNames[cn]] || []).length;
      }

      var minCoaches = cc.min_coaches_per_game || 0;
      if (minCoaches > coachNames.length) {
        warnings.push('Du krever ' + minCoaches + ' trenere representert per lag, men bare ' + coachNames.length + ' trener' + (coachNames.length === 1 ? '' : 'e') + ' er definert. Legg til flere trenere eller senk kravet.');
      }

      var minChildren = cc.min_children_per_game || 0;
      if (minChildren > 0 && totalChildren === 0) {
        warnings.push('Du krever ' + minChildren + ' trenerbarn per lag, men ingen barn er valgt. Huk av spillere under hver trener.');
      }

      if (minChildren * subTeamCount > totalChildren && totalChildren > 0) {
        warnings.push('Du krever ' + minChildren + ' trenerbarn per lag (\u00d7' + subTeamCount + ' lag = ' + (minChildren * subTeamCount) + '), men bare ' + totalChildren + ' trenerbarn er definert.');
      }

      var at = config.always_together || [];
      if (minCoaches >= 2 && coachNames.length >= 2) {
        for (var a = 0; a < at.length; a++) {
          var group = at[a];
          var groupCoaches = {};
          for (var g = 0; g < group.length; g++) {
            for (var cn2 = 0; cn2 < coachNames.length; cn2++) {
              if ((cc.coaches[coachNames[cn2]] || []).indexOf(group[g]) !== -1) {
                groupCoaches[coachNames[cn2]] = true;
              }
            }
          }
          if (Object.keys(groupCoaches).length >= 2) {
            var gNames = group.map(function(pid) {
              var sp = activePlayers.find(function(p) { return p.player_id === pid; });
              return sp ? sp.name : pid;
            });
            warnings.push(gNames.join(' og ') + ' er satt til alltid sammen, men tilh\u00f8rer ulike trenere. Dette kan gj\u00f8re det vanskelig \u00e5 oppfylle trener-kravet p\u00e5 andre lag.');
          }
        }
      }
    }

    if (activePlayers.length < subTeamCount * 2) {
      warnings.push('Bare ' + activePlayers.length + ' aktive spillere for ' + subTeamCount + ' lag. Legg til flere spillere.');
    }

    return warnings;
  }

  /**
   * Save distribution result to Supabase (event_players.sub_team).
   * Only saves players belonging to the sub_team that owns each event.
   */
  async function saveDistributionResult(result, opts) {
    var sb = opts.helpers.getSb();
    var uid = opts.helpers.getOwnerUid();
    if (!sb || !uid) return false;

    var seasonId = opts.season.id;
    var playerMap = buildPlayerMap(opts.seasonPlayers);
    var allActive = opts.seasonPlayers.filter(function(p) { return p.active !== false; });

    // Build eventId → sub_team lookup from matchDays
    var eventSubTeam = {};
    for (var d = 0; d < result.matchDays.length; d++) {
      var md = result.matchDays[d];
      for (var tk in md.teamEvents) {
        eventSubTeam[md.teamEvents[tk].eventId] = parseInt(tk, 10);
      }
    }

    try {
      for (var eventId in result.assignments) {
        var assign = result.assignments[eventId];
        var evSubTeam = eventSubTeam[eventId];
        var rows = [];
        var assignedPids = {};

        // Players assigned to this event's sub_team
        for (var pid in assign) {
          if (evSubTeam && assign[pid] !== evSubTeam) continue;
          rows.push({
            event_id: eventId,
            season_id: seasonId,
            user_id: uid,
            player_id: pid,
            sub_team: assign[pid],
            in_squad: true,
            player_name: playerMap[pid] ? playerMap[pid].name : null
          });
          assignedPids[pid] = true;
        }

        // Absent players: clear sub_team and mark not in squad
        for (var ai = 0; ai < allActive.length; ai++) {
          var apid = allActive[ai].player_id;
          if (!assignedPids[apid]) {
            rows.push({
              event_id: eventId,
              season_id: seasonId,
              user_id: uid,
              player_id: apid,
              sub_team: null,
              in_squad: false,
              player_name: playerMap[apid] ? playerMap[apid].name : null
            });
          }
        }

        if (rows.length > 0) {
          var res = await sb.from('event_players')
            .upsert(rows, { onConflict: 'event_id,player_id' });
          if (res.error) throw res.error;
        }
      }
      // Save timestamp + summary stats to distribution_config
      var distConfig = opts.season.distribution_config || {};
      distConfig.last_distributed_at = new Date().toISOString();

      // Compute summary stats
      var allStats = _distResult ? _distResult.stats : {};
      var kmArr = [], gamesArr = [];
      var activeSp = opts.seasonPlayers.filter(function(p) { return p.active !== false; });
      for (var si = 0; si < activeSp.length; si++) {
        var st = allStats[activeSp[si].player_id];
        if (st) { kmArr.push(st.totalKm); gamesArr.push(st.totalGames); }
      }
      distConfig.last_stats = {
        match_days: _distResult ? _distResult.matchDays.length : 0,
        km_spread: kmArr.length >= 2 ? Math.max.apply(null, kmArr) - Math.min.apply(null, kmArr) : 0,
        games_spread: gamesArr.length >= 2 ? Math.max.apply(null, gamesArr) - Math.min.apply(null, gamesArr) : 0
      };

      var configRes = await sb.from('seasons')
        .update({ distribution_config: distConfig })
        .eq('id', seasonId)
        .eq('user_id', uid);
      if (configRes.error) {
        console.error('[sesong-fordeling] config save error:', configRes.error);
      } else {
        // Update local season object so banner reflects immediately
        opts.season.distribution_config = distConfig;
      }

      return true;
    } catch (e) {
      console.error('[sesong-fordeling] save error:', e);
      return false;
    }
  }

  // =========================================================================
  //  PUBLIC API
  // =========================================================================

  window.sesongFordeling = {
    haversineKm: haversineKm,
    matchOpponentToKommune: matchOpponentToKommune,
    isInternalMatch: isInternalMatch,
    computeSeasonDistances: computeSeasonDistances,
    saveDistances: saveDistances,
    computeAndSave: computeAndSave,
    getJersey: getJersey,
    runDistribution: runDistribution,
    buildMatchDays: buildMatchDays,
    calcAllStats: calcAllStats,
    PROFILE_WEIGHTS: PROFILE_WEIGHTS,
    initUI: initUI
  };

})();
