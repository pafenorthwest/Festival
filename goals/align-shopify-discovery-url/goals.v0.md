# Goals Extract
- Task name: align-shopify-discovery-url
- Iteration: v0
- State: locked

## Goals

1. Accept a valid discovered Customer Account GraphQL URL that advertises a newer API version while preserving all existing HTTPS, port, Shopify-host, and destination safety checks, and derive Festival's pinned `2026-07` GraphQL endpoint for all subsequent Customer Account calls.
2. Add focused automated coverage for newer-version discovery normalization, continued `2026-07` behavior, and rejection of malformed discovery paths.
3. Validate the completed change, commit it on `ericp/align-shopify-discovery-url`, push it to the configured remote, and open a pull request into `main` containing `Closes #267`.


## Non-goals

- Upgrade Festival's Customer Account API contract to `2026-10` or any release candidate.
- Alter OAuth credential, callback, scope, protected-data, order-readiness, or unrelated Shopify integrations.
- Weaken endpoint validation or return upstream response bodies, tokens, or credentials to the browser.


## Success criteria

- [G1] Saving valid Customer Account settings reaches `readiness: "ready"` when Shopify discovery advertises a newer valid Customer Account API version.
- [G1] Customer Account GraphQL requests use the derived pinned `2026-07` endpoint rather than the newer discovered version.
- [G1] Unsafe destinations and malformed Customer Account GraphQL discovery paths remain rejected.
- [G2] Focused regression coverage passes, alongside the repository's pinned format, build, and test checks.
- [G3] A pushed pull request targets `main`, contains `Closes #267`, and has no merge conflicts with its base.
