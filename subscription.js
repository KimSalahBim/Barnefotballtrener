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
      // VIKTIG: .hidden kan være display:none !important og må fjernes
      modal.classList.remove('hidden');
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

    if (modal) {
      hide(modal);
      // legg tilbake hidden for å matche HTML sin default state
      modal.classList.add('hidden');
    }

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
  // --- Compatibility layer for auth.js / pricing.js ---
  // Ensure subscriptionService has the functions other files expect.

  // NB: window.subscriptionService finnes allerede over – vi bare fyller på API-et.

  window.subscriptionService.checkSubscription =
    window.subscriptionService.checkSubscription ||
    (async function (userId) {
      // Try a backend endpoint if you have one:
      try {
        const token = await getAccessToken();
        const resp = await fetch('/api/subscription-status', {
          method: 'GET',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.ok) return await resp.json();
      } catch (_) {}

      // Fallback: assume no active subscription/trial (forces pricing UI)
      return { active: false, trial: false, canStartTrial: true };
    });

  window.subscriptionService.startTrial =
    window.subscriptionService.startTrial ||
    (async function (userId, planType) {
      // If you have an endpoint, call it. Otherwise fallback to "success:false"
      try {
        const token = await getAccessToken();
        const resp = await fetch('/api/start-trial', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ userId, planType }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok)
          return { success: false, error: data?.error || 'Kunne ikke starte trial' };
        return { success: true, ...data };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    });

  window.subscriptionService.init =
    window.subscriptionService.init ||
    (async function () {
      // Initialize Stripe.js using CONFIG.stripe.publishableKey
      try {
        if (window.subscriptionService.stripe) return;

        const key = window.CONFIG?.stripe?.publishableKey;
        if (!key) throw new Error('Mangler CONFIG.stripe.publishableKey');

        // Ensure Stripe.js is loaded
        if (typeof window.Stripe !== 'function') {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://js.stripe.com/v3/';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Kunne ikke laste Stripe.js'));
            document.head.appendChild(s);
          });
        }

        window.subscriptionService.stripe = window.Stripe(key);
      } catch (e) {
        console.error('❌ subscriptionService.init failed:', e);
      }
    });

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
      const closeBtn = e.target.closest(
        '#closePricingBtn, #closeSubscriptionBtn, .close-subscription, [data-close="subscriptionModal"]'
      );
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
