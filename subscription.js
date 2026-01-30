// subscription.js (FRONTEND) – skal kjøres i nettleser

(function () {
  async function getAccessToken() {
    try {
      // authService wrapperen du la til i auth.js
      if (window.authService && typeof window.authService.getSessionWithRetry === "function") {
        const session = await window.authService.getSessionWithRetry();
        return session && session.access_token ? session.access_token : null;
      }

      // fallback: hvis supabase klient finnes
      if (window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === "function") {
        const resp = await window.supabase.auth.getSession();
        const session = resp && resp.data && resp.data.session ? resp.data.session : null;
        return session && session.access_token ? session.access_token : null;
      }
    } catch (e) {}
    return null;
  }

  async function checkSubscription() {
    const token = await getAccessToken();
    if (!token) {
      return { active: false, trial: false, lifetime: false, plan: null, current_period_end: null, canStartTrial: true };
    }

    const r = await fetch("/api/subscription-status", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    if (!r.ok) {
      let payload = {};
      try { payload = await r.json(); } catch (e) {}
      console.warn("subscription-status not ok:", r.status, payload);
      return { active: false, trial: false, lifetime: false, plan: null, current_period_end: null, canStartTrial: true };
    }

    const data = await r.json();
    return data || { active: false, trial: false, lifetime: false, plan: null, current_period_end: null, canStartTrial: true };
  }

  async function startTrial(plan) {
    const token = await getAccessToken();
    if (!token) throw new Error("Missing token");

    const r = await fetch("/api/start-trial", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ plan: plan || "year" }),
    });

    if (!r.ok) {
      let payload = {};
      try { payload = await r.json(); } catch (e) {}
      throw new Error("start-trial failed: " + r.status + " " + JSON.stringify(payload));
    }

    return await r.json();
  }

  async function openPortal() {
    const token = await getAccessToken();
    if (!token) throw new Error("Missing token");

    const r = await fetch("/api/create-portal-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({}),
    });

    if (!r.ok) {
      let payload = {};
      try { payload = await r.json(); } catch (e) {}
      throw new Error("portal failed: " + r.status + " " + JSON.stringify(payload));
    }

    const data = await r.json();
    if (data && data.url) window.location.href = data.url;
  }

  // Expose global API (det auth.js/pricing.js forventer)
  var svc = (window.subscriptionService = window.subscriptionService || {});
  svc.checkSubscription = svc.checkSubscription || checkSubscription;
  svc.startTrial = svc.startTrial || startTrial;
  svc.openPortal = svc.openPortal || openPortal;

  console.log("✅ subscription.js lastet (frontend)");
})();
