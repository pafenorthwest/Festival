# Establish Goals
- Task name: s05-live-prod-firebase-shopify-launch
- Iteration: v0
- State: blocked

## Status
Blocked on infrastructure readiness decision `D4` (target `<prod-domain>`, Ubuntu 24.04 host access, and production Shopify organization ownership) plus completion of `S04` (`v0.3.0`).

## Request
Execute the Parallel Live Infrastructure Track (`Nov 14–20`) against stable `v0.3.0`: provision and harden the Ubuntu 24.04 host (`01-host.sh`, Issue `#95` IPv4/IPv6 UFW, DNS/TLS reverse proxy), configure Live Firebase and all 15 `cloud-setup/.env` secrets, onboard Live Shopify (11 Admin/Customer scopes, Headless Customer Account OAuth, Storefront token, and `packages/shopify-confirmation` Checkout UI Extension), seed `#360` PAFE concertos, and complete live E2E smoke verification.

## Blocking ambiguity
- `D4` (Production Infrastructure): Confirm exact `<prod-domain>`, SSH/root access to the target Ubuntu 24.04 host, and ownership/admin access to the production Shopify organization and Firebase billing/project console.

## Assumptions
- `S05` deploys immutable `v0.3.0` (`S04`) and runs in parallel with Wave 2–3 code refactors (`S06`–`S13`) without blocking or being blocked by refactor PRs.
- All secret material stays strictly inside `/opt/Festival/cloud-setup/.env` (`chmod 600`), GitHub `production` environment secrets, Firebase Console, and Shopify Partners/Admin — zero credentials ever enter repository files or chat logs.
- Every live external mutation (UFW enablement, DNS/TLS cutover, Shopify app deployment, live test order) requires explicit operator confirmation at execution time.

## Goals
1. Provision and harden the Ubuntu 24.04 production host at `/opt/Festival` on tag `v0.3.0` using `cloud-setup/01-host.sh`, Issue `#95` IPv4/IPv6 UFW rules (`IPV6=yes`, allow `80`/`443`/management `22`, deny `3000`/`5432`/`8080`), DNS, and a TLS reverse proxy preserving `X-Forwarded-Proto: https`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Referrer-Policy: same-origin`, and raw webhook bodies.
2. Configure the live production Firebase project/Web App and populate all 15 required variables in `/opt/Festival/cloud-setup/.env` (`chmod 600`), passing `cloud-setup/02-validate-env.sh` and `cloud-setup/03-prepare-images.sh`, bringing up the `v0.3.0` stack via `docker compose up -d`, and setting GitHub `production` environment secrets (`DEPLOY_HOST`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_PUBLIC_URL`).
3. Configure the live Shopify Store and Custom Admin App (`Embedded = false`, `2026-07` webhooks, all 11 Admin/Customer scopes), Headless Confidential Customer Account API OAuth client + Storefront token, and deploy `packages/shopify-confirmation` (`shopify app deploy --config production`) with Festival origin `https://<prod-domain>` and slug `pafe` on Thank-you and Order-status blocks.
4. Bootstrap the `pafe` tenant via Firebase Admin, connect live Shopify in `/org/pafe/admin/integrations` (confirming `ORDERS_PAID` webhook registration), seed the 25 PAFE concertos from `#360` (`20261109000000_load_pafe_concertos.sql`), and pass live end-to-end smoke verification on `v0.3.0`.

## Non-goals
- Deploying unmerged Wave 2 or Wave 3 refactor branches onto production prior to the `v0.4.0` release cutover (`S14`).
- Opening public student class registration prior to December QA and `v1.0.0` sign-off (`ENABLE_DROP_TRANSFER=false`).
- Committing any live secrets, `.env` values, service-account keys, or Shopify tokens into Git.

## Success criteria
- [G1] `/opt/Festival` runs at `v0.3.0` on Ubuntu 24.04; `ufw status verbose` enforces IPv4/IPv6 allow on `80`/`443`/mgmt `22` and blocks external probes to `3000`/`5432`/`8080`; `https://<prod-domain>/healthz` returns `200` over valid TLS with expected security headers.
- [G2] `/opt/Festival/cloud-setup/.env` (`0600` permissions) passes `02-validate-env.sh` with all 15 required variables, containers report healthy in `docker compose ps`, Firebase Admin login + role claims succeed on `https://<prod-domain>`, and GitHub `production` secrets are configured.
- [G3] Live Shopify Admin App (11 scopes, `2026-07`), Headless Customer Account OAuth (`/api/customer-auth/callback` & `/org/pafe/account`), Storefront token, and `packages/shopify-confirmation` Thank-you / Order-status blocks are active in production.
- [G4] `/org/pafe/admin/integrations` shows connected Shopify with `ORDERS_PAID` registered, all 25 PAFE concertos are queryable in Postgres, customer OAuth login + `<form>` POST logout return `200`/`302` (zero `403`), and live Teacher Membership purchase + `#361` `/org/pafe/directory` opt-in + Admin toggle succeed end-to-end.

## Next action
Resolve `D4` (`<prod-domain>`, Ubuntu 24.04 host access, production Shopify org) once `S04` (`v0.3.0`) publishes, flip `State` to `locked`, and execute `tasks/s05-live-prod-firebase-shopify-launch/spec.md`.
