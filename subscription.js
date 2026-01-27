// subscription.js — robust tannhjul (åpner innstillinger/pricing)
// - Klikk på #manageSubscriptionBtn åpner:
//   1) #subscriptionModal (hvis finnes)
//   2) ellers #pricingPage (hvis finnes)
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

  // Eksponer et stabilt API (så andre filer kan bruke det)
  window.SubscriptionUI = {
    open: openSettings,
    close: closeSettings,
  };

  // Bakoverkompatibilitet: noen steder forventer subscriptionService.manageSubscription()
  window.subscriptionService = window.subscriptionService || {};
  window.subscriptionService.manageSubscription = openSettings;

  // Robust: funker selv om knappen renderes på nytt / DOM endrer seg
  document.addEventListener('click', (e) => {
    const gear = e.target.closest('#manageSubscriptionBtn');
    if (gear) {
      e.preventDefault();
      openSettings();
      return;
    }

    // Valgfritt: støtte “close”-knapper om du har dem i HTML
    const closeBtn = e.target.closest('#closePricingBtn, #closeSubscriptionBtn, .close-subscription');
    if (closeBtn) {
      e.preventDefault();
      closeSettings();
      return;
    }
  }, { passive: false });

  // Esc lukker
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });

  // Debug (kan fjernes senere)
  console.log('✅ subscription.js lastet: SubscriptionUI klar');
})();
