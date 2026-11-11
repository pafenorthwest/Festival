# Browser validation

Validated the actual Vite frontend at `http://127.0.0.1:5175` in Chromium with Python Playwright. Clock fixed at November 7, 2026; festival fixtures span 2026 and 2027. Every `/api/**` request was intercepted and fulfilled by explicit fixture DTOs. No live backend or Shopify writes were made. External requests were blocked except that the Google icon CSS was fulfilled with the official full Material Symbols font cached in `/private/tmp/festival-symbols-full.ttf`.

All four behavior suites passed: **58 assertions, 19 unique screenshots**. A final CSS refresh passed 4 additional visual assertions, for **62 assertions total**.

- `browser-results.json`: 36 assertions, 15 screenshots. Real SPA navigation; local cart add; saved first piece and empty optional next piece; delayed Add input lock; prerequisite removal retains dependent and blocks checkout, restoration recovers; global cart persistence; purchased teacher/edit tooltip/current cutoff/read-only past cutoff; existing PATCH fields; held PATCH blocks navigation/signout without logout; dirty form cancel/discard/signout cancel; separate waitlist contact consent; multiple performers/classes; concerto catalog ID; idempotent checkout retries; successful checkout handoff without a beforeunload dialog. No browser JavaScript errors and no unhandled API routes.
- `browser-edge-results.json`: 3 assertions, 1 screenshot. Empty-performer redirect, child creation through existing contract, Continue Registration restores festival and auto-selects sole child.
- `browser-state-results.json`: 11 assertions, 2 screenshots. Total-duration validation retains first piece; capacity loss/recovery; changed CSRF identity and resolved unauthenticated session clear cart/context; normal SPA session reload preserves cart/context; browser reload clears memory-only cart.
- `browser-responsive-results.json`: 8 assertions, 1 screenshot. Full sidebar at 1101px, manual collapse/expand, rail at 1100px and 761px, hamburger at 760px, menu closes after navigation, 390px no overflow.

- `browser-visual-refresh-results.json`: 4 assertions after final CSS polish. Refreshed registration, class, and My Registrations mobile screenshots. All have no horizontal overflow; the 390px header keeps brand and controls on one row with measured height 70px.

Fixtures/scripts are saved alongside the results for inspection. These are historical validation fixtures, not a turnkey repository test suite: adapt the hardcoded `ROOT` workspace path and provide the full Material Symbols font cache at `/private/tmp/festival-symbols-full.ttf` before rerunning. The scripts were run from `/private/tmp` and are saved here under their original names `festival_frontend_qa.py`, `festival_edge_qa.py`, `festival_state_qa.py`, and `festival_responsive_qa.py`; dependent scripts import `festival_frontend_qa`. Python Playwright and Chromium were already installed. Browser launch required the environment's sandbox escalation. The Vite server was started separately by the integration owner.

Generated screenshots are retained locally and excluded from Git. The JSON results preserve their original local screenshot paths as validation history.

Scope: this proves frontend behavior against representative existing API contracts. It does not exercise real payment processing, persistence, live accounts, or deployed infrastructure.
