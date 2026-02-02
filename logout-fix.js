// logout-fix.js — Holmes v2 (Edge/ITP-robust)
// ==================================================
// Goals:
// - Logout always works, even when Edge blocks storage or Supabase auth acquires a lock.
// - Use delegated click handler in CAPTURE phase so other handlers can't block it.
// - Prefer authService.signOut(); fallback to supabase.auth.signOut().
// - Best-effort cleanup of Supabase auth keys in storage.
// - Hard reload after logout to avoid "ghost UI" and bfcache issues.

(function () {
  "use strict";

  var LOG = "[logout-fix]";
  var alreadyBoundKey = "__bf_logout_handler_v2";

  function notify(msg) {
    try {
      if (typeof window.showNotification === "function") {
        window.showNotification(msg, "info");
        return;
      }
    } catch (_) {}
    try {
      // Fallback (rare): keep simple
      alert(msg);
    } catch (_) {}
  }

  function cleanupSupabaseStorage() {
    // Supabase v2 keys typically look like: sb-<project-ref>-auth-token
    // Best-effort: remove keys that match common auth-token patterns.
    var storages = [window.localStorage, window.sessionStorage];

    for (var sIdx = 0; sIdx < storages.length; sIdx++) {
      var s = storages[sIdx];
      try {
        if (!s) continue;

        var keys = [];
        for (var i = 0; i < s.length; i++) {
          var k = s.key(i);
          if (!k) continue;

          if (k.indexOf("sb-") === 0 && k.indexOf("-auth-token") !== -1) keys.push(k);
          if (k.indexOf("supabase") !== -1 && k.indexOf("auth") !== -1) keys.push(k);
        }

        for (var j = 0; j < keys.length; j++) {
          try { s.removeItem(keys[j]); } catch (_) {}
        }
      } catch (_) {}
    }
  }

  function hardReload() {
    // Avoid bfcache and keep it deterministic
    try {
      window.location.replace(window.location.origin + window.location.pathname + (window.location.hash || ""));
    } catch (_) {
      try { window.location.reload(); } catch (_) {}
    }
  }

  function getSupabaseClient() {
    // Prefer global supabase, fallback to authService.supabase if present
    if (window.supabase) return window.supabase;
    if (window.authService && window.authService.supabase) return window.authService.supabase;
    return null;
  }

  function doSignOutViaAuthService() {
    if (!window.authService || typeof window.authService.signOut !== "function") return Promise.resolve(false);

    try {
      var res = window.authService.signOut();
      if (res && typeof res.then === "function") {
        return res.then(function (r) {
          if (r && r.success === false) throw new Error(r.error || "Logout feilet");
          return true;
        });
      }
      // If signOut is sync and didn't throw, assume ok
      return Promise.resolve(true);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function doSignOutViaSupabase() {
    var sb = getSupabaseClient();
    if (!sb || !sb.auth || typeof sb.auth.signOut !== "function") {
      return Promise.reject(new Error("Supabase auth ikke klar."));
    }

    return sb.auth.signOut().then(function (r) {
      if (r && r.error) throw r.error;
      return true;
    });
  }

  function bindDelegatedLogout() {
    if (window[alreadyBoundKey]) return;
    window[alreadyBoundKey] = true;

    document.addEventListener(
      "click",
      function (e) {
        try {
          var t = e && e.target;
          if (!t || !t.closest) return;

          // Accept multiple selectors to be future-proof
          var btn = t.closest('#logoutBtn, [data-action="logout"], .logout-btn');
          if (!btn) return;

          // Run first and block others
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

          console.log(LOG, "Logout clicked");

          notify("Logger ut…");

          // Try authService first, then fallback
          doSignOutViaAuthService()
            .catch(function (err1) {
              console.warn(LOG, "authService.signOut failed, trying supabase:", err1);
              return doSignOutViaSupabase();
            })
            .then(function () {
              cleanupSupabaseStorage();
              hardReload();
            })
            .catch(function (err2) {
              console.error(LOG, "Logout error:", err2);
              // Best-effort cleanup helps when Edge blocks storage / locks
              cleanupSupabaseStorage();
              notify("Logout låste seg. Lukk andre faner, oppdater siden, eller prøv privat fane.");
            });
        } catch (fatal) {
          console.error(LOG, "Fatal in logout handler:", fatal);
          cleanupSupabaseStorage();
          notify("Logout feilet uventet. Prøv å oppdatere siden.");
        }
      },
      true // capture
    );

    console.log(LOG, "✅ Delegated logout handler bound (capture)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindDelegatedLogout);
  } else {
    bindDelegatedLogout();
  }
})();
