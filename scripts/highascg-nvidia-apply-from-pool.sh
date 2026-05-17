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

if compgen -G "$POOL/*.deb" >/dev/null 2>&1; then
	log "apt-get install branch $BR (Dir::Cache::Archives=$POOL)"
	apt-get install -y --no-install-recommends \
		-o Dir::Cache::Archives="$POOL" \
		-o Apt::Acquire::Retries=3 \
		"nvidia-driver-$BR" "nvidia-dkms-$BR"
else
	log "Pool has no *.deb — trying network-enabled install"
	apt-get update
	apt-get install -y --no-install-recommends "nvidia-driver-$BR" "nvidia-dkms-$BR"
fi

echo "Applied nvidia-driver-$BR + nvidia-dkms-$BR (reboot typically required)"
