# Volunteer Portal — Version One

Status: Draft specification; confirmed requirements are recorded below. Open decisions at the end must be resolved before implementation.

Extends [Side Quests #2: Volunteer Portal](SIDEQUESTS-2026.md#2-volunteer-portal). This document defines the detailed version-one scope. It does not authorize application implementation.

## Purpose and scope

Provide self-service volunteer signup and cancellation, a shared coverage schedule, and admin tools to manage roles and slots. Reuse the existing Firebase configuration and authenticated accounts. Admin screens require existing admin authorization.

Version one supports exactly one volunteer per slot. Multiple-capacity slots are deferred. Where additional coverage is needed, admins may create separately named roles such as “Table Monitor 1” and “Table Monitor 2.” Room Proctor uses the special structure described below.

## Signup screen

The signup flow has four steps:

1. **Authenticate:** Sign in using Firebase SSO or an email link, reusing the existing Firebase configuration.
2. **Choose a role:** Display role descriptions and any optional HTTP link to additional details. Explain that volunteers choose one role per signup pass and can return to choose another role afterward.
3. **Choose slots:** Allow multiple slots for the selected role. Display weekday, date in `MM/DD` format (for example, `03/31`), and AM or PM. Display optional informational time text when present. Room Proctor slots also display Division and Adjudicator.
4. **Enter contact information and submit:** Name, email, and phone are required. Only email is prefilled; it is fixed to the authenticated account’s email and cannot be replaced with another contact email. Name and phone must be entered again on subsequent signup passes.

Volunteers may complete one role’s bookings, return to the volunteer screen, and select slots for another role.

### Booking rules

- Each slot has a maximum of one active volunteer assignment.
- Across all roles, a volunteer may hold at most one AM assignment and one PM assignment on a given festival-local date.
- AM and PM determine conflicts. Informational time text does not affect availability or conflict validation.
- Submitting several slots is all-or-nothing. If any selection is unavailable or conflicts at submission time, no selected slots are booked. Explain the affected selections and require the volunteer to revise before resubmitting.
- Enforce capacity and volunteer conflicts atomically, including simultaneous submissions.
- Successful bookings appear on the volunteer review screen regardless of Mailchimp availability.

## Roles and slots

### Roles

Admins create roles before creating their slots. Each role has:

- A slug.
- A description.
- An optional HTTP link to additional details.

The exact relationship between role slug and visible role name remains an open decision.

### Slots

Each slot belongs to a role and has:

- A required date.
- A required AM or PM designation.
- Optional free-text informational time, such as `9am - 4:30pm`. No time parsing or time-range validation is required.
- Division and Adjudicator only when the role is Room Proctor.

### Special Room Proctor role

Use one special **Room Proctor** role. Every slot for this role requires both Division and Adjudicator, entered as free text. Other roles do not have these fields.

Multiple Room Proctor slots may share a date and AM/PM designation when they represent different adjudicators. For example, Room Proctor slots for Dr Brown and Mr Yellow on `03/31` AM require two different volunteers. They remain slots under the same role, rather than separately named roles per adjudicator.

## Review screens

Both screens use the festival’s local timezone, default to a week view, and offer a day-view toggle. Display slots grouped roughly by AM and PM, including empty and filled slots and the assigned volunteer’s name. Dates use `MM/DD` and include weekday information.

### Volunteer review

- Requires authentication.
- Shows the consolidated coverage schedule, including other volunteers’ names.
- Allows volunteers to cancel only their own assignments.
- Email and phone are visible only to the volunteer themselves and admins.

### Admin review

- Requires admin authentication and authorization.
- Shows consolidated coverage and gaps, with assigned volunteer names.
- Allows admins to cancel any assignment.
- Allows admins to see volunteer contact information.

### Cancellation

Volunteers and admins may cancel assignments at any time; there is no cancellation cutoff. Cancellation immediately reopens the slot for signup. Ordinary assignment cancellation emits a Mailchimp cancellation event for that slot.

## Admin build screen

- Requires admin authentication and authorization.
- Create roles, then create slots for each role.
- Edit and delete roles and slots regardless of signup status.
- Version one does not require impact checks or a cancellation prerequisite before edits or deletion.
- Deleting a role does not trigger Mailchimp events in version one.

The treatment of existing assignments after schedule edits, and events on direct slot deletion, remain open below.

## Mailchimp integration

- Mailchimp sends the volunteer emails.
- Every signup registers the authenticated email with the volunteer audience segment.
- Each booked slot emits a signup/welcome event intended to produce one email per slot. A submission booking three slots produces three slot-specific events/emails.
- Each ordinary assignment cancellation emits a slot-specific cancellation event, including cancellations initiated by admins.
- Role deletion is explicitly exempt from event generation in version one.
- Mailchimp failure does not prevent a booking or cancellation from succeeding. Volunteers can verify their assignments on their review page.

The Mailchimp audience/segment identifiers, event contract, failure retry policy, and reminder ownership/timing are not yet specified. Sidequest #2 calls for automated pre-event reminders; this requirement remains unresolved rather than implicitly removed.

## Conceptual records

Retain the sidequest’s conceptual records: `volunteer`, `volunteer_role`, `volunteer_shift`, and `volunteer_assignment`. Exact storage design is outside this specification draft.

- A volunteer links to an existing authenticated account and has required name, account email, and phone.
- A role defines its slug, description, optional details link, and whether it is the special Room Proctor role.
- A shift represents a dated AM/PM slot, optional time text, and Room Proctor details where applicable.
- An assignment connects a volunteer to a slot.

## Acceptance criteria

1. The four-step signup supports selecting multiple slots for one role and returning to book another role.
2. Email is prefilled from authentication and cannot be edited; name and phone are required and are not prefilled, including for returning volunteers.
3. A slot cannot acquire more than one active assignment, even under simultaneous submissions.
4. A volunteer cannot book two slots in the same date/AM-PM period across any roles.
5. A conflicting multi-slot submission creates no bookings and requires revised selections.
6. All slots require date and AM/PM; optional time text is displayed without time validation or conflict calculations.
7. Room Proctor slots require both free-text Division and Adjudicator; other roles do not expose those fields.
8. Two Room Proctor slots for different adjudicators can be filled independently in the same date/AM-PM period by different volunteers.
9. Authenticated volunteers and admins can view empty and filled coverage in week and day views, with week as the default and names visible.
10. Contact email and phone cannot be accessed by other volunteers.
11. Volunteers can cancel their own assignments at any time; admins can cancel any assignment. The slot reopens immediately.
12. Admins can create, edit, and delete roles and slots without signup-status impact checks. Non-admins cannot perform these actions.
13. Each booked slot produces its own signup/welcome event and ordinary cancellation produces its own cancellation event; role deletion produces no events.
14. Mailchimp failure leaves successful bookings and cancellations intact and reflected on the review page.
15. Schedule dates display weekday and `MM/DD` in the festival’s local timezone.

Implementation must include tests for changed behavior, particularly authorization, privacy, concurrent booking, all-or-nothing submission, cancellation, and Mailchimp failure isolation.

## Deferred scope

- Configurable slot capacity greater than one.
- Signup-impact checks before admin edits or deletion.
- Mailchimp events on role deletion.
- Time-based conflict validation or cancellation deadlines.

The optional check-in tracking mentioned in sidequest #2 has not been requested for this version.

## Open decisions

1. **Direct slot deletion:** Does deleting a filled slot suppress cancellation events, as role deletion does? Should deleting a role also remove its slots and assignments from the active schedule?
2. **Edits to filled slots:** Should existing volunteers remain assigned when admins change a slot’s date or AM/PM, even if that creates a conflict with another assignment? No impact checks are requested, so this must be reconciled with the one-place-at-a-time rule.
3. **Mailchimp failures and reminders:** Should failed events retry automatically, or is best-effort delivery sufficient? Are reminders configured entirely in Mailchimp, and are they required for version one?
4. **Role naming:** Should admins enter a separate display name alongside the slug and description?
5. **Review scope:** Is the consolidated schedule for all roles, with optional role filtering? How should the volunteer’s own bookings be distinguished?
6. **Festival scope:** Are roles and slots scoped to a festival edition/year, and should review default to the festival’s first week or the current week?
