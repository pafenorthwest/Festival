# Festival email lifecycle draft

These are new plain-text drafts. Bracketed fields require data or an approved policy before sending. **P** = parent or family account contact; **T** = teacher; **A** = accompanist. A role appears in the audience only when that person is linked to the relevant student or membership.

| Event / template | Audience | Trigger and delivery | PafeTools status |
| --- | --- | --- | --- |
| Membership registration open / `01-membership-open.txt` | T, A (prior-year members) | Staff runs a one-time batch shortly after membership registration opens. | Existing legacy task. |
| Membership confirmed / `02-membership-confirmed.txt` | T, A (newly joined current-year member) | Registration processor detects new membership divisions; proposed Festival equivalent sends after confirmation. | Existing legacy processor email. |
| Shopify order receipt / no Festival template | P (purchaser) | Shopify completes the order and sends its receipt. | Shopify-owned; no duplicate Festival email. |
| Student registration confirmed / `03-registration-confirmed-parent.txt` | P | Festival validates a student registration and marks it confirmed; send once per confirmed registration or group per parent account. | Proposed distinct message. Legacy processor sends an account update rather than this exact confirmation. |
| Registration needs action / `04-registration-action-required-parent.txt` | P | Validation identifies a specific issue requiring parent action; send the issue and correction route. | Legacy account update processor handles issues; this standalone wording is proposed. Legacy may copy T/A on issues. |
| Waitlist status changed / `05-waitlist-status-parent.txt` | P | A student is added to or removed from the waitlist, excluding a completed promotion or withdrawal handled below. | Proposed explicit transition notice. |
| Waitlist invitation / `06-waitlist-invitation-parent.txt` | P | Staff approves an offer and releases the invitation; legacy marks `Ask` then runs a batch. | Existing legacy task; Festival trigger is proposed. |
| Waitlist promotion / `07-waitlist-promotion-parent.txt` | P | A waitlisted student is actually added to a class. | Proposed explicit notice; legacy processor moves registrations but has no clearly separate promotion template. |
| Waitlist cancellation / `08-waitlist-cancellation-parent.txt` | P | Parent-requested waitlist withdrawal is recorded. | Proposed explicit notice. |
| Waitlist no room / `09-waitlist-no-room-parent.txt` | P | Staff closes an offer cycle or publishes the schedule and confirms no place is available. | Existing legacy no-room/regret paths; Festival trigger is proposed. |
| Teacher weekly summary / `10-teacher-weekly-summary.txt` | T | Scheduled weekly run after validated student changes; group only that teacher's new registrations, corrections, repertoire, and waitlist movements. Skip empty summaries. | Proposed; legacy sends individual account updates and schedule mail, not this digest. |
| Accompanist weekly summary / `11-accompanist-weekly-summary.txt` | A | Same weekly run, grouped for the assigned accompanist; skip empty summaries. | Proposed. |
| Family schedule published / `12-family-schedule-published.txt` | P | Staff approves and publishes a schedule version; send affected families their student times, rooms, and repertoire. | Existing legacy parent option in Publish Schedule. |
| Teacher schedule published / `13-teacher-schedule-published.txt` | T | Same publication, with that teacher's assigned students and repertoire. | Existing legacy member option, rendered for teachers. |
| Accompanist schedule published / `14-accompanist-schedule-published.txt` | A | Same publication, with that accompanist's assigned students, times, and repertoire. | Existing legacy member option, rendered for accompanists. |
| Schedule correction / `15-schedule-correction.txt` | P, T, A **only if affected** | Staff publishes a correction to an already released schedule; send each affected role its own relevant details. | Proposed explicit correction message; legacy can clear sent markers after edits. |
| Placement result / `16-placement-result-parent.txt` | P in the proposed Festival policy; legacy recipients unverified | Staff releases finalized placement results. | Existing operator-run placement send; its To/Cc is determined by a runtime template, so no recipient role can be confirmed from the checkout. |

The three schedule publication emails form one release event, with a separate render and send for each role. A member who is both a teacher and an accompanist may need both sections; deduplicate by person while keeping each role's assignments clear. Do not infer that a waitlist invitation guarantees placement or that a purchase confirms a valid registration.

## Evidence and limits

- [Membership opening task](/Users/eric/pafenorthwest/PafeTools/PafeTools/SendMemberRegOpenEmail.cs) selects prior-year teachers and accompanists and says to run once after opening.
- [Registration processor](/Users/eric/pafenorthwest/PafeTools/PafeTools/ProcessRegistrationUpdates.cs) handles account updates, issues, and member-joined emails during a periodic operator-run process.
- [Waitlist invitation task](/Users/eric/pafenorthwest/PafeTools/PafeTools/SendWaitlistInvitationEmail.cs) sends to parents after `Ask` status. Its older no-room branch is inactive; the active waitlist-regret send is in Publish Schedule.
- [Publish Schedule](/Users/eric/pafenorthwest/PafeTools/PafeTools/PublishSchedule.cs) has separate parent, member, and waitlist-regret email options.
- [Placement task](/Users/eric/pafenorthwest/PafeTools/PafeTools/RecordClassPlacements.cs) sends on operator command and gets recipients from `PlacementEmailTemplate.html`.
- [Shared mailer](/Users/eric/pafenorthwest/PAFE/PAFE/PafeMailer.cs) assembles member schedules; [registration tokens](/Users/eric/pafenorthwest/PAFE/PAFE/PafeRegistrations.cs) include repertoire titles and composers.

Original email templates are downloaded at runtime and are unavailable in this checkout. Accordingly, the text files here are fresh drafts, not legacy copy. Confirm the recipient policy, deadlines, links, sender address, and any reply instructions before use.
