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
      log('💳 Starting checkout for:', planType, priceId);
      showNotification('Videresender til betaling...', 'info');

      // ✅ Foretrukket: server-side Checkout Session (sikrer riktig kunde/metadata, og unngår
      // klient-cache/Stripe.js edge-cases).
      const token = await getAccessTokenWithRetry();
      if (!token) {
        console.error('❌ Failed to get access token after retries');
        throw new Error('Invalid session - kunne ikke hente tilgangstoken');
      }

      log('✅ Got access token, calling API...');

      const r = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: planType }),
      });

      log(`📡 API response status: ${r.status}`);

      const data = await safeJson(r);
      
      if (!r.ok) {
        console.error('❌ API returned error:', {
          status: r.status,
          statusText: r.statusText,
          error: data?.error,
          data: data
        });
        throw new Error(data?.error || `Checkout-feil (${r.status})`);
      }

      log('✅ API response OK:', data);

      if (!data?.url) {
        console.error('❌ API response missing url:', data);
        throw new Error('Mangler checkout-url fra server');
      }

      log('✅ Redirecting to:', data.url);
      window.location.assign(data.url);
    } catch (error) {
      console.error('❌ Checkout error:', {
        message: error.message,
        stack: error.stack,
        planType: planType,
        user: user?.email
      });
      showNotification(`Kunne ikke starte betalingsprosessen: ${error.message}`, 'error');
    }
  }

  async function safeJson(resp) {
    try {
      return await resp.json();
    } catch (_) {
      return null;
    }
  }

  async function getAccessTokenWithRetry(retries = 5) {
    console.log('💳 Getting access token for checkout...');
    
    for (let i = 0; i < retries; i++) {
      try {
        // Først: prøv getSession
        const s = await window.supabase?.auth?.getSession?.();
        let token = s?.data?.session?.access_token;

        if (token) {
          console.log(`✅ Got token from getSession (attempt ${i+1}/${retries}):`, token.substring(0, 20) + '...');
          return token;
        }

        console.log(`⚠️ No token from getSession (attempt ${i+1}/${retries}), trying refresh...`);

        // Hvis ingen token: prøv refresh først
        if (typeof window.supabase?.auth?.refreshSession === 'function') {
          try {
            await window.supabase.auth.refreshSession();
            console.log('🔄 Refreshed session');
          } catch (refreshErr) {
            console.warn('⚠️ Refresh failed:', refreshErr);
          }
          
          // Prøv getSession igjen etter refresh
          const s2 = await window.supabase?.auth?.getSession?.();
          token = s2?.data?.session?.access_token;
          
          if (token) {
            console.log(`✅ Got token after refresh (attempt ${i+1}/${retries}):`, token.substring(0, 20) + '...');
            return token;
          }
        }
      } catch (e) {
        console.warn(`❌ Token attempt ${i+1}/${retries} failed:`, e);
      }

      // Økende backoff: 500ms, 1000ms, 1500ms, 2000ms, 2500ms
      const delay = 500 + (i * 500);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise((r) => setTimeout(r, delay));
    }
    
    console.error(`❌ Failed to get token after ${retries} attempts`);
    return null;
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

    const emailInput = document.getElementById('magicLinkEmail');
    const btn = document.getElementById('magicLinkBtn');
    const hint = document.getElementById('magicLinkHint');



    if (!emailInput || !btn) {
      log('ℹ️ Magic link elementer finnes ikke på denne siden (#magicLinkEmail / #magicLinkBtn).');
      return;
    }

    if (btn.__bf_bound_magic_pricing) return;
    btn.__bf_bound_magic_pricing = true;

    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';

    function setHint(text) {
      if (hint) hint.textContent = text;
    }

    function setButtonState(disabled, text) {
      btn.disabled = !!disabled;
      if (text) btn.textContent = text;
    }

    async function sendMagicLink() {
      const email = safeTrim(emailInput.value);

      if (!email || !email.includes('@')) {
        showNotification('Skriv inn en gyldig e-postadresse.', 'error');
        emailInput.focus();
        return;
      }

      const until = getCooldownUntil(email);
      const now = Date.now();
      if (until && now < until) {
        const remaining = Math.ceil((until - now) / 1000);
        showNotification(`Vent ${remaining}s før du sender en ny lenke.`, 'info');
        setButtonState(true, `Vent ${remaining}s...`);
        setTimeout(() => {
          // Ikke spam UI – bare “slipp” knappen etter litt
          setButtonState(false, 'Send innloggingslenke');
        }, Math.min(remaining, 10) * 1000);
        return;
      }

      // Guard: lås alltid i minst 60s for å unngå 429 pga dobbelklikk / dobbel-binding
      setCooldown(email, COOLDOWN_SECONDS_DEFAULT);

      setButtonState(true, 'Sender...');
      try {
        if (!window.authService || typeof window.authService.signInWithMagicLink !== 'function') {
          throw new Error('authService.signInWithMagicLink finnes ikke');
        }

        const res = await window.authService.signInWithMagicLink(email);

        if (res && res.success) {
          setHint('Sjekk e-posten din og klikk på lenka for å logge inn ✅');
          showNotification('Innloggingslenke sendt. Sjekk e-posten.', 'success');
        } else {
          // Hvis Supabase svarer med "after XX seconds", juster cooldown riktig
          const errMsg = res?.error || 'Kunne ikke sende lenke.';
          const wait = parseWaitSecondsFromErrorMessage(errMsg);
          if (wait) setCooldown(email, Math.max(wait, COOLDOWN_SECONDS_DEFAULT));
          showNotification(errMsg, 'error');
        }
      } catch (err) {
        const msg = err?.message || String(err);
        const wait = parseWaitSecondsFromErrorMessage(msg);
        if (wait) setCooldown(email, Math.max(wait, COOLDOWN_SECONDS_DEFAULT));
        console.error('❌ Magic link exception:', err);
        showNotification(msg.includes('after')
          ? msg
          : 'Kunne ikke sende lenke. Prøv igjen om litt.', 'error');
      } finally {
        setButtonState(false, 'Send innloggingslenke');
      }
    }

    // CAPTURE + stopImmediatePropagation => hindrer at auth.js sin click-handler også sender
    btn.addEventListener(
      'click',
      async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        await sendMagicLink();
      },
      { capture: true, passive: false }
    );

    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btn.click();
      }
    });

    log('✅ Magic link bundet (pricing.js) (#magicLinkBtn)');
  }

  // -------------------------------
  // Back button
  // -------------------------------
  function bindBackButton() {
    const btn = document.getElementById('closePricingBtn');
    if (!btn) {
      log('ℹ️ closePricingBtn ikke funnet på denne siden');
      return;
    }

    if (btn.__bf_bound_back) {
      log('ℹ️ closePricingBtn allerede bundet');
      return;
    }
    btn.__bf_bound_back = true;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      log('🔙 Back button klikket');

      try {
        const user = await getCurrentUser();
        
        if (!user) {
          // Ikke innlogget: gå til login
          log('ℹ️ Ingen bruker - går til login');
          if (window.authService && typeof window.authService.showLoginScreen === 'function') {
            window.authService.showLoginScreen();
          }
          return;
        }

        // Innlogget: sjekk subscription
        const svc = getSubscriptionService();
        if (!svc || typeof svc.checkSubscription !== 'function') {
          log('⚠️ Subscription service mangler - går til login');
          if (window.authService && typeof window.authService.showLoginScreen === 'function') {
            window.authService.showLoginScreen();
          }
          return;
        }

        const status = await svc.checkSubscription();
        const hasAccess = !!(status && (status.active || status.trial || status.lifetime));

        if (hasAccess) {
          log('✅ Bruker har tilgang - går til hovedapp');
          if (window.authService && typeof window.authService.showMainApp === 'function') {
            window.authService.showMainApp();
          }
        } else {
          log('ℹ️ Bruker mangler tilgang - forblir på pricing');
          // Bruker er på riktig side allerede (pricing)
          showNotification('Velg en plan for å fortsette', 'info');
        }
      } catch (err) {
        console.error('❌ Back button error:', err);
        // Fallback: gå til login
        if (window.authService && typeof window.authService.showLoginScreen === 'function') {
          window.authService.showLoginScreen();
        }
      }
    });

    log('✅ Back button bundet (#closePricingBtn)');
  }

  // -------------------------------
  // Boot
  // -------------------------------
function boot() {
  log('💳 Pricing.js loaded');
  bindPlanButtons();
  bindBackButton();
  // bindMagicLink(); // Magic link håndteres av auth.js
  handleStripeReturnParams();
}


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
