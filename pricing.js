// Barnefotballtrener - Pricing Page Logic
// ================================================

// Håndter prisvalg
document.addEventListener('DOMContentLoaded', () => {
  // Bind klikk på alle "Velg"-knapper
  const selectButtons = document.querySelectorAll('.btn-select');
  selectButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const planType = btn.getAttribute('data-plan');
      const priceId = btn.getAttribute('data-price-id');
      
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
    const user = authService.getUser();
    
    if (!user) {
      showNotification('Du må være logget inn først', 'error');
      authService.showLoginScreen();
      return;
    }

    // Sjekk om bruker kan starte trial
    const subscription = await subscriptionService.checkSubscription(user.id);
    
    if (subscription.canStartTrial && CONFIG.trial.enabled) {
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
      // Gå direkte til betaling
      await startCheckout(priceId, user);
    }
  } catch (error) {
    console.error('Error handling plan selection:', error);
    showNotification('En feil oppstod. Prøv igjen senere.', 'error');
  }
}

// Start Stripe Checkout
async function startCheckout(priceId, user) {
  try {
    showNotification('Videresender til betaling...', 'info');
    
    const result = await subscriptionService.createCheckoutSession(
      priceId,
      user.id,
      user.email
    );
    
    if (!result.success) {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Checkout error:', error);
    showNotification('Kunne ikke starte betalingsprosessen. Prøv igjen.', 'error');
  }
}

// Håndter vellykket betaling
async function handleSuccessfulPayment() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');
  
  if (!sessionId) {
    showNotification('Betaling fullført! 🎉', 'success');
    setTimeout(() => {
      authService.showMainApp();
    }, 2000);
    return;
  }

  try {
    const result = await subscriptionService.handleSuccessfulPayment(sessionId);
    
    if (result.success) {
      showNotification('Betaling fullført! Velkommen! 🎉', 'success');
      setTimeout(() => {
        authService.showMainApp();
      }, 2000);
    } else {
      showNotification('Kunne ikke bekrefte betalingen. Kontakt support.', 'error');
    }
  } catch (error) {
    console.error('Payment confirmation error:', error);
    showNotification('En feil oppstod. Kontakt support.', 'error');
  }
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
      quantity: formData.get('quantity'),
      message: formData.get('message'),
      timestamp: new Date().toISOString()
    };

    // Send til din backend/database
    // For nå: logg og vis melding
    console.log('Team contact:', data);
    
    showNotification('Takk! Vi kontakter deg snart.', 'success');
    closeTeamContactForm();
    
    // Reset form
    document.getElementById('teamContactForm').reset();

    // I produksjon: send til Supabase eller email-service
    // await sendContactRequest(data);
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
      clubName: formData.get('clubName'),
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      quantity: formData.get('quantity'),
      planType: formData.get('planType'),
      message: formData.get('message'),
      timestamp: new Date().toISOString()
    };

    console.log('Club contact:', data);
    
    showNotification('Takk! Vi sender deg et tilbud snart.', 'success');
    closeClubContactForm();
    
    // Reset form
    document.getElementById('clubContactForm').reset();

    // I produksjon: send til Supabase eller email-service
    // await sendContactRequest(data);
  } catch (error) {
    console.error('Club contact error:', error);
    showNotification('Kunne ikke sende forespørsel. Prøv igjen.', 'error');
  }
}

// Hjelpefunksjon for notifikasjoner
function showNotification(message, type = 'info') {
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
    animation: slideInRight 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease';
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
