#!/usr/bin/env bash
# WO-39: Apply NVIDIA driver+dkms branch from offline pool (/opt/nvidia-pool) via apt — no CLI args from caller.
#
# Reads a single-line branch number from /run/highascg/nvidia-apply.req then deletes the file.
# Run as root: sudo -n /usr/local/lib/highascg/nvidia-apply-from-pool.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo 'Run as root' >&2
	exit 1
}

REQ=/run/highascg/nvidia-apply.req
POOL="${NVIDIA_DEB_POOL:-/opt/nvidia-pool}"
NV_LIB="/usr/local/lib/highascg/nvidia-pool-lib.sh"
if [[ ! -f "$NV_LIB" ]]; then
	REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
	NV_LIB="${REPO_ROOT}/tools/eggs/live-usb/nvidia-multi-driver/nvidia-pool-lib.sh"
fi
if [[ -f "$NV_LIB" ]]; then
	# shellcheck source=tools/eggs/live-usb/nvidia-multi-driver/nvidia-pool-lib.sh
	source "$NV_LIB"
fi
if [[ -f /etc/highascg/nvidia-driver-flavor ]]; then
	NVIDIA_DRIVER_FLAVOR="$(tr -d '[:space:]' < /etc/highascg/nvidia-driver-flavor)"
	export NVIDIA_DRIVER_FLAVOR
fi

log() {
	echo "[nvidia-apply] $*" >&2
	logger -t highascg-nvidia-apply -- "$@"
}

[[ -f "$REQ" ]] || {
	log 'Missing request file /run/highascg/nvidia-apply.req'
	exit 2
}

BR=$(head -1 "$REQ" | tr -dc '0-9')
rm -f "$REQ"

[[ -n "${BR:-}" ]] || {
	log 'Empty branch'
	exit 3
}

case "$BR" in
535 | 580 | 595) ;;
*)
	log "Disallowed branch: $BR"
	exit 4
	;;
esac

if [[ ! -d "$POOL" ]]; then
	log "Pool missing: $POOL"
	exit 5
fi

export DEBIAN_FRONTEND=noninteractive

driver_pkg="nvidia-driver-${BR}"
dkms_pkg="nvidia-dkms-${BR}"
if [[ -f "$NV_LIB" ]]; then
	driver_pkg="$(nvidia_pool_driver_pkg "$BR")"
	dkms_pkg="$(nvidia_pool_dkms_pkg "$BR")"
fi

if compgen -G "$POOL/*.deb" >/dev/null 2>&1; then
	log "apt-get install $driver_pkg + $dkms_pkg (Dir::Cache::Archives=$POOL)"
	apt-get install -y --no-install-recommends \
		-o Dir::Cache::Archives="$POOL" \
		-o Apt::Acquire::Retries=3 \
		"$driver_pkg" "$dkms_pkg"
else
	log "Pool has no *.deb — trying network-enabled install"
	apt-get update
	apt-get install -y --no-install-recommends "$driver_pkg" "$dkms_pkg"
fi

echo "Applied $driver_pkg + $dkms_pkg (reboot typically required)"
