# Goals Extract
- Task name: configurable-shopify-audit-path
- Iteration: v0
- State: locked

## Goals

1. Add a validated backend environment override for the Shopify mutation-audit file, with the existing production path retained whenever the override is absent.
2. Wire the resolved path into the application audit writer without weakening the existing fail-closed audit requirement or modifying audit-record contents.
3. Cover default, valid override, and invalid override behavior with focused tests.
4. Document non-privileged local configuration in `develop.env` and the existing setup guide, while retaining the production provisioning guidance.


## Non-goals

- Change the production default path or automatically create production audit directories.
- Make audit logging optional, redirect audit events to the browser/database, or log Shopify credentials/tokens/raw responses.
- Modify Shopify product mutations, credentials, scopes, or Docker deployment behavior.


## Success criteria

- [G1] With no override, the application continues to use `/var/log/festival/shopify-admin-audit.ndjson`.
- [G1] A non-empty absolute override is used by the application; an empty value uses the default and a relative or malformed value fails startup validation.
- [G2] Focused backend coverage verifies the configuration contract and audit writer selection.
- [G3] `develop.env` and `SETUP.md` explain how to choose a user-writable development path without changing the production audit requirement.
