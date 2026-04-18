## Summary

Create the admin billing reconciliation side quest so operators can repair mismatches between Shopify money movement and the services actually rendered.

## Scope

- Support refunds, credits, manual charges, write-offs, and invoice creation
- Maintain a ledger and adjustment history
- Provide admin workflows to search by order, performer, or parent
- Keep Shopify as the source of truth for money movement
- Keep the local system as the source of truth for reconciliation intent

## Deliverables

- Billing adjustment, ledger, credit, and invoice model
- APIs for refund, credit, invoice, and mismatch repair workflows
- Admin console for investigating and resolving billing mismatches
- Audit trail tying every adjustment to an actor and reason

## Acceptance Criteria

- Admins can resolve payment mismatches without engineering intervention
- Every financial adjustment is logged and traceable
- Double refunds and duplicate credits are prevented
- Shopify and local billing state remain reconcilable

## Notes

- Spec sources: `specs/SIDEQUESTS-2026.md`
- Workstream: `Side Quest`
- Ownership: `combined`
