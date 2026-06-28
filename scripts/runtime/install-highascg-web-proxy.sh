#!/usr/bin/env bash
# Install nginx reverse proxy: browser http://<playout-ip>/ → HighAsCG on :4200.
#
# Usage:
#   sudo bash scripts/runtime/install-highascg-web-proxy.sh
#
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONF_SRC="${REPO_ROOT}/config/nginx/highascg-web-proxy.conf"
CONF_DST=/etc/nginx/sites-available/highascg-web-proxy.conf
ENABLED=/etc/nginx/sites-enabled/highascg-web-proxy.conf

export DEBIAN_FRONTEND=noninteractive

# shellcheck source=../../tools/eggs/live-usb/apt-with-stale-eggs-repo-fallback.sh
source "${REPO_ROOT}/tools/eggs/live-usb/apt-with-stale-eggs-repo-fallback.sh"

if ! command -v nginx >/dev/null 2>&1; then
	highascg_apt_install nginx
fi

[[ -f "$CONF_SRC" ]] || {
	echo "Missing ${CONF_SRC}" >&2
	exit 1
}

install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
install -m 0644 -o root -g root "$CONF_SRC" "$CONF_DST"
ln -sf "$CONF_DST" "$ENABLED"
rm -f /etc/nginx/sites-enabled/default

if nginx -t 2>/dev/null; then
	systemctl enable nginx.service
	systemctl restart nginx.service
	echo "OK: nginx proxies :80 → 127.0.0.1:4200 (${CONF_DST})"
else
	echo "nginx config test failed — check ${CONF_DST}" >&2
	nginx -t
	exit 1
fi
