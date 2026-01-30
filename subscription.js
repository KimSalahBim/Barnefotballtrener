// subscription.js
// Håndterer abonnement-modal + åpner Stripe Customer Portal (manage / cancel)
// Krever at window.supabase (Supabase client) er initialisert (fra auth.js)

(() => {
  const LOG_PREFIX = "🧾";
  const PORTAL_ENDPOINT = "/api/create-portal-session";
  const STATUS_ENDPOINT = "/api/subscription-status";

  // --- Utils ---
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getAccessToken({ retries = 3 } = {}) {
    // Ikke bruk for aggressive timeouts her – det skaper "Invalid session" / flakiness.
    // Prøv flere ganger i tilfelle Supabase fortsatt "recoverAndRefresh"-er.
    for (let i = 0; i < retries; i++) {
      try {
        // 1) Normal vei
        const s = await window.supabase?.auth?.getSession?.();
        const token = s?.data?.session?.access_token;
        if (token) return token;

        // 2) Noen nettlesere (enterprise policies / tracking prevention) kan gi
        // en kort periode der session er null selv om bruker er innlogget.
        // Da prøver vi en forsiktig refresh.
        await window.supabase?.auth?.refreshSession?.();
        const s2 = await window.supabase?.auth?.getSession?.();
        const token2 = s2?.data?.session?.access_token;
        if (token2) return token2;

        // fallback: getUser kan av og til fungere når session ikke er tilgjengelig ennå
        const u = await window.supabase?.auth?.getUser?.();
        // getUser returnerer ikke token, men hvis den feiler pga manglende session,
        // gir vi Supabase litt tid og prøver igjen.
        if (u?.data?.user) {
          // user finnes, men token mangler -> prøv en runde til
        }
      } catch (_) {
        // ignore
      }
      await sleep(250 + i * 250);
    }
    throw new Error("Ingen gyldig sesjon (token mangler).");
  }

  async function callApiJson(url, { method = "GET", token, body } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // ignore
    }
    if (!res.ok) {
      const msg = data?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  // --- SubscriptionService (window.subscriptionService) ---
  const subscriptionService = {
    async checkSubscription() {
      let token;
      try {
        token = await getAccessToken();
      } catch (e) {
        console.warn(`${LOG_PREFIX} ⚠️ getAccessToken failed:`, e);
        return {
          active: false,
          trial: false,
          lifetime: false,
          plan: null,
          current_period_end: null,
          cancel_at_period_end: false,
          cancel_at: null,
          subscription_id: null,
          reason: "no_session",
        };
      }

      try {
        const status = await callApiJson(STATUS_ENDPOINT, {
          method: "GET",
          token,
        });
        return status;
      } catch (e) {
        console.warn(`${LOG_PREFIX} ⚠️ subscription-status failed:`, e);
        return {
          active: false,
          trial: false,
          lifetime: false,
          plan: null,
          current_period_end: null,
          cancel_at_period_end: false,
          cancel_at: null,
          subscription_id: null,
          reason: "status_error",
        };
      }
    },

    async openPortal(flow = "manage") {
      const token = await getAccessToken();
      const returnUrl = `${window.location.origin}/#`;

      const data = await callApiJson(PORTAL_ENDPOINT, {
        method: "POST",
        token,
        body: { returnUrl, flow },
      });

      if (!data?.url) throw new Error("Mangler portal-URL fra server.");
      window.location.href = data.url;
    },
  };

  window.subscriptionService = subscriptionService;

  // --- Modal wiring (eksisterende index + "trygg" dynamisk knapp for kansellering) ---
  function ensureCancelButton() {
    const modal = document.getElementById("subscriptionModal");
    if (!modal) return null;

    // Finn eksisterende knapper (samme som før)
    const manageBtn = modal.querySelector("#managePortalBtn");
    if (!manageBtn) return null;

    // Hvis cancel-knapp finnes, bruk den
    let cancelBtn = modal.querySelector("#cancelPortalBtn");
    if (cancelBtn) return cancelBtn;

    // Lag ny knapp ved siden av "Administrer abonnement"
    cancelBtn = document.createElement("button");
    cancelBtn.id = "cancelPortalBtn";
    cancelBtn.type = "button";
    cancelBtn.className = manageBtn.className; // samme stil
    cancelBtn.style.marginLeft = "8px";
    cancelBtn.innerHTML = `🛑 Kanseller abonnement`;
    manageBtn.insertAdjacentElement("afterend", cancelBtn);

    return cancelBtn;
  }

  function setModalTexts(status) {
    // Støtt både gamle og nye id-er (noe kan være ulikt mellom bygg/versjoner)
    const statusEl =
      document.getElementById("subscriptionStatusText") ||
      document.getElementById("subscriptionStatus");
    const planEl =
      document.getElementById("subscriptionPlanText") ||
      document.getElementById("subscriptionPlan");

    if (statusEl) statusEl.textContent = status?.active ? "Aktiv" : "Ikke aktiv";
    if (planEl) {
      const planMap = { month: "Månedlig", year: "Årlig", lifetime: "Livstid" };
      planEl.textContent = planMap[status?.plan] || "—";
    }

    // Optional: liten info-linje hvis kansellert ved periodens slutt
    const infoId = "subscriptionCancelInfo";
    let info = document.getElementById(infoId);
    const modal = document.getElementById("subscriptionModal");
    if (!modal) return;

    if (!info) {
      info = document.createElement("div");
      info.id = infoId;
      info.style.marginTop = "8px";
      info.style.fontSize = "13px";
      info.style.opacity = "0.85";
      // prøv å plassere under plan-linjene (antatt at disse finnes)
      const body = modal.querySelector(".modal-body") || modal;
      body.appendChild(info);
    }

    if (status?.cancel_at_period_end) {
      const date = status?.cancel_at ? new Date(status.cancel_at).toLocaleDateString("no-NO") : "";
      info.textContent = date
        ? `Abonnementet er satt til å avsluttes ved periodens slutt (${date}).`
        : `Abonnementet er satt til å avsluttes ved periodens slutt.`;
    } else {
      info.textContent = "";
    }
  }

  async function openSubscriptionModal() {
    const modal = document.getElementById("subscriptionModal");
    if (!modal) return;

    modal.style.display = "block";

    const status = await subscriptionService.checkSubscription();
    setModalTexts(status);

    // Sørg for at vi har cancel-knapp
    const cancelBtn = ensureCancelButton();

    // Bind knapper
    const manageBtn = document.getElementById("managePortalBtn");
    if (manageBtn && !manageBtn.__bound) {
      manageBtn.__bound = true;
      manageBtn.addEventListener("click", async () => {
        try {
          await subscriptionService.openPortal("manage");
        } catch (e) {
          alert(`Kunne ikke åpne abonnement-portalen: ${e.message}`);
        }
      });
    }

    if (cancelBtn && !cancelBtn.__bound) {
      cancelBtn.__bound = true;
      cancelBtn.addEventListener("click", async () => {
        try {
          await subscriptionService.openPortal("cancel");
        } catch (e) {
          alert(`Kunne ikke åpne kanselleringsflyt: ${e.message}`);
        }
      });
    }
  }

  function closeSubscriptionModal() {
    const modal = document.getElementById("subscriptionModal");
    if (!modal) return;
    modal.style.display = "none";
  }

  function bind() {
    // Knappen i toppmenyen (tannhjul / settings)
    const btn = document.getElementById("manageSubscriptionBtn");
    if (btn && !btn.__bound) {
      btn.__bound = true;
      btn.addEventListener("click", openSubscriptionModal);
      console.log(`${LOG_PREFIX} ✅ manageSubscriptionBtn bound`);
    }

    const closeBtn = document.getElementById("closeSubscriptionModal");
    if (closeBtn && !closeBtn.__bound) {
      closeBtn.__bound = true;
      closeBtn.addEventListener("click", closeSubscriptionModal);
    }

    // Lukk ved klikk utenfor
    window.addEventListener("click", (event) => {
      const modal = document.getElementById("subscriptionModal");
      if (event.target === modal) closeSubscriptionModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  console.log(`${LOG_PREFIX} ✅ subscription.js loaded (browser-safe)`);
})();
