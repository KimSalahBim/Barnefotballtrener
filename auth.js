// Barnefotballtrener - auth.js (REPLACEMENT FILE)
// ===================================================
// - Robust Supabase Auth (Google OAuth + Magic link/OTP)
// - Én autoritativ auth-flyt (ingen dobbeltbinding)
// - Stabil på iOS/Safari + scroll-lock
// - Paywall basert på subscriptionService.checkSubscription() (token-basert)
// - Anti-spam/cooldown for magic link (reduserer 429)
// - Guards mot doble init-kall

// -------------------------------
// AbortError guard (støy fra intern auth)
// -------------------------------
if (!window.__bf_aborterror_guard) {
  window.__bf_aborterror_guard = true;
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event?.reason?.message || event?.reason || '');
    if (msg.includes('AbortError') || msg.includes('signal is aborted')) {
      console.warn('⚠️ Ignorerer AbortError fra intern auth:', event.reason);
      event.preventDefault?.();
    }
  });
}

// -------------------------------
// DEV bypass (DISABLED)
// -------------------------------
const DEV_BYPASS_ENABLED = false;
const DEV_BYPASS_EMAILS = [
  'kimruneholmvik@gmail.com',
  'katrinenordseth@gmail.com',
];
function isDevBypassUser(user) {
  const email = (user?.email || '').toLowerCase().trim();
  return DEV_BYPASS_EMAILS.includes(email);
}

// -------------------------------
// Safe storage helpers
// -------------------------------
function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeStorageRemove(key) {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}

// -------------------------------
// iOS-safe scroll lock
// -------------------------------
function lockScroll() {
  const y = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add('lock-scroll');
  document.body.classList.add('lock-scroll');

  // Inline fallback (iOS)
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.top = `-${y}px`;
  document.body.style.overflow = 'hidden';
  document.body.dataset.scrollY = String(y);
}

function unlockScroll() {
  const y = parseInt(document.body.dataset.scrollY || '0', 10) || 0;
  document.documentElement.classList.remove('lock-scroll');
  document.body.classList.remove('lock-scroll');

  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.top = '';
  document.body.style.overflow = '';
  delete document.body.dataset.scrollY;

  window.scrollTo(0, y);
}

// -------------------------------
// Supabase config (public) – støtter flere varianter
// -------------------------------
function readEnv(key) {
  return (
    (window.ENV && window.ENV[key]) ||
    (window.env && window.env[key]) ||
    window[key] ||
    ''
  );
}

const SUPABASE_URL =
  readEnv('SUPABASE_URL') ||
  readEnv('VITE_SUPABASE_URL') ||
  '';

const SUPABASE_ANON_KEY =
  readEnv('SUPABASE_ANON_KEY') ||
  readEnv('SUPABASE_ANON') ||
  readEnv('VITE_SUPABASE_ANON_KEY') ||
  readEnv('VITE_SUPABASE_ANON') ||
  '';

// -------------------------------
// AuthService
// -------------------------------
class AuthService {
  constructor() {
    this._mainShown = false;
    this._handlingSignIn = false;

    this.supabase = null;
    this.currentUser = null;
    this.initPromise = null;

    this.lockKey = 'bf_auth_lock_v1';
  }

