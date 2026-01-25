// Barnefotballtrener - auth.js
// ===================================================
// - Fikser "Fortsett med Google" på iPhone (binder #googleSignInBtn)
// - Guard mot AbortError
// - Enkel lock for å redusere race i session
// - DEV bypass: kimruneholmvik@gmail.com hopper over plan/pricing

// -------------------------------
// AbortError guard
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
// DEV bypass
// -------------------------------
const DEV_BYPASS_EMAILS = ['kimruneholmvik@gmail.com'];
function isDevBypassUser(user) {
  const email = (user?.email || '').toLowerCase().trim();
  return DEV_BYPASS_EMAILS.includes(email);
}

// -------------------------------
// Supabase config
// -------------------------------
const SUPABASE_URL =
  (window.ENV && window.ENV.SUPABASE_URL) ||
  window.SUPABASE_URL ||
  '';

const SUPABASE_ANON_KEY =
  (window.ENV && (window.ENV.SUPABASE_ANON_KEY || window.ENV.SUPABASE_ANON)) ||
  window.SUPABASE_ANON_KEY ||
  window.SUPABASE_ANON ||
  '';

// -------------------------------
// DOM refs
// -------------------------------
const loginScreen = document.getElementById('passwordProtection');
const mainApp = document.getElementById('mainApp');
const pricingPage = document.getElementById('pricingPage');

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeStorageRemove(key) {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}

class AuthService {
  constructor() {
    this._mainShown = false;
    this.supabase = null;
    this.currentUser = null;
    this.initPromise = null;
    this.lockKey = 'bf_auth_lock_v1';
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      console.log('🔐 Initialiserer AuthService...');

      try {
        await this.loadSupabaseScript();

        if (!window.supabase) {
          console.error('❌ Supabase library ikke lastet!');
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

        // Session med retry+lock
        let session = null;
        try {
          session = await this.getSessionWithRetry();
        } catch (e) {
          console.warn('⚠️ getSessionWithRetry feilet:', e);
        }

        if (session?.user) {
          this.currentUser = session.user;
          console.log('✅ Bruker allerede logget inn:', session.user.email);
          await this.handleSignIn(session.user);
        } else {
          console.log('ℹ️ Ingen aktiv session');
          this.showLoginScreen();
        }

        // Auth events
        this.supabase.auth.onAuthStateChange(async (event, sess) => {
          console.log('🔄 Auth state changed:', event);

          if (event === 'SIGNED_IN' && sess?.user) {
            console.log('✅ Bruker logget inn:', sess.user.email);
            await this.handleSignIn(sess.user);
          }

          if (event === 'SIGNED_OUT') {
            console.log('👋 Bruker logget ut');
            this.currentUser = null;
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
      script.src = 'https://unpkg.com/@supabase/supabase-js@2';
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

  async acquireLock() {
    const now = Date.now();
    const ttl = 10_000;
    const raw = safeStorageGet(this.lockKey);
    const val = raw ? Number(raw) : 0;

    if (val && now - val < ttl) {
      await new Promise((r) => setTimeout(r, 350));
      return this.acquireLock();
    }
    safeStorageSet(this.lockKey, String(now));
  }

  releaseLock() {
    safeStorageRemove(this.lockKey);
  }

  async getSessionWithRetry() {
    await this.acquireLock();
    try {
      try {
        const { data, error } = await this.supabase.auth.getSession();
        if (error) throw error;
        return data?.session || null;
      } catch (error) {
        console.error('❌ getSession kastet feil:', error);
        await new Promise((r) => setTimeout(r, 400));
        const { data, error: err2 } = await this.supabase.auth.getSession();
        if (err2) throw err2;
        return data?.session || null;
      }
    } finally {
      this.releaseLock();
    }
  }

  async signInWithGoogle() {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      // iOS/Safari: redirectTo må være samme origin + path
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

  async signOut() {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      // Bruk samme lock-mekanisme som resten av auth-flyten
      if (typeof this.acquireLock === 'function') await this.acquireLock();

      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;

      this.currentUser = null;

      // UI fallback – trygt selv om auth-state listener også oppdaterer
      this.showLoginScreen();

      return { success: true };
    } catch (error) {
      console.error('❌ Logout error:', error);
      return { success: false, error: error?.message || String(error) };
    } finally {
      if (typeof this.releaseLock === 'function') this.releaseLock();
    }
  }

  async handleSignIn(user) {
    this.currentUser = user;

    if (isDevBypassUser(user)) {
      console.log('🔓 DEV BYPASS aktiv - hopper over plan/pricing:', user.email);
      this.showMainApp();
      return;
    }

    console.log('🔍 Sjekker subscription for bruker:', user.id);

    try {
      if (typeof subscriptionService === 'undefined') {
        console.warn('⚠️ subscriptionService ikke funnet - viser prisside');
        this.showPricingPage();
        return;
      }

      const subscription = await subscriptionService.checkSubscription(user.id);
      console.log('📊 Subscription status:', subscription);

      if (subscription?.active || subscription?.trial) {
        this.showMainApp();
      } else {
        this.showPricingPage();
      }
    } catch (error) {
      console.error('❌ Subscription check failed:', error);
      this.showPricingPage();
    }
  }

  showLoginScreen() {
    if (loginScreen) loginScreen.style.display = 'flex';
    if (pricingPage) pricingPage.style.display = 'none';
    if (mainApp) mainApp.style.display = 'none';
  }

  showPricingPage() {
    if (loginScreen) loginScreen.style.display = 'none';
    if (pricingPage) pricingPage.style.display = 'block';
    if (mainApp) mainApp.style.display = 'none';
  }

  showMainApp() {
    if (loginScreen) loginScreen.style.display = 'none';
    if (pricingPage) pricingPage.style.display = 'none';

    if (mainApp) {
      mainApp.style.display = 'block';
      mainApp.style.opacity = '1';
      mainApp.style.visibility = 'visible';
      mainApp.style.pointerEvents = 'auto';
    }

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



// Global instans
const authService = new AuthService();
window.authService = authService;

// -------------------------------
// Bind #googleSignInBtn (eksakt)
// -------------------------------
function bindGoogleButton() {
  const btn = document.getElementById('googleSignInBtn');
  if (!btn) {
    console.warn('⚠️ Fant ikke #googleSignInBtn i DOM');
    return;
  }
  if (btn.__bf_bound_google) return;
  btn.__bf_bound_google = true;

  btn.style.pointerEvents = 'auto';
  btn.style.cursor = 'pointer';

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('➡️ Google-knapp klikket, starter OAuth...');
    const res = await authService.signInWithGoogle();
    if (!res?.success) {
      console.error('❌ Google-login feilet:', res?.error);
      window.showNotification?.('Innlogging feilet. Prøv igjen.', 'error');
    }
  }, { passive: false });

  console.log('✅ Google-knapp bundet (#googleSignInBtn)');
}

// -------------------------------
// Boot
// -------------------------------
function bootAuth() {
  console.log('📄 DOM ready - initialiserer auth');
  bindGoogleButton();
  authService.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootAuth);
} else {
  bootAuth();
}
