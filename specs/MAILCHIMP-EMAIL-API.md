# Mailchimp email dispatch API

Status: Proposed specification. This document defines a reusable backend capability; it does not implement sends or define when business events occur.

## Purpose and boundary

Festival exposes an internal API that accepts a **caller-selected set of recipients** and the data each recipient needs in a Mailchimp-owned email template. A future registration, waitlist, scheduling, membership, volunteer, or administrative service decides *whether and when* to call it. The email API validates, records, and submits those requests to Mailchimp. It does not discover lifecycle events, schedule a weekly digest, choose recipients from business records, or author email copy.

An API caller may prepare one recipient or a bounded batch. A teacher or accompanist digest is already grouped by the caller before submission. A family schedule message is already narrowed to the family and its own registration data. Shopify continues to own its order-completion receipt.

This specification covers email only. SMS remains outside this Mailchimp contract.

## Ownership

| Concern | Owner |
| --- | --- |
| Trigger timing, business eligibility, role-to-person lookup, recipient selection, and digest assembly | Calling Festival service or authorized staff workflow |
| Subject, body, visual design, merge tags, automation flow, and publication of production templates | Mailchimp |
| Stable template key, transport, provider template/event identifier, permitted roles, required variable names, active state, and organization mapping | Festival **metadata registry**; no subject or body copy |
| Request validation, authorization, per-recipient idempotency, provider submission, status, retry, and audit | Festival email API |
| Marketing audience membership, subscription and suppression state | Mailchimp Marketing, with consent provenance maintained by the responsible enrollment process |

