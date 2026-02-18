// © 2026 Barnefotballtrener.no. All rights reserved.
// club.js (v3)
//
// Endringer fra v2:
// - escapeHtml() for XSS-vern på klubbnavn
// - Dobbeltabonnement-varsel i innstillingsmodalen
// - Bedre UX ved utløpt/inaktiv klubb på prissiden
// - Fetch timeout via AbortController

(() => {
  const LOG_PREFIX = "🏟️";
  const JOIN_ENDPOINT = "/api/join-club";
  const LEAVE_ENDPOINT = "/api/leave-club";
  const FETCH_TIMEOUT_MS = 12000;

  if (window.__bf_club_loaded) return;
  window.__bf_club_loaded = true;

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------
  async function getToken() {
    try {
      const s = await window.supabase?.auth?.getSession?.();
      return s?.data?.session?.access_token || null;
    } catch (_) {
      return null;
    }
  }

  async function apiCall(url, { method = "POST", token, body } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      : null;

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `Feil ${res.status}`);
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("Tidsavbrudd. Sjekk internettforbindelsen.");
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function showNotif(msg, type) {
    if (typeof window.showNotification === "function") {
      window.showNotification(msg, type || "info");
    } else {
      alert(msg);
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // -------------------------------------------------------
  // 1. PRISSIDE: Klubbkort + kode-input + utløpt-melding
  // -------------------------------------------------------
  function injectPricingClubSection() {
    const page = document.getElementById("pricingPage");
    if (!page) return;
    if (page.querySelector("#clubPricingSection")) return;

    const container = page.querySelector(".pricing-container") || page;
    const cards = container.querySelector(".pricing-cards");
    if (!cards) return;

    const section = document.createElement("div");
    section.id = "clubPricingSection";
    section.innerHTML = `
      <!-- Utløpt/inaktiv klubb-varsel (skjult som default) -->
      <div id="clubExpiredBanner" style="
        display: none;
        margin-top: 24px;
        padding: 16px 20px;
        background: #fff3cd;
        border: 1px solid #ffc107;
        border-radius: 12px;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
        text-align: center;
        font-size: 14px;
        color: #856404;
        font-weight: 600;
      ">
        <i class="fas fa-exclamation-triangle"></i>
        <span id="clubExpiredMessage">Klubblisensen din har utløpt.</span>
        <div style="font-weight:400; margin-top:4px;">Kontakt klubben eller velg et eget abonnement under.</div>
      </div>

      <!-- Klubblisens-kort -->
      <div style="
        margin-top: 24px;
        padding: 28px 24px;
        background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
        border: 2px solid #90caf9;
        border-radius: 20px;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
        text-align: center;
      ">
        <div style="margin-bottom:14px;">
          <i class="fas fa-people-group" style="font-size:36px; color:#0d47a1;"></i>
        </div>
        <h3 style="margin:0 0 8px; font-size:22px; font-weight:800; color:#0d47a1;">
          Klubblisens
        </h3>
        <p style="margin:0 0 16px; font-size:15px; color:#1a237e; line-height:1.5;">
          Har klubben mange trenere? Vi tilbyr samlelisenser med rabatt.
          <br>Én faktura, enkel administrasjon, og alle trenere får tilgang.
        </p>
        <div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap; margin-bottom:18px;">
          <div style="font-size:13px; color:#1565c0;"><i class="fas fa-check" style="color:#2e7d32;"></i> Volumrabatt fra 3 trenere</div>
          <div style="font-size:13px; color:#1565c0;"><i class="fas fa-check" style="color:#2e7d32;"></i> Én faktura til klubben</div>
          <div style="font-size:13px; color:#1565c0;"><i class="fas fa-check" style="color:#2e7d32;"></i> Enkel onboarding</div>
        </div>
        <button
          id="clubContactTriggerBtn"
          type="button"
          onclick="if(typeof window.showClubContactForm==='function'){window.showClubContactForm();}else{window.location.href='mailto:support@barnefotballtrener.no?subject=Klubblisens';}"
          style="
            display:inline-block; padding:12px 28px; background:#0d47a1; color:white;
            border:none; border-radius:12px; font-size:15px; font-weight:700; cursor:pointer;
          "
        >
          <i class="fas fa-envelope"></i> Kontakt oss for klubbpris
        </button>
      </div>

      <!-- Kode-input -->
      <div id="clubCodeSection" style="
        margin-top: 16px; padding: 20px 24px; background: white;
        border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.08);
        max-width: 500px; margin-left: auto; margin-right: auto;
      ">
        <div style="text-align:center; margin-bottom:12px;">
          <h4 style="margin:0; font-size:15px; font-weight:700; color:#1a1a2e;">
            Har du allerede en klubbkode?
          </h4>
          <p style="margin:4px 0 0; font-size:13px; color:#666;">
            Skriv inn koden du har fått fra klubben din.
          </p>
        </div>
        <div style="display:flex; gap:8px; align-items:stretch;">
          <input
            id="clubCodeInput" type="text" placeholder="F.eks. STEINKJER2026"
            autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="50"
            style="
              flex:1; padding:12px 16px; border:2px solid #e0e0e0; border-radius:12px;
              font-size:16px; font-weight:700; letter-spacing:1px; text-transform:uppercase;
              outline:none; transition: border-color 0.2s;
            "
          />
          <button id="clubCodeSubmitBtn" type="button" style="
            padding:12px 20px; background:#0d47a1; color:white; border:none;
            border-radius:12px; font-size:15px; font-weight:700; cursor:pointer; white-space:nowrap;
          ">Aktiver</button>
        </div>
        <div id="clubCodeFeedback" style="margin-top:10px; font-size:14px; font-weight:600; text-align:center; display:none;"></div>
      </div>
    `;

    cards.insertAdjacentElement("afterend", section);

    // Events
    const input = section.querySelector("#clubCodeInput");
    if (input) {
      input.addEventListener("focus", () => { input.style.borderColor = "#0d47a1"; });
      input.addEventListener("blur", () => { input.style.borderColor = "#e0e0e0"; });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); handleJoinClub(); }
      });
    }
    const btn = section.querySelector("#clubCodeSubmitBtn");
    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); handleJoinClub(); });

    // Sjekk om vi bør vise utløpt-varsel
    showExpiredBannerIfNeeded();

    console.log(`${LOG_PREFIX} ✅ Klubbseksjon injisert`);
  }

  function showExpiredBannerIfNeeded() {
    const status = window.subscriptionService?.getLastKnownStatus?.();
    if (!status) return;

    const banner = document.getElementById("clubExpiredBanner");
    const msgEl = document.getElementById("clubExpiredMessage");
    if (!banner) return;

    if (status.reason === "club_expired" && status.club_name) {
      if (msgEl) msgEl.textContent = `Klubblisensen til ${escapeHtml(status.club_name)} har utløpt.`;
      banner.style.display = "block";
    } else if (status.reason === "club_inactive" && status.club_name) {
      if (msgEl) msgEl.textContent = `Klubblisensen til ${escapeHtml(status.club_name)} er ikke lenger aktiv.`;
      banner.style.display = "block";
    } else {
      banner.style.display = "none";
    }
  }

  // -------------------------------------------------------
  // 2. JOIN-LOGIKK
  // -------------------------------------------------------
  async function handleJoinClub() {
    const input = document.getElementById("clubCodeInput");
    const btn = document.getElementById("clubCodeSubmitBtn");
    const feedback = document.getElementById("clubCodeFeedback");
    if (!input || !btn) return;

    const code = input.value.trim();
    if (!code) {
      showFeedback(feedback, "Skriv inn en klubbkode", "error");
      input.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sjekker...";
    input.disabled = true;

    try {
      const token = await getToken();
      if (!token) {
        showFeedback(feedback, "Du må være logget inn først", "error");
        return;
      }

      const result = await apiCall(JOIN_ENDPOINT, {
        method: "POST", token,
        body: { inviteCode: code },
      });

      if (result.success) {
        showFeedback(
          feedback,
          result.already_member
            ? `Du er allerede medlem av ${escapeHtml(result.club_name)}`
            : escapeHtml(result.message),
          "success"
        );

        setTimeout(async () => {
          try {
            if (window.subscriptionService) {
              await window.subscriptionService.checkSubscription({ forceFresh: true });
            }
            const user = window.authService?.getUser?.();
            if (user && typeof window.authService?.handleSignIn === "function") {
              await window.authService.handleSignIn(user);
            } else {
              window.location.reload();
            }
          } catch (_) {
            window.location.reload();
          }
        }, 1500);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} ❌ Join club failed:`, err);
      showFeedback(feedback, err.message || "Noe gikk galt", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Aktiver";
      input.disabled = false;
    }
  }

  function showFeedback(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    el.style.color = type === "error" ? "#d32f2f" : "#2e7d32";
    el.style.backgroundColor = type === "error" ? "#fdecea" : "#e8f5e9";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "8px";
  }

  // -------------------------------------------------------
  // 3. INNSTILLINGSMODAL
  // -------------------------------------------------------
  function patchModalForStatus(status) {
    const modal = document.getElementById("subscriptionModal");
    if (!modal) return;

    // Rydd opp fra forrige gang
    const oldClub = modal.querySelector("#clubInfoSection");
    if (oldClub) oldClub.remove();
    const oldDual = modal.querySelector("#dualSubWarning");
    if (oldDual) oldDual.remove();

    const isClubPrimary = status && status.plan && String(status.plan).startsWith("club_");
    const hasDualAccess = status && status.has_club_access && !isClubPrimary;

    // ---- CASE A: Brukeren har Stripe/trial OG klubbtilgang ----
    if (hasDualAccess) {
      toggleStripeButtons(modal, true);
      injectDualSubscriptionWarning(modal, status);
      return;
    }

    // ---- CASE B: Brukeren har kun klubbtilgang ----
    if (isClubPrimary) {
      toggleStripeButtons(modal, false);
      patchPlanText(modal, status);
      injectClubInfo(modal, status);
      return;
    }

    // ---- CASE C: Normal Stripe/trial/ingen tilgang ----
    toggleStripeButtons(modal, true);
  }

  function patchPlanText(modal, status) {
    const planEl = modal.querySelector("#subscriptionPlanText") || modal.querySelector("#subscriptionPlan");
    if (!planEl) return;
    const map = {
      club_month: "Klubb (månedlig)",
      club_year: "Klubb (årlig)",
      club_lifetime: "Klubb (livstid)"
    };
    planEl.textContent = map[status.plan] || "Klubblisens";
  }

  function injectClubInfo(modal, status) {
    const safeName = escapeHtml(status.club_name || "din klubb");

    const section = document.createElement("div");
    section.id = "clubInfoSection";
    section.style.cssText = `
      margin-top:12px; padding:14px 16px;
      background:linear-gradient(135deg, #e3f2fd, #bbdefb);
      border:1px solid #90caf9; border-radius:12px;
    `;
    section.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <i class="fas fa-shield-halved" style="color:#0d47a1; font-size:16px;"></i>
        <strong style="color:#0d47a1; font-size:14px;">Klubblisens</strong>
      </div>
      <div style="font-size:13px; color:#1a237e; line-height:1.5;">
        Du har tilgang via <strong>${safeName}</strong>.
        Klubben administrerer abonnementet.
      </div>
      <button id="leaveClubBtn" type="button" style="
        margin-top:10px; padding:6px 14px; background:transparent;
        border:1px solid #ef5350; color:#ef5350; border-radius:8px;
        font-size:12px; font-weight:600; cursor:pointer;
      ">Forlat klubb</button>
    `;

    const anchor = modal.querySelector(".bf-subcard");
    if (anchor) anchor.insertAdjacentElement("afterend", section);
    else {
      const body = modal.querySelector(".bf-modal__body");
      if (body) body.appendChild(section);
    }

    const leaveBtn = section.querySelector("#leaveClubBtn");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", async () => {
        if (!confirm(
          "Er du sikker på at du vil forlate klubben?\n\n" +
          "Du mister tilgangen din og trenger et eget abonnement."
        )) return;

        leaveBtn.disabled = true;
        leaveBtn.textContent = "Forlater...";
        try {
          const token = await getToken();
          if (!token) throw new Error("Ikke innlogget");
          await apiCall(LEAVE_ENDPOINT, { method: "POST", token });
          showNotif("Du har forlatt klubben.", "info");
          setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
          alert("Kunne ikke forlate klubb: " + err.message);
          leaveBtn.disabled = false;
          leaveBtn.textContent = "Forlat klubb";
        }
      });
    }
  }

  // ---- Dobbeltabonnement-varsel ----
  function injectDualSubscriptionWarning(modal, status) {
    const safeName = escapeHtml(status.club_name || "din klubb");

    const warning = document.createElement("div");
    warning.id = "dualSubWarning";
    warning.style.cssText = `
      margin-top:12px; padding:14px 16px;
      background:#fff8e1; border:1px solid #ffca28;
      border-radius:12px;
    `;
    warning.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <i class="fas fa-info-circle" style="color:#f57f17; font-size:16px;"></i>
        <strong style="color:#f57f17; font-size:14px;">Du betaler dobbelt</strong>
      </div>
      <div style="font-size:13px; color:#5d4037; line-height:1.5;">
        Du har et individuelt abonnement, men du har også tilgang via
        <strong>${safeName}</strong>.
        <br>Du kan trygt kansellere ditt individuelle abonnement
        via «Administrer abonnement» over.
      </div>
    `;

    const anchor = modal.querySelector(".bf-subcard");
    if (anchor) anchor.insertAdjacentElement("afterend", warning);
    else {
      const body = modal.querySelector(".bf-modal__body");
      if (body) body.appendChild(warning);
    }
  }

  function toggleStripeButtons(modal, show) {
    const ids = ["managePortalBtn", "cancelPortalBtn", "openPricingFromModal"];
    ids.forEach((id) => {
      const el = modal.querySelector("#" + id);
      if (el) el.style.display = show ? "" : "none";
    });
  }

  // -------------------------------------------------------
  // 4. HOOKS
  // -------------------------------------------------------
  function watchPricingPage() {
    const pricing = document.getElementById("pricingPage");
    if (!pricing) { setTimeout(watchPricingPage, 500); return; }

    const observer = new MutationObserver(() => {
      if (pricing.style.display !== "none" && !pricing.classList.contains("hidden")) {
        injectPricingClubSection();
      }
    });
    observer.observe(pricing, { attributes: true, attributeFilter: ["style", "class"] });

    if (pricing.style.display !== "none") injectPricingClubSection();
  }

  function watchSubscriptionModal() {
    const modal = document.getElementById("subscriptionModal");
    if (!modal) { setTimeout(watchSubscriptionModal, 500); return; }

    const observer = new MutationObserver(() => {
      const isVisible = modal.style.display === "block" || modal.style.display === "flex";
      if (isVisible) {
        const lastStatus = window.subscriptionService?.getLastKnownStatus?.();
        if (lastStatus) patchModalForStatus(lastStatus);
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["style", "class"] });
  }

  // -------------------------------------------------------
  // 5. INIT
  // -------------------------------------------------------
  function init() {
    watchPricingPage();
    watchSubscriptionModal();
    console.log(`${LOG_PREFIX} ✅ club.js v3 loaded`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
