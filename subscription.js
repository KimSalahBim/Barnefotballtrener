/* subscription.js (frontend – browser) */
(function () {
  "use strict";

  function log() { try { console.log("🧾", ...arguments); } catch (_) {} }
  function warn() { try { console.warn("⚠️", ...arguments); } catch (_) {} }
  function err() { try { console.error("❌", ...arguments); } catch (_) {} }

  function $(id) { return document.getElementById(id); }

  function show(el, display) {
    if (!el) return;
    el.style.display = display || "block";
    el.classList.remove("hidden");
  }

  function hide(el) {
    if (!el) return;
    el.style.display = "none";
    el.classList.add("hidden");
  }

  function fmtDate(iso) {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString("no-NO", { year: "numeric", month: "2-digit", day: "2-digit" });
    } catch (_) {
      return null;
    }
  }

  function planLabel(plan) {
    if (plan === "month") return "Månedlig";
    if (plan === "year") return "Årlig";
    if (plan === "lifetime") return "Livstid";
    return plan || "—";
  }

  async function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(label || "timeout")), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(t);
    }
  }

  async function getAccessToken() {
    // Prefer AuthService if you have one
    try {
      const svc = window.AuthService || window.authService;
      if (svc && typeof svc.getAccessToken === "function") {
        const tok = await svc.getAccessToken();
        if (tok) return tok;
      }
    } catch (_) {}

    // Fallback: window.supabase session
    try {
      if (!window.supabase || !window.supabase.auth) return null;

      const { data, error } = await withTimeout(
        window.supabase.auth.getSession(),
        3500,
        "supabase.getSession timeout"
      );

      if (error) {
        warn("getSession error:", error);
        return null;
      }
      return data && data.session ? data.session.access_token : null;
    } catch (e) {
      warn("getAccessToken failed:", e);
      return null;
    }
  }

  async function checkSubscription() {
    const token = await getAccessToken();
    if (!token) {
      return { active: false, trial: false, lifetime: false, plan: null, current_period_end: null, canStartTrial: true, reason: "not_logged_in" };
    }

    try {
      const resp = await fetch("/api/subscription-status", {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        warn("subscription-status not ok:", resp.status, data);
        return { active: false, trial: false, lifetime: false, plan: null, current_period_end: null, canStartTrial: true, reason: "api_error" };
      }

      // Normalize for frontend
      return {
        active: !!data.active,
        trial: !!data.trial,
        lifetime: !!data.lifetime,
        plan: data.plan || null,
        current_period_end: data.current_period_end || null,
        trial_ends_at: data.trial_ends_at || null,
        canStartTrial: (typeof data.canStartTrial === "boolean") ? data.canStartTrial : true,
        reason: data.reason || null,
      };
    } catch (e) {
      err("checkSubscription network error:", e);
      return { active: false, trial: false, lifetime: false, plan: null, current_period_end: null, canStartTrial: true, reason: "network_error" };
    }
  }

  async function startTrial(planType) {
    const token = await getAccessToken();
    if (!token) return { ok: false, error: "NOT_LOGGED_IN" };

    try {
      const resp = await fetch("/api/start-trial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ planType: planType || "year" }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return { ok: false, error: data.error || ("HTTP_" + resp.status) };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: "NETWORK_ERROR" };
    }
  }

  async function openCustomerPortal() {
    const token = await getAccessToken();
    if (!token) {
      alert("Du må være logget inn for å åpne abonnement-innstillinger.");
      return;
    }

    try {
      const resp = await fetch("/api/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ returnUrl: window.location.href }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.url) {
        warn("create-portal-session failed:", resp.status, data);
        alert("Kunne ikke åpne abonnement-innstillinger akkurat nå.");
        return;
      }
      window.location.href = data.url;
    } catch (e) {
      err("openCustomerPortal failed:", e);
      alert("Kunne ikke åpne abonnement-innstillinger akkurat nå.");
    }
  }

  async function fillSubscriptionModal() {
    const statusEl = $("subscriptionStatus");
    const planEl = $("subscriptionPlan");
    const untilEl = $("subscriptionUntil"); // optional

    if (statusEl) statusEl.textContent = "Laster…";
    if (planEl) planEl.textContent = "Laster…";
    if (untilEl) untilEl.textContent = "";

    const s = await checkSubscription();
    log("Subscription status:", s);

    if (s.lifetime) {
      if (statusEl) statusEl.textContent = "Aktiv";
      if (planEl) planEl.textContent = "Livstid";
      if (untilEl) untilEl.textContent = "";
      return;
    }

    if (s.trial && !s.active) {
      if (statusEl) statusEl.textContent = "Prøveperiode";
      if (planEl) planEl.textContent = planLabel(s.plan);
      const until = fmtDate(s.current_period_end);
      if (untilEl) untilEl.textContent = until ? ("Til " + until) : "";
      return;
    }

    if (s.active) {
      if (statusEl) statusEl.textContent = "Aktiv";
      if (planEl) planEl.textContent = planLabel(s.plan);
      const until = fmtDate(s.current_period_end);
      if (untilEl) untilEl.textContent = until ? ("Til " + until) : "";
      return;
    }

    if (statusEl) statusEl.textContent = "Ikke aktiv";
    if (planEl) planEl.textContent = "—";
    const until = fmtDate(s.current_period_end);
    if (untilEl) untilEl.textContent = until ? ("Sist kjent slutt: " + until) : "";
  }

  async function openModal() {
    const modal = $("subscriptionModal");
    if (!modal) return false;
    show(modal, "flex");
    await fillSubscriptionModal();
    return true;
  }

  function closeModal() {
    const modal = $("subscriptionModal");
    if (!modal) return;
    hide(modal);
  }

  function bind() {
    const manageBtn = $("manageSubscriptionBtn");
    if (manageBtn) {
      manageBtn.addEventListener("click", async function () {
        const ok = await openModal();
        if (!ok) {
          // fallback: pricing
          window.location.href = "/pricing.html";
        }
      });
      log("✅ manageSubscriptionBtn bound");
    } else {
      warn("manageSubscriptionBtn not found");
    }

    const closeBtn = $("closeSubscriptionModal");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    const modal = $("subscriptionModal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });
    }

    const portalBtn = $("managePortalBtn");
    if (portalBtn) portalBtn.addEventListener("click", openCustomerPortal);

    // optional trial start buttons (if you have them)
    const startTrialYearBtn = $("startTrialYearBtn");
    if (startTrialYearBtn) {
      startTrialYearBtn.addEventListener("click", async function () {
        const r = await startTrial("year");
        if (!r.ok) alert("Kunne ikke starte prøveperiode: " + r.error);
        else alert("Prøveperiode startet!");
        await fillSubscriptionModal();
      });
    }
  }

  // Expose
  window.subscriptionService = {
    checkSubscription: checkSubscription,
    startTrial: startTrial,
    openCustomerPortal: openCustomerPortal,
  };

  // Boot
  try { bind(); } catch (e) { err("subscription.js bind failed:", e); }
  log("✅ subscription.js loaded (browser-safe)");
})();
