# Live checkout restoration verification

Verified on November 15–16, 2026 against `festival.passmore.xyz`, organization `pafe`, linked to development store `test-pafe.myshopify.com`. A fresh isolated visible Chrome profile was used. The user entered both Shopify email codes and the storefront password directly. The browser workflow used normal UI authentication rather than reading cookies or customer tokens from storage.

## Observed flow

1. Completed genuine Shopify Customer Account sign-in and confirmed the intended account through the visible Festival contact page. Order History displayed five existing orders, all showing PAID/FULFILLED, and two confirmed class registrations. The browser observed `GET /customer/orders` **200** with five orders.
2. Confirmed the account had no pending checkout: `GET /customer/pending-checkout` **200**, `checkout: null`, and navbar **Cart 0**. Captured read-only hashes of existing protected records before creating the fixture.
3. Created one dedicated synthetic performer through Festival UI (**201**) and selected an eligible Cello Solo class, the existing registered teacher, and one synthetic three-minute performance piece. Added one registration for **USD100**. Festival checkout creation returned **200**.
4. Passed the development storefront password screen and used Festival's supported Continue checkout action (**200**). Shopify displayed one class line, quantity **1**, total **USD100**, and **Test Payment Gateway**. No payment fields were filled and Pay now was never clicked.
5. Returned to Festival, used its supported Sign out action, and observed Sign in with **Cart 0**. Completed a second genuine email-code sign-in. The navbar automatically restored **Cart 1**, and the cart displayed the saved synthetic registration and unfinished-checkout total **USD100**.
6. Loaded Registration afresh, selected the same performer, division, and teacher, and observed every Register button disabled, including the otherwise available Solo class. The unfinished-checkout panel directed the customer to continue or resolve it first. A full cart-page load retained **Cart 1**, the saved details, and the same total.
7. Continued checkout from the new session: the resume endpoint returned **200**, and Shopify again displayed the same class line, quantity **1**, total **USD100**, with Test Payment Gateway. No payment was attempted. Order History in the second session returned **200** with the same five displayed orders. The last pending-checkout response was **200**, state `ready`, registration count **1**, and `resumeAllowed: true`; the browser recorded no API error responses during this flow.
8. Returned the isolated browser to Festival's cart page, showing the unpaid saved registration for review. No fixture cleanup has been performed.

## Identity and preservation evidence

Read-only comparison after the second sign-in and resume found exactly one fixture intent and line. SHA-256 hashes of the performer, intent, correlation, line, cart reference, and complete provider cart ID matched the pre-relogin fixture snapshot. The execution remained generation **1**, completed/attached, with the same associated provider cart. The intent remained `checkout_started` for **USD100**. This proves persisted-cart identity; an independent checkout-URL hash was not captured.

All four original performer rows, the existing membership, two confirmed class entitlements, three local order projections, and three validation decisions retained their exact baseline row hashes. The only added performer was the synthetic fixture. The customer profile's full-row hash changed during genuine relogin; the normal auth callback records verified Shopify email and timestamps. Because the baseline retained only a whole-row hash, unchanged profile field contents are not claimed. No profile-edit form was submitted.

## Limits and remaining fixture

The genuine sign-in, abandoned checkout, relogin restoration, registration guard, refresh, and same-cart resume checks passed. The original historical Order History error was not reproduced; this flow does not establish its historical cause. These five orders did not display refund information, so refund behavior was not validated. Genuine partial-to-full payment, refunds, and payment completion remain unverified.

One synthetic performer and one unpaid single-registration **USD100** checkout remain for review. Existing purchases and memberships were preserved. Cleanup must target only this new fixture after checking financial state again. Raw identifiers, private checkout URLs, credentials, and personal information are intentionally excluded from this report.
