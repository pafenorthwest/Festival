# Admin profile contact consent and audit

- Task name: admin-profile-consent
- Iteration: v1
- State: locked

Authorization: The user approved the proposed three-file Admin profile consent and audit change, regression tests, a new branch, and a pull request targeting `feat/97-public-directory` by asking to make these changes. No additional goal approval is required.

## Goals

1. Gate private contact fields in all four Admin profile responses (Teacher and Accompanist lists and approval-update responses) on the customer's current-version staff-access consent, scoped to the authenticated organization and customer. Await a profile-access audit containing the authenticated actor UID before disclosing contacts.
2. Redact private contact fields when consent is missing or belongs to an older privacy-notice version while retaining profile moderation data and operations. Preserve customer self-service responses, the public directory contract, tenant isolation, and the existing Admin customer-profile 404 behavior for missing consent.
3. Add regression coverage for current, absent, and old-version consent; audit failure that prevents disclosure; authenticated actor UID; tenant scope; and unchanged customer-own/public behavior. Pass the pinned validation and open a pull request from the new branch into `feat/97-public-directory`.

## Non-goals

- Schema or migration changes, new consent capture flows, or backfilling consent.
- Membership acquisition, membership eligibility, and public-directory behavior changes.
- Reworking profile persistence, field ownership, or unrelated authorization and audit behavior.
- Modifying or including the pre-existing untracked `tasks/review-pr-307/` artifacts.

## Success criteria

- [G1] The four Admin responses disclose `phone`, `email`, and `zip_code` only after a tenant-scoped lookup confirms `CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION` consent and the required audit write resolves successfully. The audit identifies the authenticated actor by UID and the target customer and organization.
- [G2] Missing or old-version consent omits those contacts without preventing Admin listing or approval moderation. Customer-own profile responses and public directory responses retain their prior behavior; existing `adminCustomerProfile` callers still receive 404 when consent is unavailable.
- [G3] Focused tests cover consent versions, fail-closed audit errors, organization/customer scope, actor UID, the existing Admin 404 contract, and unchanged customer/public responses. Explicit-file Biome checks, common/backend builds, selected backend tests, and a full backend suite when practical pass. The reviewed, in-scope change is committed and pushed on `codex/admin-profile-consent`, with the PR base explicitly set to `feat/97-public-directory`.

Validation: Native PowerShell checks enforce the repository goal-validator requirements (stable task name, locked state, 1–20 goals, and mapped success criteria). The repository's lifecycle helpers are Bash-only and are not executed under the PowerShell execution requirement.
