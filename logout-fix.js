// logout-fix.js
// Robust logout for iOS/Safari (Tracking Prevention) + Supabase
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function safeNotify(msg, type) {
    try {
      if (typeof window.showNotification === 'function') {
        window.showNotification(msg, type || 'info');
        return;
      }
    } catch (_) {}
    // fallback
    console.log(msg);
  }

  function getSupabaseClient() {
    // prøv vanlige globale navn
    return (
      window.supabaseClient ||
      window._supabaseClient ||
      (window.authService && (window.authService.supabaseClient || window.authService.supabase)) ||
      null
    );
  }

  async function trySignOut() {
    const client = getSupabaseClient();
    if (client && client.auth && typeof client.auth.signOut === 'function') {
      await client.auth.signOut();
      return true;
    }
    if (window.authService && typeof window.authService.signOut === 'function') {
      await window.authService.signOut();
      return true;
    }
    return false;
  }

  function clearLocalAuthAndAppData() {
    // 1) Fjern appdata (bft:...)
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith('bft:')) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (_) {}

    // 2) Fjern supabase tokens (best effort)
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
          k.startsWith('sb-') ||
          k.includes('supabase') ||
          k.includes('auth-token') ||
          k.includes('refresh_token') ||
          k.includes('access_token')
        ) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
  }

  function showLoginScreenFallback() {
    try {
      if (window.authService && typeof window.authService.showLoginScreen === 'function') {
        window.authService.showLoginScreen();
        return;
      }
    } catch (_) {}

    // fallback: vis login-skjerm ved å bytte display
    const main = $('mainApp');
    const login = $('passwordProtection');
    const pricing = $('pricingPage');
    if (main) main.style.display = 'none';
    if (pricing) pricing.style.display = 'none';
    if (login) login.style.display = 'flex';
  }

  function bind() {
    const btn = $('logoutBtn');
    if (!btn) return;

    const handler = async (ev) => {
      try {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      } catch (_) {}

      const ok = window.confirm('Er du sikker på at du vil logge ut?');
      if (!ok) return;

      try {
        await trySignOut();
      } catch (e) {
        // iOS/Safari kan feile her – vi fortsetter uansett
        console.warn('signOut feilet (fortsetter):', e);
      }

      clearLocalAuthAndAppData();
      showLoginScreenFallback();
      safeNotify('Logget ut', 'success');
    };

    // capture=true for å overstyre evt. eksisterende handler som feiler
    btn.addEventListener('click', handler, true);
    btn.addEventListener('touchend', handler, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
