# Goals Extract
- Task name: festival-registration-ui
- Iteration: v0
- State: locked
- Approval: User approved the mockups and requested implementation in packages/frontend against specification v1.9.

## Goals

1. Implement the approved parent shell, navigation, Festival Home, and separate Performers destination using existing routes and services.
2. Implement class-first registration with retained selection context, a sequential repertoire editor, and a shared in-memory cart across parent navigation.
3. Preserve the existing checkout/waitlist/eligibility integration, remove only the selected cart item, and retain a retry identity for unchanged checkout payloads.
4. Implement purchased registrations grouped by performer, concise Edit actions with information tooltips, and repertoire/accompanist editing using the existing cutoff response and mutation API.
5. Verify the frontend with unit checks, type checking, a production build, and browser coverage of the changed flows and responsive layouts.

## Non-goals

- Backend/common API, database, capacity, payment reconciliation, or cutoff policy changes.
- Server drafts, durable frontend carts, waitlist purchases, seat reservations, deployment, commits, or pull requests.
- Changes to unrelated existing cloud, Docker, or document artifacts.

## Success criteria

- [G1] Shared sidebar/header match approved visual states; account links do not reload and lose the cart; child management remains separate.
- [G2] Context resets follow the spec; valid first-piece save opens an optional next piece below the class maximum; class/catalog/duration policy is preserved; leaving incomplete work confirms discard.
- [G3] Add to Cart writes only frontend state; existing checkout creates Postgres/Shopify records; dependent items remain visible and block checkout when a prerequisite is removed; unchanged checkout retries reuse their key.
- [G4] Purchased rows consume snapshot teacher/cutoff/editability fields; only repertoire/accompanist may be changed; edit controls close at cutoff; server authorization remains authoritative.
- [G5] Frontend checks/build/tests and focused responsive browser checks pass; no new changes are made to backend/common.
