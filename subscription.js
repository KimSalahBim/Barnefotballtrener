// subscription.js — løsning 2 (intern abonnementsside)
// Ingen Stripe. Ingen mailto. Bare vis/skjul pricingPage.

(function () {
  function $(id) { return document.getElementById(id); }

  function show(el) { if (el) el.style.display = 'block'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function openPricing() {
    const mainApp = $('mainApp');
    const pricingPage = $('pricingPage');

    if (!pricingPage) {
      alert('Fant ikke abonnements-siden (pricingPage).');
      return;
    }

    hide(mainApp);
    show(pricingPage);
  }

  function closePricing() {
    const mainApp = $('mainApp');
    const pricingPage = $('pricingPage');

    hide(pricingPage);
    show(mainApp);
  }

  function bind() {
    // 1) Finn tannhjul-knappen
    // Bytt ID her hvis din heter noe annet:
    const gearBtn = $('manageSubscriptionBtn') || $('subscriptionBtn') || $('settingsBtn');

    if (gearBtn) {
      gearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openPricing();
      });
    } else {
      console.warn('⚠️ Fant ikke tannhjul-knapp (manageSubscriptionBtn/settingsBtn).');
    }

    // 2) Tilbake-knapp på pricingPage
    const closeBtn = $('closePricingBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closePricing();
      });
    } else {
      console.warn('⚠️ Fant ikke closePricingBtn på pricingPage.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
