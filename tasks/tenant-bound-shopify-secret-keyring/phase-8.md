# Phase 8 — Documentation Alignment and Full Regression Preparation

## Objective

Update directly affected configuration/security documentation and run broad regressions before final acceptance without expanding into #75 or migration/key-retirement work.

## Code areas impacted
- `README.md`
- `SETUP.md`
- `specs/tech-requirements.md`
- All affected backend tests

## Work items
- [ ] Replace legacy `AES_ENCRYPTION_KEY` Shopify guidance with both new variables and placeholder-only examples.
- [ ] Document approved key-ID syntax and safe 32-byte Base64 key generation.
- [ ] Document active-key writes, retained previous-key reads, process-restart configuration switching, and why keys must remain configured.
- [ ] State that database wipe/no legacy compatibility is intentional for current localhost development.
- [ ] State that re-encryption/key retirement and #75 credential/cache rotation are separate work.
- [ ] Confirm examples contain no real key/secret material and do not recommend logging configuration.
- [ ] Run complete backend tests and formatting checks to expose regressions before final audit.

## Deliverables
- Accurate safe operator/developer documentation.
- Broad backend regression evidence.

## Gate (must pass before proceeding)
- [ ] Documentation matches runtime names, validation, startup behavior, and non-goals exactly.
- [ ] No stale Shopify `AES_ENCRYPTION_KEY` instruction remains.
- [ ] Backend regression and format checks pass.

## Verification steps
- [ ] Command: `bun run test:backend`
  - Expected: all backend tests pass.
- [ ] Command: `bun run format:check`
  - Expected: format/lint checks pass.

## Risks and mitigations
- Risk: documentation implies safe key deletion after active switch.
- Mitigation: explicitly require retained keys until a separate re-encryption/retirement process exists.
