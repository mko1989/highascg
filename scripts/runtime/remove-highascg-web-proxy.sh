#!/usr/bin/env bash
# WO-498: remove the nginx :80 → :4200 reverse proxy.
#
# The operator UI is reached directly at http://<playout-ip>:4200/ — the port in the URL is the
# whole cost of dropping nginx, and the owner accepted it. What the proxy bought was a bare
# http://<playout-ip>/ and, in principle, gzip; it never actually compressed anything, because
# /etc/nginx/nginx.conf ships every `gzip_types` line commented out and nginx's default covers
# text/html only (WO-497). The Node server now gzips text assets itself, so removing this loses
# nothing and takes ~1.7 MB per UI load off a second hop.
#
# Usage (repo root):
#   sudo bash scripts/runtime/remove-highascg-web-proxy.sh          # disable + stop + mask nginx
#   sudo PURGE=1 bash scripts/runtime/remove-highascg-web-proxy.sh  # …and apt-purge the package
#
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

SITE_AVAILABLE=/etc/nginx/sites-available/highascg-web-proxy.conf
SITE_ENABLED=/etc/nginx/sites-enabled/highascg-web-proxy.conf

echo "==> removing HighAsCG nginx site"
rm -f "$SITE_ENABLED" "$SITE_AVAILABLE"

if systemctl list-unit-files nginx.service >/dev/null 2>&1; then
	echo "==> stopping and disabling nginx"
	systemctl disable --now nginx >/dev/null 2>&1 || true
	# Masked so a later apt/dependency install cannot quietly put port 80 back and shadow :4200.
	systemctl mask nginx >/dev/null 2>&1 || true
fi

if [[ "${PURGE:-0}" == "1" ]]; then
	echo "==> purging nginx packages"
	export DEBIAN_FRONTEND=noninteractive
	apt-get purge -y nginx nginx-common nginx-core >/dev/null 2>&1 || true
	apt-get autoremove -y >/dev/null 2>&1 || true
fi

# The access/error logs grow unbounded and are pure waste once nginx is gone (WO-497 measured a
# 2.0 GB access.log on this box). Truncate rather than delete, so any running reader keeps its fd.
for f in /var/log/nginx/access.log /var/log/nginx/error.log; do
	[[ -f "$f" ]] && : > "$f"
done

echo "==> done. Operator UI: http://<playout-ip>:4200/"
echo "    Verify:  curl -sI http://127.0.0.1:4200/ | head -1"
