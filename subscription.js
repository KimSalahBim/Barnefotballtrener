// Barnefotballtrener - Abonnementshåndtering
// ================================================

class SubscriptionService {
  constructor() {
    this.stripe = null;
    this.initialized = false;
  }

  // Initialiser Stripe
  async init() {
    if (this.initialized) return;

    // Last inn Stripe
    if (!window.Stripe) {
      await this.loadStripeScript();
    }

    this.stripe = window.Stripe(CONFIG.stripe.publishableKey);
    this.initialized = true;
  }

  // Last inn Stripe script
  loadStripeScript() {
    return new Promise((resolve, reject) => {
      if (window.Stripe) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Sjekk abonnementsstatus for bruker
  async checkSubscription(userId) {
    try {
      if (!authService.supabase) {
        throw new Error('Supabase not initialized');
      }

      // Hent fra subscriptions-tabellen
      const { data, error } = await authService.supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        throw error;
      }

      // Hvis ingen subscription, sjekk om trial er tilgjengelig
      if (!data) {
        return {
          active: false,
          trial: false,
          canStartTrial: true,
          plan: null
        };
      }

      const now = new Date();
      const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
      const trialEndsAt = data.trial_ends_at ? new Date(data.trial_ends_at) : null;

      // Sjekk om trial er aktiv
      if (data.status === 'trialing' && trialEndsAt && trialEndsAt > now) {
        return {
          active: false,
          trial: true,
          trialEndsAt: trialEndsAt,
          canStartTrial: false,
          plan: data.plan_type,
          daysLeft: Math.ceil((trialEndsAt - now) / (1000 * 60 * 60 * 24))
        };
      }

      // Sjekk om abonnement er aktivt
      const isActive = data.status === 'active' && (!expiresAt || expiresAt > now);

      return {
        active: isActive,
        trial: false,
        canStartTrial: false,
        plan: data.plan_type,
        expiresAt: expiresAt,
        status: data.status
      };

    } catch (error) {
      console.error('Error checking subscription:', error);
      return {
        active: false,
        trial: false,
        canStartTrial: true,
        error: error.message
      };
    }
  }

  // Start trial
  async startTrial(userId, planType) {
    try {
      if (!authService.supabase) {
        throw new Error('Supabase not initialized');
      }

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + CONFIG.trial.days);

      const { data, error } = await authService.supabase
        .from('subscriptions')
        .insert([
          {
            user_id: userId,
            status: 'trialing',
            plan_type: planType,
            trial_ends_at: trialEndsAt.toISOString(),
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (error) throw error;

      return { success: true, data };
    } catch (error) {
      console.error('Error starting trial:', error);
      return { success: false, error: error.message };
    }
  }

  // Opprett Stripe Checkout-sesjon
  async createCheckoutSession(priceId, userId, email) {
    try {
      // Dette må kalles via din backend/edge function
      // For nå viser vi bare hvordan det skal settes opp
      
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId,
          userId,
          email,
          successUrl: `${window.location.origin}/?success=true`,
          cancelUrl: `${window.location.origin}/?canceled=true`
        })
      });

      const session = await response.json();
      
      // Redirect til Stripe Checkout
      const result = await this.stripe.redirectToCheckout({
        sessionId: session.id
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return { success: true };
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return { success: false, error: error.message };
    }
  }

  // Håndter vellyket betaling
  async handleSuccessfulPayment(sessionId) {
    try {
      // Hent session-detaljer
      const response = await fetch(`/api/checkout-session?session_id=${sessionId}`);
      const session = await response.json();

      // Oppdater subscription i database
      const userId = authService.getUserId();
      if (!userId) throw new Error('User not authenticated');

      const { error } = await authService.supabase
        .from('subscriptions')
        .upsert([
          {
            user_id: userId,
            status: 'active',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan_type: session.metadata.plan_type,
            expires_at: session.metadata.expires_at,
            updated_at: new Date().toISOString()
          }
        ]);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error handling payment:', error);
      return { success: false, error: error.message };
    }
  }

  // Formater pris
  formatPrice(amount, currency = 'NOK') {
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency',
      currency: currency
    }).format(amount);
  }

  // Beregn besparelse
  calculateSavings(monthlyPrice, yearlyPrice) {
    const yearlyMonthly = yearlyPrice / 12;
    const savings = ((monthlyPrice - yearlyMonthly) / monthlyPrice) * 100;
    return Math.round(savings);
  }
}

// Opprett global instans
const subscriptionService = new SubscriptionService();

// Initialiser når DOM er klar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => subscriptionService.init());
} else {
  subscriptionService.init();
}
