// © 2026 Barnefotballtrener.no. All rights reserved.
// subscription.js
// Håndterer abonnement-modal + åpner Stripe Customer Portal (manage / cancel)
// Krever at window.supabase (Supabase client) er initialisert (fra auth.js)

(() => {
  const LOG_PREFIX = "🧾";
  const PORTAL_ENDPOINT = "/api/create-portal-session";
  const STATUS_ENDPOINT = "/api/subscription-status";
  const TRIAL_ENDPOINT = "/api/start-trial";

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

  // Token cache (5 min TTL) - SECURITY: Now keyed by userId to prevent cross-user leakage
  let tokenCache = { token: null, expires: 0, userId: null };

  // Subscription-status cache (60s TTL) keyed by userId (reduces duplicate /api/subscription-status calls)
  let statusCache = { status: null, expires: 0, userId: null };

  function getCachedStatus(currentUserId) {
    if (
      statusCache.status &&
      Date.now() < statusCache.expires &&
      statusCache.userId === currentUserId
    ) {
      console.log(`${LOG_PREFIX} ðŸ’¾ Using cached subscription status for user ${currentUserId?.substring(0, 8)}... (${Math.floor((statusCache.expires - Date.now())/1000)}s left)`);
      return statusCache.status;
    }
    return null;
  }

  function setCachedStatus(status, userId, ttlMs = 60 * 1000) {
    statusCache.status = status;
    statusCache.userId = userId;
    statusCache.expires = Date.now() + ttlMs;
  }

  function clearStatusCache() {
    statusCache = { status: null, expires: 0, userId: null };
  }

  function getCachedToken(currentUserId) {
    // SECURITY: Only return cached token if it belongs to current user
    if (tokenCache.token && 
        Date.now() < tokenCache.expires && 
        tokenCache.userId === currentUserId) {
      console.log(`${LOG_PREFIX} ðŸ’¾ Using cached token for user ${currentUserId?.substring(0, 8)}... (${Math.floor((tokenCache.expires - Date.now())/1000)}s left)`);
      return tokenCache.token;
    }
    return null;
  }

  function setCachedToken(token, userId) {
    tokenCache.token = token;
    tokenCache.userId = userId;
    tokenCache.expires = Date.now() + (5 * 60 * 1000); // 5 min
    console.log(`${LOG_PREFIX} ðŸ’¾ Cached token for user ${userId?.substring(0, 8)}... (5 min)`);
  }

  function clearTokenCache() {
    const hadToken = !!tokenCache.token;
    tokenCache = { token: null, expires: 0, userId: null };
    clearStatusCache();
    if (hadToken) {
      console.log(`${LOG_PREFIX} ðŸ—‘️ Token cache cleared`);
    }
  }

  // SECURITY: Clear token cache on auth state changes (prevents cross-user token reuse)
  // NOTE: auth.js laster Supabase async, så vi venter kort til window.supabase finnes.
  function bindAuthStateCleanup(retries = 40) {
    if (window.__bf_subscription_auth_cleanup_bound) return;

    const sb = window.supabase;
    const canBind = sb && sb.auth && (typeof sb.auth.onAuthStateChange === 'function');

    if (canBind) {
      window.__bf_subscription_auth_cleanup_bound = true;

      sb.auth.onAuthStateChange((event, session) => {
        const newUserId = session?.user?.id || null;
        const cachedUserId = tokenCache.userId;

        console.log(`${LOG_PREFIX} ðŸ” Auth state change: ${event}, user: ${newUserId?.substring(0, 8) || 'none'}`);

        // Clear cache if user changed or signed out
        if (newUserId !== cachedUserId) {
          console.log(`${LOG_PREFIX} ⚠️ User changed (${cachedUserId?.substring(0, 8) || 'none'} â†’ ${newUserId?.substring(0, 8) || 'none'}), clearing token cache`);
          clearTokenCache();
        }
      });

      return;
    }

    if (retries <= 0) return;
    setTimeout(() => bindAuthStateCleanup(retries - 1), 250);
  }

  bindAuthStateCleanup();

  // Timeout wrapper for promises som kan henge
  function withTimeout(promise, ms, errorMsg = "Timeout") {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
  }

  // Timeout wrapper for fetch API calls
  async function fetchWithTimeout(url, options, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    
    // Check if AbortController is available
    if (typeof AbortController === "undefined") {
      // Fallback: no abort, but avoid blocking UX forever
      return Promise.race([
        fetch(url, options),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Request timeout")), timeoutMs))
      ]);
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      return await fetch(url, { ...(options || {}), signal: controller.signal });
    } catch (error) {
      // Re-throw with clearer message if aborted
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    } finally {
      clearTimeout(id);
    }
  }

  async function getAccessToken({ retries = 3, skipCache = false } = {}) {
    // Get current user ID for cache keying.
    // Try getSession first, but fall back to existing cache or authService if it hangs.
    let currentUserId = null;
    try {
      const sessionResult = await withTimeout(
        window.supabase?.auth?.getSession?.() || Promise.resolve({ data: {} }),
        5000,
        "getSession userId lookup (5s)"
      );
      const { data: { session } } = sessionResult || { data: {} };
      currentUserId = session?.user?.id || null;
    } catch (err) {
      console.warn(`${LOG_PREFIX} ⚠️ Could not get current user ID for cache:`, err.message);
    }

    // Fallback: use cached userId or authService if getSession timed out
    if (!currentUserId) {
      currentUserId = tokenCache.userId || null;
    }
    if (!currentUserId) {
      try {
        currentUserId = window.authService?.getUserId?.() || null;
      } catch (_) {}
    }

    // 1) Try cached token first (unless skipCache)
    if (!skipCache && currentUserId) {
      const cached = getCachedToken(currentUserId);
      if (cached) return cached;
    }

    // 2) Ikke bruk for aggressive timeouts her – det skaper "Invalid session" / flakiness.
    // Prøv flere ganger i tilfelle Supabase fortsatt "recoverAndRefresh"-er.
    for (let i = 0; i < retries; i++) {
      try {
        // Normal vei med timeout
        const s = await withTimeout(
          window.supabase?.auth?.getSession?.(),
          5000,
          "getSession (5s)"
        );
        const token = s?.data?.session?.access_token;
        const userId = s?.data?.session?.user?.id;
        if (token && userId) {
          console.log(`${LOG_PREFIX} ✅ Got token from getSession`);
          setCachedToken(token, userId);
          return token;
        }

        // Noen nettlesere (enterprise policies / tracking prevention) kan gi
        // en kort periode der session er null selv om bruker er innlogget.
        // Da prøver vi en forsiktig refresh.
        await withTimeout(
          window.supabase?.auth?.refreshSession?.(),
          5000,
          "refreshSession (5s)"
        );
        const s2 = await withTimeout(
          window.supabase?.auth?.getSession?.(),
          5000,
          "getSession timeout (retry)"
        );
        const token2 = s2?.data?.session?.access_token;
        const userId2 = s2?.data?.session?.user?.id;
        if (token2 && userId2) {
          console.log(`${LOG_PREFIX} ✅ Got token after refresh`);
          setCachedToken(token2, userId2);
          return token2;
        }

        // fallback: getUser kan av og til fungere når session ikke er tilgjengelig ennå
        const u = await withTimeout(
          window.supabase?.auth?.getUser?.(),
          5000,
          "getUser (5s)"
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

    const res = await fetchWithTimeout(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }, 10000); // 10 second timeout

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // ignore
    }
    if (!res.ok) {
      const msg = data?.error || `${res.status} ${res.statusText}`;
      const errId = (data && data.error_id) ? data.error_id : null;
      throw new Error(errId ? `${msg} (Feilkode: ${errId})` : msg);
    }
    return data;
  }

  // --- SubscriptionService (window.subscriptionService) ---
  const subscriptionService = {
    // Returner cachet status uten nettverkskall (for graceful fallback)
    getLastKnownStatus() {
      if (statusCache.status && statusCache.userId) {
        return statusCache.status;
      }
      return null;
    },
    async checkSubscription(options) {
      const forceFresh = !!(options && options.forceFresh);
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
        // Use last known userId from token cache (set by getAccessToken) to key status cache safely.
        const currentUserId = tokenCache.userId || null;

        if (!forceFresh && currentUserId) {
          const cachedStatus = getCachedStatus(currentUserId);
          if (cachedStatus) return cachedStatus;
        }

        const status = await callApiJson(STATUS_ENDPOINT, {
          method: "GET",
          token,
        });

        if (currentUserId) setCachedStatus(status, currentUserId, 60 * 1000);
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

    async startTrial(userId, planType) {
      // Only month/year supported by /api/start-trial
      if (!planType || (planType !== "month" && planType !== "year")) {
        throw new Error("Trial only supported for month/year plans");
      }

      console.log(`${LOG_PREFIX} ðŸŽ Starting trial for user ${userId}, plan: ${planType}`);

      const token = await getAccessToken();
      const data = await callApiJson(TRIAL_ENDPOINT, {
        method: "POST",
        token,
        body: { planType },
      });

      console.log(`${LOG_PREFIX} ✅ Trial started:`, data);
      clearStatusCache();

      // Expected response: { success:true, trial_started_at, trial_ends_at, trial_days }
      return data;
    },

    async openPortal(flow = "manage") {
      const token = await getAccessToken();
      // Portal actions may change subscription state; clear cache so next check is fresh
      clearStatusCache();
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
    cancelBtn.dataset.createdBy = "subscriptionjs";
    cancelBtn.type = "button";
    cancelBtn.className = manageBtn.className; // samme stil
    cancelBtn.style.marginLeft = "8px";
    cancelBtn.innerHTML = `ðŸ›‘ Kanseller abonnement`;
    manageBtn.insertAdjacentElement("afterend", cancelBtn);

    return cancelBtn;
  }
function setModalTexts(status) {
  const modal = document.getElementById("subscriptionModal");
  if (!modal) return;

  // Finn elementer inne i modalen (robust hvis samme id finnes andre steder)
  const statusEl =
    modal.querySelector("#subscriptionStatusText") ||
    modal.querySelector("#subscriptionStatus");
  const planEl =
    modal.querySelector("#subscriptionPlanText") ||
    modal.querySelector("#subscriptionPlan");

  // Status: regn trial/lifetime som aktivt for UI
  if (statusEl) {
    const isActive = !!(status && (status.active || status.trial || status.lifetime));
    statusEl.textContent = isActive ? "Aktiv" : "Ikke aktiv";
  }

  // Plan: støtt både `plan` og `planType`
  if (planEl) {
    const planKey = (status && (status.plan || status.planType)) || null;
    const planMap = { month: "Månedlig", year: "Årlig", lifetime: "Livstid" };
    planEl.textContent = (planKey && planMap[planKey]) ? planMap[planKey] : "—";
  }

  // Info-linje ved kansellering / utløp av periode
  const infoId = "subscriptionCancelInfo";
  let info = modal.querySelector("#" + infoId) || document.getElementById(infoId);

  // Hvis info finnes globalt men ikke i modalen, flytt den inn (unngår duplicate id)
  if (info && !modal.contains(info)) {
    const body = modal.querySelector(".bf-modal__body");
    if (body) body.appendChild(info);
    else modal.appendChild(info);
  }

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

    const body = modal.querySelector(".bf-modal__body");
    if (body) body.appendChild(info);
    else modal.appendChild(info);
  }

  const cancelIso = status?.cancel_at || status?.current_period_end;
  const shouldShowCancelInfo =
    !!cancelIso &&
    !!(status?.active || status?.trial || status?.lifetime) &&
    (status?.cancel_at_period_end || status?.cancel_at);

  if (shouldShowCancelInfo) {
    const date = new Date(cancelIso).toLocaleDateString("no-NO");
    info.textContent = `✅ Du har tilgang til ${date} (ut perioden du allerede har betalt for).`;
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

    // Oppdater cancel-knappens state hver gang modalen åpnes (unngå "stale" status)
    if (cancelBtn) {
      const hasStripeSub = !!status?.subscription_id;
      const isLifetime = !!status?.lifetime || status?.plan === "lifetime";
      const isTrial = !!status?.trial && !hasStripeSub && !isLifetime;
      const alreadyCancellingNow = !!status?.cancel_at || !!status?.cancel_at_period_end;

      // Kun ekte Stripe-subscriptions kan kanselleres (ikke trial / lifetime)
      const canCancelNow = !!status?.active && hasStripeSub && !isLifetime && !alreadyCancellingNow;

      cancelBtn.disabled = !canCancelNow;
      cancelBtn.style.opacity = cancelBtn.disabled ? "0.6" : "1";
      cancelBtn.style.cursor = cancelBtn.disabled ? "not-allowed" : "pointer";

      // Unngå å ødelegge evt. eksisterende ikon/markup i HTML:
      // Vi endrer kun knappetekst hvis knappen er opprettet av subscription.js.
      const createdByScript = cancelBtn.dataset?.createdBy === "subscriptionjs";

      if (isLifetime) {
        if (createdByScript) cancelBtn.innerHTML = "ðŸ† Livstid (ingen kansellering)";
        cancelBtn.title = "Livstidskjøp kan ikke kanselleres.";
      } else if (isTrial) {
        if (createdByScript) cancelBtn.innerHTML = "🧪 Prøveperiode (ingen kansellering)";
        cancelBtn.title = "Prøveperioden avsluttes automatisk – ingen kansellering nødvendig.";
      } else if (!hasStripeSub) {
        if (createdByScript) cancelBtn.innerHTML = "— Ingen abonnement å kansellere";
        cancelBtn.title = "Ingen Stripe-abonnement er knyttet til denne brukeren.";
      } else if (alreadyCancellingNow) {
        if (createdByScript) cancelBtn.innerHTML = "✅ Allerede kansellert";
        cancelBtn.title = "Abonnementet er allerede satt til å avsluttes ved periodens slutt.";
      } else {
        if (createdByScript) cancelBtn.innerHTML = "ðŸ›‘ Kanseller abonnement";
        cancelBtn.title = "";
      }
    }
if (cancelBtn && !cancelBtn.__bound) {
      cancelBtn.__bound = true;
      cancelBtn.addEventListener("click", async () => {
        try {
          if (cancelBtn.disabled) return; // ekstra sikkerhet
          await subscriptionService.openPortal("cancel");
        } catch (e) {
          alert(`Kunne ikke åpne kanselleringsflyt: ${e.message}`);
        }
      });
    }

    // Ekstra: Vis hvilken bruker som er innlogget (for "shared device" trygghet)
    const userLine = document.getElementById("subscriptionUserLine");
    try {
      const u = window.authService?.getUser?.();
      if (userLine) userLine.textContent = u?.email ? `Innlogget: ${u.email}` : "";
    } catch (_) {
      if (userLine) userLine.textContent = "";
    }

    // Ekstra: "Se planer"-knapp i modal (åpner prissiden)
    const openPricingBtn = document.getElementById("openPricingFromModal");
    if (openPricingBtn && !openPricingBtn.__bound) {
      openPricingBtn.__bound = true;
      openPricingBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        closeSubscriptionModal();
        window.authService?.showPricingPage?.();
      }, { capture: true });
    }

    // Ekstra: Kopiér support-epost
    const copyBtn = document.getElementById("copySupportEmailBtn");
    if (copyBtn && !copyBtn.__bound) {
      copyBtn.__bound = true;
      copyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        const email = window.CONFIG?.app?.supportEmail || "support@barnefotballtrener.no";
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(email);
            alert("Support-epost kopiert ✅");
          } else {
            prompt("Kopiér e-post:", email);
          }
        } catch (_) {
          prompt("Kopiér e-post:", email);
        }
      }, { capture: true });
    }

    // GDPR Art. 20: Export Data button
    const exportDataBtn = document.getElementById("exportDataBtn");
    if (exportDataBtn && !exportDataBtn.__bound) {
      exportDataBtn.__bound = true;
      exportDataBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        console.log(`${LOG_PREFIX} 📥 Eksporterer data...`);
        
        try {
          const token = await getAccessToken();
          if (!token) {
            alert("Kunne ikke hente tilgangsnøkkel. Logg inn på nytt.");
            return;
          }

          const response = await fetchWithTimeout("/api/export-data", {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }, 15000);

          if (!response.ok) {
            const payload = await response.json().catch(() => ({ error: "Unknown error" }));
            const msg = payload.error || "Eksport feilet";
            throw new Error(payload && payload.error_id ? `${msg} (Feilkode: ${payload.error_id})` : msg);
          }

          // Download the JSON file
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `barnefotballtrener-data-${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);

          alert("✅ Dine data er lastet ned!\n\nFilen inneholder:\n- Kontoinformasjon\n- Abonnementshistorikk\n- Betalingshistorikk\n\nSpillerlister må eksporteres separat via \"Eksporter\"-knappen i Spillere-seksjonen.");

        } catch (err) {
          console.error(`${LOG_PREFIX} âŒ Export failed:`, err);
          alert(`Kunne ikke eksportere data: ${err.message}\n\nKontakt support@barnefotballtrener.no hvis problemet vedvarer.`);
        }
      }, { capture: true });
    }

    // GDPR Art. 17: Delete Account button
    const deleteAccountBtn = document.getElementById("deleteAccountBtn");
    if (deleteAccountBtn && !deleteAccountBtn.__bound) {
      deleteAccountBtn.__bound = true;
      deleteAccountBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        // Step 1: First warning
        const confirm1 = window.confirm(
          "⚠️ ADVARSEL: Slette konto permanent?\n\n" +
          "Dette vil:\n" +
          "• Slette din bruker og alle data\n" +
          "• Kansellere alle aktive abonnementer\n" +
          "• Ikke kunne angres\n\n" +
          "Betalingshistorikk beholdes i 7 år (lovkrav)\n\n" +
          "Er du sikker?"
        );

        if (!confirm1) return;

        // Step 2: Type confirmation
        const confirm2 = window.prompt(
          "For å bekrefte sletting, skriv:\n\nDELETE_MY_ACCOUNT\n\n" +
          "(dette kan ikke angres)"
        );

        if (confirm2 !== "DELETE_MY_ACCOUNT") {
          alert("Kontosletting avbrutt.");
          return;
        }

        console.log(`${LOG_PREFIX} ðŸ—‘️ Sletter konto...`);
        
        try {
          const token = await getAccessToken();
          if (!token) {
            alert("Kunne ikke hente tilgangsnøkkel. Logg inn på nytt.");
            return;
          }

          const response = await fetchWithTimeout("/api/delete-account", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
          }, 20000);

          if (!response.ok) {
            const payload = await response.json().catch(() => ({ error: "Unknown error" }));
            const msg = payload.error || "Sletting feilet";
            throw new Error(payload && payload.error_id ? `${msg} (Feilkode: ${payload.error_id})` : msg);
          }

          const result = await response.json();
          
          alert(
            "✅ Din konto er nå permanent slettet.\n\n" +
            "Hva som ble slettet:\n" +
            "• Bruker og påloggingsinformasjon\n" +
            "• Abonnementer kansellert\n" +
            "• App-data fjernet\n\n" +
            "Betalingshistorikk beholdes i 7 år per norsk lov (bokføringsloven).\n\n" +
            "Du vil nå bli logget ut."
          );

          // Clear localStorage and redirect to login
          try {
            localStorage.clear();
          } catch (_) {}
          
          window.location.href = "/";

        } catch (err) {
          console.error(`${LOG_PREFIX} âŒ Delete failed:`, err);
          alert(
            `Kunne ikke slette konto: ${err.message}\n\n` +
            "Kontakt support@barnefotballtrener.no for manuell sletting."
          );
        }
      }, { capture: true });
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
      console.log(`${LOG_PREFIX} ðŸ—‘️ Removed old click handler`);
    }

    // Lag ny handler
    const clickHandler = (e) => {
      // Tannhjul-knapp
      const gear = e.target.closest("#manageSubscriptionBtn");
      if (gear) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        console.log(`${LOG_PREFIX} ⚙️ Gear clicked, opening modal...`);
        openSubscriptionModal().catch((err) => console.error(`${LOG_PREFIX} âŒ openSubscriptionModal failed:`, err));
        return;
      }

      // Lukkeknapper (støtter både ID og data-attribute)
      const close = e.target.closest("#closeSubscriptionModal, [data-close='subscriptionModal']");
      if (close) {
        e.preventDefault();
        console.log(`${LOG_PREFIX} âŒ Close clicked`);
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
