# S05 — Live Production Host, Firebase, and Shopify Launch (`v0.4.3` Pre-`Dec 1` Cutover)

## Goal reference
- Goal contract: `goals/s05-live-prod-firebase-shopify-launch/goals.v1.md` (`establish-goals.v1.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Parallel Live Ops Track, unblocked by `D4`, cuts over with `S14 [G4]` on `v0.4.3` ahead of `Dec 1`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (`tenant-org`, `customer-identity`, `teacher-directory`, `commerce-projection`, and production edge/infrastructure)

## Scope

### In scope
- Remote Ubuntu `24.04.5` production host `/opt/Festival` at `<prod-host>` rolled forward from `main` (`c80c5dcb77176633c902f172ad75921085b009ab`) to tagged release `v0.4.3` (`cloud-setup/01-host.sh`, `cloud-setup/02-validate-env.sh`, `cloud-setup/03-prepare-images.sh`, `/opt/Festival/cloud-setup/.env`, `scripts/migrate.ts`)
- Host UFW IPv4/IPv6 firewall verification (Issue `#95`), Cloudflare + host `nginx` Let's Encrypt TLS, and container proxy configuration
- Live production Firebase project (`<prod-firebase-project>`), Web App authorized domains, and Admin service account
- Live Shopify store `performing-arts-festival-eastside.myshopify.com` (`<prod-shopify-handle>`), Custom Admin App (11+ scopes, `2026-07`, `ORDERS_PAID`), Headless Confidential Customer Account OAuth client, private Storefront token, and `packages/shopify-confirmation` production deployment (`shopify.app.production.toml` if non-secret app config updates are needed)
- `database/bootstrap/20261109000000_load_pafe_concertos.sql` + `database/bootstrap/pafe-concertos.csv` execution on live Postgres (`festival_octv3_db`) or `/org/pafe/admin/concerto-repertoire` CSV import (`S20`/`#359`)
- `goals/s05-live-prod-firebase-shopify-launch/{establish-goals,goals}.v1.md`
- `tasks/s05-live-prod-firebase-shopify-launch/{spec,code-review}.md`
- `specs/pre-thanksgiving-program.md` (`D4` resolution and `S05`/`S14 [G4]` status updates)

### Out of scope
- Opening Phase 2 public student class registration prior to December QA and `v1.0.0` sign-off (`ENABLE_DROP_TRANSFER=false`, `SPRING` registration window `2027-01-12`..`2027-02-16`)
- Adding unsupported keys outside the 15-key `cloud-setup/02-validate-env.sh` allowlist into `/opt/Festival/cloud-setup/.env`
- Committing any `.env` files, keys, tokens, or production secrets to Git

## Approach

### Verified Production Baseline (Read-Only SSH Audit 2026-11-23)
Read-only SSH audit of `webadmin@<prod-host>` (`2026-11-23T04:02Z`) verified:
- **Host & network (`[G1]`)**: Ubuntu `24.04.5 LTS` (`6.8.0-149-generic`), `webadmin` (`uid=1000`, `sudo,docker`), `3.8Gi` RAM (`3.1Gi` available), `0B` swap, `77G` disk (`5.5G` / `8%` used); `ufw` `active`/`enabled` with `ENABLED=yes` and `IPV6=yes`; `ss -tuln` public listeners strictly `:22`, `:80`, `:443` (IPv4+IPv6), frontend bound to `127.0.0.1:8080`, `:3000` and `:5432` unexposed; zero Festival cron jobs or systemd timers (`snap.certbot.renew.timer` enabled).
- **Edge & TLS**: `artsfestival.online` proxied via Cloudflare to host `nginx` (`80` `301` to `443`; `certbot-dns-cloudflare` Let's Encrypt cert valid `2026-11-22` to `2027-02-20`), proxying `http://127.0.0.1:8080` (`festival-cloud-frontend-1`) for SPA + `/healthz` (`200 OK`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Referrer-Policy: same-origin`) and raw-body `POST /api/shopify/webhooks/orders-paid` to `http://backend:3000`. Non-blocking notes: `/etc/nginx/nginx.conf` includes `TLSv1 TLSv1.1` alongside `TLSv1.2 TLSv1.3`, and container `nginx` overwrites `X-Forwarded-Proto` with `$scheme` (`http`) and `X-Real-IP` with the Docker bridge IP (non-blocking since backend enforces `FESTIVAL_PUBLIC_ORIGIN` and Cloudflare terminates client TLS).
- **Repo, `.env` & containers**: `/opt/Festival` (`755 webadmin:webadmin`) on clean `main` at `c80c5dcb77176633c902f172ad75921085b009ab` (includes PR `#455`); `/opt/Festival/cloud-setup/.env` (`600 webadmin:webadmin`, untracked) contains all 15 allowed keys (`FIREBASE_PROJECT_ID=<prod-firebase-project>`, `FRONT_FIREBASE_PROJECT_ID=<prod-firebase-project>`, `FRONT_FIREBASE_AUTH_DOMAIN=<prod-firebase-project>.firebaseapp.com`, `FESTIVAL_PUBLIC_ORIGIN=https://artsfestival.online`, `API_ALLOWED_ORIGINS=https://artsfestival.online`, `TRUST_PROXY_HEADERS=true`, `ENABLE_DROP_TRANSFER=false`) and passes `bash cloud-setup/02-validate-env.sh` (exit `0`). `festival-cloud-postgres-1` (`healthy`), `festival-cloud-backend-1` (`Up`), `festival-cloud-frontend-1` (`Up`).
- **Postgres (`festival_octv3_db`), tenant `pafe` & Shopify**: 77 tables and latest indexes present from bootstrap (`orgs.schema_migrations` = `0 rows`); `1` org (`Performing Arts Festival`, `slug=pafe`, `America/Los_Angeles`, `USD`), `1` primary festival (`SPRING`, `Annual PAFE Festival`, `2027-03-30`..`2027-04-03`, reg `2027-01-12`..`2027-02-16`), `4` active divisions (`piano`, `violin/viola`, `cello/bass`, `woodwinds`), `1` `Admin` staff user, `GET /api/organizations/pafe/landing` `200 OK`. Shopify Admin integration `<prod-shopify-handle>` (`performing-arts-festival-eastside.myshopify.com`) shows `verification_status=ok`, `integration_version=8`, 12 scopes granted (all 11 required scopes present), `webhook_readiness_status=ready`, client secret + private Storefront token present. Customer Account integration `<prod-shopify-handle>` shows `readiness=ready`, `integration_version=1`, client secret present (`can_read_orders=false` until first `/account/orders` query). `orgs.repertoire_works` = `0 rows`; `orgs.products` = `1 row` (`Annual Teacher`, `teacher_membership`, `365` days; `$0` Accompanist uses `orgs.membership_division_policies` `one_to_two`). Test-mode smoke artifacts currently in DB: `1` `orders/paid` delivery (`processed` `2026-11-23 03:11:39Z`), `1` `shopify_order_projections` row, `1` `membership_entitlements` row (`teacher_membership`, `active_or_future`), `1` `membership_validation_decisions` (`approved`), `1` `teacher_profiles` (`approved`, `public_directory_opt_in=false`), `0` `accompanist_profiles`.
- **Remaining deltas**: `orgs.schema_migrations` `0 -> 12`, `orgs.repertoire_works` `0 -> 25`, `can_read_orders` pending first authenticated `/account/orders` hit, `packages/shopify-confirmation` Thank-you/Order-status block verification, GitHub `production` CD secrets/vars (`DEPLOY_HOST`, `DEPLOY_SSH_PRIVATE_KEY`, `vars.DEPLOY_PUBLIC_URL`), `v0.4.3` tag deploy, Phase 1 test-mode E2E smoke + pre-`Dec 1` test-row cleanup and Online Store password removal, plus optional host reconciliation/backup timers, 2–4 GB swapfile, and `/etc/nginx/nginx.conf` `TLSv1.2 TLSv1.3` hardening.

### Execution Steps (`[G1]`–`[G5]`)
1. **Verify & Harden Host and Edge Ingress (`[G1]`)**:
   - Maintain `/opt/Festival` (`webadmin:webadmin`), Issue `#95` IPv4/IPv6 UFW (`22`/`80`/`443` only, `127.0.0.1:8080` loopback-only, `:3000`/`:5432` unexposed), and Cloudflare + host `nginx` Let's Encrypt TLS (`https://artsfestival.online`).
   - Confirm `/healthz` returns `200 OK` with `Cross-Origin-Opener-Policy: same-origin-allow-popups` and `Referrer-Policy: same-origin`, and confirm `POST /api/shopify/webhooks/orders-paid` forwards intact raw request bodies.
   - Optional/post-cutover host hardening & observability (operator-approved): restrict `/etc/nginx/nginx.conf` `ssl_protocols` to `TLSv1.2 TLSv1.3`, add a 2–4 GB swapfile, configure scheduled Postgres backups and reconciliation timer, and wire post-`v0.4.3` Grafana Cloud `/opt/monitoring/` telemetry (`Issue #459`).
2. **Pre-Production `v0.4.3` Promotion Gate, Backup, Migration Ledger & `production` CD (`[G2]`, `S14 [G4]`)**:
   - Confirm the production Firebase project (`<prod-firebase-project>`) Web App authorized domain `artsfestival.online` and `/opt/Festival/cloud-setup/.env` (`0600`) passing `bash cloud-setup/02-validate-env.sh`.
   - Follow the operator-sequenced pre-production promotion gate:
     1. Merge PR `#456` (`admin_directory_tooltips`) + `S22` (`s22-phase1-playwright-e2e-smoke`) to `main` and cut the `v0.4.3` release prep PR (5 `package.json` files + `CHANGELOG.md`).
     2. Promote `main` to `release` (triggering `.github/workflows/deploy.yml` to `integration` / `https://int.artsfestival.online`) and verify customer UI tooltips + Phase 1 walkthrough on `int` **before** pushing tag `v0.4.3`.
     3. Take a pre-deploy `pg_dump -Fc` snapshot of `festival_octv3_db` in `/home/webadmin/backups/` (`chmod 600`) on `<prod-host>`, set GitHub `production` Secrets (`DEPLOY_HOST=<prod-host>`, `DEPLOY_SSH_PRIVATE_KEY` for `webadmin`; `DEPLOY_USER` defaults to `webadmin`) + Variable (`vars.DEPLOY_PUBLIC_URL=https://artsfestival.online`), then push tag `v0.4.3` on the verified `release` SHA to roll out to `<prod-host>`, confirm `verify`, `build-and-push`, `deploy`, and `smoke-test` pass, and run `scripts/migrate.ts` (`12` idempotent SQL migrations into `orgs.schema_migrations`) using the exact ephemeral runner pattern from `.github/workflows/deploy.yml`:
     ```bash
     docker run --rm --network festival-cloud_default --env-file cloud-setup/.env \
       -e DB_HOST=postgres -e DB_PORT=5432 -e DATABASE=festival_octv3_db \
       -e DB_USER=festivaladmin -e DB_SSL=false -e DB_SCHEMA=orgs \
       -v "${PWD}:/app:ro" -w /app oven/bun:1.4.2 bun run scripts/migrate.ts
     ```
3. **Verify Live Shopify Apps & `packages/shopify-confirmation` Blocks (`[G3]`)**:
   - Confirm `performing-arts-festival-eastside.myshopify.com` (`<prod-shopify-handle>`) Custom Admin App (`Embedded = false`, `2026-07`, `ORDERS_PAID` webhook -> `https://artsfestival.online/api/shopify/webhooks/orders-paid`, all 11 required Admin/Customer scopes) and Headless Confidential Customer Account API OAuth (`/api/customer-auth/callback`, logout `/org/pafe/account`) + private Storefront token.
   - Verify production `packages/shopify-confirmation` Thank-you and Order-status checkout blocks are active with `Festival application origin = https://artsfestival.online` and `slug = pafe`.
4. **Seed 25 PAFE Concertos & Pass Test-Mode Phase 1 E2E Smoke (`[G4]`)**:
   - While the Online Store password gates public buyers, seed all 25 PAFE concertos via `database/bootstrap/20261109000000_load_pafe_concertos.sql` + `database/bootstrap/pafe-concertos.csv` (or `/org/pafe/admin/concerto-repertoire` CSV import from `S20`/`#359`).
   - Verify `/org/pafe/admin/integrations` diagnostics (`orders_paid_webhook` + `private_storefront_token` PASS; `public_storefront_access` reports expected `locked` while the Online Store password is enabled).
   - Execute end-to-end test-mode Phase 1 smoke against `https://artsfestival.online`: Customer OAuth login + `/account/orders` (confirming `can_read_orders=true`) + `<form method="POST">` logout (`200`/`302`), paid Teacher checkout + recovery (`#455`) + `#361`/`#418` directory & single-division rules, `$0` Accompanist signup + `#416` directory parity, PR `#456` customer help tooltips, and `S22` Phase 1 Playwright smoke.
5. **Execute Pre-`Dec 1` Go-Live Cutover Hygiene (`[G5]`)**:
   - With explicit operator confirmation, purge or revoke test-mode smoke rows (`orders/paid` delivery, `shopify_order_projections`, `membership_entitlements`, `membership_validation_decisions`, `teacher_profiles`, and any smoke `accompanist_profiles`).
   - Disable Shopify test payment mode in favor of live payments, remove Online Store password protection on `performing-arts-festival-eastside.myshopify.com`, confirm all `3/3` `/org/pafe/admin/integrations` diagnostics PASS (`public_storefront_access` unlocked), and record `S05` + `S14 [G4]` completion in `specs/pre-thanksgiving-program.md`.

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s05-live-prod-firebase-shopify-launch -Iteration v1
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
Iteration v1 locked (2026-11-23) following read-only SSH audit of webadmin@<prod-host>; [G1] host/TLS/env & initial pafe/Shopify wiring verified; [G2]-[G5] execution pending.

## Quality gate results
Pending execution.
