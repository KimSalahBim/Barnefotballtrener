// Barnefotballtrener - Pricing Page Logic
// ================================================

// Håndter prisvalg
document.addEventListener('DOMContentLoaded', () => {
  console.log('💳 Pricing page loaded');

  // Bind klikk på alle "Velg"-knapper
  const selectButtons = document.querySelectorAll('.btn-select');
  console.log(`Found ${selectButtons.length} select buttons`);

  selectButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const planType = btn.getAttribute('data-plan');       // "month" | "year" | "lifetime"
      const priceId = btn.getAttribute('data-price-id');    // kan være satt i HTML, men server styrer uansett
      console.log(`Button clicked: ${planType}, priceId: ${priceId}`);
      await handlePlanSelection(planType, priceId);
    });
  });

  // Sjekk om vi kommer tilbake fra Stripe
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('success') === 'true') {
    handleSuccessfulPayment();
  } else if (urlParams.get('canceled') === 'true') {
    showNotification('Betaling avbrutt. Du kan prøve igjen når som helst.', 'info');
  }
});

// Håndter planvalg
async function handlePlanSelection(planType, priceId) {
  try {
    console.log('🔍 Handling plan selection:', planType);

    const user = authService.getUser();

    if (!user) {
      console.log('❌ No user found');
      showNotification('Du må være logget inn først', 'error');
      authService.showLoginScreen();
      return;
    }

    console.log('✅ User found:', user.email);

    // Sjekk om bruker kan starte trial
    const subscription = await subscriptionService.checkSubscription(user.id);
    console.log('📊 Subscription status:', subscription);

    if (subscription.canStartTrial && CONFIG.trial.enabled) {
      console.log('🎁 Starting trial...');
      // Start trial
      const result = await subscriptionService.startTrial(user.id, planType);

      if (result.success) {
        showNotification(`Gratulerer! Din ${CONFIG.trial.days}-dagers prøveperiode har startet! 🎉`, 'success');
        setTimeout(() => {
          authService.showMainApp();
        }, 2000);
      } else {
        showNotification('Noe gikk galt. Prøv igjen.', 'error');
      }
    } else {
      console.log('💳 Going to payment...');
      // Gå direkte til betaling (via backend)
      await startCheckout(planType, priceId, user);
    }
  } catch (error) {
    console.error('❌ Error handling plan selection:', error);
    showNotification('En feil oppstod. Prøv igjen senere.', 'error');
  }
}

// Hent access token på en robust måte (støtter ulike auth.js-varianter)
async function getAccessToken() {
  // 1) Foretrukket: getSessionWithRetry()
  try {
    if (window.AuthService?.getSessionWithRetry) {
      const s = await window.AuthService.getSessionWithRetry();
      if (s?.access_token) return s.access_token;
    }
  } catch (_) {}

  try {
    if (window.authService?.getSessionWithRetry) {
      const s = await window.authService.getSessionWithRetry();
      if (s?.access_token) return s.access_token;
    }
  } catch (_) {}

  // 2) Fallback: supabase.auth.getSession()
  try {
    const sb = window.supabase;
    if (sb?.auth?.getSession) {
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (token) return token;
    }
  } catch (_) {}

  return null;
}

// Start Stripe Checkout (via backend /api/create-checkout-session)
async function startCheckout(planType, priceId, user) {
  try {
    console.log('💳 Starting checkout for:', planType);
    showNotification('Videresender til betaling...', 'info');

    // Initialiser Stripe (frontend)
    await subscriptionService.init();

    if (!subscriptionService.stripe) {
      throw new Error('Stripe not initialized');
    }

    // Må ha token for å kunne lage checkout session på server
    const token = await getAccessToken();
    if (!token) {
      showNotification('Du må være logget inn først', 'error');
      authService.showLoginScreen();
      return;
    }

    // Lag Checkout Session på server (server bestemmer priceId via env vars)
    const resp = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ planType })
    });

    let data = {};
    try {
      data = await resp.json();
    } catch (_) {}

    if (!resp.ok || !data?.sessionId) {
      console.error('Checkout session error:', data);
      throw new Error(data?.error || 'Kunne ikke starte betalingsprosessen');
    }

    // Redirect til Stripe Checkout med sessionId
    const { error } = await subscriptionService.stripe.redirectToCheckout({
      sessionId: data.sessionId
    });

    if (error) throw error;
  } catch (error) {
    console.error('❌ Checkout error:', error);
    showNotification(`Kunne ikke starte betalingsprosessen: ${error.message}`, 'error');
  }
}

