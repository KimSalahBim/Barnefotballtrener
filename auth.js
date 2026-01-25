// Barnefotballtrener - Autentisering (Supabase)
// ================================================

// Noen nettlesere/enheter kan kaste AbortError fra interne Supabase-auth operasjoner (f.eks. Web Locks/fetch som avbrytes).
// Vi vil ikke la det ta ned hele appen.
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

// --- DEV / ADMIN BYPASS ---
// Brukes for å slippe betalings-/abonnementsskjerm for utvalgte e-poster (f.eks. under testing).
// Viktig: Dette er en "hard bypass" på klientsiden. Fjern før offentlig lansering dersom du ikke vil ha gratis tilgang.
const DEV_BYPASS_EMAILS = ['kimruneholmvik@gmail.com'];

function isDevBypassUser(user) {
  const email = (user?.email || '').toLowerCase().trim();
  return DEV_BYPASS_EMAILS.includes(email);
}

// Konfigurasjon - HENTES FRA ENV (Vercel) via window.ENV eller fallback
const SUPABASE_URL =
  (window.ENV && window.ENV.SUPABASE_URL) ||
  window.SUPABASE_URL ||
  '';

// Bruk ANON_KEY (public) i frontend, aldri service_role
const SUPABASE_ANON_KEY =
  (window.ENV && (window.ENV.SUPABASE_ANON_KEY || window.ENV.SUPABASE_ANON)) ||
  window.SUPABASE_ANON_KEY ||
  window.SUPABASE_ANON ||
  '';

// UI-elementer
const loginScreen = document.getElementById('passwordProtection');
const mainApp = document.getElementById('mainApp');
const pricingPage = document.getElementById('pricingPage');

// Liten hjelpefunksjon for trygg localStorage
function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

class AuthService {
  constructor() {
    this.supabase = null;
    this.currentUser = null;
    this.initialized = false;
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

        // OAuth callback-detektering (hash/query)
        const url = new URL(window.location.href);
        const hasOAuthParams =
          url.searchParams.get('code') ||
          url.searchParams.get('access_token') ||
          url.hash.includes('access_token') ||
          url.hash.includes('code=');

        if (hasOAuthParams) {
          console.log('🔑 OAuth callback detektert - behandler...');
        }

        // Hent session med retry (AbortError kan skje)
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

        // Lytt på auth-endringer
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

        this.initialized = true;
        console.log('✅ AuthService initialisert');
      } catch (error) {
        console.error('❌ Auth init feilet:', error);
        this.showLoginScreen();
      }
    })();

    return this.initPromise;
  }

  async loadSupabaseScript() {
    // Ikke last flere ganger
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
    // Enkel lock i localStorage for å unngå samtidige init-race som kan trigge AbortError i noen miljøer
    const now = Date.now();
    const ttl = 10_000; // 10s
    const raw = safeStorageGet(this.lockKey);
    const val = raw ? Number(raw) : 0;

    if (val && now - val < ttl) {
      // Lock er "tatt" nylig, vent litt
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
      // første forsøk
      try {
        const { data, error } = await this.supabase.auth.getSession();
        if (error) throw error;
        return data?.session || null;
      } catch (error) {
        console.error('❌ getSession kastet feil:', error);

        // retry 1
        await new Promise((r) => setTimeout(r, 400));
        try {
          const { data, error: err2 } = await this.supabase.auth.getSession();
          if (err2) throw err2;
          return data?.session || null;
        } catch (error2) {
          console.error('❌ getSession retry feilet:', error2);
          throw error2;
        }
      }
    } finally {
      this.releaseLock();
    }
  }

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
      console.error('❌ Sign in error:', error);
      return { success: false, error: error.message };
    }
  }

  async signOut() {
    try {
      if (!this.supabase) throw new Error('Supabase ikke initialisert');

      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;

      this.currentUser = null;
      this.showLoginScreen();
      console.log('✅ Utlogging vellykket');
      return { success: true };
    } catch (error) {
      console.error('❌ Sign out error:', error);
      return { success: false, error: error.message };
    }
  }

  // Håndter innlogging
  async handleSignIn(user) {
    this.currentUser = user;

    // DEV bypass: Kim (og evt. andre i listen) skal alltid inn i hovedappen uten abonnement/planvalg
    if (isDevBypassUser(user)) {
      console.log('🔓 DEV BYPASS aktiv - hopper over subscription/prisside for:', user.email);
      this.showMainApp();
      return;
    }

    console.log('🔍 Sjekker subscription for bruker:', user.id);

    try {
      // Sjekk om subscriptionService finnes
      if (typeof subscriptionService === 'undefined') {
        console.warn('⚠️ subscriptionService ikke funnet - viser prisside');
        this.showPricingPage();
        return;
      }

      // Sjekk om bruker har et aktivt abonnement
      const subscription = await subscriptionService.checkSubscription(user.id);
      console.log('📊 Subscription status:', subscription);

      if (subscription.active) {
        console.log('✅ Aktivt abonnement - viser hovedapp');
        this.showMainApp();
      } else if (subscription.trial) {
        console.log('🎁 Trial-periode aktiv - viser hovedapp');
        this.showMainApp();
      } else {
        console.log('💳 Ingen aktiv subscription - viser prisside');
        this.showPricingPage();
      }
    } catch (error) {
      console.error('❌ Subscription check failed:', error);
      // Vis prisside hvis subscription-sjekk feiler
      console.log('⚠️ Feil ved subscription-sjekk - viser prisside');
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

      // Viktig: sørg for at appen faktisk blir synlig og får layout (noen miljøer kan "henge" på opacity/anim)
      mainApp.style.opacity = '1';
      mainApp.style.visibility = 'visible';
      mainApp.style.pointerEvents = 'auto';
    }

    // Start appen
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

  getUserEmail() {
    return this.currentUser?.email || null;
  }

  getUserId() {
    return this.currentUser?.id || null;
  }
}

// Opprett global instans
const authService = new AuthService();

// Initialiser når DOM er klar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM ready - initialiserer auth');
    authService.init();
  });
} else {
  console.log('📄 DOM allerede ready - initialiserer auth');
  authService.init();
}