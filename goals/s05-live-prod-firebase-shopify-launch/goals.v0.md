# Goals Extract
- Task name: s05-live-prod-firebase-shopify-launch
- Iteration: v0
- State: blocked

## Goals
1. Provision and harden the Ubuntu 24.04 production host at `/opt/Festival` on tag `v0.3.0` using `cloud-setup/01-host.sh`, Issue `#95` IPv4/IPv6 UFW rules (`IPV6=yes`, allow `80`/`443`/management `22`, deny `3000`/`5432`/`8080`), DNS, and a TLS reverse proxy preserving `X-Forwarded-Proto: https`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Referrer-Policy: same-origin`, and raw webhook bodies.
2. Configure the live production Firebase project/Web App and populate all 15 required variables in `/opt/Festival/cloud-setup/.env` (`chmod 600`), passing `cloud-setup/02-validate-env.sh` and `cloud-setup/03-prepare-images.sh`, bringing up the `v0.3.0` stack via `docker compose up -d`, and setting GitHub `production` environment secrets (`DEPLOY_HOST`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_PUBLIC_URL`).
3. Configure the live Shopify Store and Custom Admin App (`Embedded = false`, `2026-07` webhooks, all 11 Admin/Customer scopes), Headless Confidential Customer Account API OAuth client + Storefront token, and deploy `packages/shopify-confirmation` (`shopify app deploy --config production`) with Festival origin `https://artsfestival.online` and slug `pafe` on Thank-you and Order-status blocks.
4. Bootstrap the `pafe` tenant via Firebase Admin, connect live Shopify in `/org/pafe/admin/integrations` (confirming `ORDERS_PAID` webhook registration), seed the 25 PAFE concertos from `#360` (`20261109000000_load_pafe_concertos.sql`), and pass live end-to-end smoke verification on `v0.3.0`.

## Non-goals
- Deploying unmerged Wave 2 or Wave 3 refactor branches onto production prior to the `v0.4.0` release cutover (`S14`).
- Opening public student class registration prior to December QA and `v1.0.0` sign-off (`ENABLE_DROP_TRANSFER=false`).
- Committing any live secrets, `.env` values, service-account keys, or Shopify tokens into Git.

## Success criteria
- [G1] `/opt/Festival` runs at `v0.3.0` on Ubuntu 24.04; `ufw status verbose` enforces IPv4/IPv6 allow on `80`/`443`/mgmt `22` and blocks external probes to `3000`/`5432`/`8080`; `https://artsfestival.online/healthz` returns `200` over valid TLS with expected security headers.
- [G2] `/opt/Festival/cloud-setup/.env` (`0600` permissions) passes `02-validate-env.sh` with all 15 required variables, containers report healthy in `docker compose ps`, Firebase Admin login + role claims succeed on `https://artsfestival.online`, and GitHub `production` secrets are configured.
- [G3] Live Shopify Admin App (11 scopes, `2026-07`), Headless Customer Account OAuth (`/api/customer-auth/callback` & `/org/pafe/account`), Storefront token, and `packages/shopify-confirmation` Thank-you / Order-status blocks are active in production.
- [G4] `/org/pafe/admin/integrations` shows connected Shopify with `ORDERS_PAID` registered, all 25 PAFE concertos are queryable in Postgres, customer OAuth login + `<form>` POST logout return `200`/`302` (zero `403`), and live Teacher Membership purchase + `#361` `/org/pafe/directory` opt-in + Admin toggle succeed end-to-end.
