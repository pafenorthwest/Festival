# Establish Goals

## Status

- Task name: shopify-paid-order-callback-error
- Iteration: v0
- State: locked

## Request

- Shopify Integrations reports paid-order callback rejection with a Shopify request ID.

## Blocking ambiguity

- None. User approved the goals and requested a new branch during preflight.

## Assumptions

- The running service uses the webhook registration code in this checkout; the original Shopify response has not been retrieved.
- The registration mutation declares uri as URL!, while Shopify documents the uri input as String. The error classifier treats any mention of uri as callback failure.

## Goals

1. Correct the paid-order webhook registration mutation to match Shopify's documented uri input type.
2. Prevent GraphQL schema/type errors from being misreported as callback HTTPS/TLS/proxy failures.

## Non-goals

- Production deployment, credential changes, and unrelated Shopify behavior.

## Success criteria

- [G1] A regression test verifies that the registration mutation supplies uri using the documented GraphQL type; relevant backend tests pass.
- [G2] A regression test verifies that a GraphQL variable type mismatch mentioning uri is classified as an upstream failure while actual callback rejections retain their callback classification.

## Next action

- Hand off to implement on a new codex branch.
