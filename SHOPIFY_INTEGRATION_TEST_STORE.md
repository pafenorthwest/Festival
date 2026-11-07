# New Shopify integration test store

Use this checklist to connect a new Shopify dev store to a separate Festival
integration app and to deploy the **Return to Festival account** checkout UI
extension. Keep the app, dev store, and Festival organization for this environment
distinct from other test or production environments.

## 1. Create and prepare the store

1. In the [Shopify Dev Dashboard](https://dev.shopify.com/), open **Stores →
   Create store → Dev**. Name the store, choose its plan, and finish creation.
   Open the store admin at [admin.shopify.com](https://admin.shopify.com/) and
   complete its business details and other required setup prompts.
2. In the store admin, open **Settings → Domains** and copy the exact
   `*.myshopify.com` domain. For example, a store shown as
   `int-page.myshopify.com` uses that full domain, not `int-pafe`, a display
   name, or an `admin.shopify.com/store/...` URL.
3. Confirm the new app will belong to the **same Shopify organization** as the
   store. Festival's Admin API integration uses Shopify's server-side client
   credentials grant, which requires an app and store in the same organization.

[Shopify: create a dev store](https://shopify.dev/docs/apps/build/stores/development-stores) ·
[Shopify: client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)

## 2. Create and configure the Admin app

In [dev.shopify.com](https://dev.shopify.com/), open **Apps → Create app** in
the store's organization. Give it a distinct name such as `PAFE Integration`.
Create an app version with these settings (use the integration environment's
actual Festival URL):

| Setting | Value |
| --- | --- |
| Application URL | Reachable Festival integration admin URL, for example `https://<integration-origin>/org/<slug>/admin`. Festival does not create this app setting. |
| Embedded | `false` |
| Access scopes | `read_customers,read_orders,read_products,write_products,write_inventory,read_publications,write_publications,customer_read_customers,customer_read_draft_orders,customer_read_metaobjects,customer_read_orders` |
| Legacy install flow | `false` |
| Allowed redirection URLs | Empty (`redirect_urls = []`); the Admin integration has no OAuth redirect with client credentials. |
| Webhook API version | `2026-07` |

The scope list comes from
[`SHOPIFY_REQUIRED_SCOPES`](packages/common/src/shopify.ts). The existing
[`shopify.app.toml`](shopify.app.toml) also includes `read_inventory`; that scope
is optional for Festival's current required list. Release the configured app
version before installation. After a later scope change, approve the updated
permissions on the installed store; a version's scope list alone does not prove
that the store granted them.

Do not add an `ORDERS_PAID` destination to the app TOML. Festival registers and
repairs its app-owned paid-order subscription for the connected store after
**Save & Test** or **Diagnostics**, using `FESTIVAL_PUBLIC_ORIGIN`. The webhook
API version alone does not create that subscription.

For this **custom app**, Shopify lists protected customer data Levels 1 and 2
as available without a public-app review. A separate **Protected customer data
access** request is not part of this setup; the other cards on **API access
requests** (such as Read all orders or Subscriptions APIs) are not required by
Festival's current integration. Keep the requested scopes limited to what the
app uses and verify effective data access in Festival. Shopify's protected-data
requirements still apply to how the data is handled.

[Shopify: Dev Dashboard apps](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard) ·
[Shopify: protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)

## 3. Choose distribution and install

- **If the app's Overview has a Distribution card:** Shopify says this card
  appears for Partner-organization apps. Select **Custom distribution**, enter
  the exact `*.myshopify.com` domain from **Settings → Domains**, and generate
  the custom install link. Open the link as an administrator of that store and
  approve installation.
- **If the app has an Installs card instead:** Use **Install app** on that card,
  or **⋯ → Install** on the app row in the Dev Dashboard. Select the dev store
  and approve installation. This is the path Shopify documents for an app
  created in the store's organization.

If this app is already installed on the intended store with the released scopes,
no new install link or reinstall is needed. Use Festival's **Save & Test** to
confirm the actual credentials and granted scopes.

[Shopify: distribution methods](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method) ·
[Shopify: install a Dev Dashboard app](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard)

## 4. Set up Headless customer accounts

This is a separate Shopify client from the Admin app above.

1. In the store admin, open **Settings → Customer accounts** and choose the new
   **Customer accounts** option for online store and checkout.
2. Install Shopify's **Headless** sales channel. Select **Create storefront**
   on first installation or **Sales channels → Headless → Add storefront**.
3. In that storefront's **Customer Account API settings**, choose a
   **confidential client** and grant `customer_read_orders`. Record its account
   domain, client ID, and client secret; do not substitute the Admin app's
   credentials.

The Headless storefront also has Storefront API tokens. Record the **private**
Storefront token only if this environment's storefront implementation requires
it; keep it server-side. It is not the Customer Account client secret.

[Shopify: Headless channel](https://shopify.dev/docs/storefronts/headless/overview) ·
[Shopify: Customer Account API setup](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started)

## 5. Connect Festival and verify the webhook

1. Set `FESTIVAL_PUBLIC_ORIGIN` on the integration backend to its publicly
   reachable HTTPS **origin**, with no path. Confirm DNS, TLS, and proxy routing
   for `https://<integration-origin>/api/shopify/webhooks/orders-paid`.
2. In Festival at `/org/<slug>/admin/integrations`, use the **Shopify
   Integration** card to enter the store's exact `*.myshopify.com` domain and
   the **new Admin app's** client ID and secret.
   Enter the new secret explicitly when replacing an older integration; leaving
   the field blank retains the saved secret.
3. Select **Save & Test**, then run **Shopify Integration → Diagnostics**. Check
   the effective scopes, especially `read_orders`, and confirm the app-owned
   `ORDERS_PAID` webhook points to this environment. Diagnostics can repair a
   stale subscription. Do not create a manual store-admin webhook.
4. On the same Festival page, use the **Shopify Customer Accounts** card to
   enter the Headless account domain, client ID, and secret from section 4,
   then select **Save & Verify**. Copy Festival's exact callback and logout
   return URLs into the Headless client's application setup. The callback has the form
   `https://<integration-origin>/api/customer-auth/callback`; the logout return
   goes to `https://<integration-origin>/org/<slug>/account`.

See [SETUP.md](SETUP.md) for the keyring, webhook delivery, reconciliation, and
credential handling requirements.

## 6. Link and deploy the checkout UI extension

From this repository root, use Shopify CLI to link a **named configuration** to
the new app. When prompted, select the new integration app and a name such as
`integration`; keep the existing `shopify.app.toml` for `PAFE Test 2026-09`.
Inspect the generated `shopify.app.integration.toml`, including its client ID,
application URL, scopes, and extension directory, before deploying. If the
linked file does not include the extension directory, add the same
`extension_directories = ["packages/shopify-confirmation/extensions/*"]` entry
as the existing [`shopify.app.toml`](shopify.app.toml), then validate again.

```powershell
shopify app config link
shopify app config validate --config integration
shopify app deploy --config integration
```

Linking a config changes Shopify CLI's default app configuration. Use
`--config integration` on later commands intended for this app, or restore the
previous default with `shopify app config use` and select the previous config.

Inspect CLI's proposed changes before confirming the deploy. The extension
source is at
[`packages/shopify-confirmation/extensions/festival-account-return`](packages/shopify-confirmation/extensions/festival-account-return).
It declares Thank you and Order status targets. Let Shopify CLI maintain its
extension UID mapping for the new app; check what CLI proposes instead of
manually changing the UID. `shopify app deploy` builds, deploys, and releases an
app version; it does not deploy the Festival web application.

In the store's **Settings → Checkout → Customize**, add **Return to Festival
account** to **Thank you** and **Order status**. Set **Festival application
origin** to this environment's HTTPS origin and **Festival organization slug**
to its actual slug in both blocks, then save. The extension source defaults to
`https://festival.passmore.xyz` when the origin setting is empty, so set the
integration origin explicitly. Preview both pages in the checkout editor, then
open a test order's Thank you and Order status pages to check that the button
opens the correct Festival account.

[Shopify: multiple app configs](https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files) ·
[Shopify: app deploy](https://shopify.dev/docs/api/shopify-cli/app/app-deploy)

## 7. Test a paid membership checkout

In store admin, open **Settings → Payments** and activate Shopify's **Test
payment gateway**. Start a Teacher Membership checkout **from Festival** and
complete Shopify checkout with card-number field `1`, any future expiry, and
any three-digit CVV. Enter `Test payment gateway` as the cardholder name. This
simulates a successful payment; it is separate from Shopify app billing.

Verify that Festival records a processed paid-order delivery, an approved
validation decision, and one active entitlement grant. A generic Shopify test
webhook cannot prove Festival's checkout correlation. Also open Thank you and
Order status and verify that **Return to Festival account** points to this
environment's account page.

[Shopify: Test payment gateway](https://help.shopify.com/en/partners/manage-clients-stores/test-orders)
