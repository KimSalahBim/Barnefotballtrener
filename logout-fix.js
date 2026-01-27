function bindLogoutBtn() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  if (btn.__bf_bound_logout) return;
  btn.__bf_bound_logout = true;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();

    const a = window.authService;
    if (!a || !a.supabase) {
      alert('Auth er ikke klar ennå.');
      return;
    }

    await a.supabase.auth.signOut();
    location.reload();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindLogoutBtn);
} else {
  bindLogoutBtn();
}
