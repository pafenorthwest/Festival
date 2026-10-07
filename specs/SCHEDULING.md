# Scheduling — Version One

Status: Draft specification; confirmed requirements are recorded below. Open decisions at the end must be resolved before implementation.

Extends [Phase 5 — Scheduling + Physical Space Modeling](ROADMAP-2026.md#phase-5--scheduling--physical-space-modeling) and consolidates issues [#31](https://github.com/pafenorthwest/Festival/issues/31) (backend scheduling domain), [#32](https://github.com/pafenorthwest/Festival/issues/32) (admin scheduling workspace), and [#38](https://github.com/pafenorthwest/Festival/issues/38) (personalized schedule portal and public class schedule) into one version-one scope. This document does not authorize application implementation.

## Purpose and scope

Translate verified, placed Festival registrations into a real-world room-and-time schedule, let staff assign and adjust that schedule manually, and let each audience see the slice of it that belongs to them. Reuse the existing Firebase configuration and authenticated accounts, and the existing Rooms admin panel ([#277](https://github.com/pafenorthwest/Festival/pull/277)) as the room inventory this spec schedules against.

"Placed," used throughout this document, is not yet a real status anywhere in the codebase — see [Open decision 3](#open-decisions) before treating anything here as buildable today.

Three assets make up the scheduling domain:

1. **Rooms** — already specified and built (see [Rooms](#rooms-already-built) below). This document extends it with scheduling use, not new room fields.
2. **Scheduled hours** — the bookable time blocks a room offers, defined in this document.
3. **Self-service availability settings** — adjudicators' own record of when they can be scheduled, defined in this document.

Version one is **manual scheduling only**. No automated solver, and no automatic assignment. Staff place each performer into a slot by hand, informed by the adjudicator-availability status the system surfaces for that slot.

### Rooms (already built)

[#277](https://github.com/pafenorthwest/Festival/pull/277) added the Festival admin Rooms panel: a festival-scoped list of rooms, each with an optional piano configuration (upright and/or grand, positive whole-number counts, capped at 3 pianos per room). That remains the room asset for this spec — scheduling reads from it but does not change its fields or its 3-piano cap. Scheduling does not add a general room capacity; see [Scheduled hours](#scheduled-hours) for why.

### Visibility and authorization

- A Firebase `admin` intent type may define rooms' scheduled hours, make and change assignments, and view the consolidated schedule for the selected festival. This applies to every Festival administrative role (Admin, Division Chair, Concert Chair, and equivalent), matching the admin intent pattern established in [VOLUNTEER-PORTAL.md](VOLUNTEER-PORTAL.md).
- An adjudicator may set and change only their own availability. They must never see another adjudicator's availability or the consolidated schedule, unless they separately hold an admin intent.
- Personalized schedule views (adjudicator, accompanist, teacher, parent/guardian) each show only that authenticated person's own relationship to the schedule — their assigned classes, their placements, their students' entries, or their children's entries, respectively. None of these views expose another person's schedule.
- A public, unauthenticated view shows only a high-level class schedule — no contact information, no personal relationships, and no adjudicator identity. I checked: this app has no existing precedent of showing adjudicator names publicly for a class, so this spec doesn't assume one either; whether to add that is a product decision outside this document's scope.

### Festival scope

All scheduling activity — rooms, scheduled hours, availability, and assignments — is scoped to exactly one festival, matching every other festival-scoped feature in this codebase (volunteers, class registration, rooms). An adjudicator's availability does not carry over between festivals; they set it separately for each festival they are scheduled in.

## Scheduled hours

A **scheduled hour** is a bookable time block offered by a specific room within a festival. Staff define scheduled hours after creating rooms, mirroring the Volunteer Portal's "create roles, then create slots for each role" build pattern.

Each scheduled hour has:

- A required room (must belong to the same festival).
- A required date.
- A required start time and end time, in the festival's local timezone.
- An optional label or note (for example, "Junior Piano — Morning Block"), for staff's own reference; it is not shown to the public.

Scheduled hours do not overlap within the same room: two scheduled hours for the same room may not share any time range on the same date. This is a stricter rule than the Volunteer Portal's AM/PM granularity, because scheduling needs exact time precision to translate into a printable program.

Each scheduled hour holds **at most one assignment** in version one. A room judging a sequence of performers back-to-back is modeled as a sequence of scheduled hours in that room (for example, five consecutive 10-minute blocks), not as one block holding five assignments — this keeps "scheduled hour" and "assignment" in a strict one-to-one relationship, which both the export format and the personalized views below depend on.

A scheduled hour has an optional **division** (referencing the organization's existing division list, the same entity used elsewhere for class registration and membership) and an optional **adjudicator**, for the same reason the Volunteer Portal's Room Proctor role already pairs a division and adjudicator on a shift: staff need to know who is judging a block before they can check that person's availability against it. The adjudicator reference depends on resolving adjudicator identity — see [Open decisions](#open-decisions).

## Self-service availability settings

An adjudicator records when they're available within a festival, before staff build scheduled hours around them. This is self-service: the adjudicator sets their own availability; staff do not set it on their behalf in version one.

Availability has to be expressed as date/time ranges, not as a set of existing scheduled hours — an adjudicator can't mark a scheduled hour available before staff have tagged them onto one, and staff can't tag them onto one without knowing their availability first. Staff define scheduled hours and assign an adjudicator to each by matching it against that adjudicator's stated time ranges, not the other way around.

- Availability is a set of date/time ranges within the festival, in the festival's local timezone.
- An adjudicator may change their availability at any time, including after a scheduled hour already names them as its adjudicator; the change does not lock, and does not require staff review (see [Open decisions](#open-decisions) for the reasoning).
- Staff use availability as a filter or warning when assigning: version one does not hard-block an assignment outside stated availability, since staff must retain override ability (matching the "keep the experience override-friendly rather than over-automated" principle from [#32](https://github.com/pafenorthwest/Festival/issues/32)), but the scheduling workspace must make unavailable-outside-availability assignments visibly distinct so staff do not do so by accident.
- Only the adjudicator who owns an availability record, and admin intent types, may view it. Other adjudicators cannot see each other's availability.

This feature has a real, unresolved prerequisite: **this codebase has no adjudicator identity today.** The only existing reference to "adjudicator" anywhere in the schema is a free-text field on volunteer Room Proctor shifts (`volunteer_shifts.adjudicator`) — a string an admin types in, not an authenticated account. Self-service availability requires an adjudicator to sign in and be recognized as themselves across festivals, which means this spec implicitly requires a real adjudicator account/intent type, not just a text label. That identity model is scoped as an open decision below, not assumed solved by this document.

## Assignment

An **assignment** places one class registration into one scheduled hour. It does not need its own concept of a performer group: `packages/common/src/registration.ts` already carries `childId`, `teacherId`, and `accompanistId`/`accompanistMembershipId` on every registration, so an assignment reaches the accompanist, the teacher, and the performing child by following the registration it's attached to — scheduling adds no new linkage for any of them. This also resolves what each personalized view in [#38](https://github.com/pafenorthwest/Festival/issues/38) actually queries: join assignments to their registration, then filter by whichever id matches the signed-in person.

- Only confirmed **placed** class registrations are valid assignment candidates by default. Waitlisted registrations are excluded from normal assignment.
- A waitlisted registration may be assigned only through a separately approved, explicitly audited override. The override record captures the approver, the reason, the registration's prior allocation status (waitlisted), and a timestamp. The scheduling workspace must show this audit context to authorized staff wherever an overridden assignment appears.
- Staff assign and reassign manually from the scheduling workspace. There is no automated solver in version one, matching [#31](https://github.com/pafenorthwest/Festival/issues/31) and [#32](https://github.com/pafenorthwest/Festival/issues/32)'s explicit non-goal.
- Reassignment (moving an existing assignment to a different scheduled hour or room) must be fast and must not require rebuilding the surrounding schedule, per [#32](https://github.com/pafenorthwest/Festival/issues/32)'s acceptance criteria.
- All assignment changes — create, move, remove — are audited: actor, prior state, new state, and timestamp.

This spec inherits a real, unresolved dependency from [#28](https://github.com/pafenorthwest/Festival/issues/28) (soft-capacity placement and waitlist allocation): **this codebase has no "placed" or "waitlisted" registration status today.** I checked directly — neither concept exists anywhere in `packages/common` or `packages/backend` outside of issue text. Scheduling's entire assignment-candidate model depends on that distinction existing first. Either #28 ships before scheduling implementation begins, or this spec's "placed" input is stubbed/deferred — that choice belongs to the team, not this document, and is recorded as an open decision below.

## Scheduling workspace (admin)

- Requires the Firebase `admin` intent type, regardless of the holder's Festival administrative role, matching the Volunteer Portal's admin-build-screen pattern.
- Staff define rooms' scheduled hours here (rooms themselves are defined in the existing Rooms panel).
- When staff consider a scheduled hour that names an adjudicator, that adjudicator's availability status for it is visible (available, unavailable, or not yet set) — this is a property of the scheduled hour under consideration, not of the candidate registration.
- Waitlisted registrations are absent from the normal candidate list; they appear only through the approved audited override flow, with that context visible.
- Staff can export the resulting schedule as PDF and CSV.
- Per [#32](https://github.com/pafenorthwest/Festival/issues/32): the workspace favors overrides over automation at every step. Staff must always be able to make a manual exception.

## Personalized and public schedule views

Per [#38](https://github.com/pafenorthwest/Festival/issues/38), this spec treats schedule *distribution* as a separate concern from the manual scheduling workspace above — it reads the same assignment data but does not let any of these audiences edit it.

- **Adjudicator view:** the classes assigned to them, and nowhere to edit the schedule itself (editing availability is separate, see [Self-service availability settings](#self-service-availability-settings)).
- **Accompanist view:** schedule entries tied to their placements.
- **Teacher view:** schedule entries for their students.
- **Parent/guardian view:** schedule entries for their children.
- **Public view:** a high-level class schedule, published without login, with no personal or contact information.

All four personalized views require login and enforce relationship-based access — an adjudicator cannot see a teacher's view, a parent cannot see another family's children's entries, and so on. Every view (personalized and public) must be usable online and must have a clean, printer-friendly format, per [#38](https://github.com/pafenorthwest/Festival/issues/38)'s acceptance criteria. An iOS app is an explicit stretch goal for this delivery, not a blocker.

### Date and time display

Schedule dates and times display in the festival's local timezone, using the same weekday + `MM/DD` convention established in [VOLUNTEER-PORTAL.md](VOLUNTEER-PORTAL.md) (for example, "Tue 03/31"), with an explicit start–end time shown per scheduled hour, since scheduling needs exact times rather than the Volunteer Portal's AM/PM granularity.

## Conceptual records

Retains the Phase 5 roadmap's conceptual records, refined with this spec's detail. Exact storage design is outside this specification draft.

- A **room** belongs to one festival (already built in [#277](https://github.com/pafenorthwest/Festival/pull/277); not redefined here).
- A **scheduled hour** belongs to one room in one festival, and has a required date, start time, end time, an optional staff-facing label, and an optional division and adjudicator. Scheduled hours in the same room do not overlap, and each holds at most one assignment.
- An **adjudicator availability record** links an adjudicator's account to a festival and a set of date/time ranges they've marked available.
- An **assignment** connects one placed (or audited-override waitlisted) registration to one scheduled hour, with an actor, timestamp, and change history. It carries no fields of its own for child, teacher, or accompanist — those come from the registration it's attached to.
- An **assignment audit entry** records actor, prior state, new state, and timestamp for every assignment change, including waitlist overrides' approver and reason.

## Acceptance criteria

1. Admins can define scheduled hours for an existing room, each with a room, date, start time, end time, and an optional division and adjudicator; two scheduled hours in the same room may not overlap.
2. Admins can assign a placed registration to a scheduled hour from the scheduling workspace; a scheduled hour holds at most one assignment.
3. Waitlisted registrations are absent from the normal candidate list and can be assigned only through the approved, audited override, which records approver, reason, prior status, and timestamp.
4. Reassigning an existing assignment to a different scheduled hour or room does not require rebuilding the surrounding schedule.
5. Every assignment change (create, move, remove) is recorded with actor, prior state, new state, and timestamp.
6. Staff can export the festival's schedule as PDF and CSV from the scheduling workspace.
7. An adjudicator can set and change their own availability for a festival, expressed as date/time ranges; they cannot see another adjudicator's availability.
8. The scheduling workspace visibly distinguishes an assignment made outside an adjudicator's stated availability, without hard-blocking it.
9. An adjudicator's personalized view shows only the classes scheduled into hours where they're named as the adjudicator.
10. An accompanist's personalized view shows only assignments whose registration's `accompanistId`/`accompanistMembershipId` matches them — no new accompanist-to-schedule linkage is created for this purpose.
11. A teacher's personalized view shows only assignments whose registration's `teacherId` matches them.
12. A parent/guardian's personalized view shows only assignments whose registration's `childId` is one of their own children.
13. All four personalized views require login and enforce relationship-based access; none can view another person's schedule slice.
14. A public class schedule is available without login and contains no personal or contact information.
15. Every schedule view, personalized and public, is usable online and has a printer-friendly format.
16. Schedule dates and times display in the festival's local timezone, with weekday + `MM/DD` and an explicit start–end time per scheduled hour.
17. Rooms, scheduled hours, availability, and assignments are scoped to a single festival; availability does not carry over between festivals.
18. No automated solver makes assignments in version one; every assignment is a manual staff action.

Implementation must include tests for changed behavior, particularly Firebase intent-type authorization per audience, festival isolation, waitlist-override auditing, assignment-change auditing, and relationship-based access for each personalized view.

## Deferred scope

- An automated scheduling solver (explicitly out of scope per [#31](https://github.com/pafenorthwest/Festival/issues/31)/[#32](https://github.com/pafenorthwest/Festival/issues/32); "don't build a solver yet").
- The iOS app client from [#38](https://github.com/pafenorthwest/Festival/issues/38) — tracked as a stretch goal, not required for this version.
- Automated notifications when a schedule changes (this spec does not define a Mailchimp/communications event contract for scheduling, unlike the Volunteer Portal's booking/cancellation events).
- Hard-blocking an assignment outside an adjudicator's stated availability. Version one surfaces the mismatch; it does not prevent the override.
- A general room/scheduled-hour capacity (for example, audience seats). Resolved by the one-assignment-per-scheduled-hour rule above, not an open question — see [Scheduled hours](#scheduled-hours).

## Open decisions

Two of these are genuine engineering/product-modeling questions I worked through against the existing codebase and have a recommendation for. The other two are sequencing and product-content calls that belong to Eric/the team, not something I can resolve by reading code.

1. **Adjudicator identity — recommendation:** model `adjudicator` as a new Firebase intent type, parallel to the existing `volunteer` intent ([VOLUNTEER-PORTAL.md](VOLUNTEER-PORTAL.md)): an authenticated account self-enrolls as an adjudicator for one festival (not a persistent organization-membership role, since adjudicators are typically outside judges specific to a festival, not staff). This reuses an already-proven pattern in this exact codebase rather than inventing a new identity shape. Self-service availability and the scheduled-hour adjudicator field both depend on this being confirmed before implementation.
2. **Availability lock — recommendation:** let an adjudicator edit their availability at any time, including after an assignment exists. Don't block the edit or silently require staff review; let the resulting mismatch surface through the same visible-distinction mechanism as any other availability mismatch (acceptance criterion 8). This keeps the rule singular (one mismatch-detection mechanism, not two) and matches the "override-friendly, not over-automated" principle [#32](https://github.com/pafenorthwest/Festival/issues/32) already establishes for staff; extending it to adjudicators' own edits is a small, consistent step, not a new principle.
3. **Dependency on #28 — needs Eric's call, not resolvable here:** scheduling's "placed vs. waitlisted" assignment-candidate model assumes [#28](https://github.com/pafenorthwest/Festival/issues/28)'s soft-capacity placement already exists. Neither "placed" nor "waitlisted" exists in the codebase today — I checked directly. Should #28 ship first, or should this spec define a temporary/stubbed placement signal for scheduling to build against in the meantime? This is a roadmap-sequencing decision, not a modeling one.
4. **Export format specifics — needs Eric's call, not resolvable here:** [#31](https://github.com/pafenorthwest/Festival/issues/31)/[#32](https://github.com/pafenorthwest/Festival/issues/32) call for PDF/CSV export but do not specify a layout, grouping, or the fields each format includes. This is a product-content decision (what the printed program should actually look like), not something inferable from the existing codebase.
