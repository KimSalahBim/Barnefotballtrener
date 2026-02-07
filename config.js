// Barnefotballtrener - Konfigurasjon
// ================================================
// VIKTIG: Fyll inn dine egne nøkler fra Supabase og Stripe
// ================================================

const CONFIG = {
  // Supabase
  supabase: {
    url: 'https://jxteosjxgrblasksfeyu.supabase.co', // Hent fra Supabase Dashboard -> Project Settings -> API
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4dGVvc2p4Z3JibGFza3NmZXl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxOTE1ODMsImV4cCI6MjA4NDc2NzU4M30.4VhLfxcX0PCkUeK9aYrTrfmTwESH9zOyx4sY61lIZ9w' // Hent fra samme sted
  },

  // Stripe
  stripe: {
    publishableKey: 'pk_test_51SssHuD5NzOLeQriVmf4JpQl1R6oXiK2BGjlYt5SQHwCfmRp6K5bW0o2tiJs4BeWBvsC8NQeUMZKjlCr9ZwvAmA900ktL0vICe' // Hent fra Stripe Dashboard
  },

  // Prisplaner (Stripe Price IDs)
  prices: {
    month: {
      id: 'price_1SylYMD5NzOLeQrictXE2x6X',
      amount: 49,
      currency: 'NOK',
      interval: 'month',
      name: 'Månedlig',
      description: '49 kr per måned'
    },
    year: {
      id: 'price_1SylZ1D5NzOLeQriR9j3zVLb',
      amount: 299,
      currency: 'NOK',
      interval: 'year',
      name: 'Årlig',
      description: '299 kr per år (spar 49%)'
    },
    lifetime: {
      id: 'price_1SylZsD5NzOLeQriqp3g2j7t',
      amount: 799,
      currency: 'NOK',
      interval: 'one_time',
      name: 'Livstid',
      description: '799 kr - betal én gang'
    }
  },

  // Team og Klubb priser (håndteres manuelt via kontaktskjema)
  teamPricing: {
    team: {
      minQuantity: 3,
      maxQuantity: 9,
      pricePerPerson: 479, // 20% rabatt
      discount: 0.20
    },
    club: {
      minQuantity: 10,
      lifetime: 401, // 33% rabatt
      yearly: 133, // 33% rabatt
      discount: 0.33
    }
  },

  // Trial periode
  trial: {
    days: 7,
    enabled: true
  },

  // App innstillinger
  app: {
    name: 'Barnefotballtrener',
    domain: 'barnefotballtrener.no',
    supportEmail: 'support@barnefotballtrener.no',
    sessionDuration: 12 // timer før auto-logout
  }
};

// Expose CONFIG globally (Stripe/subscription.js expects this)
window.CONFIG = CONFIG;

// Eksporter config
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
