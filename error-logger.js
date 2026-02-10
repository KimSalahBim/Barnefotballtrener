// © 2026 Barnefotballtrener.no. All rights reserved.
(function () {
  'use strict';

  var MAX_ERRORS = 5;
  var errorCount = 0;
  var seen = {};

  function getSupabase() {
    try {
      var sb = window.supabase || window.supabaseClient;
      if (sb && sb.from) return sb;
    } catch (_) {}
    return null;
  }

  function getUserId() {
    try {
      if (window.authService && typeof window.authService.getUserId === 'function') {
        return window.authService.getUserId() || null;
      }
    } catch (_) {}
    return null;
  }

  function logError(message, source, lineno, colno, stack) {
    if (errorCount >= MAX_ERRORS) return;

    var uid = getUserId();
    if (!uid) return; // Kun logg for innloggede brukere (RLS krever user_id)

    // Dedup: samme melding + linje = skip
    var key = (message || '') + ':' + (lineno || 0);
    if (seen[key]) return;
    seen[key] = true;
    errorCount++;

    var sb = getSupabase();
    if (!sb) return;

    try {
      sb.from('error_logs').insert({
        user_id: uid,
        message: String(message || '').slice(0, 1000),
        source: String(source || '').slice(0, 500),
        lineno: lineno || null,
        colno: colno || null,
        stack: String(stack || '').slice(0, 4000),
        user_agent: String(navigator.userAgent || '').slice(0, 500),
        url: String(location.href || '').slice(0, 500)
      }).then(function () {}).catch(function () {});
    } catch (_) {}
  }

  // addEventListener: kolliderer ikke med andre error handlers
  window.addEventListener('error', function (event) {
    var stack = '';
    if (event.error && event.error.stack) stack = event.error.stack;
    logError(event.message, event.filename, event.lineno, event.colno, stack);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var message = 'Unhandled Promise Rejection';
    var stack = '';
    if (reason) {
      if (typeof reason === 'string') message = reason;
      else if (reason.message) message = reason.message;
      if (reason.stack) stack = reason.stack;
    }
    logError(message, 'promise', 0, 0, stack);
  });
})();
