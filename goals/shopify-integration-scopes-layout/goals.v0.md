# Goals Extract
- Task name: shopify-integration-scopes-layout
- Iteration: v0
- State: blocked

## Goals

1. Pending scope clarification: update the setup instruction scope list and
   verified-scope/capability display to the complete required list from SETUP.
2. Tighten the Shopify settings presentation by roughly half vertically, reduce
   its type size modestly, add a rounded gray input-like border, and separate it
   clearly from the credential fields below.


## Non-goals

- Do not modify Shopify authorization behavior, database schema, or unrelated
  integration cards unless the confirmed scope list requires it.


## Success criteria

- [G1] The page's setup instructions and verified scope display enumerate the
  confirmed required scopes, with automated coverage for any changed scope
  diagnostics.
- [G2] The settings presentation has the confirmed compact styling, rounded gray
  border, and bottom separation before the inputs; relevant frontend tests pass.

