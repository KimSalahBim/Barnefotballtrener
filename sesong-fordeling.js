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
  //  PUBLIC API
  // =========================================================================

  window.sesongFordeling = {
    haversineKm: haversineKm,
    matchOpponentToKommune: matchOpponentToKommune,
    isInternalMatch: isInternalMatch,
    computeSeasonDistances: computeSeasonDistances,
    saveDistances: saveDistances,
    computeAndSave: computeAndSave
  };

})();
