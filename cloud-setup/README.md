# Cloud host preparation

These scripts prepare a fresh **Ubuntu 24.04** host for Festival. Ubuntu has no
24.02 release; confirm the actual release with `cat /etc/os-release` before
running the first script. The supplied 58 GB disk has ample space for the three
images and their build cache, while the 2 GB RAM makes serial image builds
important. The host scripts use Bash, which is available on Ubuntu without
installing PowerShell first.

The scripts do not start Festival containers. The only Docker image actions are
pulling `postgres:17-alpine` and building the backend and frontend images from
this checkout.

## Run in order

1. As `root`, put a complete checkout outside `/root`, for example at
   `/opt/Festival`. The host script hands ownership of that checkout to
   `webadmin`, so use a dedicated checkout that this account may own.
2. From that checkout, run `bash cloud-setup/01-host.sh` as `root`. It creates
   `webadmin`, installs the host prerequisites and Docker Engine with the
   Compose plugin, and enables Docker for `webadmin`. It does not change sshd
   configuration or firewall rules. If root has an `authorized_keys` file, the
   script copies it to the new account so key login can work. Docker group
   membership takes effect in a new login session.
3. Start a fresh `webadmin` login (`su - webadmin` from the root session is one
   option) and return to the checkout. Build **your own**
   `cloud-setup/.env` using [`.env.example`](.env.example) as a guide. The
   scripts never create or fill in this file. Set its mode to `600` and keep
   real passwords, Firebase credentials, and encryption keys out of Git. Set
   `TRUST_PROXY_HEADERS=true` and supply a distinct, randomly generated
   `FESTIVAL_RECONCILIATION_TOKEN` of at least 32 letters, digits, `_`, or `-`
   characters; do not reuse the database password.
4. Run `bash cloud-setup/02-validate-env.sh`. It checks required values and
   placeholders without printing secrets. Fix every reported error before the
   next step.
5. Run `bash cloud-setup/03-prepare-images.sh` as `webadmin`. It rechecks the
   env file, pulls PostgreSQL, and builds the two application images in
   sequence. It does not invoke `docker compose up` or run any container.
6. Run `bash cloud-setup/04-service-commands.sh` to **print** the exact
   start, status, stop, restart, and down commands. This last script only
   prints text.

The cloud Compose file is independent of the repository's development
`docker-compose.yml`. It fixes the database role, database, and schema to
`festivaladmin`, `festival_sepv2_db`, and `orgs`, matching the checked-in
initialization SQL. Set a unique `DB_PASSWORD` in your env file. The backend
and PostgreSQL have no host-published ports. The frontend listens on host
`127.0.0.1:8080`; arrange a separately managed HTTPS reverse proxy and DNS
before exposing the app publicly. Do not point public traffic at backend port
3000 or database port 5432. See [SECURITY.md](../SECURITY.md) for the network
and firewall boundary.

The backend trusts proxy headers in this production configuration. The
checked-in frontend Nginx overwrites incoming forwarded headers before sending
requests to the private backend. With an external HTTPS proxy in front of the
frontend container, Nginx sees that proxy as its remote peer, so login events
may record the proxy or gateway IP instead of the client's IP. Recording the
real client IP requires deliberate trusted ingress configuration later. Keep
the backend private. The reconciliation token is required in the env file, but
these scripts do not schedule reconciliation jobs. Since the backend has no
host-published port, a scheduler must run on the private Docker network to
reach its private routes.

Frontend Firebase values are embedded when its image is built. After changing
those values, rerun image preparation before starting or recreating the
frontend. The backend reads its environment at container creation time.
The database and Shopify audit file use named Docker volumes; the printed
`down` command retains them. Do not add `-v` unless you intend to erase those
volumes. If an image build runs out of memory on this 2 GB host, add swap
through your host operations process and rerun `03-prepare-images.sh`; the
script itself makes no swap or kernel changes.

## Clean a host checkout and rerun integration

The manual integration workflow stops before image preparation if the host
checkout has staged or unstaged tracked changes. Log in as `webadmin`, then
inspect those changes:

```bash
cd /opt/Festival
git status --short
git diff
git diff --cached
git ls-files -- cloud-setup/.env
```

The last command must print nothing: `cloud-setup/.env` must remain untracked
(and may be ignored). If it prints the env path, stop and back up the env file
outside the checkout before proceeding; restoring tracked files would also
restore that file. Do not include env contents in patches or other shared
output.

If the tracked edits are worth keeping, save patches outside the checkout
before discarding them. Use fresh filenames if these backups already exist:

```bash
git diff --binary --output=/home/webadmin/festival-unstaged.patch
git diff --cached --binary --output=/home/webadmin/festival-staged.patch
```

Keep these backups private; they may contain sensitive local edits.

After reviewing the changes and confirming the env file is untracked, discard
the tracked edits and check the result:

```bash
git restore --source=HEAD --staged --worktree .
git status --short
```

This restores tracked files to the checked-out commit and preserves the
untracked or ignored `cloud-setup/.env`. **Do not run `git clean -fdx`**: it can
delete that env file. Remaining untracked files do not fail the workflow's
tracked-change checks.

Once the tracked changes are gone, rerun the failed workflow run to retry the
same verified commit SHA. Starting a new **Run workflow** instead captures the
selected branch's current tip. This workflow deploys only to integration;
production deployment remains out of scope.

Adding `webadmin` to the `docker` group grants effective root-level control
of the host. Limit access to that account and protect its SSH key. This setup
does not change the root login or configure the cloud firewall, DNS, TLS,
backups, monitoring, or scheduled reconciliation. Configure those before
treating the stack as a public production service.
