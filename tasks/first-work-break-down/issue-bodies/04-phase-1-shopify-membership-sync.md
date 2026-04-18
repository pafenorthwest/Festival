## Summary

Implement the backend Phase 1 flow that makes Shopify the system of record for membership purchases and customer identity mapping.

## Scope

- Ingest Shopify `orders/create` and `customers/create` events
- Map Shopify customer records to local users
- Store membership status locally for teacher and accompanist memberships
- Make webhook handling idempotent
- Keep Firebase admin auth separate from Shopify customer identity

## Deliverables

- Webhook handlers for customer/order membership events
- Local tables for membership state and Shopify customer mapping
- Deterministic customer-to-user mapping rules
- Reconciliation-ready local membership status projection

## Acceptance Criteria

- A qualifying Shopify purchase results in a local membership record
- Returning Shopify customers map to the same local user deterministically
- Duplicate webhook deliveries do not create duplicate memberships
- Membership status can be resolved locally as active/inactive

## Notes

- Spec sources: `specs/ROADMAP-2026.md`, `specs/Phase1-Account-Memberships.md`
- Phase: `Phase 1`
- Ownership: `backend API`
