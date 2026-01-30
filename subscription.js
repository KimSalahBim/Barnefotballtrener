// subscription.js
// Robust betaling/portal + abonnement-modal (lav-risiko):
// - Fikser at modalen er skjult med class="hidden" (display:none !important) ved å toggle class.
// - Bruker riktige ID-er fra index.html: #subscriptionStatus, #subscriptionPlan, #subscriptionModal, #managePortalBtn
// - Robust klikk på tannhjul via event delegation (capture) + pointer-events på ikon.
// - Eksponerer window.subscriptionService med:
//    * init() -> this.stripe
//    * checkSubscription() -> /api/subscription-status
//    * startCheckout(planType) -> /api/create-checkout-session + redirectToCheckout({sessionId})
//    * startTrial(planType) -> /api/start-trial
//    * openPortal(flow) -> /api/create-portal-session + redirect til url (manage/cancel)
//
// Krever: window.supabase (fra auth.js) og window.CONFIG (fra config.js)

(function () {
  'use strict';

  const LOG_PREFIX = '🧾';
  const STATUS_ENDPOINT = '/api/subscription-status';
  const CHECKOUT_ENDPOINT = '/api/create-checkout-session';
  const TRIAL_ENDPOINT = '/api/start-trial';
  const PORTAL_ENDPOINT = '/api/create-portal-session';

  // -----------------------------
  // Utils
  // -----------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log() {
    try { console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (_) {}
  }
  function warn() {
    try { console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (_) {}
  }

  function fmtDateNo(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) { return ''; }
  }

  function planLabel(plan) {
    const map = { month: 'Månedlig', year: 'Årlig', lifetime: 'Livstid' };
    return map[String(plan || '').toLowerCase()] || '—';
  }

  async function getAccessToken(opts) {
    const retries = (opts && opts.retries) || 6;

    for (let i = 0; i < retries; i++) {
      try {
        const s = await (window.supabase && window.supabase.auth && window.supabase.auth.getSession
          ? window.supabase.auth.getSession()
          : null);
        const token = s && s.data && s.data.session && s.data.session.access_token;
        if (token) return token;

        const u = await (window.supabase && window.supabase.auth && window.supabase.auth.getUser
          ? window.supabase.auth.getUser()
          : null);
        if (u && u.data && u.data.user) {
          // user finnes, token kan komme "straks"
        }
      } catch (_) {}

      await sleep(250 + i * 250);
    }

    throw new Error('Ingen gyldig sesjon (token mangler).');
  }

  async function callApiJson(url, opts) {
    opts = opts || {};
    const method = opts.method || 'GET';
    const token = opts.token;
    const body = opts.body;

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    const res = await fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch (_) {}

    if (!res.ok) {
      const msg = (data && data.error) || (res.status + ' ' + res.statusText);
      throw new Error(msg);
    }
    return data;
  }

  function ensureStripeJsLoaded() {
    return new Promise((resolve, reject) => {
      if (window.Stripe) return resolve();

      const existing = document.querySelector('script[src^="https://js.stripe.com/v3"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Kunne ikke laste Stripe.js')));
        return;
      }

      const s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Kunne ikke laste Stripe.js'));
      document.head.appendChild(s);
    });
  }

  // -----------------------------
  // SubscriptionService (global)
  // -----------------------------
  const subscriptionService = {
    stripe: null,

    init: async function () {
      if (this.stripe) return this.stripe;
      const pk = window.CONFIG && window.CONFIG.stripe && window.CONFIG.stripe.publishableKey;
      if (!pk) {
        warn('Mangler CONFIG.stripe.publishableKey');
        return null;
      }
      await ensureStripeJsLoaded();
      this.stripe = window.Stripe(pk);
      return this.stripe;
    },

    checkSubscription: async function () {
      let token;
      try {
        token = await getAccessToken({ retries: 6 });
      } catch (e) {
        warn('getAccessToken failed:', e);
        return {
          active: false,
          trial: false,
          lifetime: false,
          plan: null,
          current_period_end: null,
          cancel_at_period_end: false,
          cancel_at: null,
          trial_ends_at: null,
          canStartTrial: false,
          reason: 'no_session',
        };
      }

      try {
        const status = await callApiJson(STATUS_ENDPOINT, { method: 'GET', token: token });
        return status || {};
      } catch (e) {
        warn('subscription-status failed:', e);
        return {
          active: false,
          trial: false,
          lifetime: false,
          plan: null,
          current_period_end: null,
          cancel_at_period_end: false,
          cancel_at: null,
          trial_ends_at: null,
          canStartTrial: false,
          reason: 'status_error',
        };
      }
    },

    startCheckout: async function (planType) {
      await this.init();
      if (!this.stripe || typeof this.stripe.redirectToCheckout !== 'function') {
        throw new Error('Stripe er ikke initialisert');
      }

      const token = await getAccessToken({ retries: 6 });
      const data = await callApiJson(CHECKOUT_ENDPOINT, {
        method: 'POST',
        token: token,
        body: { planType: planType },
      });

      const sessionId = data && data.sessionId;
      if (!sessionId) throw new Error('Mangler sessionId fra server.');

      const result = await this.stripe.redirectToCheckout({ sessionId: sessionId });
      if (result && result.error) throw result.error;
    },

    startTrial: async function (_userId, planType) {
      const token = await getAccessToken({ retries: 6 });
      const data = await callApiJson(TRIAL_ENDPOINT, {
        method: 'POST',
        token: token,
        body: { planType: planType },
      });
      return data;
    },

    openPortal: async function (flow) {
      flow = flow || 'manage';
      const token = await getAccessToken({ retries: 6 });
      const returnUrl = window.location.origin + window.location.pathname + (window.location.hash || '');

      const data = await callApiJson(PORTAL_ENDPOINT, {
        method: 'POST',
        token: token,
        body: { returnUrl: returnUrl, flow: flow },
      });

      if (!data || !data.url) throw new Error('Mangler portal-URL fra server.');
      window.location.href = data.url;
    },
  };

  window.subscriptionService = subscriptionService;

  // -----------------------------
  // Modal helpers (index.html markup)
  // -----------------------------
  function getModal() {
    return document.getElementById('subscriptionModal');
  }

  function openModal() {
    const modal = getModal();
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('lock-scroll');
  }

  function closeModal() {
    const modal = getModal();
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('lock-scroll');
  }

  function ensureCancelButton() {
    const modal = getModal();
    if (!modal) return null;

    const manageBtn = modal.querySelector('#managePortalBtn');
    if (!manageBtn) return null;

    let cancelBtn = modal.querySelector('#cancelPortalBtn');
    if (cancelBtn) return cancelBtn;

    cancelBtn = document.createElement('button');
    cancelBtn.id = 'cancelPortalBtn';
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.marginLeft = '8px';
    cancelBtn.innerHTML = '<i class="fas fa-ban"></i> Kanseller abonnement';

    manageBtn.insertAdjacentElement('afterend', cancelBtn);
    return cancelBtn;
  }

  function setModalTexts(status) {
    const statusEl = document.getElementById('subscriptionStatus');
    const planEl = document.getElementById('subscriptionPlan');
    const userLine = document.getElementById('subscriptionUserLine');

    try {
      const email = window.authService && window.authService.currentUser ? window.authService.currentUser.email : '';
      if (userLine) userLine.textContent = email ? ('Innlogget som ' + email) : '';
    } catch (_) {}

    let statusText = 'Ikke aktiv';
    if (status && status.lifetime) statusText = 'Aktiv (livstid)';
    else if (status && status.trial) statusText = 'Aktiv (prøveperiode)';
    else if (status && status.active) statusText = 'Aktiv';

    if (statusEl) statusEl.textContent = statusText;
    if (planEl) {
      if (status && status.trial && !status.plan) planEl.textContent = 'Prøveperiode';
      else planEl.textContent = planLabel(status && status.plan);
    }

    const infoId = 'subscriptionCancelInfo';
    let info = document.getElementById(infoId);
    const modal = getModal();
    if (!modal) return;

    if (!info) {
      info = document.createElement('div');
      info.id = infoId;
      info.style.marginTop = '10px';
      info.style.fontSize = '13px';
      info.style.opacity = '0.85';
      const body = modal.querySelector('.bf-modal__body') || modal;
      body.appendChild(info);
    }

    if (status && status.lifetime) {
      info.textContent = 'Du har livstidstilgang.';
      return;
    }

    if (status && status.trial) {
      const d = fmtDateNo(status.trial_ends_at);
      info.textContent = d ? ('Prøveperiode aktiv til ' + d + '.') : 'Prøveperiode aktiv.';
      return;
    }

    if (status && status.active) {
      if (status.cancel_at_period_end) {
        const end = fmtDateNo(status.cancel_at || status.current_period_end);
        info.textContent = end
          ? ('Kansellert ved periodens slutt. Tilgang til ' + end + '.')
          : 'Kansellert ved periodens slutt.';
      } else {
        const renew = fmtDateNo(status.current_period_end);
        info.textContent = renew ? ('Fornyes ' + renew + '.') : '';
      }
      return;
    }

    info.textContent = 'Ingen aktiv plan. Velg en plan for å få full tilgang.';
  }

  async function openSubscriptionModal() {
    openModal();

    const cancelBtn = ensureCancelButton();
    const manageBtn = document.getElementById('managePortalBtn');

    let status = null;
    try { status = await subscriptionService.checkSubscription(); }
    catch (e) { warn('checkSubscription error:', e); status = { active: false }; }

    setModalTexts(status);

    if (manageBtn && !manageBtn.__bf_bound_manage) {
      manageBtn.__bf_bound_manage = true;
      manageBtn.addEventListener('click', async function () {
        try { await subscriptionService.openPortal('manage'); }
        catch (e) { alert('Kunne ikke åpne abonnement-portalen: ' + e.message); }
      });
    }

    if (cancelBtn && !cancelBtn.__bf_bound_cancel) {
      cancelBtn.__bf_bound_cancel = true;
      cancelBtn.addEventListener('click', async function () {
        try {
          const s = await subscriptionService.checkSubscription();
          if (!s || !s.active || s.trial || s.lifetime) {
            alert('Du har ikke et aktivt, betalt abonnement å kansellere.');
            return;
          }
          await subscriptionService.openPortal('cancel');
        } catch (e) {
          alert('Kunne ikke åpne kanselleringsflyt: ' + e.message);
        }
      });
    }

    if (cancelBtn) {
      const disabled = !status || !status.active || !!status.trial || !!status.lifetime;
      cancelBtn.disabled = disabled;
      cancelBtn.title = disabled
        ? 'Kansellering gjelder bare aktive betalte abonnement.'
        : 'Kanseller ved periodens slutt (i Stripe-portalen).';
    }
  }

  // -----------------------------
  // Binding: robust tannhjul + data-close
  // -----------------------------
  function bind() {
    const gearBtn = document.getElementById('manageSubscriptionBtn');
    if (gearBtn) {
      const icon = gearBtn.querySelector('i');
      if (icon) icon.style.pointerEvents = 'none';
    }

    if (!document.__bf_sub_modal_bound) {
      document.__bf_sub_modal_bound = true;

      // CAPTURE gjør at vi overlever hvis andre scripts stopper bubbling.
      document.addEventListener('click', function (e) {
        const t = e.target;

        const gear = t && t.closest ? t.closest('#manageSubscriptionBtn') : null;
        if (gear) {
          e.preventDefault();
          e.stopPropagation();
          log('✅ manageSubscriptionBtn clicked');
          openSubscriptionModal();
          return;
        }

        const close = t && t.closest ? t.closest('[data-close="subscriptionModal"]') : null;
        if (close) {
          e.preventDefault();
          closeModal();
          return;
        }

        const openPricing = t && t.closest ? t.closest('#openPricingFromModal') : null;
        if (openPricing) {
          e.preventDefault();
          try { if (window.authService && window.authService.showPricingPage) window.authService.showPricingPage(); } catch (_) {}
          closeModal();
          return;
        }
      }, true);

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal();
      });
    }

    log('✅ subscription.js loaded (modal + portal + checkout)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
