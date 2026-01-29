// Barnefotballtrener - Pricing Page + Magic Link Logic
// =====================================================

(() => {
  'use strict';

  // -------------------------------
  // Helpers
  // -------------------------------
  function log(...args) {
    console.log(...args);
  }

  function showNotification(message, type = 'info') {
    log(`📢 Notification: ${message} (${type})`);

    // Bruk eksisterende notification-system hvis tilgjengelig
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return;
    }

    // Fallback
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 25px;
      border-radius: 12px;
      background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6'};
      color: white;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function getAuthService() {
    return window.authService || null;
  }

  function getSubscriptionService() {
    // Viktig: i din kode har du brukt subscriptionService (ikke subscriptionsService)
    return window.subscriptionService || null;
  }

  function getSupabaseClient() {
    // Fallback: authService.supabase -> window.supabase
    const a = getAuthService();
    if (a?.supabase) return a.supabase;
    if (window.supabase) return window.supabase;
    return null;
  }

  function cleanEmail(email) {
    return String(email || '').trim();
  }

  // -------------------------------
  // Session/token helpers
  // -------------------------------
  async function getAccessToken() {
    // 1) Prefer: authService.getSessionWithRetry() hvis den finnes
    try {
      const a = getAuthService();
      if (a?.getSessionWithRetry) {
        const s = await a.getSessionWithRetry();
        if (s?.access_token) return s.access_token;
        if (s?.session?.access_token) return s.session.access_token;
      }
    } catch (_) {}

    // 2) Fallback: supabase.auth.getSession()
    try {
      const sb = getSupabaseClient();
      if (sb?.auth?.getSession) {
        const { data } = await sb.auth.getSession();
        const token = data?.session?.access_token;
        if (token) return token;
      }
    } catch (_) {}

    return null;
  }

  async function getCurrentUser() {
    // 1) Sync user fra authService hvis den finnes
    try {
      const a = getAuthService();
      if (a?.getUser) {
        const u = a.getUser(); // i din kode ser denne ut til å være sync
        if (u) return u;
      }
      if (a?.currentUser) return a.currentUser;
    } catch (_) {}

    // 2) Fallback: supabase.auth.getSession()
    try {
      const sb = getSupabaseClient();
      if (sb?.auth?.getSession) {
        const { data } = await sb.auth.getSession();
        const u = data?.session?.user || null;
        if (u) return u;
      }
    } catch (_) {}

    return null;
  }

  // -------------------------------
  // Magic link binding + cooldown
  // -------------------------------
  const MAGIC_COOLDOWN_MS = 35_000; // 35s for å unngå rate limit
  const MAGIC_STORAGE_KEY = 'bf_magiclink_last_sent_at';

  function getMagicCooldownRemaining() {
    try {
      const last = Number(localStorage.getItem(MAGIC_STORAGE_KEY) || '0');
      const diff = Date.now() - last;
      return Math.max(0, MAGIC_COOLDOWN_MS - diff);
    } catch (_) {
      return 0;
    }
  }

  function setMagicCooldownNow() {
    try {
      localStorage.setItem(MAGIC_STORAGE_KEY, String(Date.now()));
    } catch (_) {}
  }

  function setBtnDisabled(btn, disabled) {
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? '0.7' : '1';
    btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    btn.style.pointerEvents = disabled ? 'none' : 'auto';
  }

  async function sendMagicLink() {
    const a = getAuthService();
    const sb = getSupabaseClient();
    const emailInput = document.getElementById('magicLinkEmail');
    const btn = document.getElementById('magicLinkBtn');

    const email = cleanEmail(emailInput?.value);

    if (!email || !email.includes('@')) {
      showNotification('Skriv inn en gyldig e-postadresse.', 'error');
      return;
    }

    const remaining = getMagicCooldownRemaining();
    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      showNotification(`Vent litt – du kan sende ny lenke om ${secs}s.`, 'info');
      return;
    }

    if (!a && !sb) {
      showNotification('Innlogging er ikke klar (auth mangler). Oppdater siden.', 'error');
      return;
    }

    setBtnDisabled(btn, true);
    showNotification('Sender innloggingslenke…', 'info');

    try {
      // Bruk din authService-metode hvis den finnes
      if (a?.signInWithMagicLink) {
        const res = await a.signInWithMagicLink(email);
        if (!res?.success) {
          throw new Error(res?.error || 'Kunne ikke sende innloggingslenke');
        }
      } else {
        // Fallback direkte mot supabase client
        if (!sb?.auth?.signInWithOtp) throw new Error('Supabase auth er ikke tilgjengelig');

        // Safari/iOS: bruk samme origin + path
        const emailRedirectTo = window.location.origin + window.location.pathname;

        const { error } = await sb.auth.signInWithOtp({
          email,
          options: { emailRedirectTo },
        });
        if (error) throw error;
      }

      setMagicCooldownNow();
      showNotification('Innloggingslenke sendt. Sjekk e-posten (og søppelpost).', 'success');
    } catch (err) {
      const msg = err?.message || String(err);

      // Spesifikk håndtering av rate limit
      if (String(msg).toLowerCase().includes('rate') || String(msg).includes('429')) {
        setMagicCooldownNow(); // sett cooldown uansett for å hindre spam-klikk
        showNotification('Du har sendt for mange lenker. Vent litt og prøv igjen.', 'error');
      } else {
        showNotification(`Kunne ikke sende lenke: ${msg}`, 'error');
      }
      console.error('❌ Magic link error:', err);
    } finally {
      // re-enable etter en liten pause (også ved feil)
      setTimeout(() => setBtnDisabled(btn, false), 1200);
    }
  }

  function bindMagicLinkUI() {
    const btn = document.getElementById('magicLinkBtn');
    const input = document.getElementById('magicLinkEmail');

    if (!btn || !input) {
      // Ikke på alle sider
      return;
    }

    if (btn.__bf_bound_magic) return;
    btn.__bf_bound_magic = true;

    btn.addEventListener(
      'click',
      async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await sendMagicLink();
      },
      { passive: false }
    );

    // Enter i input sender
    if (!input.__bf_bound_enter) {
      input.__bf_bound_enter = true;
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          await sendMagicLink();
        }
      });
    }

    // Vis cooldown-status hvis aktiv
    const remaining = getMagicCooldownRemaining();
    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      showNotification(`Du kan sende ny lenke om ${secs}s.`, 'info');
    }

    log('✅ Magic link bundet (#magicLinkBtn)');
  }

  // -------------------------------
  // Pricing / checkout
  // -------------------------------
  async function handlePlanSelection(planType) {
    try {
      log('🔍 Handling plan selection:', planType);

      const user = await getCurrentUser();
      const a = getAuthService();
      const svc = getSubscriptionService();

      if (!user) {
        showNotification('Du må være logget inn først.', 'error');
        a?.showLoginScreen?.();
        return;
      }

      // Trial-logikk (kun hvis du har det skrudd på og metodene finnes)
      try {
        const cfg = window.CONFIG;
        const canTrial =
          !!cfg?.trial?.enabled &&
          typeof svc?.checkSubscription === 'function' &&
          typeof svc?.startTrial === 'function';

        if (canTrial) {
          const sub = await svc.checkSubscription(user.id);
          if (sub?.canStartTrial) {
            const result = await svc.startTrial(user.id, planType);
            if (result?.success) {
              showNotification(`Gratulerer! Din ${cfg.trial.days}-dagers prøveperiode har startet! 🎉`, 'success');
              setTimeout(() => a?.showMainApp?.(), 800);
              return;
            }
            // hvis trial feiler: fall gjennom til checkout
          }
        }
      } catch (_) {
        // Ignorer trial-feil og gå videre til checkout
      }

      // Ellers -> Stripe checkout via backend
      await startCheckout(planType);
    } catch (error) {
      console.error('❌ Error handling plan selection:', error);
      showNotification('En feil oppstod. Prøv igjen senere.', 'error');
    }
  }

  async function startCheckout(planType) {
    try {
      showNotification('Videresender til betaling…', 'info');

      const svc = getSubscriptionService();
      if (!svc?.init || !svc?.stripe) {
        // init kan sette stripe
        if (svc?.init) await svc.init();
      }

      if (!svc?.stripe) {
        throw new Error('Stripe er ikke initialisert');
      }

      const token = await getAccessToken();
      if (!token) {
        showNotification('Du må være logget inn først.', 'error');
        getAuthService()?.showLoginScreen?.();
        return;
      }

      const resp = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planType }),
      });

      let data = {};
      try {
        data = await resp.json();
      } catch (_) {}

      if (!resp.ok || !data?.sessionId) {
        console.error('Checkout session error:', data);
        throw new Error(data?.error || 'Kunne ikke starte betalingsprosessen');
      }

      const { error } = await svc.stripe.redirectToCheckout({ sessionId: data.sessionId });
      if (error) throw error;
    } catch (error) {
      console.error('❌ Checkout error:', error);
      showNotification(`Kunne ikke starte betalingsprosessen: ${error?.message || error}`, 'error');
    }
  }

  async function handleSuccessfulPayment() {
    showNotification('Betaling fullført! Velkommen! 🎉', 'success');
    setTimeout(() => {
      window.history.replaceState({}, document.title, window.location.pathname);
      getAuthService()?.showMainApp?.();
    }, 900);
  }

  // -------------------------------
  // Bindings
  // -------------------------------
  function bindPricingButtons() {
    // Event delegation: funker selv om kort/knapper renderes på nytt
    if (document.__bf_bound_pricing_clicks) return;
    document.__bf_bound_pricing_clicks = true;

    document.addEventListener(
      'click',
      async (e) => {
        const btn = e.target?.closest?.('.btn-select');
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const planType = btn.getAttribute('data-plan'); // month | year | lifetime
        if (!planType) {
          showNotification('Fant ikke plan-type på knappen.', 'error');
          return;
        }

        log(`💳 Plan button clicked: ${planType}`);
        await handlePlanSelection(planType);
      },
      { passive: false }
    );
  }

  function bindStripeReturnHandlers() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success') === 'true') {
      handleSuccessfulPayment();
    } else if (urlParams.get('canceled') === 'true') {
      showNotification('Betaling avbrutt. Du kan prøve igjen når som helst.', 'info');
    }
  }

  // Team/Club modaler (trygt: gjør ingenting hvis de ikke finnes)
  function bindContactFormsIfPresent() {
    const teamForm = document.getElementById('teamContactForm');
    if (teamForm && !teamForm.__bf_bound) {
      teamForm.__bf_bound = true;
      teamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showNotification('Kontakt-skjema er ikke aktivert ennå.', 'info');
      });
    }

    const clubForm = document.getElementById('clubContactForm');
    if (clubForm && !clubForm.__bf_bound) {
      clubForm.__bf_bound = true;
      clubForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showNotification('Kontakt-skjema er ikke aktivert ennå.', 'info');
      });
    }
  }

  // -------------------------------
  // Boot
  // -------------------------------
  function boot() {
    log('💳 pricing.js loaded');
    bindPricingButtons();
    bindStripeReturnHandlers();
    bindMagicLinkUI();
    bindContactFormsIfPresent();

    // Debug
    const count = document.querySelectorAll('.btn-select').length;
    log(`Found ${count} select buttons`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
