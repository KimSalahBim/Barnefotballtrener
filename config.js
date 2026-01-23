// Barnefotballtrener - Konfigurasjon
// ================================================
// VIKTIG: Fyll inn dine egne nøkler fra Supabase og Stripe
// ================================================

const CONFIG = {
  // Supabase
  supabase: {
    url: 'DIN_SUPABASE_URL_HER', // Hent fra Supabase Dashboard -> Project Settings -> API
    anonKey: 'DIN_SUPABASE_ANON_KEY_HER' // Hent fra samme sted
  },

  // Stripe
  stripe: {
    publishableKey: 'DIN_STRIPE_PUBLISHABLE_KEY_HER' // Hent fra Stripe Dashboard
  },

  // Prisplaner (Stripe Price IDs)
  prices: {
    month: {
      id: 'price_XXXXX', // Fyll inn etter du har opprettet produktet i Stripe
      amount: 25,
      currency: 'NOK',
      interval: 'month',
      name: 'Månedlig',
      description: '25 kr per måned'
    },
    year: {
      id: 'price_XXXXX',
      amount: 199,
      currency: 'NOK',
      interval: 'year',
      name: 'Årlig',
      description: '199 kr per år (spar 33%)'
    },
    lifetime: {
      id: 'price_XXXXX',
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

// Eksporter config
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
