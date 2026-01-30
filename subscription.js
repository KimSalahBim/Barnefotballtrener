// subscription.js
// Håndterer abonnement-modal + åpner Stripe Customer Portal (manage / cancel)
// Krever at window.supabase (Supabase client) er initialisert (fra auth.js)

(() => {
  const LOG_PREFIX = "🧾";
  const PORTAL_ENDPOINT = "/api/create-portal-session";
  const STATUS_ENDPOINT = "/api/subscription-status";

  // --- BFCACHE FIX: Clear state ved browser back/forward restore ---
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      // Siden ble restored fra bfcache - clear state og rebind
      delete window.__bf_subscription_click_handler;
      console.log(`${LOG_PREFIX} 🔄 State cleared after bfcache restore, rebinding...`);
      // Trigger rebind
      bind();
    }
  });

  // --- Utils ---
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Token cache (5 min TTL)
  let tokenCache = { token: null, expires: 0 };

  function getCachedToken() {
    if (tokenCache.token && Date.now() < tokenCache.expires) {
      console.log(`${LOG_PREFIX} 💾 Using cached token (${Math.floor((tokenCache.expires - Date.now())/1000)}s left)`);
      return tokenCache.token;
    }
    return null;
  }

  function setCachedToken(token) {
    tokenCache.token = token;
    tokenCache.expires = Date.now() + (5 * 60 * 1000); // 5 min
    console.log(`${LOG_PREFIX} 💾 Cached token for 5 minutes`);
  }

  // Timeout wrapper for promises som kan henge
  function withTimeout(promise, ms, errorMsg = "Timeout") {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
  }

  async function getAccessToken({ retries = 3, skipCache = false } = {}) {
    // 1) Prøv cached token først (hvis ikke skipCache)
    if (!skipCache) {
      const cached = getCachedToken();
      if (cached) return cached;
    }

    // 2) Ikke bruk for aggressive timeouts her – det skaper "Invalid session" / flakiness.
    // Prøv flere ganger i tilfelle Supabase fortsatt "recoverAndRefresh"-er.
    for (let i = 0; i < retries; i++) {
      try {
        // Normal vei med timeout
        const s = await withTimeout(
          window.supabase?.auth?.getSession?.(),
          3000,
          "getSession timeout"
        );
        const token = s?.data?.session?.access_token;
        if (token) {
          console.log(`${LOG_PREFIX} ✅ Got token from getSession`);
          setCachedToken(token);
          return token;
        }

        // Noen nettlesere (enterprise policies / tracking prevention) kan gi
        // en kort periode der session er null selv om bruker er innlogget.
        // Da prøver vi en forsiktig refresh.
        await withTimeout(
          window.supabase?.auth?.refreshSession?.(),
          3000,
          "refreshSession timeout"
        );
        const s2 = await withTimeout(
          window.supabase?.auth?.getSession?.(),
          3000,
          "getSession timeout (retry)"
        );
        const token2 = s2?.data?.session?.access_token;
        if (token2) {
          console.log(`${LOG_PREFIX} ✅ Got token after refresh`);
          setCachedToken(token2);
          return token2;
        }

        // fallback: getUser kan av og til fungere når session ikke er tilgjengelig ennå
        const u = await withTimeout(
          window.supabase?.auth?.getUser?.(),
          3000,
          "getUser timeout"
        );
        // getUser returnerer ikke token, men hvis den feiler pga manglende session,
        // gir vi Supabase litt tid og prøver igjen.
        if (u?.data?.user) {
          console.log(`${LOG_PREFIX} ⚠️ User exists but no token, retrying...`);
          // user finnes, men token mangler -> prøv en runde til
        }
      } catch (err) {
        console.warn(`${LOG_PREFIX} ⚠️ getAccessToken attempt ${i+1} failed:`, err.message);
      }
      await sleep(250 + i * 250);
    }
    throw new Error("Ingen gyldig sesjon (token mangler). Prøv å refresh siden (F5).");
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
      info.style.marginTop = "12px";
      info.style.padding = "10px 12px";
      info.style.backgroundColor = "#fff3cd";
      info.style.border = "1px solid #ffc107";
      info.style.borderRadius = "6px";
      info.style.fontSize = "14px";
      info.style.color = "#856404";
      info.style.fontWeight = "500";
      // Plasser rett etter plan-info (i modal-body)
      const body = modal.querySelector(".bf-modal__body");
      if (body) {
        body.appendChild(info);
      } else {
        modal.appendChild(info);
      }
    }

    if (status?.cancel_at_period_end) {
      const date = status?.cancel_at ? new Date(status.cancel_at).toLocaleDateString("no-NO") : "";
      info.textContent = date
        ? `⚠️ Abonnementet avsluttes ${date}`
        : `⚠️ Abonnementet er satt til å avsluttes ved periodens slutt.`;
      info.style.display = "block";
    } else {
      info.style.display = "none";
    }
  }

  async function openSubscriptionModal() {
    const modal = document.getElementById("subscriptionModal");
    if (!modal) return;

    // Fjern hidden-klasse og sett display
    modal.classList.remove("hidden");
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
    modal.classList.add("hidden");
  }

  function bind() {
    console.log(`${LOG_PREFIX} 🔧 bind() called, readyState=${document.readyState}`);

    // IDEMPOTENT binding: Fjern gammel handler først, registrer ny
    const oldHandler = window.__bf_subscription_click_handler;
    if (oldHandler) {
      document.removeEventListener("click", oldHandler, true);
      console.log(`${LOG_PREFIX} 🗑️ Removed old click handler`);
    }

    // Lag ny handler
    const clickHandler = (e) => {
      // Tannhjul-knapp
      const gear = e.target.closest("#manageSubscriptionBtn");
      if (gear) {
        e.preventDefault();
        e.stopPropagation();
        console.log(`${LOG_PREFIX} ⚙️ Gear clicked, opening modal...`);
        openSubscriptionModal();
        return;
      }

      // Lukkeknapper (støtter både ID og data-attribute)
      const close = e.target.closest("#closeSubscriptionModal, [data-close='subscriptionModal']");
      if (close) {
        e.preventDefault();
        console.log(`${LOG_PREFIX} ❌ Close clicked`);
        closeSubscriptionModal();
        return;
      }
    };

    // Registrer ny handler i capture-fase
    document.addEventListener("click", clickHandler, true);
    window.__bf_subscription_click_handler = clickHandler;

    console.log(`${LOG_PREFIX} ✅ Delegated click handlers bound (idempotent)`);

    // Fallback: direkte binding på lukkeknapp hvis den har ID
    const closeBtn = document.getElementById("closeSubscriptionModal");
    if (closeBtn && !closeBtn.__bound) {
      closeBtn.__bound = true;
      closeBtn.addEventListener("click", closeSubscriptionModal);
    }

    // Lukk ved klikk utenfor (kun registrer én gang)
    if (!window.__bf_outside_click_bound) {
      window.__bf_outside_click_bound = true;
      window.addEventListener("click", (event) => {
        const modal = document.getElementById("subscriptionModal");
        if (event.target === modal) closeSubscriptionModal();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  console.log(`${LOG_PREFIX} ✅ subscription.js loaded (browser-safe + bfcache-aware)`);
})();
