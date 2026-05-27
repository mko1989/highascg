#!/usr/bin/env bash
# Remove ~90s highascg start delay when HIGHASCGEXF is absent (WO-47).
# Run: sudo bash scripts/fix-highascg-no-exfat-startup-block.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_CASPAR="${1:-casparcg}"

install -m 0755 "${REPO_ROOT}/scripts/highascg-exfat-boot.sh" /usr/local/lib/highascg/highascg-exfat-boot.sh

# Refresh mount + boot units (ConditionPathExists, no local-fs pull at boot)
bash "${REPO_ROOT}/scripts/install-exfat-systemd-units.sh" "$USER_CASPAR"

# highascg.service: no Wants on home-casparcg-exfat.mount
bash "${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh" "$USER_CASPAR"

systemctl daemon-reload
systemctl reset-failed home-casparcg-exfat.mount 2>/dev/null || true

echo ""
echo "Done. highascg.service should no longer Wants the exFAT mount unit."
echo "Test: time systemctl restart highascg"
systemctl cat highascg.service | head -20
