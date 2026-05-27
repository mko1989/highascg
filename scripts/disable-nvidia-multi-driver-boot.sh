#!/usr/bin/env bash
# Remove first-boot NVIDIA picker + pool gate (single-driver-per-ISO model).
# Run on build host before eggs produce, or on deployed rig once: sudo bash scripts/disable-nvidia-multi-driver-boot.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

log() { echo "[disable-nvidia-multi] $*"; }

systemctl disable highascg-pick-nvidia.service 2>/dev/null || true
systemctl reset-failed highascg-pick-nvidia.service 2>/dev/null || true

for f in \
	/etc/systemd/system/highascg-pick-nvidia.service \
	/usr/local/sbin/highascg-pick-nvidia.sh \
	/etc/systemd/system/highascg.service.d/10-wait-for-nvidia.conf \
	/usr/local/lib/highascg/nvidia-apply-from-pool.sh \
	/usr/local/lib/highascg/nvidia-pool-lib.sh \
	/etc/sudoers.d/highascg-nvidia-apply-from-pool; do
	if [[ -e "$f" ]]; then
		rm -f "$f"
		log "removed $f"
	fi
done

if [[ -d /opt/nvidia-pool ]] && [[ "${HIGHASCG_PURGE_NVIDIA_POOL:-0}" == "1" ]]; then
	rm -rf /opt/nvidia-pool
	log "removed /opt/nvidia-pool"
fi

systemctl daemon-reload
log "done — highascg.service no longer waits on nvidia-installed"