// Håndter vellykket betaling
async function handleSuccessfulPayment() {
  console.log('✅ Handling successful payment');

  showNotification('Betaling fullført! Velkommen! 🎉', 'success');

  // Vent litt før vi redirecter
  setTimeout(() => {
    // Fjern query params fra URL
    window.history.replaceState({}, document.title, window.location.pathname);

    // Gå til hovedapp
    authService.showMainApp();
  }, 2000);
}

// Vis team kontaktskjema
function showTeamContactForm() {
  const modal = document.getElementById('teamContactModal');
  if (modal) modal.style.display = 'flex';
}

// Lukk team kontaktskjema
function closeTeamContactForm() {
  const modal = document.getElementById('teamContactModal');
  if (modal) modal.style.display = 'none';
}

// Vis klubb kontaktskjema
function showClubContactForm() {
  const modal = document.getElementById('clubContactModal');
  if (modal) modal.style.display = 'flex';
}

// Lukk klubb kontaktskjema
function closeClubContactForm() {
  const modal = document.getElementById('clubContactModal');
  if (modal) modal.style.display = 'none';
}

// Håndter team kontaktskjema
document.addEventListener('DOMContentLoaded', () => {
  const teamForm = document.getElementById('teamContactForm');
  if (teamForm) {
    teamForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleTeamContact(new FormData(teamForm));
    });
  }

  const clubForm = document.getElementById('clubContactForm');
  if (clubForm) {
    clubForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleClubContact(new FormData(clubForm));
    });
  }
});

// Håndter team kontakt
async function handleTeamContact(formData) {
  try {
    const data = {
      type: 'team',
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      quantity: parseInt(formData.get('quantity')),
      message: formData.get('message'),
      created_at: new Date().toISOString()
    };

    console.log('Team contact:', data);

    // Send til Supabase
    if (authService.supabase) {
      const { error } = await authService.supabase
        .from('contact_requests')
        .insert([data]);

      if (error) throw error;
    }

    showNotification('Takk! Vi kontakter deg snart.', 'success');
    closeTeamContactForm();

    // Reset form
    document.getElementById('teamContactForm').reset();
  } catch (error) {
    console.error('Team contact error:', error);
    showNotification('Kunne ikke sende forespørsel. Prøv igjen.', 'error');
  }
}

// Håndter klubb kontakt
async function handleClubContact(formData) {
  try {
    const data = {
      type: 'club',
      club_name: formData.get('clubName'),
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      quantity: parseInt(formData.get('quantity')),
      plan_type: formData.get('planType'),
      message: formData.get('message'),
      created_at: new Date().toISOString()
    };

    console.log('Club contact:', data);

    // Send til Supabase
    if (authService.supabase) {
      const { error } = await authService.supabase
        .from('contact_requests')
        .insert([data]);

      if (error) throw error;
    }

    showNotification('Takk! Vi sender deg et tilbud snart.', 'success');
    closeClubContactForm();

    // Reset form
    document.getElementById('clubContactForm').reset();
  } catch (error) {
    console.error('Club contact error:', error);
    showNotification('Kunne ikke sende forespørsel. Prøv igjen.', 'error');
  }
}

// Hjelpefunksjon for notifikasjoner
function showNotification(message, type = 'info') {
  console.log(`📢 Notification: ${message} (${type})`);

  // Bruk eksisterende notification-system hvis tilgjengelig
  if (typeof window.showNotification === 'function') {
    window.showNotification(message, type);
    return;
  }

  // Ellers: enkel fallback
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 25px;
    border-radius: 12px;
    background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6'};
    color: white;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Lukk modal ved klikk utenfor
window.addEventListener('click', (e) => {
  const teamModal = document.getElementById('teamContactModal');
  const clubModal = document.getElementById('clubContactModal');

  if (e.target === teamModal) {
    closeTeamContactForm();
  }
  if (e.target === clubModal) {
    closeClubContactForm();
  }
});
