// Barnefotballtrener - Auth UI Handler
// ================================================
// Håndterer UI for innlogging, logout og subscription status
// Robust for mobil (Safari) ved å bruke event-delegering for logout.

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', initAuthUI);

  async function initAuthUI() {
    // Vent litt på at authService blir tilgjengelig
    await waitForAuthService(3000);

    // NOTE: Google Sign In button is bound by auth.js (with stopImmediatePropagation).
    // We do NOT bind it here to avoid double-firing on mobile (touchend + click).
    setupLogoutDelegation(); // <-- viktig: robust på mobil
    setupSubscriptionBadge();
    setupRefreshButton();
  }

  async function waitForAuthService(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.authService && typeof window.authService.signInWithGoogle === 'function') return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  // -----------------------------
  // Logout (robust på mobil)
  // -----------------------------
  function setupLogoutDelegation() {
    // Vi lytter på dokumentet og sjekker om klikk/touch kom fra logout-knappen
    const matchesLogout = (target) => {
      if (!target) return null;
      return target.closest('#logoutBtn, [data-action="logout"], .logout-btn');
    };

    const doLogout = async (ev) => {
      const btn = matchesLogout(ev.target);
      if (!btn) return;

      ev.preventDefault();
      ev.stopPropagation();

      // Unngå dobbel-trigger (click + touchend)
      if (btn.dataset.locked === '1') return;
      btn.dataset.locked = '1';
      setTimeout(() => (btn.dataset.locked = '0'), 600);

      const ok = window.confirm('Er du sikker på at du vil logge ut?');
      if (!ok) return;

      try {
        if (!window.authService || typeof window.authService.signOut !== 'function') {
          throw new Error('authService.signOut mangler');
        }

        await window.authService.signOut();

        // Valgfritt, men ofte nødvendig for å få UI “rent” på iOS:
        // reload sikrer at session + view resettes
        notify('Logget ut', 'info');
        setTimeout(() => window.location.reload(), 150);
      } catch (error) {
        console.error('Logout error:', error);
        notify('Kunne ikke logge ut. Prøv igjen.', 'error');
      }
    };

    document.addEventListener('click', doLogout, true);
    document.addEventListener('touchend', doLogout, true);
  }

  // -----------------------------
  // Subscription Badge
  // -----------------------------
  async function setupSubscriptionBadge() {
    const badge = document.getElementById('subscriptionBadge');
    const text = document.getElementById('subscriptionText');
    if (!badge || !text) return;

    try {
      const user = window.authService?.getUser?.();
      if (!user) {
        badge.style.display = 'none';
        return;
      }

      const subscription = await window.subscriptionService?.checkSubscription?.();
      if (!subscription) {
        badge.style.display = 'none';
        return;
      }

      if (subscription.trial) {
        badge.className = 'subscription-badge trial';
        text.textContent = `Trial`;
        badge.style.display = 'flex';
      } else if (subscription.active) {
        badge.className = 'subscription-badge active';
        text.textContent = 'Pro';
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    } catch (e) {
      console.error('Error loading subscription badge:', e);
      badge.style.display = 'none';
    }
  }

  // -----------------------------
  // Refresh Button
  // -----------------------------
  function setupRefreshButton() {
    const btn = document.getElementById('refreshBtn');
    if (!btn) return;
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', () => {
      window.location.reload();
    });
  }

  // -----------------------------
  // Notification helper
  // -----------------------------
  function notify(message, type = 'info') {
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return;
    }
    const el = document.getElementById('notification');
    if (!el) return;

    el.textContent = message;
    el.className = `notification ${type}`;
    el.style.display = 'block';
    setTimeout(() => (el.style.display = 'none'), 2600);
  }
})();
