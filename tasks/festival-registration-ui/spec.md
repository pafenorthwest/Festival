# Festival registration UI implementation

Locked scope: [goals v0](../../goals/festival-registration-ui/goals.v0.md), approved [UI specification v1.9](../../specs/festival_registration_ui_spec.md), and the static mockups in `specs/mockups/festival-registration`.

## Boundaries

Implement production behavior and styling in `packages/frontend` only. Reuse existing customer APIs, cart-to-checkout handoff, separate waitlist, policy validation, and purchased metadata endpoints. Retain the existing 42-day cutoff. Earlier backend/common response additions and unrelated dirty files are preserved.

Use the existing checkout. Parent shell/routing/runtime, registration/editor/cart, and purchased registrations have separate write owners. Integrate shared styles and run one final validation path. Completed carts and selector context remain memory-only; no new backend or persistent draft lifecycle is introduced.

The user explicitly approved the specification/mockups before implementation. Repository Bash-only scaffolding is replaced with native PowerShell preflight and equivalent task artifacts to honor AGENTS.md execution requirements.

## Pinned validation

```powershell
bun run verify:toolchain
bun run build:common
bun run --cwd packages/frontend lint
bun run --cwd packages/frontend test
bun run --cwd packages/frontend build
```

Run Biome on changed TypeScript/TSX files and scoped new CSS. Browser verification uses the real Vite application with fixture responses at its existing HTTP API boundary; no fixture data or preview handlers are shipped in production code. Exercise full sidebar, icon rail, mobile menu, registration/editor/cart, prerequisite removal, waitlist separation, and purchased edit/cutoff behavior.

## Delivery evidence

Implemented the approved parent shell, responsive sidebar/rail/mobile navigation, blended Festival Home, Performers workflow, registration workspace, sequential repertoire editor, memory-only cart, and grouped My Registrations with teacher attribution and accessible Edit help. Purchased repertoire/accompanist editing consumes server editability and preserves the existing exact cutoff. Checkout and separate contact/consent waitlist reuse existing APIs and behavior; this implementation adds no backend/common changes.

Validation completed:

- Toolchain verification and common dependency build passed.
- Frontend typecheck, production build, and all **408 tests** passed (2,300 assertions across 48 files).
- Pre-commit validation refreshed the common build, frontend typecheck/build and all 408 frontend tests; all **83 targeted backend tests** for the purchased-registration contract also passed.
- Scoped Biome checks passed without errors; the new CSS retains nonblocking specificity/important warnings.
- Independent code review reported no remaining actionable findings (correctness confidence 0.95).
- The actual Vite application passed **62 browser assertions** covering navigation breakpoints, cart retention and session isolation, repertoire validation, prerequisite/capacity recovery, purchased edits/cutoffs, navigation/sign-out guards, waitlist separation, and checkout retries/handoff. See [browser evidence and screenshots](validation/browser-validation.md).

Browser checks used fixture responses at the existing HTTP API boundary. Live accounts, persistence, Shopify payment processing, and deployed infrastructure were not exercised. Changes are committed locally in logical groups at the user's request; no deployment, push, or pull request was performed.
