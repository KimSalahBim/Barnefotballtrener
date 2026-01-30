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
    const ls = getTokenFromLocalStorage();
    if (ls) return ls;

    // NB: Hvis du ser "supabase.getSession (2500ms)" ofte, øk 2500 til f.eks 8000
    try {
      const svc = window.AuthService || window.authService;
      if (svc?.getSessionWithRetry) {
        const s = await withTimeout(svc.getSessionWithRetry(), 2500, "getSessionWithRetry");
        if (s?.access_token) return s.access_token;
      }
    } catch (_) {}

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
  async function checkSubscription() {
    const token = await getAccessToken();
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
      if (!resp.ok) return { success: false, error: data?.error || `Kunne ikke starte prøveperiode (${resp.status})` };

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

    try {
      const svc = window.AuthService || window.authService;
      const u = svc?.currentUser || null;
      const email = u?.email || "";
      if (userLineEl) userLineEl.textContent = email ? `Innlogget som: ${email}` : "";
    } catch {
      if (userLineEl) userLineEl.textContent = "";
    }

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

    modal.classList.remove("hidden");
    show(modal, "flex");
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
  // Pricing navigation
  // -----------------------------
  function openPricing(returnTarget) {
    state.pricingReturn = returnTarget || null;

    const svc = window.AuthService || window.authService;
    if (svc?.showPricingPage) {
      svc.showPricingPage();
      return;
    }

    try {
      window.location.href = "/pricing.html";
    } catch (_) {}
  }

  // -----------------------------
  // Stripe Customer Portal
  // -----------------------------
  async function openCustomerPortal() {
    const token = await getAccessToken();
    if (!token) {
      alert("Du må være logget inn for å åpne abonnement-innstillinger.");
      return;
    }

    try {
      const resp = await fetch("/api/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ returnUrl: window.location.href }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.url) {
        console.warn("create-portal-session failed:", resp.status, data);
        alert("Kunne ikke åpne abonnement-innstillinger akkurat nå.");
        return;
      }

      window.location.href = data.url;
    } catch (e) {
      console.warn("openCustomerPortal error:", e);
      alert("Kunne ikke åpne abonnement-innstillinger akkurat nå.");
    }
  }

  // -----------------------------
  // Bind UI
  // -----------------------------
  function bindManageButton() {
    const btn = $("manageSubscriptionBtn");
    if (!btn) return;

    btn.addEventListener("click", async function () {
      const didOpen = openModal();
      if (!didOpen) {
        // fallback: åpne pricing
        openPricing("main");
      }
    });
  }

  function bindModalButtons() {
    const modal = $("subscriptionModal");
    if (!modal) return;

    const closeBtn = $("closeSubscriptionModal");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });

    const portalBtn = $("managePortalBtn");
    if (portalBtn) portalBtn.addEventListener("click", openCustomerPortal);

    const openPricingBtn = $("openPricingFromModal");
    if (openPricingBtn) {
      openPricingBtn.addEventListener("click", function () {
        closeModal();
        openPricing("main");
      });
    }
  }

  // -----------------------------
  // Expose service
  // -----------------------------
  window.subscriptionService = {
    checkSubscription,
    startTrial,
    openCustomerPortal,
  };

  // Boot
  bindManageButton();
  bindModalButtons();

  console.log("✅ subscription.js lastet (robust token + modal + portal)");
})();
