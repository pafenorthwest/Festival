# Stored postal-code profile retrieval

State: locked

Authorization: User requested fixing profile postal-code retrieval, adding a test using the stored `postalCode` field, and updating existing PR 311.

Goals and success criteria:
1. All teacher/accompanist profile reads (by customer, by profile ID, and admin list) extract the canonical stored `mailing_address.postalCode` into the existing `zip_code` response field.
2. Regression coverage starts from a stored address with `postalCode`, detects the former `zip`/`zipCode` bug, and verifies corrected profile responses. Missing postal codes remain optional.
3. Relevant repository/profile tests, formatting, and common/backend builds pass; update the same branch and PR 311.

Non-goals: rewriting stored addresses, changing the public directory DTO or postal-code response field name, legacy key migration, or unrelated profile and consent behavior.
