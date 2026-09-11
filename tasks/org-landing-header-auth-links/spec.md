# Organization landing header auth links

## Goal reference

- `goals/org-landing-header-auth-links/goals.v5.md` (locked)

## Scope

### In scope

- The two named membership/auth anchors, the public organization header, its
  styles, the Google Material Symbols font include, Login/Logout button consistency,
  and focused frontend tests.

### Out of scope

- Routes, authentication behavior, existing link destinations and labels, and
  unrelated navigation layout.

## Approach

- Reuse the compact-header button classes for the anchor links, add grouped header
  actions ordered Home → account icon → Login/Logout, and apply auth-state icon
  visibility through CSS.

## Verification commands

- Lint: `bun run --cwd packages/frontend lint`
- Build: `bun run --cwd packages/frontend build`
- Tests: `bun run --cwd packages/frontend test`

## Delivery

- Delivered: Both named anchors now use the compact-header button classes and
  equivalent anchor styles. The organization header renders Home, a Google
  Material Symbols person account link, and the Login/Logout control in that
  order. The account icon has `1rem` horizontal padding, is transparent while
  logged out, and bullet-ink while logged in. Login and Logout are both buttons;
  Login navigates to the unchanged auth URL and Logout retains its POST flow.
  Focused coverage verifies the links, order, icon, padding, auth styles, and
  button behavior.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; the only existing changes are the generated
  goal/task artifacts for this task and the project manifest entry.

## Quality gate results

- Lint: passed — `bun run --cwd packages/frontend lint`
- Build: passed — `bun run --cwd packages/frontend build`
- Tests: passed (51 tests) — `bun run --cwd packages/frontend test`
- Code review: pending
- Clean merge: pending landing gate
