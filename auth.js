// Barnefotballtrener - Autentisering (Supabase)
// ================================================

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
    this.supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
    
    console.log('✅ Supabase client opprettet');

    // Håndter OAuth callback først
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get('access_token')) {
      console.log('🔑 OAuth callback detektert - behandler...');
    }

    // Sjekk session
    const { data: { session }, error } = await this.supabase.auth.getSession();
    
    if (error) {
      console.error('❌ Session error:', error);
    }
    
    if (session) {
      console.log('✅ Bruker allerede logget inn:', session.user.email);
      this.currentUser = session.user;
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
      // Last inn pricing.html hvis det ikke er lastet
      this.loadPricingPage();
    }
  }

  // Last inn pricing.html innhold
  async loadPricingPage() {
    const pricingPage = document.getElementById('pricingPage');
    if (!pricingPage || pricingPage.innerHTML.trim().length > 0) return;

    try {
      console.log('📄 Laster pricing.html...');
      const response = await fetch('pricing.html');
      const html = await response.text();
      pricingPage.innerHTML = html;
      
      // Initialiser pricing hvis scriptet finnes
      if (typeof initPricing === 'function') {
        console.log('💳 Initialiserer pricing');
        initPricing();
      }
    } catch (error) {
      console.error('❌ Kunne ikke laste pricing.html:', error);
      pricingPage.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <h2>Velg abonnement</h2>
          <p>Vennligst velg et abonnement for å fortsette.</p>
        </div>
      `;
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
