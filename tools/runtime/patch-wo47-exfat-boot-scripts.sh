#!/usr/bin/env bash
# Install fixed WO-47 exfat boot scripts into /usr/local/lib/highascg/.
# Use on Calamares-installed playout hosts — ISO excludes ~/highascg/scripts/*.
#
#   sudo bash ~/highascg/tools/runtime/patch-wo47-exfat-boot-scripts.sh
#   sudo bash ~/highascg/tools/runtime/patch-wo47-exfat-boot-scripts.sh --restart
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
DEST=/usr/local/lib/highascg
RESTART=0
[[ "${1:-}" == "--restart" ]] && RESTART=1

pick_src() {
	local name="$1"
	local candidates=(
		"${REPO_ROOT}/scripts/exfat/${name}"
		"${HERE}/wo47-${name}"
	)
	local c
	for c in "${candidates[@]}"; do
		if [[ -f "$c" ]]; then
			printf '%s' "$c"
			return 0
		fi
	done
	return 1
}

install -d "$DEST"
for name in highascg-exfat-boot.sh highascg-fix-config-permissions.sh; do
	src="$(pick_src "$name")" || {
		echo "ERROR: missing source for ${name}" >&2
		exit 1
	}
	install -m 0755 "$src" "${DEST}/${name}"
	bash -n "${DEST}/${name}"
	echo "OK: ${DEST}/${name} ← ${src}"
done

chown -R casparcg:casparcg "${REPO_ROOT}/config" 2>/dev/null || true

systemctl reset-failed highascg-exfat-boot.service highascg-fix-config-permissions.service highascg-decklink-install.service 2>/dev/null || true
systemctl start highascg-fix-config-permissions.service
systemctl start --no-block highascg-exfat-boot.service
echo "OK: exfat boot triggered (returns immediately; decklink skipped when desktopvideo already installed)"

if [[ "$RESTART" -eq 1 ]]; then
	systemctl restart highascg.service 2>/dev/null || true
fi

echo "Verify: bash ${REPO_ROOT}/tools/eggs/live-usb/diagnose-highascg-startup.sh"
