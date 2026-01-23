// Barnefotballtrener - Auth UI Handler
// ================================================
// Håndterer UI for innlogging, logout og subscription status

(function() {
  'use strict';

  // Vent til DOM og auth er klar
  document.addEventListener('DOMContentLoaded', initAuthUI);

  async function initAuthUI() {
    // Vent litt på at auth service er initialisert
    await new Promise(resolve => setTimeout(resolve, 100));

    setupGoogleSignIn();
    setupLegacyLogin();
    setupLogout();
    setupSubscriptionBadge();
  }

  // Google Sign In
  function setupGoogleSignIn() {
    const btn = document.getElementById('googleSignInBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logger inn...';

      try {
        const result = await authService.signInWithGoogle();
        
        if (!result.success) {
          throw new Error(result.error || 'Login failed');
        }
      } catch (error) {
        console.error('Google sign in error:', error);
        showNotification('Kunne ikke logge inn med Google. Prøv igjen.', 'error');
        
        // Reset button
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          <span>Fortsett med Google</span>
        `;
      }
    });
  }

  // Legacy Login (gammel passord-metode)
  function setupLegacyLogin() {
    const btn = document.getElementById('legacyLoginBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const pwd = prompt('Skriv passord:');
      if (pwd === '1234') {
        // Simuler innlogging for eksisterende brukere
        localStorage.setItem('fotballLoggedIn', 'true');
        localStorage.setItem('fotballLoginTime', String(Date.now()));
        
        document.getElementById('passwordError').style.display = 'none';
        authService.showMainApp();
        
        if (typeof initApp === 'function' && !window.appInitialized) {
          initApp();
        }
      } else {
        const errorEl = document.getElementById('passwordError');
        if (errorEl) {
          errorEl.textContent = 'Feil passord. Prøv igjen.';
          errorEl.style.display = 'block';
        }
      }
    });
  }

  // Logout
  function setupLogout() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const confirm = window.confirm('Er du sikker på at du vil logge ut?');
      if (!confirm) return;

      try {
        await authService.signOut();
        showNotification('Logget ut', 'info');
      } catch (error) {
        console.error('Logout error:', error);
        showNotification('Kunne ikke logge ut. Prøv igjen.', 'error');
      }
    });
  }

  // Subscription Badge
  async function setupSubscriptionBadge() {
    const badge = document.getElementById('subscriptionBadge');
    const text = document.getElementById('subscriptionText');
    
    if (!badge || !text) return;

    // Sjekk subscription status
    const user = authService.getUser();
    if (!user) {
      badge.style.display = 'none';
      return;
    }

    try {
      const subscription = await subscriptionService.checkSubscription(user.id);
      
      if (subscription.trial) {
        badge.className = 'subscription-badge trial';
        text.textContent = `Trial (${subscription.daysLeft} dager igjen)`;
        badge.style.display = 'flex';
      } else if (subscription.active) {
        badge.className = 'subscription-badge active';
        
        if (subscription.plan === 'lifetime') {
          text.textContent = 'Livstid';
        } else if (subscription.plan === 'year') {
          text.textContent = 'Pro (Årlig)';
        } else {
          text.textContent = 'Pro';
        }
        
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }

      // Gjør badge klikkbar for å vise detaljer
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', () => showSubscriptionDetails(subscription));
      
    } catch (error) {
      console.error('Error loading subscription badge:', error);
      badge.style.display = 'none';
    }
  }

  // Vis subscription detaljer
  function showSubscriptionDetails(subscription) {
    let message = '';
    
    if (subscription.trial) {
      const endDate = new Date(subscription.trialEndsAt).toLocaleDateString('nb-NO');
      message = `Din gratis prøveperiode utløper ${endDate}.\n\nHusk å velge en plan før den tid!`;
    } else if (subscription.active) {
      if (subscription.plan === 'lifetime') {
        message = 'Du har livstidstilgang til Barnefotballtrener! 🎉';
      } else if (subscription.expiresAt) {
        const endDate = new Date(subscription.expiresAt).toLocaleDateString('nb-NO');
        message = `Din ${subscription.plan === 'year' ? 'årlige' : 'månedlige'} plan fornyes automatisk.\n\nNeste fornyelse: ${endDate}`;
      } else {
        message = 'Du har aktiv tilgang til alle funksjoner.';
      }
    } else {
      message = 'Du har ikke et aktivt abonnement.';
    }
    
    alert(message);
  }

  // Notification helper (hvis ikke allerede definert)
  function showNotification(message, type = 'info') {
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return;
    }

    const el = document.getElementById('notification');
    if (!el) return;
    
    el.textContent = message;
    el.className = `notification ${type}`;
    el.style.display = 'block';
    
    setTimeout(() => {
      el.style.display = 'none';
    }, 3000);
  }

})();
