// subscription.js — robust tannhjul + modal + Stripe Customer Portal
// Passer til index.html + auth.js + pricing.js som du har nå.
//
// - #manageSubscriptionBtn åpner #subscriptionModal (hvis finnes), ellers pricing.
// - Modalen fylles med Status/Plan/E-post ved åpning.
// - #managePortalBtn åpner Stripe Customer Portal via /api/create-portal-session (Bearer token).
// - #openPricingFromModal åpner pricing og husker at "Tilbake" skal gå til app.
// - checkSubscription() fungerer både med/uten userId (auth.js kaller uten).
// - getAccessToken() prioriterer localStorage (stabilt) og faller tilbake til getSession() med timeout.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    pricingReturn: null, // "main" | "login" | null
  };

  function isVisible(el) {
    if (!el) return false;
    return el.style.display !== "none";
  }

  function show(el, display = "block") {
    if (!el) return;
    el.style.display = display;
  }

  function hide(el) {
    if (!el) return;
    el.style.display = "none";
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      // Norsk kortformat
      return d.toLocaleDateString("no-NO", { year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      return null;
    }
  }

  function planLabel(plan) {
    if (!plan) return "—";
    const p = String(plan).toLowerCase();
    if (p === "month" || p === "monthly") return "Månedlig";
    if (p === "year" || p === "annual" || p === "yearly") return "Årlig";
    if (p === "lifetime") return "Livstid";
    return plan;
  }

  // -----------------------------
  // Token: localStorage først
  // -----------------------------
  function getTokenFromLocalStorage() {
    try {
      const keys = Object.keys(localStorage || {}).filter((k) => k.includes("sb-") && k.endsWith("-auth-token"));
      if (!keys.length) return null;

      // Velg den lengste (hvis flere)
      keys.sort((a, b) => (localStorage.getItem(b) || "").length - (localStorage.getItem(a) || "").length);
      const raw = localStorage.getItem(keys[0]);
      if (!raw) return null;

      const obj = JSON.parse(raw);

      const access =
        obj?.currentSession?.access_token ||
        obj?.access_token ||
        obj?.session?.access_token ||
        obj?.data?.session?.access_token;

      return access || null;
    } catch {
      return null;
    }
  }

  function withTimeout(promise, ms, label = "TIMEOUT") {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} (${ms}ms)`)), ms)),
    ]);
  }

  async function getAccessToken() {
    // 1) Stabilt: localStorage
    const ls = getTokenFromLocalStorage();
    if (ls) return ls;

    // 2) authService.getSessionWithRetry (men aldri heng)
    try {
      const svc = window.AuthService || window.authService;
      if (svc?.getSessionWithRetry) {
        const s = await withTimeout(svc.getSessionWithRetry(), 2500, "getSessionWithRetry");
        if (s?.access_token) return s.access_token;
      }
    } catch (_) {}

    // 3) supabase.auth.getSession (men aldri heng)
    try {
      const sb = window.supabase;
      if (sb?.auth?.getSession) {
        const res = await withTimeout(sb.auth.getSession(), 2500, "supabase.getSession");
        const token = res?.data?.session?.access_token;
        if (token) return token;
      }
    } catch (_) {}

    return null;
  }

  // -----------------------------
  // Subscription API
  // -----------------------------
  async function checkSubscription(/* userId optional */) {
    const token = await getAccessToken();

    // Hvis vi ikke får token: returner "ikke aktiv" (auth.js vil vise prisside)
    if (!token) return { active: false, trial: false, lifetime: false, canStartTrial: true };

    try {
      const resp = await fetch("/api/subscription-status", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.warn("subscription-status not ok:", resp.status, data);
        return { active: false, trial: false, lifetime: false, canStartTrial: true };
      }

      // Normaliser svar (sikrer felter pricing/auth forventer)
      return {
        active: !!data.active,
        trial: !!data.trial,
        lifetime: !!data.lifetime,
        plan: data.plan || null,
        current_period_end: data.current_period_end || null,
        canStartTrial: data.canStartTrial !== undefined ? !!data.canStartTrial : true,
      };
    } catch (e) {
      console.warn("checkSubscription failed:", e);
      return { active: false, trial: false, lifetime: false, canStartTrial: true };
    }
  }

  async function startTrial(userId, planType) {
    // Hvis du faktisk har /api/start-trial: denne vil brukes av pricing.js når trial er enabled.
    // Hvis ikke: failer pent uten å krasje UI.
    const token = await getAccessToken();
    if (!token) return { success: false, error: "Du må være logget inn for å starte prøveperiode." };

    try {
      const resp = await fetch("/api/start-trial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, planType }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        return { success: false, error: data?.error || `Kunne ikke starte prøveperiode (${resp.status})` };
      }

      return { success: true, ...data };
    } catch (e) {
      return { success: false, error: e?.message || "Kunne ikke starte prøveperiode." };
    }
  }

  // -----------------------------
  // Modal UI
  // -----------------------------
  async function fillSubscriptionModal() {
    const modal = $("subscriptionModal");
    if (!modal) return;

    const statusEl = $("subscriptionStatus");
    const planEl = $("subscriptionPlan");
    const userLineEl = $("subscriptionUserLine");

    // User line
    try {
      const svc = window.AuthService || window.authService;
      const u = svc?.currentUser || null;
      const email = u?.email || "";
      if (userLineEl) userLineEl.textContent = email ? `Innlogget som: ${email}` : "";
    } catch {
      if (userLineEl) userLineEl.textContent = "";
    }

    // Status + plan
    if (statusEl) statusEl.textContent = "Laster…";
    if (planEl) planEl.textContent = "Laster…";

    const s = await checkSubscription();

    if (s.lifetime) {
      if (statusEl) statusEl.textContent = "Aktiv";
      if (planEl) planEl.textContent = "Livstid";
      return;
    }

    if (s.trial && !s.active) {
      const until = fmtDate(s.current_period_end);
      if (statusEl) statusEl.textContent = until ? `Prøveperiode (til ${until})` : "Prøveperiode";
      if (planEl) planEl.textContent = planLabel(s.plan) || "—";
      return;
    }

    if (s.active) {
      const until = fmtDate(s.current_period_end);
      if (statusEl) statusEl.textContent = until ? `Aktiv (til ${until})` : "Aktiv";
      if (planEl) planEl.textContent = planLabel(s.plan);
      return;
    }

    if (statusEl) statusEl.textContent = "Ikke aktiv";
    if (planEl) planEl.textContent = "—";
  }

  function openModal() {
    const modal = $("subscriptionModal");
    if (!modal) return false;

    // Fjern "hidden" som kan trigge display:none !important
    modal.classList.remove("hidden");
    show(modal, "flex");

    // Fyll inn status/plan
    fillSubscriptionModal();
    return true;
  }

  function closeModal() {
    const modal = $("subscriptionModal");
    if (!modal) return;
    hide(modal);
    modal.classList.add("hidden");
  }

  // -----------------------------
  // Pricing navigation (return target)
  // -----------------------------
  function openPricing(returnTarget) {
    state.pricingReturn = returnTarget || null;

    const svc = window.AuthService || window.authService;
    if (svc?.showPricingPage) {
      svc.showPricingPage();
      return;
    }

    // fallback
    hide($("mainApp"));
    hide($("passwordProtection"));
    show($("pricingPage"), "block");
  }

  function closePricing() {
    const svc = window.AuthService || window.authService;

    if (state.pricingReturn === "main") {
      state.pricingReturn = null;
      if (svc?.showMainApp) {
        svc.showMainApp();
        return;
      }
      show($("mainApp"), "block");
      hide($("pricingPage"));
      return;
    }

    // default -> login
    state.pricingReturn = null;
    if (svc?.showLoginScreen) {
      svc.showLoginScreen();
      return;
    }
    show($("passwordProtection"), "block");
    hide($("pricingPage"));
    hide($("mainApp"));
  }

  // -----------------------------
  // Stripe Customer Portal
  // -----------------------------
  async function openStripeCustomerPortal() {
    try {
      const token = await getAccessToken();
      if (!token) {
        alert("Du må være logget inn for å administrere abonnement.");
        return;
      }

      const resp = await fetch("/api/create-portal-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data?.url) {
        console.error("Portal error:", resp.status, data);
        alert(data?.error || "Kunne ikke åpne abonnement akkurat nå. Prøv igjen.");
        return;
      }

      window.location.href = data.url;
    } catch (e) {
      console.error("openStripeCustomerPortal failed:", e);
      alert("Kunne ikke åpne abonnement. Prøv igjen.");
    }
  }

  // -----------------------------
  // Public API expected by auth/pricing
  // -----------------------------
  const svc = (window.subscriptionService = window.subscriptionService || {});

  svc.checkSubscription = svc.checkSubscription || checkSubscription;
  svc.startTrial = svc.startTrial || startTrial;

  svc.init =
    svc.init ||
    (async function () {
      try {
        if (svc.stripe) return;

        const key = window.CONFIG?.stripe?.publishableKey;
        if (!key) throw new Error("Mangler CONFIG.stripe.publishableKey");

        if (typeof window.Stripe !== "function") {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://js.stripe.com/v3/";
            s.onload = resolve;
            s.onerror = () => reject(new Error("Kunne ikke laste Stripe.js"));
            document.head.appendChild(s);
          });
        }

        svc.stripe = window.Stripe(key);
      } catch (e) {
        console.error("❌ subscriptionService.init failed:", e);
      }
    });

  // For bakoverkompatibilitet med gamle kall
  svc.manageSubscription = svc.manageSubscription || function () {
    if (!openModal()) openPricing("main");
  };

  window.SubscriptionUI = window.SubscriptionUI || {
    open: () => svc.manageSubscription(),
    close: () => closeModal(),
    openPortal: () => openStripeCustomerPortal(),
  };

  // -----------------------------
  // Click handling (delegation)
  // -----------------------------
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;

      // Tannhjul i topp
      if (t?.closest?.("#manageSubscriptionBtn")) {
        e.preventDefault();
        e.stopPropagation();
        // alltid modal hvis mulig
        if (!openModal()) openPricing("main");
        return;
      }

      // Portal-knapp i modal
      if (t?.closest?.("#managePortalBtn")) {
        e.preventDefault();
        e.stopPropagation();
        openStripeCustomerPortal();
        return;
      }

      // "Se planer" i modal -> pricing (return til app)
      if (t?.closest?.("#openPricingFromModal")) {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
        openPricing("main");
        return;
      }

      // Close pricing -> riktig retur
      if (t?.closest?.("#closePricingBtn")) {
        e.preventDefault();
        e.stopPropagation();
        closePricing();
        return;
      }

      // Close modal (X / backdrop / data-close)
      if (
        t?.closest?.('[data-close="subscriptionModal"]') ||
        t?.closest?.("#closeSubscriptionBtn") ||
        t?.closest?.(".close-subscription") ||
        t?.closest?.('#subscriptionModal [data-close="subscriptionModal"]')
      ) {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
        return;
      }
    },
    { passive: false }
  );

  // ESC lukker modal først, ellers pricing
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    const modal = $("subscriptionModal");
    const pricing = $("pricingPage");

    if (modal && isVisible(modal)) {
      closeModal();
      return;
    }
    if (pricing && isVisible(pricing)) {
      closePricing();
    }
  });

  console.log("✅ subscription.js lastet (robust token + modal + portal)");
})();
