#!/usr/bin/env bash
# Mount HIGHASCGDAT + HIGHASCGEXF (when present) and run boot mtime sync + project → volume push.
#
# Use after eggs produce (build umounts volumes) or when exfat-sync was skipped (nothing mounted).
#
#   sudo bash scripts/highascg-exfat-remount-sync.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
USER_CASPAR="${1:-casparcg}"

log() { echo "==> $*"; }

log "Bridge boot (HIGHASCGDAT)"
# `start` is a no-op when the oneshot already exited; restart remounts after eggs umount.
systemctl reset-failed highascg-bridge-boot.service 2>/dev/null || true
systemctl restart highascg-bridge-boot.service

log "USB / exFAT boot (HIGHASCGEXF)"
systemctl reset-failed highascg-exfat-boot.service 2>/dev/null || true
systemctl restart highascg-exfat-boot.service

log "Wait for exfat-sync (boot pull + push seed)"
systemctl reset-failed highascg-exfat-sync.service 2>/dev/null || true
systemctl restart highascg-exfat-sync.service
systemctl --no-pager --full status highascg-exfat-sync.service || true

echo
findmnt -T /home/casparcg/bridge /home/casparcg/exfat /home/casparcg/highascg/media/bridge /home/casparcg/highascg/media/exfat 2>/dev/null || true
echo
echo "Config counts:"
for d in /home/casparcg/highascg/config /home/casparcg/bridge/configs /home/casparcg/exfat/configs; do
	if [[ -d "$d" ]]; then
		n="$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l)"
		echo "  ${d}: ${n} files"
	fi
done
echo
echo "Dashboard: curl -s http://127.0.0.1:4200/api/system/exfat-sync | jq .volumes 2>/dev/null || true"
echo "Start server if needed: sudo systemctl start highascg.service"
