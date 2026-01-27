// logout-fix.js — binder logout-knapp robust
(function () {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return console.warn('Fant ikke logoutBtn');

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const sb = window.authService?.supabase;
      if (!sb) return alert('Supabase ikke klar – prøv å oppdatere siden.');
      await sb.auth.signOut();
    } catch (err) {
      console.error('Logout feilet:', err);
      alert('Kunne ikke logge ut.');
    }
  });
})();
