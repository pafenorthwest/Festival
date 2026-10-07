# Scheduling — Version One

Status: Draft specification; confirmed requirements are recorded below. Open decisions at the end must be resolved before implementation.

Extends [Phase 5 — Scheduling + Physical Space Modeling](ROADMAP-2026.md#phase-5--scheduling--physical-space-modeling) and consolidates issues [#31](https://github.com/pafenorthwest/Festival/issues/31) (backend scheduling domain), [#32](https://github.com/pafenorthwest/Festival/issues/32) (admin scheduling workspace), and [#38](https://github.com/pafenorthwest/Festival/issues/38) (personalized schedule portal and public class schedule) into one version-one scope. This document does not authorize application implementation.

## Purpose and scope

Translate verified, placed Festival registrations into a real-world room-and-time schedule, let staff assign and adjust that schedule manually, and let each audience see the slice of it that belongs to them. Reuse the existing Firebase configuration and authenticated accounts, and the existing Rooms admin panel ([#277](https://github.com/pafenorthwest/Festival/pull/277)) as the room inventory this spec schedules against.

Three assets make up the scheduling domain:

1. **Rooms** — already specified and built (see [Rooms](#rooms-already-built) below). This document extends it with scheduling use, not new room fields.
2. **Scheduled hours** — the bookable time blocks a room offers, defined in this document.
3. **Self-service availability settings** — adjudicators' own record of when they can be scheduled, defined in this document.

Version one is **manual scheduling only**. No automated solver, and no automatic assignment. Staff place each performer into a slot by hand, informed by availability and capacity data the system surfaces.

### Rooms (already built)

[#277](https://github.com/pafenorthwest/Festival/pull/277) added the Festival admin Rooms panel: a festival-scoped list of rooms, each with an optional piano configuration (upright and/or grand, positive whole-number counts, capped at 3 pianos per room). That remains the room asset for this spec — scheduling reads from it but does not change its fields or its 3-piano cap. Any new room-level need scheduling surfaces (for example, room capacity for non-piano purposes) is an open decision below, not an assumption.

### Visibility and authorization

- A Firebase `admin` intent type may define rooms' scheduled hours, make and change assignments, and view the consolidated schedule for the selected festival. This applies to every Festival administrative role (Admin, Division Chair, Concert Chair, and equivalent), matching the admin intent pattern established in [VOLUNTEER-PORTAL.md](VOLUNTEER-PORTAL.md).
- An adjudicator may set and change only their own availability. They must never see another adjudicator's availability or the consolidated schedule, unless they separately hold an admin intent.
- Personalized schedule views (adjudicator, accompanist, teacher, parent/guardian) each show only that authenticated person's own relationship to the schedule — their assigned classes, their placements, their students' entries, or their children's entries, respectively. None of these views expose another person's schedule.
- A public, unauthenticated view shows only a high-level class schedule — no contact information, no personal relationships, no adjudicator identity beyond what the festival already displays publicly for a class.

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

A single scheduled hour may contain multiple assignments (multiple classes or performers using the same room block back-to-back), subject to the capacity rules below.

## Self-service availability settings

An adjudicator records the scheduled hours they are available for, within a festival, before staff assign them. This is self-service: the adjudicator sets their own availability; staff do not set it on their behalf in version one.

- Availability is expressed as a set of scheduled hours (or, equivalently, room/date/time ranges) the adjudicator marks as available.
- An adjudicator may change their availability at any time before an assignment locks it in (see [Open decisions](#open-decisions) for whether an existing assignment blocks further availability changes).
- Staff use availability as a filter or warning when assigning: version one does not hard-block an assignment outside stated availability, since staff must retain override ability (matching the "keep the experience override-friendly rather than over-automated" principle from [#32](https://github.com/pafenorthwest/Festival/issues/32)), but the scheduling workspace must make unavailable-outside-availability assignments visibly distinct so staff do not do so by accident.
- Only the adjudicator who owns an availability record, and admin intent types, may view it. Other adjudicators cannot see each other's availability.

This feature has a real, unresolved prerequisite: **this codebase has no adjudicator identity today.** The only existing reference to "adjudicator" anywhere in the schema is a free-text field on volunteer Room Proctor shifts (`volunteer_shifts.adjudicator`) — a string an admin types in, not an authenticated account. Self-service availability requires an adjudicator to sign in and be recognized as themselves across festivals, which means this spec implicitly requires a real adjudicator account/intent type, not just a text label. That identity model is scoped as an open decision below, not assumed solved by this document.

## Assignment

An **assignment** places one performer (or performer group, such as an accompanist-performer pair) into a scheduled hour.

- Only confirmed **placed** class registrations are valid assignment candidates by default. Waitlisted registrations are excluded from normal assignment.
- A waitlisted registration may be assigned only through a separately approved, explicitly audited override. The override record captures the approver, the reason, the registration's prior allocation status (waitlisted), and a timestamp. The scheduling workspace must show this audit context to authorized staff wherever an overridden assignment appears.
- Staff assign and reassign manually from the scheduling workspace. There is no automated solver in version one, matching [#31](https://github.com/pafenorthwest/Festival/issues/31) and [#32](https://github.com/pafenorthwest/Festival/issues/32)'s explicit non-goal.
- Reassignment (moving an existing assignment to a different scheduled hour or room) must be fast and must not require rebuilding the surrounding schedule, per [#32](https://github.com/pafenorthwest/Festival/issues/32)'s acceptance criteria.
- All assignment changes — create, move, remove — are audited: actor, prior state, new state, and timestamp.

This spec inherits a real, unresolved dependency from [#28](https://github.com/pafenorthwest/Festival/issues/28) (soft-capacity placement and waitlist allocation): **this codebase has no "placed" or "waitlisted" registration status today.** I checked directly — neither concept exists anywhere in `packages/common` or `packages/backend` outside of issue text. Scheduling's entire assignment-candidate model depends on that distinction existing first. Either #28 ships before scheduling implementation begins, or this spec's "placed" input is stubbed/deferred — that choice belongs to the team, not this document, and is recorded as an open decision below.

## Scheduling workspace (admin)

- Requires the Firebase `admin` intent type, regardless of the holder's Festival administrative role, matching the Volunteer Portal's admin-build-screen pattern.
- Staff define rooms' scheduled hours here (rooms themselves are defined in the existing Rooms panel).
- Staff see placed registrations as assignment candidates, with each candidate's adjudicator-availability status visible (available, unavailable, or availability not yet set) wherever that's relevant to the assignment.
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
- A **scheduled hour** belongs to one room in one festival, and has a required date, start time, end time, and optional staff-facing label. Scheduled hours in the same room do not overlap.
- An **adjudicator availability record** links an adjudicator's account to a festival and a set of scheduled hours (or equivalent time ranges) they've marked available.
- An **assignment** connects a placed (or audited-override waitlisted) registration to a scheduled hour, with an actor, timestamp, and change history.
- An **assignment audit entry** records actor, prior state, new state, and timestamp for every assignment change, including waitlist overrides' approver and reason.

## Acceptance criteria

1. Admins can define scheduled hours for an existing room, each with a room, date, start time, and end time; two scheduled hours in the same room may not overlap.
2. Admins can assign a placed registration to a scheduled hour from the scheduling workspace.
3. Waitlisted registrations are absent from the normal candidate list and can be assigned only through the approved, audited override, which records approver, reason, prior status, and timestamp.
4. Reassigning an existing assignment to a different scheduled hour or room does not require rebuilding the surrounding schedule.
5. Every assignment change (create, move, remove) is recorded with actor, prior state, new state, and timestamp.
6. Staff can export the festival's schedule as PDF and CSV from the scheduling workspace.
7. An adjudicator can set and change their own availability for a festival, expressed as a set of scheduled hours; they cannot see another adjudicator's availability.
8. The scheduling workspace visibly distinguishes an assignment made outside an adjudicator's stated availability, without hard-blocking it.
9. An adjudicator's personalized view shows only the classes assigned to them.
10. An accompanist's personalized view shows only schedule entries tied to their own placements.
11. A teacher's personalized view shows only schedule entries for their own students.
12. A parent/guardian's personalized view shows only schedule entries for their own children.
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
- Room capacity beyond the existing piano configuration (for example, a general attendee/seating capacity), unless the team decides scheduling needs it — see open decisions.

## Open decisions

1. **Adjudicator identity:** Does this spec require a new "adjudicator" account/intent type distinct from the existing organization-member and volunteer models, or should adjudicators be modeled as a new flavor of an existing identity (for example, an invited member with an "Adjudicator" role)? Self-service availability cannot be built until this is resolved.
2. **Dependency on #28:** Scheduling's "placed vs. waitlisted" assignment-candidate model assumes [#28](https://github.com/pafenorthwest/Festival/issues/28)'s soft-capacity placement already exists. Neither "placed" nor "waitlisted" exists in the codebase today. Should #28 ship first, or should this spec define a temporary/stubbed placement signal for scheduling to build against in the meantime?
3. **Availability lock:** Once an adjudicator is assigned to a scheduled hour, can they still edit their availability to mark that hour unavailable? If so, does the existing assignment silently become an availability-mismatch (per acceptance criterion 8), or does it require staff review?
4. **Room capacity beyond pianos:** Does a scheduled hour need a general capacity (for example, number of performers or audience seats), or is version one limited to one assignment track per scheduled hour, with multiple simultaneous assignments handled by creating multiple scheduled hours?
5. **Export format specifics:** [#31](https://github.com/pafenorthwest/Festival/issues/31)/[#32](https://github.com/pafenorthwest/Festival/issues/32) call for PDF/CSV export but do not specify a layout, grouping, or the fields each format includes. This needs a concrete contract before implementation.
6. **Accompanist/teacher/student linkage:** [#38](https://github.com/pafenorthwest/Festival/issues/38) assumes schedule entries can already be traced to a specific accompanist's placements and a specific teacher's students. Does that linkage already exist in the registration/entitlement data model, or does scheduling need to establish it?
