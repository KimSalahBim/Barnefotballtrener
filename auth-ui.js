// Barnefotballtrener - auth-ui.js (MOBIL-FIKS)
// ===========================================
// Mål: Google-knappen skal ALLTID reagere på iPhone/Safari.
// - Binder #googleSignInBtn eksplisitt
// - Bruker både click og touchend
// - Viser spinner/disable for synlig respons
// - Bruker alert som fallback ved feil (slik at det ikke føles som "ingenting skjer")

(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;

    if (!btn.__bf_original_html) {
      btn.__bf_original_html = btn.innerHTML;
    }

    if (loading) {
      btn.disabled = true;
      btn.style.opacity = '0.8';
      btn.innerHTML = `<span style="display:inline-flex; align-items:center; gap:10px;">
        <span style="display:inline-block; width:16px; height:16px; border:2px solid rgba(0,0,0,0.2); border-top-color: rgba(0,0,0,0.7); border-radius:50%; animation: bfspin 0.8s linear infinite;"></span>
        Logger inn...
      </span>`;
    } else {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = btn.__bf_original_html;
    }
  }

  function ensureSpinnerCss() {
    if (document.getElementById('bfspin-style')) return;
    const style = document.createElement('style');
    style.id = 'bfspin-style';
    style.textContent = `@keyframes bfspin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`;
    document.head.appendChild(style);
  }

  async function startGoogleLogin(btn) {
    try {
      ensureSpinnerCss();
      setButtonLoading(btn, true);

      // Sørg for at authService finnes
      if (typeof window.authService === 'undefined' && typeof authService === 'undefined') {
        throw new Error('authService finnes ikke (auth.js lastes ikke?)');
      }

      // Noen ganger ligger den på window, andre ganger som global
      const svc = window.authService || authService;

      // Sørg for init før OAuth (så supabase client finnes)
      if (typeof svc.init === 'function') {
        await svc.init();
      }

      if (typeof svc.signInWithGoogle !== 'function') {
        throw new Error('signInWithGoogle() finnes ikke på authService');
      }

      const res = await svc.signInWithGoogle();

      // Hvis OAuth redirect starter riktig, vil siden navigere bort.
      // Hvis vi får error uten redirect:
      if (res && res.success === false) {
        throw new Error(res.error || 'Innlogging feilet');
      }
    } catch (err) {
      console.error('Google login error:', err);
      setButtonLoading(btn, false);

      // Bruk alert så du SER at noe skjedde
      alert('Innlogging feilet: ' + (err?.message || String(err)));
    }
  }

  function bindGoogleButton() {
    const btn = $('googleSignInBtn');
    if (!btn) {
      console.warn('Fant ikke #googleSignInBtn');
      return;
    }

    // Gjør det ekstra klikkbart på iOS
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';
    btn.style.position = btn.style.position || 'relative';
    btn.style.zIndex = btn.style.zIndex || '1001';

    if (btn.__bf_bound) return;
    btn.__bf_bound = true;

    // CLICK
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startGoogleLogin(btn);
    }, { passive: false });

    // TOUCH (iOS)
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startGoogleLogin(btn);
    }, { passive: false });

    console.log('✅ Google-knapp bundet (click + touchend)');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindGoogleButton);
  } else {
    bindGoogleButton();
  }

})();
