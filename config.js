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
      id: 'price_1SssQbD5NzOLeQrihuah3dHE', // Fyll inn etter du har opprettet produktet i Stripe
      amount: 25,
      currency: 'NOK',
      interval: 'month',
      name: 'Månedlig',
      description: '25 kr per måned'
    },
    year: {
      id: 'price_1SsskZD5NzOLeQri0c4i879y',
      amount: 199,
      currency: 'NOK',
      interval: 'year',
      name: 'Årlig',
      description: '199 kr per år (spar 33%)'
    },
    lifetime: {
      id: 'price_1SssnID5NzOLeQri9vOKcXmO',
      amount: 599,
      currency: 'NOK',
      interval: 'one_time',
      name: 'Livstid',
      description: '599 kr - betal én gang'
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