  // DOM refs (robust hvis script lastes før DOM)
  _refs() {
    return {
      loginScreen: document.getElementById('passwordProtection'),
      mainApp: document.getElementById('mainApp'),
      pricingPage: document.getElementById('pricingPage'),
    };
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      console.log('🔐 Initialiserer AuthService...');

      try {
        await this.loadSupabaseScript();

        if (!window.supabase) {
          console.error('❌ Supabase library ikke lastet (window.supabase mangler)');
          this.showLoginScreen();
          return;
        }
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          console.error('❌ Mangler Supabase config (URL/ANON_KEY)');
          this.showLoginScreen();
          return;
        }

        this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });

        console.log('✅ Supabase client opprettet');

        let session = null;
        try { session = await this.getSessionWithRetry(); } catch {}

        if (session?.user) {
          this.currentUser = session.user;
          console.log('✅ Bruker allerede logget inn:', session.user.email);
          await this.handleSignIn(session.user);
        } else {
          console.log('ℹ️ Ingen aktiv session');
          this.showLoginScreen();
        }

        this.supabase.auth.onAuthStateChange(async (event, sess) => {
          console.log('🔄 Auth state changed:', event);

          if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && sess?.user) {
            await this.handleSignIn(sess.user);
          }

          if (event === 'SIGNED_OUT') {
            console.log('👋 Bruker logget ut');
            this.currentUser = null;
            this._mainShown = false;
            this.showLoginScreen();
          }
        });

        console.log('✅ AuthService initialisert');
      } catch (error) {
        console.error('❌ Auth init feilet:', error);
        this.showLoginScreen();
      }
    })();

    return this.initPromise;
  }

  async loadSupabaseScript() {
    if (window.supabase) return;

    console.log('📦 Laster Supabase script...');

    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-supabase-script="1"]');
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', reject);
        return;
      }

      const script = document.createElement('script');
      // ✅ UMD build for vanilla JS
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      script.async = true;
      script.defer = true;
      script.setAttribute('data-supabase-script', '1');

      script.onload = () => {
        console.log('✅ Supabase script lastet');
        resolve();
      };
      script.onerror = (e) => {
        console.error('❌ Kunne ikke laste Supabase script', e);
        reject(e);
      };

      document.head.appendChild(script);
    });
  }

  // Lock for å redusere race conditions
  async acquireLock() {
    const ttl = 10_000;
    const maxWait = 8_000;
    const start = Date.now();

    while (true) {
      const now = Date.now();
      const raw = safeStorageGet(this.lockKey);
      const val = raw ? Number(raw) : 0;

      if (!val || now - val >= ttl) {
        safeStorageSet(this.lockKey, String(now));
        return;
      }
      if (now - start >= maxWait) {
        console.warn('⚠️ acquireLock timeout – fortsetter likevel');
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  releaseLock() {
    safeStorageRemove(this.lockKey);
  }

  async getSessionWithRetry() {
    if (!this.supabase) return null;

    await this.acquireLock();
    try {
      try {
        const { data, error } = await this.supabase.auth.getSession();
        if (error) throw error;
        return data?.session || null;
      } catch (error) {
        console.warn('⚠️ getSession feilet, retry:', error);
        await new Promise((r) => setTimeout(r, 350));
        const { data, error: err2 } = await this.supabase.auth.getSession();
        if (err2) throw err2;
        return data?.session || null;
      }
    } finally {
      this.releaseLock();
    }
  }

  // Sign-in methods
  async signInWithGoogle() {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      const redirectTo = window.location.origin + window.location.pathname;

      const { error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('❌ Google sign-in error:', error);
      return { success: false, error: error?.message || String(error) };
    }
  }

  async signInWithMagicLink(email) {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      const cleanEmail = String(email || '').trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return { success: false, error: 'Ugyldig e-postadresse' };
      }

      const emailRedirectTo = window.location.origin + window.location.pathname;

      const { error } = await this.supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { emailRedirectTo },
      });

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('❌ Magic link error:', error);
      return { success: false, error: error?.message || String(error) };
    }
  }

  async signOut() {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      await this.acquireLock();

      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;

      this.currentUser = null;
      this._mainShown = false;

      this.showLoginScreen();
      return { success: true };
    } catch (error) {
      console.error('❌ Logout error:', error);
      return { success: false, error: error?.message || String(error) };
    } finally {
      this.releaseLock();
    }
  }

  // Access gate
  async handleSignIn(user) {
    if (this._handlingSignIn) return;
    this._handlingSignIn = true;

    try {
      this.currentUser = user;

      if (DEV_BYPASS_ENABLED && isDevBypassUser(user)) {
        console.log('🔥 DEV BYPASS aktiv - hopper over plan/pricing:', user.email);
        this.showMainApp();
        return;
      }

      console.log('🔎 Sjekker subscription for bruker:', user?.id);

      const svc = window.subscriptionService;
      if (!svc || typeof svc.checkSubscription !== 'function') {
        console.warn('⚠️ subscriptionService.checkSubscription mangler - viser prisside');
        this.showPricingPage();
        return;
      }

      const status = await svc.checkSubscription();
      console.log('📊 Subscription status:', status);

      const hasAccess = !!(status?.active || status?.trial || status?.lifetime);

      if (hasAccess) {
        this.showMainApp();

        // Trial auto-lås (serverstyrt recheck)
        if (status?.trial && status?.trial_ends_at) {
          const msLeft = new Date(status.trial_ends_at).getTime() - Date.now();
          if (msLeft > 0) {
            setTimeout(async () => {
              try {
                const refreshed = await svc.checkSubscription();
                const stillHasAccess = !!(refreshed?.active || refreshed?.trial || refreshed?.lifetime);
                if (!stillHasAccess) {
                  this._mainShown = false;
                  this.showPricingPage();
                  alert('Prøveperioden er utløpt. Velg en plan for å fortsette.');
                }
              } catch (e) {
                console.warn('⚠️ Trial recheck feilet:', e);
              }
            }, Math.min(msLeft + 1000, 2147483000));
          }
        }
      } else {
        this.showPricingPage();
      }
    } catch (error) {
      console.error('❌ Subscription check failed:', error);
      this.showPricingPage();
    } finally {
      this._handlingSignIn = false;
    }
  }

  // UI
  showLoginScreen() {
    document.body.classList.add('gated');
    lockScroll();
    window.scrollTo(0, 0);

    this._mainShown = false;

    const { loginScreen, pricingPage, mainApp } = this._refs();
    if (loginScreen) loginScreen.style.display = 'flex';
    if (pricingPage) pricingPage.style.display = 'none';
    if (mainApp) mainApp.style.display = 'none';
  }

  showPricingPage() {
    document.body.classList.add('gated');
    lockScroll();
    window.scrollTo(0, 0);

    this._mainShown = false;

    const { loginScreen, pricingPage, mainApp } = this._refs();
    if (loginScreen) loginScreen.style.display = 'none';
    if (pricingPage) pricingPage.style.display = 'block';
    if (mainApp) mainApp.style.display = 'none';
  }