“Audience” has two meanings here. In the Festival request, `recipients` is the exact intended set of people. A Mailchimp Marketing **audience** is a configured contact list identified by a provider list ID. The caller cannot send to an arbitrary list ID or segment, and a role such as `teacher` does not cause the API to fetch every teacher. For Marketing event dispatch, each requested address must already be a contact in the configured Mailchimp audience and be eligible for the associated marketing flow. For Transactional dispatch, the application supplies addresses directly; Mailchimp Transactional does not maintain a contact list. Mailchimp distinguishes those delivery models in its [product comparison](https://mailchimp.com/help/about-transactional-email/).

## Mailchimp transport choices

Each active registry entry has exactly one configured transport:

- **`marketing_event`:** Post one custom event for each eligible contact using the [Marketing member-event endpoint](https://mailchimp.com/developer/marketing/api/lists/members/create-member-event). A Mailchimp automation flow tied to that event owns the template and sends the email. Event properties are strings, so the registry must map and bound the caller’s variables to named string properties. Mailchimp supports event-property merge tags, and event-triggered automation requires an eligible paid Marketing plan; contacts must exist in the audience first ([Mailchimp event guidance](https://mailchimp.com/help/use-events-behavioral-targeting/)). This transport is for messages appropriate to marketing subscription and consent rules. Posting an event is **not** proof that the email was sent.
- **`transactional_template`:** Send a published Mailchimp Transactional template to each explicit recipient through [`messages/send-mc-template`](https://mailchimp.com/developer/transactional/api/messages/send-mc-template). Pass recipient-specific variables through the template’s documented [dynamic-content fields](https://mailchimp.com/developer/transactional/docs/templates-dynamic-content/). This is the preferred transport for essential individualized registration and schedule notices when marketing subscription cannot be assumed. The Mailchimp Transactional add-on and credentials must be provisioned before enabling these entries ([Mailchimp product and plan requirements](https://mailchimp.com/help/about-transactional-email/)). A provider `sent` or `queued` response is submission status, not inbox delivery.

The registry, not the request, chooses the transport. An inactive, unpublished, or unconfigured template fails validation before any recipient is submitted. Activating a Marketing entry also requires a verified active Mailchimp flow for its event name and a test send; an accepted event alone cannot establish that the flow is running. The registry records the Mailchimp template ID or event name, intended variable names and types, role allowlist, provider account/audience mapping, and a registry version. Marketing events must respect Mailchimp’s 2–30-character event-name limit and string-only event properties. Nested schedule or repertoire arrays are accepted only for transactional templates that have been tested with their chosen merge language; a Marketing variant would need deliberately formatted short string properties or a secure link to Festival.

## Proposed internal API

`POST /api/organizations/:slug/communication/email-dispatches`

The organization comes from authenticated tenant context and the route slug, never from a trusted request-body `organizationId`. Internal services authenticate with a scoped service identity; a manual send or preview action requires a separate admin permission. Ordinary tenant membership alone must not authorize an arbitrary email send. If a `festivalShortName` is supplied, the API verifies it belongs to that organization and records it for audit; a future caller remains responsible for selecting people and data from that festival.

```json
{
  "templateKey": "family_schedule_published",
  "festivalShortName": "2027",
  "idempotencyKey": "schedule-publication:2027:v3:families",
  "recipients": [
    {
      "email": "parent@example.org",
      "role": "parent",
      "recipientKey": "account:123",
      "variables": {
        "parent_name": "Alex",
        "festival_name": "PAFE 2027",
        "schedule_url": "https://example.org/schedule/secure-link",
        "students": [
          {
            "name": "Jordan",
            "class": "Piano Solo",
            "starts_at": "2027-03-20T10:30:00-07:00",
            "location": "Room 4",
            "repertoire": [
              { "title": "Sonatina in C", "composer": "Clementi" }
            ]
          }
        ]
      }
    }
  ]
}
```

The JSON above is an illustrative caller payload. The actual template and variable contract must be registered and tested in Mailchimp before use. `recipientKey` is a stable caller-owned person/account reference for audit and deduplication; it is not a lookup instruction to this API.

Required request fields:

| Field | Contract |
| --- | --- |
| `templateKey` | Active, organization-scoped registry key. The caller cannot provide template body, subject, Mailchimp ID, event name, or transport. |
| `idempotencyKey` | Stable identifier for one intended batch or release. Reuse on a network retry; use a new key for an intentional correction or resend. |
| `recipients` | Nonempty, bounded array of explicit entries. Each entry has a valid email, `role` (`parent`, `teacher`, `accompanist`, or a separately registered role), stable `recipientKey`, and `variables`. No open-ended segment query or `all` role is accepted. |
| `variables` | Per-recipient object matching the registry’s required variable schema. Shared values may be repeated per recipient; no implicit cross-recipient defaults. |
| `festivalShortName` | Optional only for messages that are not festival-specific; required by registry entries for festival-specific messages. |

Set a documented batch limit, variable size limit, URL policy, and provider rate limit during implementation. The API should reject the entire request on a malformed recipient, unknown role, missing required variable, duplicate `(normalized email, role, recipientKey)` entry, incompatible transport value type, cross-tenant festival, inactive template, or conflicting reuse of an idempotency key. The same address may appear with different roles when the caller explicitly intends distinct role-specific messages. It must validate that every role is allowed by that template. It must not infer parental, teacher, or accompanist access from an email address: the caller attests that each person may receive only the included student details.

The API persists one batch and one recipient delivery record per accepted entry before provider submission. A successful initial request returns `202 Accepted` with a batch ID and per-recipient IDs and `pending` states. `GET /api/organizations/:slug/communication/email-dispatches/:batchId` returns tenant-scoped status and safe error codes. An exact retry with the same key and identical normalized request returns the original batch and records; a changed payload with that key returns `409 Conflict`. The deduplication scope is organization plus idempotency key, with recipient records uniquely identified within the batch. No two provider submissions may run concurrently for the same recipient record.

Example response:

```json
{
  "batchId": "b5d727c7-1e67-4c90-a8b0-75f17e81883f",
  "status": "pending",
  "recipients": [
    {
      "recipientId": "f676b9d5-76be-4341-a882-c593a88fc064",
      "recipientKey": "account:123",
      "role": "parent",
      "status": "pending"
    }
  ]
}
```

## Submission, retry, and privacy rules

Use recipient-level states that describe what Festival actually knows: `pending`, `provider_accepted`, `provider_queued`, `failed_retryable`, `failed_terminal`, and `suppressed`. A Marketing event’s successful `204` means `provider_accepted`, not delivered. A Transactional result can be queued, sent/accepted, or rejected per recipient; record the provider result without claiming mailbox delivery. If webhooks are configured later, keep actual delivery, bounce, and complaint events separate from submission state. Batch status is derived from its recipient records, including partial success.

Transient provider errors retry with bounded exponential backoff and the same recipient record. Permanent validation, rejection, consent, or suppression failures do not retry automatically. A worker lease prevents concurrent attempts. An ambiguous provider timeout must not be blindly resent: reconcile with available provider data or mark for operator review because Mailchimp’s Marketing event endpoint has no Festival idempotency key. Intentional resends use a new request key and are audited. Each attempt records transport, registry version, provider reference if supplied, safe error category, and timestamps. Do not log API keys, full variable payloads, children’s repertoire, or secure links in ordinary application logs. Protect stored payloads and audit access according to Festival’s data-retention policy; delete them when no longer needed for delivery or investigation.

Marketing eligibility is checked against the configured audience before posting. The API must never silently subscribe a person or change their marketing consent to make a dispatch succeed. Ineligible contacts are `suppressed` with a reason visible to authorized operators. Transactional routing is permitted only for templates whose content and use are approved as transactional; it is not a bypass for marketing opt-outs. Provider credentials remain server-side and separated by organization configuration. A provider outage must be visible in status and must not change the underlying registration, booking, or schedule decision.

## Illustrative calls, not trigger requirements

These examples show how a future caller could use the same API. They do **not** establish a lifecycle, a schedule, or automatic trigger timing.

1. **Family schedule:** A scheduling service or approved staff action selects one parent, gathers only that family’s schedule and repertoire, and calls `family_schedule_published` with role `parent`. The full request example above shows this case. It may supply a secure schedule link instead of large or sensitive merge data.
2. **Teacher or accompanist weekly digest:** A separate future job groups changes for one teacher or accompanist. It calls `member_weekly_digest` once per person, with role `teacher` or `accompanist`, a period such as `2027-W11`, and that person’s own student summaries. The caller creates the period and grouping; this API does not run weekly. For example:

   ```json
   {
     "templateKey": "member_weekly_digest",
     "festivalShortName": "2027",
     "idempotencyKey": "digest:2027-W11:members",
     "recipients": [
       {
         "email": "teacher@example.org",
         "role": "teacher",
         "recipientKey": "member:teacher-42",
         "variables": {
           "member_name": "Lee",
           "period": "March 8–14, 2027",
           "students": [{ "name": "Jordan", "change": "Piano Solo registration confirmed", "repertoire": "Sonatina in C — Clementi" }]
         }
       },
       {
         "email": "accompanist@example.org",
         "role": "accompanist",
         "recipientKey": "member:accompanist-31",
         "variables": {
           "member_name": "Pat",
           "period": "March 8–14, 2027",
           "students": [{ "name": "Morgan", "change": "Vocal Solo repertoire updated", "repertoire": "Caro mio ben — Giordani" }]
         }
       }
     ]
   }
   ```

   This nested structure presumes a tested `transactional_template` registry entry. The two recipient records carry different student data; no shared list is inferred.

3. **Membership registration open:** An authorized workflow selects eligible prior-year teachers and accompanists and calls `membership_registration_open` with those explicit roles and a registration URL. If configured as `marketing_event`, each recipient must already be a consented, eligible Mailchimp audience contact. For example:

   ```json
   {
     "templateKey": "membership_registration_open",
     "festivalShortName": "2027",
     "idempotencyKey": "membership-open:2027:members",
     "recipients": [
       {
         "email": "teacher@example.org",
         "role": "teacher",
         "recipientKey": "member:teacher-42",
         "variables": { "first_name": "Lee", "registration_url": "https://example.org/membership", "deadline": "2027-02-01" }
       },
       {
         "email": "accompanist@example.org",
         "role": "accompanist",
         "recipientKey": "member:accompanist-31",
         "variables": { "first_name": "Pat", "registration_url": "https://example.org/membership", "deadline": "2027-02-01" }
       }
     ]
   }
   ```

   For a Marketing registry entry, the three variable values are mapped to string event properties. A configured Mailchimp automation flow handles the email; event acceptance does not mean delivery.

## Fit with the current repository

The current [communication route](../packages/backend/src/routes/communication.routes.ts) has `POST /events` for one `recipientDestination`, and its [service](../packages/backend/src/communication/communication-service.ts) renders stored subject/body text and sends through a generic provider. [App wiring](../packages/backend/src/app.ts) constructs that service without a production email provider. The proposed batch API, metadata registry, Mailchimp adapters, and status worker are **new work**, not existing behavior. The current `delivered` status is too strong for provider acceptance, and current duplicate-event handling skips a recorded failure; neither should be reused unchanged for this contract. The existing route’s tenant authentication is also insufficient for a general arbitrary-recipient send.

For Mailchimp email, this document supersedes the app-owned, versioned email template body and local `event → template render → send` guidance in [Side Quests #1](SIDEQUESTS-2026.md#1-communications-automation-email--sms). It does not change that document’s SMS ideas or create the lifecycle triggers listed there. Existing [email draft files](email-lifecycle-drafts/LIFECYCLE.md) are reference copy only; production email content must be created and maintained in Mailchimp. The [Volunteer Portal specification](VOLUNTEER-PORTAL.md#mailchimp-integration) may call this API when its distinct business rules are implemented, subject to its own unresolved consent, failure, and reminder decisions.

## Acceptance criteria for implementation

1. An authorized service can submit an explicit, mixed-role recipient set and unique per-recipient variables for a registered Mailchimp template; unauthorized, cross-tenant, or arbitrary-recipient browser calls are rejected.
2. Production subject and body are sourced from Mailchimp. Festival stores only registry metadata and send/audit records for this email path.
3. The selected transport enforces its prerequisites: audience membership and marketing eligibility for Marketing events; published template, configured credentials, and Transactional entitlement for Transactional sends.
4. Exact request retries do not create extra recipient submissions; conflicting key reuse fails. Failed, partial, suppressed, queued, and provider-accepted outcomes remain distinguishable and inspectable.
5. Validation rejects incomplete personalization before any provider submission. Tests cover different family data for two parents, distinct teacher and accompanist digests, marketing suppression, provider partial failure, and parking an ambiguous outcome for reconciliation without an automatic duplicate send.
6. No scheduling, recipient discovery, digest construction, or lifecycle event trigger is added as part of this API work.
