// Barnefotballtrener - Autentisering (Supabase)
// ================================================

// Noen nettlesere/enheter kan kaste AbortError fra interne Supabase-auth operasjoner (f.eks. Web Locks/fetch som avbrytes).
// Vi vil ikke la det ta ned hele appen.
if (!window.__bf_aborterror_guard) {
  window.__bf_aborterror_guard = true;
  window.addEventListener('unhandledrejection', (event) => {
    const r = event.reason;
    if (r && (r.name === 'AbortError' || /aborted/i.test(String(r.message)))) {
      console.warn('ℹ️ Ignorerer ufanget AbortError fra underliggende bibliotek:', r);
      event.preventDefault();
    }
  });
}

class AuthService {
  constructor() {
    this.supabase = null;
    this.currentUser = null;
    this.initialized = false;
  }

  // Initialiser Supabase
  async init() {
    if (this.initialized) return;

    console.log('🔐 Initialiserer AuthService...');

    // Last inn Supabase fra CDN
    if (!window.supabase) {
      await this.loadSupabaseScript();
    }

    const { createClient } = window.supabase;
    // Robust storage: fall back to in-memory if localStorage is blocked (Tracking Prevention / private mode)
const _memoryStore = {};
const memoryStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_memoryStore, k) ? _memoryStore[k] : null),
  setItem: (k, v) => { _memoryStore[k] = String(v); },
  removeItem: (k) => { delete _memoryStore[k]; }
};
const safeStorage = {
  getItem(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return memoryStorage.getItem(key); }
  },
  setItem(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { memoryStorage.setItem(key, value); }
  },
  removeItem(key) {
    try { window.localStorage.removeItem(key); } catch (e) { memoryStorage.removeItem(key); }
  }
};

