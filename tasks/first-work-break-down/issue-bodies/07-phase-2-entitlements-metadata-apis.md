## Summary

Implement the backend Phase 2 entitlement layer that converts class purchases into local registration entitlements and stores the performer metadata Shopify should not own.

## Scope

- Model `class_entitlement`, `performer`, and `registration_metadata`
- Ingest purchase events into local entitlements
- Tie entitlements to the correct performer and parent/customer records
- Keep operational metadata editable in the local application
- Preserve a clean reconciliation path between Shopify purchases and local entitlements

## Deliverables

- Backend tables/contracts for entitlements and performer metadata
- Ingestion logic from purchase events to entitlement creation
- APIs to read and update performer and registration metadata
- Reconciliation-oriented identifiers linking entitlements back to Shopify

## Acceptance Criteria

- Buying a class results in a local entitlement
- Entitlements are linked to the correct performer and purchaser
- Registration metadata can be edited locally after entitlement creation
- Metadata ownership stays in the local app rather than Shopify

## Notes

- Spec sources: `specs/ROADMAP-2026.md`
- Phase: `Phase 2`
- Ownership: `backend API`
