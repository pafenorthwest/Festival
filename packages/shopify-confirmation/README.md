# Return to Festival account

This Shopify UI extension adds **Return to Festival account** to the Thank you and Order status pages. It links to `/org/:shortname/account?checkout=processing` and adds 40px of whitespace below the button, approximately two blank text lines. For PAFE on the integration site, the destination is:

```text
https://int.artsfestival.online/org/pafe/account?checkout=processing
```

The button uses Shopify's native link-button navigation. It does not automatically redirect, read an order, transmit customer data, or grant membership. Festival uses its own customer session and server-confirmed status. If sign-in is needed, Festival preserves this exact processing return through OAuth.

## Local verification

From the Festival repository root:

```sh
bun install --frozen-lockfile
bun run build:confirmation
bun run test:confirmation
```

Both targets compile against the pinned `@shopify/ui-extensions` 2026.7.0 SDK. They use Shopify-provided web components directly; the bundles have no third-party runtime dependency. Root build, test, and format checks include this workspace.

## Connect the existing Shopify app

Deployment uses the existing Shopify app installed on the intended integration store. The repository root can serve as its CLI project: the local, gitignored `shopify.app.toml` currently links **PAFE Test 2026-09** and discovers this extension with:

```toml
extension_directories = ["packages/shopify-confirmation/extensions/*"]
```

Inspect that local configuration and confirm it is the intended app before deployment. If `shopify.app.toml` is missing or linked to a different app, run `shopify app config link` from the repository root and select the existing integration app. Ensure the linked configuration retains the `extension_directories` setting above. Preserve the app's existing scopes, URLs, webhooks, and other extensions; do not replace its configuration with a blank app.

The checked-in extension does not invent a Shopify UID. Retain the UID assigned when Shopify CLI registers it, including on subsequent deployments. An operator needs access to the existing app in Shopify's Dev Dashboard.

## Preview, deploy, and activate on integration

These are operator instructions; this change has not deployed or activated the extension in Shopify.

1. From the Festival repository root, optionally run `shopify app dev` against the integration development store to preview both targets.
2. Validate and deploy the linked app from the same directory:

   ```sh
   shopify app config validate
   shopify app deploy
   ```

   Review the CLI's selected app and proposed changes before confirming. `shopify app deploy` builds and releases the app configuration and extensions. It does not deploy the Festival web application. The integration web application must already provide the `/org/:shortname/account?checkout=processing` handoff route.
3. In the integration store's **Settings → Checkout → Customize**, select **Thank you** and add the **Return to Festival account** app block below the order confirmation.
4. Configure the block with **Festival application origin** = `https://int.artsfestival.online` and **Festival organization slug** = `pafe`, then save.
5. Select **Order status**, add the same app block, enter the same settings, and save. Configure both placements separately.
6. Complete a test checkout and verify that the button opens `https://int.artsfestival.online/org/pafe/account?checkout=processing`, with approximately two blank lines below it. Revisit the order to check the Order status placement too. Repeat with an expired Festival session to check sign-in behavior.

The origin setting accepts an HTTPS origin only (no credentials, path, query, or fragment). It defaults to `https://festival.passmore.xyz`, so explicitly set the integration origin in both blocks. The organization slug is required. Invalid or missing settings hide the button and its spacing for customers and show configuration guidance in the editor. No additional API, network, customer-data, or checkout-blocking capability is requested.

Live Shopify rendering and placement require the linked app, release, and editor configuration above. Local rendering tests cover label, destination, spacing, unsafe configuration, and reactive editor settings; they do not emulate Shopify's host renderer or replace a store preview.

## Official references

- [Thank you and Order status extension targets](https://shopify.dev/docs/apps/build/checkout/thank-you-order-status/add-survey)
- [Checkout button navigation](https://shopify.dev/docs/api/checkout-ui-extensions/latest/web-components/actions/button)
- [Deploy an app with Shopify CLI](https://shopify.dev/docs/api/shopify-cli/app/app-deploy)
- [Add app blocks in the checkout and accounts editor](https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/checkout-apps)
- [Link an existing Dev Dashboard app to Shopify CLI](https://shopify.dev/docs/apps/build/cli-for-apps/migrate-from-dashboard)
