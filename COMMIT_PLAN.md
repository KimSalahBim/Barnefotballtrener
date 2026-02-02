# Layout/UX improvements — safe implementation plan (3 commits)

This patch set is designed to improve layout stability and remove known UI errors WITHOUT touching Stripe/Supabase flows.

## Commit A — DOM correctness + core UI styling (P0/P1)
Overwrite:
- index.html
Add:
- core-ui.css

Why:
- Fixes two extra </div> that cause the browser to auto-repair the DOM, which can push #liga outside #mainApp.
- Adds core-ui.css (scoped to #mainApp) for JS-generated UI components.

Quick tests:
- Open app, login, verify you cannot scroll from login into app.
- In DevTools console:
  document.querySelector('#mainApp #liga') !== null  // should be true
- Switch tabs quickly; layout should be stable.

## Commit B — Auth CSS scoping (P1)
Overwrite:
- auth-styles.css

Why:
- Prevents generic auth styles (.small-text, .btn-secondary, .error-message) from affecting non-login parts of the app.

Quick tests:
- Login page looks the same.
- Pricing/subscription modal buttons and small texts still look correct.

## Commit C — Contact modals reliability + modal CSS (P0)
Overwrite:
- pricing.css
- pricing.js

Why:
- Makes .modal hidden by default and visible via .modal-visible (robust).
- Implements missing global functions referenced by inline onclick handlers:
  showTeamContactForm/closeTeamContactForm
  showClubContactForm/closeClubContactForm
- Privacy-safe: NO logging of form fields.
- Submission action opens a mail draft to support email (and tries to copy content).

Quick tests:
- Open Team/Club contact modal from pricing page.
- Close with X, click outside, and ESC.
- Submit: should open email draft and show alert; modal closes and form resets.

Notes:
- This does NOT change any playing-time calculations (core.js), nor Stripe logic.
