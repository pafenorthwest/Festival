## Summary

Deliver the communications automation side quest so critical user and admin events can trigger templated email/SMS messages with delivery logging and safe retry behavior.

## Scope

- Model templates, events, and delivery logs
- Build event-to-template render/send flow
- Support transactional email and SMS providers
- Keep templates editable without code deploys
- Prevent duplicate sends and preserve audit visibility

## Deliverables

- Message template/event/log data model
- Sending pipeline and provider abstractions
- Admin-facing template editing capability or equivalent management path
- Delivery/failure logging for every send attempt

## Acceptance Criteria

- Critical user actions can trigger templated communications
- Templates are editable without a code deploy
- Delivery success and failure are logged
- Duplicate send protection is in place

## Notes

- Spec sources: `specs/SIDEQUESTS-2026.md`
- Workstream: `Side Quest`
- Ownership: `combined`
