#!/usr/bin/env bash
# Bake Tailscale apt daemon on ISO; mask broken snap unit from build host clone.
#
#   sudo bash scripts/setup/install-tailscale-deb-for-iso.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

export DEBIAN_FRONTEND=noninteractive

if ! command -v tailscale >/dev/null 2>&1 || ! dpkg-query -W tailscale &>/dev/null 2>&1; then
	if ! command -v curl >/dev/null 2>&1; then
		apt-get update
		apt-get install -y --no-install-recommends curl ca-certificates
	fi
	# shellcheck source=/dev/null
	. /etc/os-release
	codename="${VERSION_CODENAME:-noble}"
	curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${codename}.noarmor.gpg" \
		-o /usr/share/keyrings/tailscale-archive-keyring.gpg
	curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${codename}.tailscale-keyring.list" \
		-o /etc/apt/sources.list.d/tailscale.list
	apt-get update
	apt-get install -y tailscale
fi

systemctl stop snap.tailscale.tailscaled.service 2>/dev/null || true
systemctl disable snap.tailscale.tailscaled.service 2>/dev/null || true
systemctl mask snap.tailscale.tailscaled.service 2>/dev/null || true

systemctl enable tailscaled.service 2>/dev/null || true
echo "OK: tailscale deb + tailscaled enabled; snap.tailscale.tailscaled masked"
