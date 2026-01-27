// subscription.js — løsning 2 (intern abonnement/innstillinger-side)
(function () {
  const $ = (id) => document.getElementById(id);

  function show(el) { if (el) el.style.display = 'block'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function openPricing() {
    const mainApp = $('mainApp');
    const pricingPage = $('pricingPage');
    if (!pricingPage) return alert('Fant ikke pricingPage i index.html');
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
    const gearBtn = $('manageSubscriptionBtn');
    if (gearBtn) gearBtn.addEventListener('click', (e) => { e.preventDefault(); openPricing(); });
    else console.warn('Fant ikke manageSubscriptionBtn');

    const closeBtn = $('closePricingBtn');
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); closePricing(); });
    else console.warn('Fant ikke closePricingBtn');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
