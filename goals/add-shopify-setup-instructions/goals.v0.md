# Goals Extract
- Task name: add-shopify-setup-instructions
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Render the issue #81 Shopify setup example above the existing integration form.
2. Derive the displayed App URL from the browser origin and current organization shortname.
3. Use native `<details open>` disclosure behavior without persistence or custom state.
4. Preserve the existing Shopify Integration form and align the instructions with existing admin styling.
5. Cover placement, exact content, dynamic URL, and disclosure accessibility deterministically.

## Non-goals

- Disclosure persistence or copy/clipboard controls.
- Backend, API, database, credential, or Shopify transport changes.

## Success criteria

- The page shows all issue #81 values, production HTTPS guidance, and the correct organization-specific App URL.
- The disclosure is expanded initially, keyboard accessible through native semantics, and collapsible to a clear summary bar.
- The instruction card precedes the existing Shopify Integration card without altering its behavior.
- `bun run format:check`, `bun run build`, and `bun run test` pass.
