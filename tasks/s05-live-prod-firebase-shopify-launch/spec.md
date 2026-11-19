# S05 — Parallel Live Production Host, Firebase, and Shopify Launch on `v0.3.0`

## Goal reference
- Goal contract: `goals/s05-live-prod-firebase-shopify-launch/goals.v0.md` (`establish-goals.v0.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Parallel Live Ops Track `Nov 14–20`, depends on `S04`, runs in parallel with `S06`–`S13`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (`tenant-org`, `customer-identity`, `teacher-directory`, `commerce-projection`, and production edge/infrastructure)

## Scope

### In scope
- Remote Ubuntu 24.04 production host `/opt/Festival` checked out at tag `v0.3.0` (`cloud-setup/01-host.sh`, `cloud-setup/02-validate-env.sh`, `cloud-setup/03-prepare-images.sh`, `/opt/Festival/cloud-setup/.env`)
- Host UFW IPv4/IPv6 firewall rules (Issue `#95`) and TLS reverse proxy configuration
- Live Firebase production project, Web App authorized domains, and Admin service account
- Live Shopify Store, Custom Admin App (11 scopes, `2026-07`), Headless Customer Account OAuth client, Storefront token, and `packages/shopify-confirmation` production deployment (`shopify.app.production.toml` if non-secret app config updates are needed)
- `database/migrations/20261109000000_load_pafe_concertos.sql` + `database/bootstrap/pafe-concertos.csv` execution on live Postgres
- `tasks/s05-live-prod-firebase-shopify-launch/spec.md` and `tasks/s05-live-prod-firebase-shopify-launch/code-review.md`
- `specs/pre-thanksgiving-program.md` (status flip for `S05` upon smoke sign-off)

### Out of scope
- Wave 2 (`S06`–`S08`) and Wave 3 (`S09`–`S13`) backend/frontend refactor files on `main`
- Committing any `.env` files, keys, tokens, or production secrets to Git

## Approach
1. **Host & Network Hardening (`Nov 14–16`, `#95`)**:
   - Production domain `artsfestival.online` (canonical origin `https://artsfestival.online`, no trailing slash) was confirmed `2026-11-12`; confirm remaining `D4` access expected Monday `2026-11-16` (DNS record cutover, Ubuntu 24.04 SSH/root access, production Firebase project access, and production Shopify organization ownership) and obtain explicit operator confirmation before mutating host firewall/network state.
   - Clone `/opt/Festival` at tag `v0.3.0`, run `cloud-setup/01-host.sh` as `root` (provisioning 4 GB swap if host has 2 GB RAM), enable UFW with `IPV6=yes` (allow `80/tcp`, `443/tcp`, management `22/tcp`; deny external `3000`, `5432`, `8080`), and configure `artsfestival.online` DNS + TLS reverse proxy (`X-Forwarded-Proto: https`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `Referrer-Policy: same-origin`, unbuffered raw body on `/api/webhooks/shopify/*`).
2. **Live Firebase & Stack Bring-Up (`Nov 16–17`)**:
   - Create the production Firebase project + Web App (Google + Email link sign-in enabled, Firebase authorized domain `artsfestival.online`) and generate the Admin service account key.
   - Populate `/opt/Festival/cloud-setup/.env` (`chmod 600`) with all 15 required variables (`DB_PASSWORD`, 3 `FIREBASE_*` vars, 4 `FRONT_FIREBASE_*` vars, `FESTIVAL_SECRET_KEYS_JSON`, `FESTIVAL_ACTIVE_SECRET_KEY_ID`, `FESTIVAL_PUBLIC_ORIGIN=https://artsfestival.online` with no trailing slash, `API_ALLOWED_ORIGINS=https://artsfestival.online` with no trailing slash, `TRUST_PROXY_HEADERS=true`, `FESTIVAL_RECONCILIATION_TOKEN`, plus optional `ENABLE_DROP_TRANSFER=false`).
   - Run `02-validate-env.sh`, `03-prepare-images.sh`, and `docker compose up -d`; set GitHub `production` environment secrets (`DEPLOY_HOST`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_PUBLIC_URL=https://artsfestival.online` with no trailing slash).
3. **Live Shopify & Checkout UI Extension (`Nov 18–20`)**:
   - Create the Custom Admin App (`Embedded = false`, webhook API `2026-07`, all 11 scopes: `read_customers,read_orders,read_products,write_products,write_inventory,read_publications,write_publications,customer_read_customers,customer_read_draft_orders,customer_read_metaobjects,customer_read_orders`).
   - Configure Headless channel Confidential Customer Account API OAuth (`customer_read_orders`, callback `https://artsfestival.online/api/customer-auth/callback`, logout `https://artsfestival.online/org/pafe/account`) and Storefront token.
   - Deploy `packages/shopify-confirmation` (`shopify app deploy --config production`) and configure Thank-you + Order-status blocks (`Festival application origin = https://artsfestival.online`, `slug = pafe`).
4. **Tenant Bootstrap, Concerto Seed & Live E2E Smoke**:
   - Create `pafe` org via Firebase Admin, connect Shopify in `/org/pafe/admin/integrations` (verifying `ORDERS_PAID` webhook registration), seed `#360` 25 PAFE concertos via `docker compose run --rm -v /opt/Festival:/work:ro -w /work postgres psql ...`, and verify landing, Customer OAuth login + POST logout (`200`/`302`), Teacher Membership purchase, `ORDERS_PAID` webhook delivery, `#361` `/org/pafe/directory` + Admin toggle, and Checkout UI Extension return link.

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s05-live-prod-firebase-shopify-launch
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
Pending execution.

## Quality gate results
Pending execution.