this.supabase = createClient(
  CONFIG.supabase.url,
  CONFIG.supabase.anonKey,
  {
    auth: {
      // Workaround for Supabase Auth lock-related hangs/aborts in some browsers/devices.
      // By providing a no-op lock, we bypass Web Locks API usage.
      lock: async (name, acquireTimeout, fn) => {
        return await fn();
      },
      storage: safeStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
console.log('✅ Supabase client opprettet');

    // Håndter OAuth callback først
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get('access_token')) {
      console.log('🔑 OAuth callback detektert - behandler...');
    }

    // Sjekk session (med retry hvis nettleseren avbryter fetch under OAuth-callback)
let session = null;
let error = null;

try {
  const res = await this.supabase.auth.getSession();
  session = res?.data?.session ?? null;
  error = res?.error ?? null;
} catch (e) {
  console.error('❌ getSession kastet feil:', e);
  // Edge/Safari kan avbryte første kall under redirect/callback (AbortError).
  if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message)))) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const res2 = await this.supabase.auth.getSession();
      session = res2?.data?.session ?? null;
      error = res2?.error ?? null;
    } catch (e2) {
      console.error('❌ getSession retry feilet:', e2);
      error = e2;
    }
  } else {
    error = e;
  }
}
if (error) {
      console.error('❌ Session error:', error);
    }
    
    if (session) {
      console.log('✅ Bruker allerede logget inn:', session.user.email);
      this.currentUser = session.user;
      // Rydd opp i URL-hash etter OAuth (hindrer at callback behandles på nytt ved refresh)
      try {
        const h = window.location.hash || '';
        if (h.includes('access_token') || h.includes('refresh_token') || h.includes('type=recovery')) {
          history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
      } catch (e) {}
      await this.handleSignIn(session.user);
    } else {
      console.log('ℹ️ Ingen aktiv session');
      this.showLoginScreen();
    }

    // Lytt til auth state endringer
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔄 Auth state changed:', event);
      
      if (event === 'SIGNED_IN' && session) {
        console.log('✅ Bruker logget inn:', session.user.email);
        this.currentUser = session.user;
        await this.handleSignIn(session.user);
      } else if (event === 'SIGNED_OUT') {
        console.log('👋 Bruker logget ut');
        this.currentUser = null;
        this.handleSignOut();
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('🔄 Token refreshed');
        this.currentUser = session?.user || null;
      } else if (event === 'USER_UPDATED') {
        console.log('👤 User updated');
        this.currentUser = session?.user || null;
      }
    });

    this.initialized = true;
    console.log('✅ AuthService initialisert');
  }

  // Last inn Supabase script
  loadSupabaseScript() {
    return new Promise((resolve, reject) => {
      if (window.supabase) {
        resolve();
        return;
      }

      console.log('📦 Laster Supabase script...');
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = () => {
        console.log('✅ Supabase script lastet');
        resolve();
      };
      script.onerror = (err) => {
        console.error('❌ Kunne ikke laste Supabase script:', err);
        reject(err);
      };
      document.head.appendChild(script);
    });
  }

  // Logg inn med Google
  async signInWithGoogle() {
    try {
      console.log('🔐 Starter Google sign-in...');
      
      const { data, error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });

      if (error) {
        console.error('❌ Google sign-in error:', error);
        throw error;
      }

      console.log('✅ Google sign-in startet (redirecter...)');
      return { success: true };
    } catch (error) {
      console.error('❌ Google sign-in failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Logg ut
  async signOut() {
    try {
      console.log('👋 Logger ut...');
      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;
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

  // Håndter utlogging
  handleSignOut() {
    this.currentUser = null;
    localStorage.removeItem('fotballLoggedIn');
    localStorage.removeItem('fotballLoginTime');
    console.log('🔓 Viser innloggingsskjerm');
    this.showLoginScreen();
  }

  // Vis innloggingsskjerm
  showLoginScreen() {
    console.log('📱 Viser login screen');
    const passwordProtection = document.getElementById('passwordProtection');
    const mainApp = document.getElementById('mainApp');
    const pricingPage = document.getElementById('pricingPage');
    
    if (passwordProtection) passwordProtection.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';
    if (pricingPage) pricingPage.style.display = 'none';
  }

  // Vis hovedapp
  showMainApp() {
    console.log('📱 Viser hovedapp');
    const passwordProtection = document.getElementById('passwordProtection');
    const mainApp = document.getElementById('mainApp');
    const pricingPage = document.getElementById('pricingPage');
    
    if (passwordProtection) passwordProtection.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';
    if (pricingPage) pricingPage.style.display = 'none';

    // Initialiser appen hvis ikke allerede gjort
    if (typeof initApp === 'function' && !window.appInitialized) {
      console.log('🚀 Initialiserer app');
      initApp();
    }
  }

  // Vis prisside
  showPricingPage() {
    console.log('💳 Viser prisside');
    const passwordProtection = document.getElementById('passwordProtection');
    const mainApp = document.getElementById('mainApp');
    const pricingPage = document.getElementById('pricingPage');
    
    if (passwordProtection) passwordProtection.style.display = 'none';
    if (mainApp) mainApp.style.display = 'none';
    if (pricingPage) {
      pricingPage.style.display = 'block';
      
      // Initialiser pricing knapper
      setTimeout(() => {
        this.initPricingButtons();
      }, 100);
    }
  }

  // Initialiser pricing-knapper
  initPricingButtons() {
    console.log('💳 Initialiserer pricing buttons');
    
    const selectButtons = document.querySelectorAll('.btn-select');
    console.log(`Fant ${selectButtons.length} knapper`);
    
    if (selectButtons.length === 0) {
      console.warn('⚠️ Ingen pricing-knapper funnet!');
      return;
    }
    
    selectButtons.forEach(btn => {
      // Fjern gamle event listeners
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const planType = newBtn.getAttribute('data-plan');
        const priceId = newBtn.getAttribute('data-price-id');
        
        console.log(`✨ Knapp klikket: ${planType}, priceId: ${priceId}`);
        await this.handlePlanSelection(planType, priceId);
      });
    });
    
    console.log('✅ Pricing buttons initialisert');
  }

  // Håndter planvalg
  async handlePlanSelection(planType, priceId) {
    try {
      console.log('🔍 Håndterer planvalg:', planType);
      
      const user = this.getUser();
      
      if (!user) {
        console.log('❌ Ingen bruker');
        alert('Du må være logget inn først');
        this.showLoginScreen();
        return;
      }

      console.log('✅ Bruker funnet:', user.email);

      // Sjekk subscription
      const subscription = await subscriptionService.checkSubscription(user.id);
      console.log('📊 Subscription:', subscription);
      
      if (subscription.canStartTrial && CONFIG.trial.enabled) {
        console.log('🎁 Starter trial...');
        const result = await subscriptionService.startTrial(user.id, planType);
        
        if (result.success) {
          alert(`Gratulerer! Din ${CONFIG.trial.days}-dagers prøveperiode har startet! 🎉`);
          setTimeout(() => {
            this.showMainApp();
          }, 1000);
        } else {
          alert('Noe gikk galt. Prøv igjen.');
        }
      } else {
        console.log('💳 Går til betaling...');
        await this.startCheckout(planType, priceId, user);
      }
    } catch (error) {
      console.error('❌ Feil:', error);
      alert('En feil oppstod. Prøv igjen senere.');
    }
  }

  // Start checkout
  async startCheckout(planType, priceId, user) {
    try {
      console.log('💳 Starter checkout:', planType);
      alert('Videresender til betaling...');
      
      await subscriptionService.init();
      
      if (!subscriptionService.stripe) {
        throw new Error('Stripe not initialized');
      }

      const actualPriceId = CONFIG.prices[planType]?.id || priceId;
      console.log('Price ID:', actualPriceId);

      if (!actualPriceId) {
        throw new Error('Invalid price ID');
      }

      const { error } = await subscriptionService.stripe.redirectToCheckout({
        lineItems: [{
          price: actualPriceId,
          quantity: 1,
        }],
        mode: planType === 'lifetime' ? 'payment' : 'subscription',
        successUrl: `${window.location.origin}/?success=true`,
        cancelUrl: `${window.location.origin}/?canceled=true`,
        customerEmail: user.email,
        clientReferenceId: user.id,
        metadata: {
          user_id: user.id,
          plan_type: planType
        }
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('❌ Checkout error:', error);
      alert(`Kunne ikke starte betaling: ${error.message}`);
    }
  }

  // Er bruker logget inn?
  isAuthenticated() {
    return !!this.currentUser;
  }

  // Hent nåværende bruker
  getUser() {
    return this.currentUser;
  }

  // Hent bruker-ID
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
