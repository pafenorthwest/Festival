# Return to Festival account

This Shopify UI extension adds **Return to Festival account** to the Thank you and Order status pages. For PAFE it links to:

```text
https://festival.passmore.xyz/org/pafe/account?checkout=processing
```

The button uses Shopify's native link-button behavior. It does not automatically redirect, read an order, transmit customer data, or grant membership. Festival uses its own customer session and server-confirmed membership status. If sign-in is needed, Festival preserves this exact processing return through OAuth.

## Local verification

From the Festival repository root:

```sh
bun install --frozen-lockfile
bun run build:confirmation
bun run test:confirmation
```

Both targets compile against the pinned `@shopify/ui-extensions` 2026.7.0 SDK. They use Shopify-provided web components directly; the bundles have no third-party runtime dependency. Root build, test, and format checks include this workspace.

## Connect the existing Shopify app

This repository did not previously contain a linked Shopify CLI app configuration. No app has been created, deployed, released, or changed in Shopify by this task.

An operator with access to the store's existing Dev Dashboard app must link this workspace to that app using Shopify CLI. From this directory:

```sh
shopify app config link
shopify app config validate
shopify app build
```

Select the existing app installed on the intended store, and inspect the imported `shopify.app.toml` before proceeding. Preserve that app's existing scopes, URLs, webhooks, and other extensions. Do not replace its configuration with a fabricated client ID or a minimal blank app. If the app already has a separate CLI project, add `extensions/festival-account-return` to that project instead, retaining any CLI-assigned extension UID. The extension source has no package-runtime dependencies; install the pinned SDK there if type checking is needed.

The checked-in extension does not invent a Shopify UID. Retain the UID assigned when Shopify CLI registers it. Store the resulting app/extension configuration with the app's deployment project.

## Preview and activate

These are deployment instructions, not steps executed by this task.

1. Preview using `shopify app dev` against the appropriate development store. Open the Thank you and Order status targets in Shopify's preview.
2. When release is authorized, deploy through the existing app's release process (`shopify app deploy` releases app configuration and extensions). Deploy Festival's checkout/frontend changes as well.
3. In the store's **Settings → Checkout → Customize**, select **Thank you** and add the **Return to Festival account** app block below the order confirmation. Also add the block to **Order status**, where Shopify sends customers who revisit the order.
4. Configure both blocks for the store: **Festival application origin** = `https://festival.passmore.xyz`, **Festival organization slug** = `pafe`. For another store, use its actual Festival organization slug. Save the editor configuration.
5. In a development/test checkout, verify that the button opens the correct Festival account; repeat with an expired Festival session. Confirm that pending payments stay Processing and only server-confirmed grants appear Active. Do not infer success from the return URL.

The origin setting accepts an HTTPS origin only (no credentials, path, query, or fragment). The organization slug is required. Invalid or missing settings hide the button for customers and show configuration guidance in the editor. No additional API, network, customer-data, or checkout-blocking capability is requested.

Live Shopify rendering and placement still require the linked app, release, and editor configuration above. Local rendering tests cover label, destination, unsafe configuration, and reactive editor settings; they do not claim to emulate Shopify's host renderer or replace a store preview.

## Official references

- [Thank you and Order status extension targets](https://shopify.dev/docs/apps/build/checkout/thank-you-order-status/add-survey)
- [Checkout button navigation](https://shopify.dev/docs/api/checkout-ui-extensions/latest/web-components/actions/button)
- [Polaris web components and execution model](https://shopify.dev/docs/api/polaris/using-polaris-web-components)
- [Link an existing Dev Dashboard app to Shopify CLI](https://shopify.dev/docs/apps/build/cli-for-apps/migrate-from-dashboard)
