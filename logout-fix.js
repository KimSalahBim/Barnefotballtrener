// logout-fix.js — Holmes v3.2 (force logout + timeouts + safe storage cleanup)
// ==========================================================================
// Goal: Logout must ALWAYS work, even when Edge Tracking Prevention blocks storage
// or Supabase auth locks/aborts. This file is intentionally defensive.
//
// Strategy:
// 1) Capture-phase delegated click handler so nothing can block logout clicks.
// 2) Attempt signOut() best-effort with a hard timeout (never hang).
// 3) Always clear Supabase auth token keys from localStorage/sessionStorage (best-effort).
// 4) Hard reload to clear in-memory session + avoid bfcache "ghost UI".
// 5) Avoid unhandled promise rejections.

(function () {
  "use strict";

  var LOG = "[logout-fix]";
  var BOUND_FLAG = "__bf_logout_handler_v3_2";

  // ---------- Small helpers ----------
  function safeNotify(msg) {
    try {
      if (typeof window.showNotification === "function") {
        window.showNotification(msg, "info");
        return;
      }
    } catch (_) {}
    try { alert(msg); } catch (_) {}
  }

  function getSupabaseClient() {
    // Prefer global client; fallback to authService.supabase if present.
    try {
      if (window.supabase) return window.supabase;
      if (window.authService && window.authService.supabase) return window.authService.supabase;
    } catch (_) {}
    return null;
  }

  function withTimeout(promise, ms, label) {
    // Ensures we never hang waiting for signOut()
    return new Promise(function (resolve, reject) {
      var settled = false;
      var t = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error((label || "timeout") + " (" + ms + "ms)"));
      }, ms);

      Promise.resolve(promise)
        .then(function (v) {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          resolve(v);
        })
        .catch(function (e) {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          reject(e);
        });
    });
  }

  // ---------- Storage cleanup (best-effort) ----------
  function cleanupSupabaseStorage() {
    // Supabase v2 usually stores token under: sb-<project-ref>-auth-token
    // Supabase v1 sometimes uses: supabase.auth.token
    //
    // We intentionally keep deletion targeted to "token"-like auth keys.
    var storages = [window.localStorage, window.sessionStorage];

    for (var sIdx = 0; sIdx < storages.length; sIdx++) {
      var s = storages[sIdx];
      try {
        if (!s) continue;

        var keysToRemove = [];
        for (var i = 0; i < s.length; i++) {
          var k = s.key(i);
          if (!k) continue;

          // Highly specific (preferred)
          if (k.indexOf("sb-") === 0 && k.indexOf("-auth-token") !== -1) {
            keysToRemove.push(k);
            continue;
          }

          // Known legacy key
          if (k === "supabase.auth.token") {
            keysToRemove.push(k);
            continue;
          }

          // Defensive: only remove if it looks like an auth token key
          // (must include both auth + token indicators)
          var lk = k.toLowerCase();
          if (lk.indexOf("supabase") !== -1 && lk.indexOf("auth") !== -1 && lk.indexOf("token") !== -1) {
            keysToRemove.push(k);
          }
        }

        for (var j = 0; j < keysToRemove.length; j++) {
          try { s.removeItem(keysToRemove[j]); } catch (_) {}
        }
      } catch (_) {
        // Edge/ITP may block storage access; ignore
      }
    }
  }

  // ---------- Reload ----------
  function hardReload() {
    // Deterministic reload: strips query params, keeps hash (if any).
    try {
      window.location.replace(
        window.location.origin +
          window.location.pathname +
          (window.location.hash || "")
      );
    } catch (_) {
      try { window.location.reload(); } catch (_) {}
    }
  }

  // ---------- Best-effort sign out ----------
  function attemptAuthServiceSignOut() {
    try {
      if (!window.authService || typeof window.authService.signOut !== "function") {
        return Promise.reject(new Error("authService.signOut unavailable"));
      }
      // Might be sync or async; normalize
      return withTimeout(window.authService.signOut(), 4000, "authService.signOut");
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function attemptSupabaseSignOut() {
    var sb = getSupabaseClient();
    try {
      if (!sb || !sb.auth || typeof sb.auth.signOut !== "function") {
        return Promise.reject(new Error("supabase.auth.signOut unavailable"));
      }
      return withTimeout(sb.auth.signOut(), 4000, "supabase.auth.signOut").then(function (r) {
        if (r && r.error) throw r.error;
        return r;
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function attemptSignOutBestEffort() {
    // Try authService first, then direct supabase; never throw at the end.
    return attemptAuthServiceSignOut()
      .catch(function (e1) {
        console.warn(LOG, "authService.signOut failed/timeout:", e1);
        return attemptSupabaseSignOut();
      })
      .catch(function (e2) {
        console.warn(LOG, "supabase.signOut failed/timeout:", e2);
        return null;
      });
  }

  // ---------- Main force logout ----------
  function forceLogout() {
    // Best-effort signOut, then ALWAYS clear tokens + reload.
    return attemptSignOutBestEffort().then(function () {
      // Always clean local tokens (this is what truly matters in Edge lock scenarios)
      cleanupSupabaseStorage();

      // Best-effort clear of any in-memory references (non-breaking)
      try {
        if (window.authService) {
          window.authService.currentUser = null;
          // Some builds use internal flags to prevent re-init; reset safely if present
          if (typeof window.authService._mainShown !== "undefined") window.authService._mainShown = false;
        }
      } catch (_) {}

      hardReload();
    });
  }

  // ---------- Click binding ----------
  function bind() {
    if (window[BOUND_FLAG]) return;
    window[BOUND_FLAG] = true;

    document.addEventListener(
      "click",
      function (e) {
        try {
          var t = e && e.target;
          if (!t || !t.closest) return;

          // Support future-proof selectors:
          var btn = t.closest('#logoutBtn, [data-action="logout"], .logout-btn');
          if (!btn) return;

          // Ensure we run first and nobody else can intercept
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

          console.log(LOG, "Logout clicked");
          safeNotify("Logger ut…");

          // Prevent unhandled rejections
          forceLogout().catch(function (fatal) {
            console.error(LOG, "forceLogout failed:", fatal);
            // Fallback: still clear tokens + reload
            cleanupSupabaseStorage();
            hardReload();
          });
        } catch (fatal2) {
          console.error(LOG, "Fatal in logout click handler:", fatal2);
          cleanupSupabaseStorage();
          hardReload();
        }
      },
      true // capture
    );

    // Manual escape hatch if needed (e.g., run __bf_forceLogout() in console)
    window.__bf_forceLogout = function () {
      return forceLogout();
    };

    console.log(LOG, "✅ Delegated logout handler bound (capture) [v3.2]");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
