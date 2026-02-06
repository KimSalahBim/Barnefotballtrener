// Barnefotballtrener - auth.js (robust, no optional chaining) v2
// =============================================================

(function () {
  // AbortError guard (støy fra intern auth / fetch aborts)
  if (!window.__bf_aborterror_guard) {
    window.__bf_aborterror_guard = true;
    // Use capture=true to intercept early (Edge kan logge/stoppe på "Uncaught (in promise) AbortError")
    window.addEventListener('unhandledrejection', function (event) {
      try {
        var reason = event && event.reason;
        var msg = String((reason && reason.message) || reason || '');
        if (msg.indexOf('AbortError') !== -1 || msg.indexOf('signal is aborted') !== -1) {
          console.warn('⚠️ Ignorerer AbortError fra intern auth:', reason);
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
        }
      } catch (e) {}
    }, true);
  }

  // Prevent multiple boots/files
  if (window.__bf_auth_file_loaded_v2) return;
  window.__bf_auth_file_loaded_v2 = true;

  // -------------------------------
  // Small helpers
  // -------------------------------
  function notify(msg, type) {
    try {
      if (typeof window.showNotification === 'function') {
        window.showNotification(msg, type);
      }
    } catch (e) {}
  }


  function isStagingHost() {
    try {
      var h = String(window.location.hostname || '').toLowerCase();
      return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.vercel.app');
    } catch (e) {
      return false;
    }
  }



  function safeGetStorage(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSetStorage(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function safeRemoveStorage(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  }
      
  function withTimeout(promise, ms, label) {
    var t;
    var timeoutPromise = new Promise(function (_, rej) {
      t = setTimeout(function () {
        rej(new Error((label || "TIMEOUT") + " (" + ms + "ms)"));
      }, ms);
    });
    return Promise.race([promise, timeoutPromise]).then(
      function (val) { try { clearTimeout(t); } catch (e) {} return val; },
      function (err) { try { clearTimeout(t); } catch (e) {} throw err; }
    );
  }

  function readSessionFromLocalStorage() {
    try {
      var keys = Object.keys(localStorage || {}).filter(function (k) {
        return k.indexOf("sb-") !== -1 && k.indexOf("-auth-token") !== -1;
      });
      if (!keys.length) return null;

      keys.sort(function (a, b) {
        return String(safeGetStorage(b) || "").length - String(safeGetStorage(a) || "").length;
      });

      var raw = safeGetStorage(keys[0]);
      if (!raw) return null;

      var obj = JSON.parse(raw);

      // Supabase v2 UMD kan variere litt i shape
      var sess =
        (obj && obj.currentSession) ||
        (obj && obj.session) ||
        (obj && obj.data && obj.data.session) ||
        null;

      if (sess && sess.access_token && sess.user) return sess;
      return null;
    } catch (e) {
      return null;
    }
  }

  function readEnv(key) {
    try {
      if (window.ENV && window.ENV[key]) return window.ENV[key];
      if (window.env && window.env[key]) return window.env[key];
      if (window[key]) return window[key];
    } catch (e) {}
    return '';
  }

  // -------------------------------
  // Scroll lock (iOS-safe)
  // -------------------------------
  function lockScroll() {
    var y = window.scrollY || window.pageYOffset || 0;

    document.documentElement.classList.add('lock-scroll');
    document.body.classList.add('lock-scroll');

    // Inline fallback for iOS
    document.body.style.width = '100%';
    document.body.style.top = '-' + y + 'px';
    document.body.style.overflow = 'hidden';
    document.body.dataset.scrollY = String(y);
  }

  function unlockScroll() {
    var y = parseInt(document.body.dataset.scrollY || '0', 10) || 0;

    document.documentElement.classList.remove('lock-scroll');
    document.body.classList.remove('lock-scroll');

    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.top = '';
    document.body.style.overflow = '';
    delete document.body.dataset.scrollY;

    window.scrollTo(0, y);
  }

  window.__bf_lockScroll = lockScroll;
  window.__bf_unlockScroll = unlockScroll;

function showSupabaseBlockedMessage(err) {
  try {
    // Idempotent: don't add twice
    if (document.getElementById('supabaseBlockedBanner')) return;

    var root = document.getElementById('passwordProtection') || document.body;
    var box = null;
    try {
      box = root.querySelector && root.querySelector('.password-box');
    } catch (_) {}
    var mount = box || root;

    var isDebugHost = false;
    try {
      var hn = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
      isDebugHost = (hn === 'localhost' || hn === '127.0.0.1' || hn.endsWith('.vercel.app'));
    } catch (_) {}

    var banner = document.createElement('div');
    banner.id = 'supabaseBlockedBanner';
    banner.className = 'supabase-blocked-banner';
    banner.setAttribute('role', 'alert');

    var title = document.createElement('div');
    title.className = 'supabase-blocked-title';
    title.textContent = 'Innlogging kunne ikke lastes';

    var msg = document.createElement('div');
    msg.className = 'supabase-blocked-text';
    msg.textContent =
      'Det ser ut som nettverket eller nettleseren din blokkerer innloggingskomponenten. ' +
      'Prøv å laste siden på nytt, bytt nettverk, eller bruk mobilnett.';

    var details = null;
    if (isDebugHost && err && (err.message || String(err))) {
      details = document.createElement('div');
      details.className = 'supabase-blocked-details';
      details.textContent = 'Teknisk: ' + (err.message || String(err));
    }

    var actions = document.createElement('div');
    actions.className = 'supabase-blocked-actions';

    var reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'supabase-blocked-retry';
    reloadBtn.textContent = 'Prøv igjen';
    reloadBtn.addEventListener('click', function () {
      try { window.location.reload(); } catch (_) {}
    });

    actions.appendChild(reloadBtn);

    banner.appendChild(title);
    banner.appendChild(msg);
    if (details) banner.appendChild(details);
    banner.appendChild(actions);

    // Insert banner near top of the login box
    if (mount && mount.firstChild) {
      mount.insertBefore(banner, mount.firstChild);
    } else if (mount) {
      mount.appendChild(banner);
    }
  } catch (_) {
    // don't throw from UI helper
  }
}

  // -------------------------------
  // Supabase config (public)
  // -------------------------------
  var SUPABASE_URL = readEnv('SUPABASE_URL') || readEnv('VITE_SUPABASE_URL') || '';
  var SUPABASE_ANON_KEY =
    readEnv('SUPABASE_ANON_KEY') ||
    readEnv('SUPABASE_ANON') ||
    readEnv('VITE_SUPABASE_ANON_KEY') ||
    readEnv('VITE_SUPABASE_ANON') ||
    '';

  // -------------------------------
  // AuthService
  // -------------------------------
  function AuthService() {
    this.supabase = null;
    this.currentUser = null;

    this._initPromise = null;
    this._mainShown = false;
    this._handlingSignIn = false;

    this._lockKey = 'bf_auth_lock_v1';

    // Single-flight for getSession to avoid Supabase auth lock/AbortError when multiple calls overlap
    this._sessionPromise = null;
    this._sessionPromiseAt = 0;
  }

  AuthService.prototype._refs = function () {
    return {
      loginScreen: document.getElementById('passwordProtection'),
      pricingPage: document.getElementById('pricingPage'),
      mainApp: document.getElementById('mainApp')
    };
  };

  AuthService.prototype._acquireLock = async function () {
    var ttl = 10000;
    var maxWait = 8000;
    var start = Date.now();

    while (true) {
      var now = Date.now();
      var raw = safeGetStorage(this._lockKey);
      var val = raw ? Number(raw) : 0;

      if (!val || now - val >= ttl) {
        safeSetStorage(this._lockKey, String(now));
        return;
      }

      if (now - start >= maxWait) {
        console.warn('⚠️ acquireLock timeout – fortsetter likevel');
        return;
      }

      await new Promise(function (r) { setTimeout(r, 250); });
    }
  };

  AuthService.prototype._releaseLock = function () {
    safeRemoveStorage(this._lockKey);
  };

  AuthService.prototype._loadSupabaseScript = async function () {
    if (window.supabase) return;

    console.log('📦 Laster Supabase script...');

    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-supabase-script="1"]');
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', reject);
        return;
      }

      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      script.async = true;
      script.defer = true;
      script.setAttribute('crossorigin', 'anonymous');
      script.setAttribute('data-supabase-script', '1');

      script.onload = function () {
        console.log('✅ Supabase script lastet');
        resolve();
      };
      script.onerror = function (e) {
        console.error('❌ Kunne ikke laste Supabase script', e);
        // Ultra-safe: only mutate UI after DOM is ready, and never throw
        try {
          var show = function () {
            try { showSupabaseBlockedMessage(e); } catch (_) {}
          };
          if (document && document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function onReady(){
              try { document.removeEventListener('DOMContentLoaded', onReady); } catch (_) {}
              show();
            });
          } else {
            show();
          }
        } catch (_) {}
        reject(e);
      };

      document.head.appendChild(script);
    });
  };

  AuthService.prototype._getSessionWithRetry = async function () {
    var self = this;
    if (!self.supabase) return null;

    await self._acquireLock();
    try {
      // 0) Fast path: localStorage (unngår Supabase internal lock på Edge hvis storage er ok)
      var ls0 = readSessionFromLocalStorage();
      if (ls0) return ls0;

      // 1) Single-flight getSession: aldri start flere overlappende getSession-kall
      var now = Date.now();

      if (!self._sessionPromise || (now - (self._sessionPromiseAt || 0) > 15000)) {
        self._sessionPromiseAt = now;

        // Catch -> strukturert retur for å unngå "Uncaught (in promise) AbortError" ved interne locks
        self._sessionPromise = self.supabase.auth.getSession().catch(function (err) {
          return { data: { session: null }, error: err };
        });

        // Clear when completed (only if still the same promise)
        try {
          (function (createdAt, p) {
            p.finally(function () {
              if (self._sessionPromise === p && self._sessionPromiseAt === createdAt) {
                self._sessionPromise = null;
                self._sessionPromiseAt = 0;
              }
            });
          })(self._sessionPromiseAt, self._sessionPromise);
        } catch (e0) {}
      }

      // 2) Vent litt lengre (Edge kan henge litt) – men uten å trigge nye getSession-kall
      var r1 = null;
      try {
        r1 = await withTimeout(self._sessionPromise, 8000, "supabase.getSession");
      } catch (e1) {
        console.warn("⚠️ getSession timeout/feil:", e1);
      }

      if (r1 && r1.error) {
        var msg = String((r1.error && r1.error.message) || r1.error || '');
        if (msg.indexOf('AbortError') !== -1 || msg.indexOf('signal is aborted') !== -1 || msg.toLowerCase().indexOf('lock') !== -1) {
          console.warn('⚠️ Supabase auth lock/AbortError – bruker localStorage fallback. (Tips: lukk andre faner)');
        } else {
          console.warn('⚠️ Supabase getSession error:', r1.error);
        }
      }

      var s1 = (r1 && r1.data && r1.data.session) ? r1.data.session : null;
      if (s1 && s1.user) return s1;

      // 3) Fallback: localStorage (ofte stabil selv når getSession henger)
      var ls = readSessionFromLocalStorage();
      if (ls) return ls;

      // 4) Best-effort "late" wait (samme promise, ingen nye kall)
      try {
        await new Promise(function (r) { setTimeout(r, 400); });
        if (self._sessionPromise) {
          var r2 = null;
          try {
            r2 = await withTimeout(self._sessionPromise, 2000, "supabase.getSession.late");
          } catch (e2) {}

          var s2 = (r2 && r2.data && r2.data.session) ? r2.data.session : null;
          if (s2 && s2.user) return s2;
        }
      } catch (e3) {}

      return null;
    } finally {
      self._releaseLock();
    }
  };


  AuthService.prototype.init = async function () {
    var self = this;
    if (self._initPromise) return self._initPromise;

    self._initPromise = (async function () {
      console.log('🟦 DOM ready - initialiserer auth');

      try {
        await self._loadSupabaseScript();

        if (!window.supabase) {
          console.error('❌ Supabase library ikke lastet (window.supabase mangler)');
          self.showLoginScreen();
          return;
        }

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          console.error('❌ Mangler Supabase config (SUPABASE_URL / SUPABASE_ANON_KEY)');
          self.showLoginScreen();
          return;
        }

        // Behold referanse til supabase-biblioteket før vi legger klient på window.supabase
const supabaseLib = window.supabase;

self.supabase = supabaseLib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Compat: andre filer forventer "window.supabase" = klient (med .auth.getSession())
window.supabaseLib = supabaseLib;
window.supabase = self.supabase;
window.supabaseClient = self.supabase;

console.log('✅ Supabase client opprettet (window.supabase = client)');


        var session = null;
        try { session = await self._getSessionWithRetry(); } catch (e) {}

        if (session && session.user) {
          self.currentUser = session.user;
          console.log('✅ Bruker allerede logget inn:', session.user.email);
          await self.handleSignIn(session.user);
        } else {
          self.showLoginScreen();
        }

        self.supabase.auth.onAuthStateChange(async function (event, sess) {
          console.log('🔄 Auth state changed:', event);

          if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && sess && sess.user) {
            await self.handleSignIn(sess.user);
          }

          if (event === 'SIGNED_OUT') {
            console.log('👋 Bruker logget ut');
            self.currentUser = null;
            self._mainShown = false;
            self.showLoginScreen();
          }
        });

        console.log('✅ AuthService initialisert');
      } catch (err) {
        console.error('❌ Auth init feilet:', err);
        self.showLoginScreen();
      }
    })();

    return self._initPromise;
  };

  // -------------------------------
  // Helper: Get canonical redirect URL (prevents /pricing.html trap)
  // -------------------------------
  function getCanonicalRedirectUrl() {
    // Strip filename, keep directory (prevents /pricing.html redirect, preserves subpath deployments)
    var p = window.location.pathname || '/';
    if (!p.endsWith('/')) {
      p = p.replace(/\/[^\/]*$/, '/');
    }
    return window.location.origin + p;
  }

  AuthService.prototype.signInWithGoogle = async function () {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

  var redirectTo = getCanonicalRedirectUrl();

  const hostname = window.location.hostname;
  const isStagingHost =
    hostname === "localhost" ||
    hostname.endsWith(".vercel.app");

  var forcePicker = safeGetStorage('bf_force_google_picker') === '1';

  var options = { redirectTo: redirectTo };
  if (isStagingHost || forcePicker) options.queryParams = { prompt: "select_account" };

  var res = await this.supabase.auth.signInWithOAuth({
    provider: "google",
    options
  });


      if (res && res.error) throw res.error;
      return { success: true };
    } catch (error) {
      console.error('❌ Google sign-in error:', error);
      return { success: false, error: (error && error.message) || String(error) };
    }
  };

  AuthService.prototype.signInWithMagicLink = async function (email) {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      var cleanEmail = String(email || '').trim();
      if (!cleanEmail || cleanEmail.indexOf('@') === -1) {
        return { success: false, error: 'Ugyldig e-postadresse' };
      }

      var emailRedirectTo = getCanonicalRedirectUrl();

      var res = await this.supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { emailRedirectTo: emailRedirectTo }
      });

      if (res && res.error) throw res.error;
      return { success: true };
    } catch (error) {
      console.error('❌ Magic link error:', error);
      return { success: false, error: (error && error.message) || String(error) };
    }
  };

  AuthService.prototype.signOut = async function () {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      await this._acquireLock();
      var res = await this.supabase.auth.signOut();
      if (res && res.error) throw res.error;

      safeSetStorage('bf_force_google_picker', '1');

      this.currentUser = null;
      this._mainShown = false;

      this.showLoginScreen();
      return { success: true };
    } catch (error) {
      console.error('❌ Logout error:', error);
      return { success: false, error: (error && error.message) || String(error) };
    } finally {
      this._releaseLock();
    }
  };

  AuthService.prototype.handleSignIn = async function (user) {
    if (this._handlingSignIn) return;
    this._handlingSignIn = true;

    try {
      safeRemoveStorage('bf_force_google_picker');
      this.currentUser = user;

      console.log('🔎 Sjekker subscription for bruker:', user && user.id);

      var svc = window.subscriptionService;
      if (!svc || typeof svc.checkSubscription !== 'function') {
        console.warn('⚠️ subscriptionService.checkSubscription mangler - viser prisside');
        this.showPricingPage();
        return;
      }

      var status = await svc.checkSubscription();
      console.log('📊 Subscription status:', status);

      var hasAccess = !!(status && (status.active || status.trial || status.lifetime));

      if (hasAccess) this.showMainApp();
      else this.showPricingPage();
    } catch (e) {
      console.error('❌ Subscription check failed:', e);
      this.showPricingPage();
    } finally {
      this._handlingSignIn = false;
    }
  };

  // -------------------------------
  // UI routing + gating (FIXED order: scrollTo -> lockScroll)
  // -------------------------------
  AuthService.prototype.showLoginScreen = function () {
    document.body.classList.add('gated');
    window.scrollTo(0, 0);
    lockScroll();

    this._mainShown = false;

    var r = this._refs();
    if (r.loginScreen) r.loginScreen.style.display = 'flex';
    if (r.pricingPage) r.pricingPage.style.display = 'none';
    if (r.mainApp) r.mainApp.style.display = 'none';
  };

  AuthService.prototype.showPricingPage = function () {
    document.body.classList.add('gated');
    window.scrollTo(0, 0);
    lockScroll();

    this._mainShown = false;

    var r = this._refs();
    if (r.loginScreen) r.loginScreen.style.display = 'none';
    if (r.pricingPage) r.pricingPage.style.display = 'block';
    if (r.mainApp) r.mainApp.style.display = 'none';
  };

  AuthService.prototype.showMainApp = function () {
    document.body.classList.remove('gated');
    unlockScroll();

    var r = this._refs();

    if (r.loginScreen) r.loginScreen.style.display = 'none';
    if (r.pricingPage) r.pricingPage.style.display = 'none';
    if (r.mainApp) {
      r.mainApp.style.display = 'block';
      r.mainApp.style.opacity = '1';
      r.mainApp.style.visibility = 'visible';
      r.mainApp.style.pointerEvents = 'auto';
    }

    if (this._mainShown) {
      console.log('ℹ️ showMainApp: allerede vist - hopper over init');
      return;
    }
    this._mainShown = true;

    try {
      if (typeof window.initApp === 'function') {
        console.log('🚀 Initialiserer app');
        window.initApp();
      } else {
        console.warn('⚠️ initApp finnes ikke på window');
      }
    } catch (e) {
      console.error('❌ initApp feilet:', e);
    }
  };
  
  // ------------------------------------------------
  // Small public helpers (used by core.js / others)
  // ------------------------------------------------
  AuthService.prototype.getUserId = function () {
    try {
      return this.currentUser && this.currentUser.id ? this.currentUser.id : null;
    } catch (e) {
      return null;
    }
  };

  AuthService.prototype.getUser = function () {
    try {
      return this.currentUser || null;
    } catch (e) {
      return null;
    }
  };

  
  // -------------------------------
  // Create/replace global instance
  // -------------------------------
  window.authService = window.authService || new AuthService();
  window.AuthService = window.authService; // compat for andre filer (subscription.js m.fl.)
  var authService = window.authService;
  // Expose a public wrapper so other files can reliably fetch session/token
