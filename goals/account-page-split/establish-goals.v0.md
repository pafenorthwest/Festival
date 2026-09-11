# Establish Goals

## Status

- Task name: account-page-split
- Iteration: v0
- State: blocked

## Request

- Split the existing customer account page into Memberships, Contact Information,
  and Order History pages under the specified organization account routes. Existing
  account URLs should lead to Memberships.

## Blocking ambiguity

- Should the legacy `/org/:slug/account` (and its trailing-slash variant) perform
  a browser-visible redirect to `/org/:slug/account/memberships`, or is rendering
  the Memberships content while retaining the legacy URL acceptable? If redirecting,
  should existing query parameters, including `?checkout=processing`, be preserved?
- Should each of the three pages include shared account navigation (for example,
  tabs/links to Memberships, Contact Information, and Order History)? If so, where
  should it appear and are there existing design patterns to follow?
- Where should the existing Log out action live: on every new account page, only on
  Contact Information, or somewhere else?
- Should unauthenticated visitors receive the same sign-in experience on every new
  account page, and should the Shopify auth return target always be the Memberships
  URL (including the checkout-processing flow)?
- Is preserving the current text, fields, polling behavior, and order pagination
  sufficient, or are copy/design changes intended as part of this split?

## Assumptions

- The three requested areas map directly to the current page: membership-status
  content to Memberships, Festival profile form to Contact Information, and Shopify
  orders to Order History.
- No API, authorization, or data-model change is requested.

## Goals

1. Provide separate routable customer-account pages for Memberships, Contact
   Information, and Order History at the requested paths.
2. Preserve the existing behavior of each moved area within its designated page.
3. Direct legacy customer-account URLs to the Memberships destination as specified
   once redirect semantics are confirmed.

## Non-goals

- No changes to customer-account APIs, authorization rules, or stored data.
- No redesign beyond any shared navigation explicitly approved.

## Success criteria

- [G1] Each requested URL resolves to its designated account area.
- [G2] Existing membership refresh/polling, contact-profile save, and order
  pagination work on their respective pages.
- [G3] Legacy account URL behavior matches the confirmed redirect requirement.

## Next action

- Ask blocking questions.
