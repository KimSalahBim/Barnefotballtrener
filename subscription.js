// subscription.js — Løsning 2 (intern abonnement/innstillinger)
// -------------------------------------------------------------
// Mål:
// - Tannhjul (#manageSubscriptionBtn) åpner intern modal (#subscriptionModal)
// - Modal kan lukkes via [data-close="subscriptionModal"] eller ESC/klikk utenfor
// - Knapp i modal (#openPricingFromModal) åpner #pricingPage (hvis finnes)
// - Knapp i pricingPage (#closePricingBtn) går tilbake til mainApp
// Robust: Skal aldri kaste uncaught errors.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function safe(fn) {
    try { fn(); } catch (e) { console.warn('subscription.js:', e); }
  }

  function show(el) { if (el) el.style.display = 'block'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function isVisible(el) {
    if (!el) return false;
    return el.style.display !== 'none' && el.offsetParent !== null;
  }

  // ---------- Modal helpers ----------
  function openModal(modal) {
    if (!modal) return;
    show(modal);
    modal.setAttribute('aria-hidden', 'false');
    // Valgfritt: lås scrolling
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modal) {
    if (!modal) return;
    hide(modal);
    modal.setAttribute('aria-hidden', 'true');
    // Lås opp scrolling
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  // ---------- Page helpers ----------
  function openPricingPage() {
    const mainApp = $('mainApp');
    const pricingPage = $('pricingPage');

    if (!pricingPage) {
      alert('Fant ikke pricingPage i index.html');
      return;
    }

    hide(mainApp);
    show(pricingPage);
    window.scrollTo(0, 0);
  }

  function closePricingPage() {
    const mainApp = $('mainApp');
    const pricingPage = $('pricingPage');

    hide(pricingPage);
    show(mainApp);
    window.scrollTo(0, 0);
  }

  // ---------- Binding ----------
  function bindOnce(el, key, event, handler, opts) {
    if (!el) return false;
    if (el[key]) return true;
    el[key] = true;
    el.addEventListener(event, handler, opts);
    return true;
  }

  function bind() {
    const gearBtn = $('manageSubscriptionBtn');
    const modal = $('subscriptionModal');
    const openPricingBtn = $('openPricingFromModal');
    const closePricingBtn = $('closePricingBtn');

    // 1) Tannhjul -> åpne modal (hvis den finnes), ellers åpne pricingPage direkte
    if (gearBtn) {
      bindOnce(gearBtn, '__bf_bound_gear', 'click', (e) => {
        e.preventDefault();
        safe(() => {
          if (modal) openModal(modal);
          else openPricingPage();
        });
      }, { passive: false });
    } else {
      console.warn('subscription.js: Fant ikke #manageSubscriptionBtn');
    }

    // 2) Lukk modal: alle elementer med data-close="subscriptionModal"
    if (modal) {
      const closers = qsa('[data-close="subscriptionModal"]', modal);
      closers.forEach((btn, idx) => {
        bindOnce(btn, `__bf_bound_close_${idx}`, 'click', (e) => {
          e.preventDefault();
          safe(() => closeModal(modal));
        }, { passive: false });
      });

      // Klikk utenfor innhold: hvis du har .modal-content el.l. så lukker vi ved klikk på bakgrunnen
      bindOnce(modal, '__bf_bound_backdrop', 'click', (e) => {
        safe(() => {
          // Hvis klikket er på selve modalen (backdrop), ikke inni innholdet:
          if (e.target === modal) closeModal(modal);
        });
      });

      // ESC lukker modal
      bindOnce(document, '__bf_bound_esc', 'keydown', (e) => {
        safe(() => {
          if (e.key === 'Escape' && isVisible(modal)) closeModal(modal);
        });
      });
    } else {
      console.warn('subscription.js: Fant ikke #subscriptionModal (ok hvis du bruker pricingPage direkte)');
    }

    // 3) "Administrer abonnement" i modal -> åpne pricingPage (og lukke modal)
    if (openPricingBtn) {
      bindOnce(openPricingBtn, '__bf_bound_openPricing', 'click', (e) => {
        e.preventDefault();
        safe(() => {
          if (modal) closeModal(modal);
          openPricingPage();
        });
      }, { passive: false });
    } // ingen warning her – knappen kan være valgfri

    // 4) "Tilbake" på pricingPage -> tilbake til mainApp
    if (closePricingBtn) {
      bindOnce(closePricingBtn, '__bf_bound_closePricing', 'click', (e) => {
        e.preventDefault();
        safe(() => closePricingPage());
      }, { passive: false });
    } // også valgfri

    // 5) Eksponer en liten API (nyttig for debugging / andre scripts)
    window.SubscriptionUI = window.SubscriptionUI || {
      open: () => safe(() => (modal ? openModal(modal) : openPricingPage())),
      close: () => safe(() => (modal ? closeModal(modal) : closePricingPage())),
      openPricing: () => safe(() => openPricingPage()),
      closePricing: () => safe(() => closePricingPage()),
    };

    console.log('✅ subscription.js: bindings klare');
  }

  // Init når DOM er klar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => safe(bind));
  } else {
    safe(bind);
  }
})();
