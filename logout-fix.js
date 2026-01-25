// logout-fix.js
// Legger til authService.signOut() slik at auth-ui.js sin logout fungerer.
// Skal lastes ETTER auth.js og auth-ui.js (helt nederst i index.html).

(function () {
  'use strict';

  async function supabaseSignOutMaybe() {
    // Prøver flere mulige steder du kan ha klienten liggende
    const svc = window.authService;
    const client =
      (svc && (svc.supabase || svc.supabaseClient)) ||
      window.supabaseClient ||
      window.supabase;

    if (client && client.auth && typeof client.auth.signOut === 'function') {
      await client.auth.signOut();
      return true;
    }
    return false;
  }

  function clearLocalMaybe() {
    // Ikke aggressiv: vi prøver, men tåler Tracking Prevention
    try {
      // Fjern kun app-relatert, ikke alt
      const keys = [
        'bf_players',
        'bf_app_state',
        'bf_training',
        'bf_match',
        'bf_liga',
        'bf_kampdag',
        'players',
        'appState',
        'ligaState',
        'kampdagState'
      ];
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
    try {
      sessionStorage.removeItem('supabase.auth.token');
    } catch (e) {}
  }

  function ensureSignOut() {
    const svc = window.authService;
    if (!svc) return false;

    if (typeof svc.signOut === 'function') return true;

    // Legg til metoden auth-ui.js forventer
    svc.signOut = async function () {
      try {
        await supabaseSignOutMaybe();
      } catch (e) {
        // Vi logger, men lar flyten gå videre
        console.warn('Supabase signOut feilet (fortsetter):', e);
      }

      clearLocalMaybe();

      // Vis login igjen hvis metoden finnes – ellers fallback
      if (typeof svc.showLoginScreen === 'function') {
        svc.showLoginScreen();
      } else {
        // hard fallback
        window.location.href = window.location.origin + window.location.pathname;
      }
    };

    console.log('✅ logout-fix: authService.signOut() lagt til');
    return true;
  }

  function init() {
    ensureSignOut();
    // Vi trenger ikke re-binde knappen – auth-ui.js har allerede handler.
    // Vi bare sørger for at signOut() finnes.
  }

  // Kjør flere ganger for sikkerhet (pga last/async)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 250);
  setTimeout(init, 1000);
})();