// Expose a public wrapper so other files can reliably fetch session/token
if (typeof authService.getSessionWithRetry !== 'function') {
  authService.getSessionWithRetry = async function () {
    return await authService._getSessionWithRetry(); // <- _getSessionWithRetry returnerer session direkte
  };
}


  // -------------------------------
  // Bind UI handlers (ONE TIME)
  // -------------------------------
  function bindGoogleButton() {
    var btn = document.getElementById('googleSignInBtn');
    if (!btn) return;
    if (btn.__bf_bound_google) return;
    btn.__bf_bound_google = true;

    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

      try { await authService.init(); } catch (err) { showSupabaseBlockedMessage(err); }

      if (!authService.supabase) {
        showSupabaseBlockedMessage(new Error('Supabase-klienten er ikke lastet.'));
        return;
      }

      console.log('🟦 Google-knapp klikket, starter OAuth...');
      var res = await authService.signInWithGoogle();
      if (res && res.success === false) {
        console.error('❌ Google-login feilet:', res.error);
        notify('Innlogging feilet. Prøv igjen.', 'error');
      }
    }, { passive: false });

    console.log('✅ Google-knapp bundet');
  }

  function bindMagicLink() {
    var emailInput = document.getElementById('magicLinkEmail');
    var btn = document.getElementById('magicLinkBtn');
    var hint = document.getElementById('magicLinkHint');

    if (!emailInput || !btn) return;
    if (btn.__bf_bound_magic) return;
    btn.__bf_bound_magic = true;

    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';

    var COOLDOWN_MS = 10000;
    var GLOBAL_MIN_MS = 1500;
    var lastGlobal = 0;

    function cooldownKey(email) {
      return 'bf_magic_cooldown_' + String(email || '').trim().toLowerCase();
    }
    function getCooldownUntil(email) {
      var raw = safeGetStorage(cooldownKey(email));
      return raw ? Number(raw) : 0;
    }
    function setCooldown(email, untilTs) {
      safeSetStorage(cooldownKey(email), String(untilTs));
    }

    function setButtonState(disabled, text) {
      btn.disabled = !!disabled;
      if (text) btn.textContent = text;
    }

    async function sendLink() {
      try { await authService.init(); } catch (err) { showSupabaseBlockedMessage(err); }

      if (!authService.supabase) {
        showSupabaseBlockedMessage(new Error('Supabase-klienten er ikke lastet.'));
        return;
      }

      var email = String(emailInput.value || '').trim();
      if (!email || email.indexOf('@') === -1) {
        notify('Skriv inn en gyldig e-postadresse.', 'error');
        try { emailInput.focus(); } catch (e) {}
        return;
      }

      var now = Date.now();
      if (now - lastGlobal < GLOBAL_MIN_MS) {
        notify('Vent litt før du prøver igjen.', 'info');
        return;
      }
      lastGlobal = now;

      var until = getCooldownUntil(email);
      if (until && now < until) {
        var remaining = Math.max(1, Math.ceil((until - now) / 1000));
        notify('Vent ' + remaining + 's før du sender ny lenke.', 'info');
        return;
      }

      var nextUntil = now + COOLDOWN_MS;
      setCooldown(email, nextUntil);

      var oldText = btn.textContent;
      setButtonState(true, 'Sender...');

      try {
        var res = await authService.signInWithMagicLink(email);
        if (res && res.success) {
          if (hint) hint.textContent = 'Sjekk e-posten din og klikk på lenka for å logge inn ✅';
          notify('Innloggingslenke sendt. Sjekk e-posten.', 'success');
        } else {
          notify((res && res.error) || 'Kunne ikke sende lenke. Prøv igjen.', 'error');
        }
      } catch (err) {
        console.error('❌ Magic link exception:', err);
        notify('Kunne ikke sende lenke. Prøv igjen.', 'error');
      } finally {
        setButtonState(false, oldText);
      }
    }

    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      await sendLink();
    }, { passive: false });

    emailInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        btn.click();
      }
    });

    console.log('✅ Magic link bundet (#magicLinkBtn)');
  }

  // -------------------------------
  // Pricing back button
  // -------------------------------
  // NOTE: Removed bindPricingBackButton() - pricing.js owns this button
  // to prevent duplicate event handlers that can cause race conditions
  // and iOS scroll-lock issues. See Round 3 Bug #3.

  // -------------------------------
  // Boot
  // -------------------------------
  async function bootAuth() {
    if (window.__bf_auth_booted) return;
    window.__bf_auth_booted = true;

    bindGoogleButton();
    if (isStagingHost()) {
      bindMagicLink();
    } else {
      // Prod: Google-only (skjul magic link for å unngå rate-limit og support)
      var emailInput = document.getElementById('magicLinkEmail');
      var btn = document.getElementById('magicLinkBtn');
      var hint = document.getElementById('magicLinkHint');
      var divider = document.getElementById('magicLinkDivider'); // optional (hvis du har gitt den id i HTML)
    
      if (divider) divider.style.display = 'none';
      if (emailInput) emailInput.style.display = 'none';
      if (btn) btn.style.display = 'none';
      if (hint) hint.style.display = 'none';
    }
    // bindPricingBackButton(); // REMOVED: pricing.js handles this
    await authService.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAuth);
  } else {
    bootAuth();
  }
})();
