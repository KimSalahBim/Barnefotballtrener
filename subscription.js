// subscription.js — robust tannhjul + Stripe Customer Portal
// - Klikk på #manageSubscriptionBtn åpner:
//   1) #subscriptionModal (hvis finnes)
//   2) ellers #pricingPage (hvis finnes)
// - Klikk på #managePortalBtn (inne i modalen) åpner Stripe Customer Portal via /api/create-portal-session
// - Eksponerer window.SubscriptionUI og window.subscriptionService.manageSubscription()

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function show(el, display = 'block') {
    if (!el) return;
    el.style.display = display;
  }

  function hide(el) {
    if (!el) return;
    el.style.display = 'none';
  }

  function openSettings() {
    const modal = $('subscriptionModal');
    const pricingPage = $('pricingPage');
    const mainApp = $('mainApp');

    // 1) Foretrekk modal hvis den finnes
    if (modal) {
      show(modal, 'flex');
      return;
    }

    // 2) Ellers bruk pricingPage hvis den finnes
    if (pricingPage) {
      hide(mainApp);
      show(pricingPage, 'block');
      return;
    }

    // 3) Hvis ingenting finnes: tydelig feilmelding
    alert('Fant ikke #subscriptionModal eller #pricingPage i index.html');
  }

  function closeSettings() {
    const modal = $('subscriptionModal');
    const pricingPage = $('pricingPage');
    const mainApp = $('mainApp');

    if (modal) hide(modal);
    if (pricingPage) hide(pricingPage);
    if (mainApp) show(mainApp, 'block');
  }

  // Hent access token på en robust måte (støtter ulike auth.js-varianter)
  async function getAccessToken() {
    // 1) Foretrukket: getSessionWithRetry()
    try {
      if (window.AuthService?.getSessionWithRetry) {
        const s = await window.AuthService.getSessionWithRetry();
        if (s?.access_token) return s.access_token;
      }
    } catch (_) {}

    try {
      if (window.authService?.getSessionWithRetry) {
        const s = await window.authService.getSessionWithRetry();
        if (s?.access_token) return s.access_token;
      }
    } catch (_) {}

    // 2) Fallback: supabase.auth.getSession()
    try {
      const sb = window.supabase;
      if (sb?.auth?.getSession) {
        const { data } = await sb.auth.getSession();
        const token = data?.session?.access_token;
        if (token) return token;
      }
    } catch (_) {}

    return null;
  }

  async function openStripeCustomerPortal() {
    try {
      const token = await getAccessToken();

      if (!token) {
        alert('Du må være logget inn for å administrere abonnement.');
        return;
      }

      const resp = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      let data = {};
      try {
        data = await resp.json();
      } catch (_) {}

      if (!resp.ok || !data?.url) {
        console.error('Portal error:', data);
        alert(data?.error || 'Kunne ikke åpne abonnement akkurat nå. Prøv igjen.');
        return;
      }

      // Send brukeren til Stripe Customer Portal
      window.location.href = data.url;
    } catch (e) {
      console.error('openStripeCustomerPortal failed:', e);
      alert('Kunne ikke åpne abonnement. Prøv igjen.');
    }
  }

  // Eksponer et stabilt API (så andre filer kan bruke det)
  window.SubscriptionUI = {
    open: openSettings,
    close: closeSettings,
    openPortal: openStripeCustomerPortal, // valgfritt, men nyttig for debugging
  };

  // Bakoverkompatibilitet: noen steder forventer subscriptionService.manageSubscription()
  window.subscriptionService = window.subscriptionService || {};
  window.subscriptionService.manageSubscription = openSettings;

  // Robust: funker selv om knapper renderes på nytt / DOM endrer seg
  document.addEventListener(
    'click',
    (e) => {
      // 1) Tannhjul i toppmeny
      const gear = e.target.closest('#manageSubscriptionBtn');
      if (gear) {
        e.preventDefault();
        openSettings();
        return;
      }

      // 2) NY: "Administrer abonnement" i modalen -> Stripe portal
      const portalBtn = e.target.closest('#managePortalBtn');
      if (portalBtn) {
        e.preventDefault();
        openStripeCustomerPortal();
        return;
      }

      // 3) Close-knapper (valgfritt)
      const closeBtn = e.target.closest('#closePricingBtn, #closeSubscriptionBtn, .close-subscription, [data-close="subscriptionModal"]');
      if (closeBtn) {
        e.preventDefault();
        closeSettings();
        return;
      }
    },
    { passive: false }
  );

  // Esc lukker
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });

  // Debug (kan fjernes senere)
  console.log('✅ subscription.js lastet: SubscriptionUI klar (inkl. portal)');
})();
