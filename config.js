// Â© 2026 Barnefotballtrener.no. All rights reserved.
// Barnefotballtrener - Konfigurasjon
// ================================================
// Stripe: LIVE nÃ¸kler (test-nÃ¸kler brukes via Vercel Preview)
// Supabase: Offentlig anon key (trygt i frontend)
// ================================================

const CONFIG = {
  // Supabase
  supabase: {
    url: 'https://jxteosjxgrblasksfeyu.supabase.co', // Hent fra Supabase Dashboard -> Project Settings -> API
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4dGVvc2p4Z3JibGFza3NmZXl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxOTE1ODMsImV4cCI6MjA4NDc2NzU4M30.4VhLfxcX0PCkUeK9aYrTrfmTwESH9zOyx4sY61lIZ9w' // Hent fra samme sted
  },

  // Stripe
  stripe: {
    publishableKey: 'pk_live_51SssHjDo19YzWAtS4XOeVVKY0zLN04owzlVmGaIDk79BfZoiRfEUWiLq3oKAlVNDI2an9FEgM2Fy9GyKJFPlLDBy00lvsqWW5d'
  },

  // Prisplaner (Stripe Price IDs)
  prices: {
    month: {
      id: 'price_1SyaHwDo19YzWAtSxSoUyB5Y',
      amount: 49,
      currency: 'NOK',
      interval: 'month',
      name: 'MÃ¥nedlig',
      description: '49 kr per mÃ¥ned'
    },
    year: {
      id: 'price_1SyaIVDo19YzWAtSbKIfLMqn',
      amount: 299,
      currency: 'NOK',
      interval: 'year',
      name: 'Ã…rlig',
      description: '299 kr per Ã¥r (spar 49%)'
    },
    lifetime: {
      id: 'price_1SyaJ2Do19YzWAtS55jH22b9',
      amount: 799,
      currency: 'NOK',
      interval: 'one_time',
      name: 'Livstid',
      description: '799 kr - betal Ã©n gang'
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
    sessionDuration: 12 // timer fÃ¸r auto-logout
  }
};

// Expose CONFIG globally (Stripe/subscription.js expects this)
window.CONFIG = CONFIG;

// Eksporter config
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
