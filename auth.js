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

    // Last inn Supabase fra CDN
    if (!window.supabase) {
      await this.loadSupabaseScript();
    }

    const { createClient } = window.supabase;
    this.supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
    
    // Sjekk om bruker allerede er logget inn
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session) {
      this.currentUser = session.user;
    }

    // Lytt til auth state endringer
    this.supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event);
      this.currentUser = session?.user || null;
      
      if (event === 'SIGNED_IN') {
        this.handleSignIn(session.user);
      } else if (event === 'SIGNED_OUT') {
        this.handleSignOut();
      }
    });

    this.initialized = true;
  }

  // Last inn Supabase script
  loadSupabaseScript() {
    return new Promise((resolve, reject) => {
      if (window.supabase) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Logg inn med Google
  async signInWithGoogle() {
    try {
      const { data, error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Google sign-in error:', error);
      return { success: false, error: error.message };
    }
  }

  // Logg ut
  async signOut() {
    try {
      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Sign out error:', error);
      return { success: false, error: error.message };
    }
  }

  // Håndter innlogging
  async handleSignIn(user) {
    this.currentUser = user;
    
    // Sjekk om bruker har et aktivt abonnement
    const subscription = await subscriptionService.checkSubscription(user.id);
    
    if (subscription.active || subscription.trial) {
      // Bruker har tilgang
      this.showMainApp();
    } else {
      // Vis prisside
      this.showPricingPage();
    }
  }

  // Håndter utlogging
  handleSignOut() {
    this.currentUser = null;
    localStorage.removeItem('fotballLoggedIn');
    localStorage.removeItem('fotballLoginTime');
    this.showLoginScreen();
  }

  // Vis innloggingsskjerm
  showLoginScreen() {
    const passwordProtection = document.getElementById('passwordProtection');
    const mainApp = document.getElementById('mainApp');
    const pricingPage = document.getElementById('pricingPage');
    
    if (passwordProtection) passwordProtection.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';
    if (pricingPage) pricingPage.style.display = 'none';
  }

  // Vis hovedapp
  showMainApp() {
    const passwordProtection = document.getElementById('passwordProtection');
    const mainApp = document.getElementById('mainApp');
    const pricingPage = document.getElementById('pricingPage');
    
    if (passwordProtection) passwordProtection.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';
    if (pricingPage) pricingPage.style.display = 'none';

    // Initialiser appen hvis ikke allerede gjort
    if (typeof initApp === 'function' && !window.appInitialized) {
      initApp();
    }
  }

  // Vis prisside
  showPricingPage() {
    const passwordProtection = document.getElementById('passwordProtection');
    const mainApp = document.getElementById('mainApp');
    const pricingPage = document.getElementById('pricingPage');
    
    if (passwordProtection) passwordProtection.style.display = 'none';
    if (mainApp) mainApp.style.display = 'none';
    if (pricingPage) pricingPage.style.display = 'flex';
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
  document.addEventListener('DOMContentLoaded', () => authService.init());
} else {
  authService.init();
}
