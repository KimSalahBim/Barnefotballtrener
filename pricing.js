// Barnefotballtrener - Pricing + Magic Link Logic (ROBUST)
// =======================================================
// Denne fila håndterer:
// 1) Planvalg (.btn-select)
// 2) Magic link (OTP) login (#magicLinkEmail + #magicLinkBtn) med cooldown/rate-limit-beskyttelse
// 3) Stripe success/cancel query params
//
// Viktig: Vi binder magic link med CAPTURE og stopImmediatePropagation()
// slik at evt. tidligere handlers (f.eks. i auth.js) ikke dobbel-sender.

(function () {
  'use strict';

  // -------------------------------
  // Utils
  // -------------------------------
  function log(...args) {
    console.log(...args);
  }

  function showNotification(message, type = 'info') {
    try {
      if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
        return;
      }
    } catch (_) {}

    // Fallback
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 14px 20px;
      border-radius: 12px;
      background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6'};
      color: white;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      max-width: 320px;
      line-height: 1.25;
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 3200);
  }

  function safeTrim(v) {
    return String(v || '').trim();
  }

  async function getCurrentUser() {
    try {
      if (window.authService) {
        // Støtt både async og sync varianter
        if (typeof window.authService.getUser === 'function') {
          const u = window.authService.getUser();
          return u && typeof u.then === 'function' ? await u : u;
        }
        if (window.authService.currentUser) return window.authService.currentUser;
      }
    } catch (_) {}
    return null;
  }

  function getSubscriptionService() {
    return window.subscriptionService || null;
  }

  // -------------------------------
  // Stripe return handling
  // -------------------------------
  function handleStripeReturnParams() {
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.get('success') === 'true') {
      showNotification('Betaling fullført! Velkommen! 🎉', 'success');

      setTimeout(() => {
        // Fjern query params fra URL (behold hash)
        const cleanUrl =
          window.location.origin +
          window.location.pathname +
          (window.location.hash || '');
        window.history.replaceState({}, document.title, cleanUrl);

        // Til hovedapp
        try {
          window.authService?.showMainApp?.();
        } catch (_) {}
      }, 1500);
    } else if (urlParams.get('canceled') === 'true') {
      showNotification('Betaling avbrutt. Du kan prøve igjen når som helst.', 'info');

      setTimeout(() => {
        const cleanUrl =
          window.location.origin +
          window.location.pathname +
          (window.location.hash || '');
        window.history.replaceState({}, document.title, cleanUrl);
      }, 800);
    }
  }

  // -------------------------------
  // Pricing / plan selection
  // -------------------------------
  async function handlePlanSelection(planType, priceId) {
    try {
      log('🔍 Handling plan selection:', planType);

      const user = await getCurrentUser();
      if (!user) {
        log('❌ No user found');
        showNotification('Du må være logget inn først', 'error');
        try {
          window.authService?.showLoginScreen?.();
        } catch (_) {}
        return;
      }

      log('✅ User found:', user.email);

      const svc = getSubscriptionService();
      if (!svc) {
        showNotification('Abonnementstjeneste er ikke lastet. Oppdater siden.', 'error');
        return;
      }

      // Finn checkSubscription (robust på navnevariasjoner)
      const checkFn =
        (typeof svc.checkSubscription === 'function' && svc.checkSubscription) ||
        (typeof svc.checkSubscriptionStatus === 'function' && svc.checkSubscriptionStatus) ||
        (typeof svc.getSubscription === 'function' && svc.getSubscription) ||
        null;

      let subscription = null;
      if (checkFn) {
        subscription = await checkFn.call(svc, user.id);
      }

      log('📊 Subscription status:', subscription);

      const trialEnabled = !!(window.CONFIG && window.CONFIG.trial && window.CONFIG.trial.enabled);
      const canStartTrial = !!(subscription && subscription.canStartTrial);

      if (trialEnabled && canStartTrial && typeof svc.startTrial === 'function') {
        log('🎁 Starting trial...');
        const result = await svc.startTrial(user.id, planType);

        if (result && result.success) {
          const days = window.CONFIG?.trial?.days || 7;
          showNotification(`Gratulerer! Din ${days}-dagers prøveperiode har startet! 🎉`, 'success');
          setTimeout(() => {
            window.authService?.showMainApp?.();
          }, 1200);
          return;
        }

        showNotification('Noe gikk galt. Prøv igjen.', 'error');
        return;
      }

      // Ellers: gå til betaling
      await startCheckout(planType, priceId, user);
    } catch (error) {
      console.error('❌ Error handling plan selection:', error);
      showNotification('En feil oppstod. Prøv igjen senere.', 'error');
    }
  }

  async function startCheckout(planType, priceId, user) {
    try {
      log('💳 Starting checkout for:', planType);
      showNotification('Videresender til betaling...', 'info');

      const svc = getSubscriptionService();
      if (!svc) throw new Error('subscriptionService mangler');

      // Bruk serverless checkout-session (robust): /api/create-checkout-session
      // og redirect med sessionId.
      if (typeof svc.startCheckout !== 'function') {
        throw new Error('subscriptionService.startCheckout mangler (subscription.js må oppdateres)');
      }

      await svc.startCheckout(planType);
    } catch (error) {
      console.error('❌ Checkout error:', error);
      showNotification(`Kunne ikke starte betalingsprosessen: ${error.message}`, 'error');
    }
  }

  function bindPlanButtons() {
    const selectButtons = document.querySelectorAll('.btn-select');
    log(`Found ${selectButtons.length} select buttons`);

    selectButtons.forEach((btn) => {
      if (btn.__bf_bound_plan) return;
      btn.__bf_bound_plan = true;

      btn.addEventListener(
        'click',
        async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const planType = btn.getAttribute('data-plan');
          const priceId = btn.getAttribute('data-price-id');

          log(`Button clicked: ${planType}, priceId: ${priceId}`);
          await handlePlanSelection(planType, priceId);
        },
        { passive: false }
      );
    });
  }

  // -------------------------------
  // Magic link (OTP) login - robust cooldown
  // -------------------------------
  const COOLDOWN_SECONDS_DEFAULT = 60; // Supabase ga deg "after 49 seconds" -> vi bruker 60 for å være safe

  function cooldownKeyForEmail(email) {
    const safe = encodeURIComponent(String(email || '').toLowerCase().trim());
    return `bf_magic_cooldown_until__${safe}`;
  }

  function getCooldownUntil(email) {
    try {
      const key = cooldownKeyForEmail(email);
      const v = localStorage.getItem(key);
      const n = v ? parseInt(v, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  function setCooldown(email, seconds) {
    try {
      const key = cooldownKeyForEmail(email);
      const until = Date.now() + Math.max(5, seconds) * 1000;
      localStorage.setItem(key, String(until));
      return until;
    } catch (_) {
      return Date.now() + Math.max(5, seconds) * 1000;
    }
  }

  function parseWaitSecondsFromErrorMessage(msg) {
    // Eksempel fra Supabase: "you can only request this after 49 seconds."
    const m = String(msg || '').match(/after\s+(\d+)\s+seconds?/i);
    if (m && m[1]) {
      const s = parseInt(m[1], 10);
      if (Number.isFinite(s) && s > 0) return s;
    }
    return null;
  }

  function bindMagicLink() {
    // Magic link håndteres kun av auth.js (unngå dobbel binding)
    return;

    // (resten er bevisst deaktivert)
  }

  // -------------------------------
  // Init
  // -------------------------------
  function init() {
    handleStripeReturnParams();
    bindPlanButtons();
    bindMagicLink();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