showMainApp() {
  document.body.classList.remove('gated');
  unlockScroll();

  const { loginScreen, pricingPage, mainApp } = this._refs();

  // Sørg for riktig UI hver gang, selv om init ikke skal kjøres på nytt
  if (loginScreen) loginScreen.style.display = 'none';
  if (pricingPage) pricingPage.style.display = 'none';
  if (mainApp) {
    mainApp.style.display = 'block';
    mainApp.style.opacity = '1';
    mainApp.style.visibility = 'visible';
    mainApp.style.pointerEvents = 'auto';
  }

  // Hindre at initApp kjøres flere ganger
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
}


// -------------------------------
// Global instance
// -------------------------------
window.authService = window.authService || new AuthService();
const authService = window.authService;

// -------------------------------
// Bind UI handlers (én gang)
// -------------------------------
function bindGoogleButton() {
  const btn = document.getElementById('googleSignInBtn');
  if (!btn) return;
  if (btn.__bf_bound_google) return;
  btn.__bf_bound_google = true;

  btn.style.pointerEvents = 'auto';
  btn.style.cursor = 'pointer';

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    console.log('🟦 Google-knapp klikket, starter OAuth...');
    const res = await authService.signInWithGoogle();
    if (res && res.success === false) {
      console.error('❌ Google-login feilet:', res.error);
      window.showNotification?.('Innlogging feilet. Prøv igjen.', 'error');
    }
  }, { passive: false });

  console.log('✅ Google-knapp bundet');
}

function bindMagicLink() {
  const emailInput = document.getElementById('magicLinkEmail');
  const btn = document.getElementById('magicLinkBtn');
  const hint = document.getElementById('magicLinkHint');

  if (!emailInput || !btn) return;
  if (btn.__bf_bound_magic) return;
  btn.__bf_bound_magic = true;

  btn.style.pointerEvents = 'auto';
  btn.style.cursor = 'pointer';

  const COOLDOWN_MS = 10_000;
  const cooldownKey = (email) => `bf_magic_cooldown_${String(email || '').trim().toLowerCase()}`;

  function getCooldownUntil(email) {
    const raw = safeStorageGet(cooldownKey(email));
    return raw ? Number(raw) : 0;
  }
  function setCooldown(email) {
    safeStorageSet(cooldownKey(email), String(Date.now() + COOLDOWN_MS));
  }

  async function sendLink() {
    const email = String(emailInput.value || '').trim();

    if (!email || !email.includes('@')) {
      window.showNotification?.('Skriv inn en gyldig e-postadresse.', 'error');
      emailInput.focus();
      return;
    }

    const until = getCooldownUntil(email);
    const now = Date.now();
    if (until && now < until) {
      const remaining = Math.max(1, Math.ceil((until - now) / 1000));
      window.showNotification?.(`Vent ${remaining}s før du sender ny lenke.`, 'info');
      return;
    }

    setCooldown(email);

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'Sender...';

    try {
      const res = await authService.signInWithMagicLink(email);
      if (res?.success) {
        if (hint) hint.textContent = 'Sjekk e-posten din og klikk på lenka for å logge inn ✅';
        window.showNotification?.('Innloggingslenke sendt. Sjekk e-posten.', 'success');
      } else {
        window.showNotification?.(res?.error || 'Kunne ikke sende lenke. Prøv igjen.', 'error');
      }
    } catch (err) {
      console.error('❌ Magic link exception:', err);
      window.showNotification?.('Kunne ikke sende lenke. Prøv igjen.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    await sendLink();
  }, { passive: false });

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });

  console.log('✅ Magic link bundet (#magicLinkBtn)');
}

// -------------------------------
// Boot (idempotent)
// -------------------------------
async function bootAuth() {
  if (window.__bf_auth_booted) return;
  window.__bf_auth_booted = true;

  console.log('🟦 DOM ready - initialiserer auth');
  bindGoogleButton();
  bindMagicLink();
  await authService.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootAuth);
} else {
  bootAuth();
}
