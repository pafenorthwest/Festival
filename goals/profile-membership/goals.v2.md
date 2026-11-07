# Accompanist membership sharing consent

State: locked

Authorization: User requested requiring sharing consent when acquiring accompanist membership and updating PR 311. Prior goals in goals.v1.md remain delivered.

Goals and success criteria:
1. Accompanist enrollment presents an unchecked required sharing-consent checkbox and privacy-policy link. Submission requires affirmative consent and sends the boolean to the server.
2. Acquisition rejects missing, false, or nonboolean consent. Valid customer session and CSRF establish consent ownership; persist the current staff-access privacy-notice version before creating a membership. Recording failure must not create a membership.
3. Add regression coverage for consent rejection, accepted recording, and the frontend request; preserve existing membership and profile behavior. Update existing PR 311 with passing formatting, relevant tests, and common/backend/frontend checks.

Non-goals: retroactive consent for existing grants, changing the admin contact DTO, changing teacher checkout, postal-code fixes, or creating a second PR.
