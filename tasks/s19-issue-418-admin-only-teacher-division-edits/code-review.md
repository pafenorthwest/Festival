# Code Review
- Task name: s19-issue-418-admin-only-teacher-division-edits
- Reviewer: Independent Code Review Subagent
- Date: 2026-11-18
- Branch: `feat/s19-issue-418-admin-only-teacher-division-edits`
- Findings status: none

## Context

Performed an independent, adversarial Step 4 code review and post-fix re-review of branch `feat/s19-issue-418-admin-only-teacher-division-edits` against `origin/main`, locked goals (`goals/s19-issue-418-admin-only-teacher-division-edits/goals.v0.md`), packet specification (`tasks/s19-issue-418-admin-only-teacher-division-edits/spec.md`), and bounded-context guardrails (`specs/bounded-contexts-2026.md` §2, §4.4, §5, §6). Both initial review findings (`S19-REV-01` and `S19-REV-02`) have been cleanly resolved and re-verified.

### Verified Audit Summary
1. **Scope & Workspace Hygiene**:
   - 100% of the 49 touched/created packet files belong strictly to `### In scope` in `tasks/s19-issue-418-admin-only-teacher-division-edits/spec.md`.
   - Verified `0` SQL migrations under `database/`, `MembershipPage.tsx` untouched, `AGENTS.md` untouched, and `0` debug logs (`console.*` / `debugger`) or leaked credentials.
2. **Structural Size & Bounded-Context Guardrails (resolving `S19-REV-01` & `S19-REV-02`)**:
   - AST verification across all 27 touched `.ts`/`.tsx` production files confirmed `0` violations: every file is `<= 482` lines (`<= 500` ceiling), every class is `<= 250` lines, and every function/method is `<= 60` lines (with `AdminTeacherDivisionEditor.tsx` split cleanly into `createDivisionEditorController` at `32` lines and `AdminTeacherDivisionEditor` at `35` lines).
   - `updateAdminTeacherProfileDivisions` in `packages/frontend/src/lib/api/directory.ts` (`143`–`163`) calls `client.admin.orgs[":orgSlug"].profiles.teachers[":profileId"].divisions` directly against `DirectoryRoutesType` without type casts.
   - `architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`, and `check:sql` (`528` backend TypeScript files) pass with zero violations (`teacher-directory` imports non-domain helpers strictly via `packages/backend/src/infra/s10-infra.ts`).
3. **`[G1]` Customer Teacher Division Lock & Server-Side Seeding**:
   - `UpsertCustomerTeacherProfileInputSchema` (`v.strictObject({ displayName, publicDirectoryOptIn })`) and `parseTeacherProfilePayload` (`assertAllowedFields`) reject `divisionIds` and unknown fields with `400` without mutating stored divisions.
   - First-time `upsertTeacherProfile` seeds `division_ids` server-side from active `teacher_membership` grants verified against active organization divisions, while subsequent customer edits preserve `existing.division_ids`.
   - `CustomerTeacherDirectoryCard.tsx` renders Teacher divisions read-only without division checkboxes while keeping the exact `"Public Teacher Directory"` heading text.
4. **`[G2]` Organization-Admin Single-Division Teacher Endpoint & UI (`D6`)**:
   - `PATCH /api/admin/orgs/:orgSlug/profiles/teachers/:profileId/divisions` enforces `requireAuth`, `requireTenant`, and `requireTenantRole(["Admin"])` (`401`/`403`/`404`), requires strictly `1` active organization division (`400` with zero DB mutation on `0`, `>1`, duplicate, invalid UUID, inactive, or cross-org division IDs), preserves `approval_status`, emits `TeacherDirectoryChanged`, redacts unconsented contact info via `resolveAdminVisible`, is declared in `PARTICIPANT_PROFILE_ROUTE_SECURITY` (`authenticationClass: "admin"`) and both `nginx/festival.conf` and `docker/nginx.festival.conf` (without matching accompanists `/divisions`), and wires a Teacher-only single-division `<select>` in `AdminTeacherDirectoryPanel.tsx` + `AdminTeacherDivisionEditor.tsx`.
5. **`[G3]` Immutable Entitlement Evidence & Effective Division Resolution**:
   - `orgs.membership_entitlement_divisions` remains untouched in PostgreSQL (`0` mutations), while `listCustomerMembershipStatus`, `listActiveTeachersForDivision`, `findActiveTeacherEntitlementGrant`, and `loadActiveTeacherRoster` (across PostgreSQL 17 and in-memory repositories) resolve effective active Teacher division(s) from `orgs.teacher_profile_divisions` whenever a `teacher_profiles` row exists for `(organization_id, customer_id)`, falling back to `orgs.membership_entitlement_divisions` only when no `teacher_profiles` row exists yet while retaining `divisionNameSnapshot` on historical `expired`/`superseded`/`revoked` status entries.
6. **`[G4]` Accompanist Policy Enforcement, Dual-Role Independence & Verification Suites**:
   - `ParticipantDirectoryService.upsertAccompanistProfile` and `CustomerTeacherDirectoryCard.tsx` (`role="accompanist"`) enforce `exactly_one`, `one_to_two`, and `one_to_all` via `validateMembershipDivisionSelection` (`400` without DB mutation on violation), and dual-role accounts keep Teacher (read-only) and Accompanist (policy-bounded editable) cards independent.
   - Full toolchain, lint, format, build, typecheck, monorepo unit/security suites, and live PostgreSQL 17 integration suites (`69` pass, `0` fail, `0` skip) pass with `0` errors and `0` warnings.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.99
- Justification: Initial findings S19-REV-01 and S19-REV-02 are cleanly resolved, and all [G1]-[G4] functional, security, NGINX, bounded-context DAG, structural size, Hono RPC typing, and live PostgreSQL 17 integration requirements pass with zero defects.
