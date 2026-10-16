#!/usr/bin/env bash
# Run as root from a cloned Festival checkout on Ubuntu 24.04.
set -Eeuo pipefail

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[[ $(id -u) -eq 0 ]] || fail 'Run this script as root.'
[[ -r /etc/os-release ]] || fail 'Cannot identify the operating system.'
# shellcheck disable=SC1091
. /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 ]] ||
  fail 'This script supports Ubuntu 24.04 only.'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_dir=$(cd -- "$script_dir/.." && pwd -P)
[[ -e "$repo_dir/.git" && -f "$repo_dir/docker-compose.yml" ]] ||
  fail 'Run this script from cloud-setup inside a cloned Festival repository.'
[[ "$repo_dir" != /root && "$repo_dir" != /root/* ]] ||
  fail "The checkout is under /root and webadmin cannot access it. Move it to /srv/festival (for example: mkdir -p /srv; mv '$repo_dir' /srv/festival), then rerun the script from there."

# The official Docker packages conflict with these distribution packages.
conflicts=()
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]]; then
    conflicts+=("$package")
  fi
done
((${#conflicts[@]} == 0)) ||
  fail "Conflicting packages are installed: ${conflicts[*]}. Remove them deliberately before rerunning."

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git python3

install -m 0755 -d /etc/apt/keyrings
key_tmp=$(mktemp)
trap 'rm -f -- "$key_tmp"' EXIT
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$key_tmp"
install -m 0644 "$key_tmp" /etc/apt/keyrings/docker.asc
rm -f -- "$key_tmp"
trap - EXIT

architecture=$(dpkg --print-architecture)
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if ! id webadmin >/dev/null 2>&1; then
  useradd --create-home --user-group --shell /bin/bash webadmin
fi
webadmin_home=$(getent passwd webadmin | cut -d: -f6)
[[ "$webadmin_home" == /home/webadmin ]] ||
  fail 'webadmin must have /home/webadmin as its home directory; inspect the account before continuing.'
[[ $(LC_ALL=C passwd -S webadmin | awk '{print $2}') == L ]] ||
  fail 'webadmin has an unlocked password; lock it deliberately before continuing.'

# A new useradd account has a locked password. Preserve existing accounts'
# authentication state rather than silently changing it.
usermod -aG sudo,docker webadmin
if [[ -s /root/.ssh/authorized_keys && ! -e "$webadmin_home/.ssh/authorized_keys" && ! -L "$webadmin_home/.ssh/authorized_keys" ]]; then
  install -d -m 0700 -o webadmin -g webadmin "$webadmin_home/.ssh"
  install -m 0600 -o webadmin -g webadmin /root/.ssh/authorized_keys "$webadmin_home/.ssh/authorized_keys"
fi

# The checkout must be writable by the account used for later image builds.
chown -R webadmin:webadmin "$repo_dir"

docker --version
docker compose version
systemctl is-active --quiet docker || fail 'Docker daemon is not running.'
printf '\nHost setup complete. Docker is running; no application containers were started.\n'
printf 'Repository: %s (owned by webadmin)\n' "$repo_dir"
printf 'webadmin has sudo and Docker group access; Docker group access is root-equivalent.\n'
if [[ ! -s "$webadmin_home/.ssh/authorized_keys" ]]; then
  printf 'Warning: webadmin has no SSH authorized_keys. Add a key before logging out as root.\n' >&2
fi
printf 'Open a new login session for webadmin so group membership takes effect.\n'
