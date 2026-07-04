#!/usr/bin/env bash
# Seed exFAT drop-update/ with server + dist-web so live stick serves UI on boot.
#
# ISO squashfs omits dist-web/ (WO-47 exFAT-only server); embed-server ISO includes dist-web/
#
# Usage:
#   sudo bash tools/eggs/live-usb/seed-stick-drop-update-from-host.sh [/dev/sdX]
#   sudo bash tools/eggs/live-usb/seed-stick-drop-update-from-host.sh --remote user@192.168.0.28
#
# Remote: one SSH password (ControlMaster). Apply tries sudo -n first; else sudo -t.
# If apply fails, drop-update/ is still on the laptop — reboot or run server-update manually.
#
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
MP="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
DEV=""
REMOTE=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--remote)
			REMOTE="${2:?user@host}"
			shift
			;;
		/dev/*) DEV="$1" ;;
		-h | --help)
			sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*) echo "Unknown: $1" >&2; exit 1 ;;
	esac
	shift
done

ensure_dist_web() {
	if [[ -f "${REPO_ROOT}/dist-web/index.html" ]]; then
		return 0
	fi
	echo "==> dist-web/ missing — building client (npm run build:client)"
	if [[ "$(id -u)" -eq 0 ]] && getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
		sudo -u "$USER_CASPAR" -H bash -lc "cd '${REPO_ROOT}' && npm run build:client"
	else
		bash -lc "cd '${REPO_ROOT}' && npm run build:client"
	fi
	[[ -f "${REPO_ROOT}/dist-web/index.html" ]] || {
		echo "ERROR: build did not produce dist-web/index.html" >&2
		exit 1
	}
}

rsync_drop_members() {
	local dest="$1"
	mkdir -p "$dest"
	local members=(index.js package.json package-lock.json src config template scripts tools/runtime dist-web)
	local m src parent
	for m in "${members[@]}"; do
		src="${REPO_ROOT}/${m}"
		[[ -e "$src" ]] || continue
		if [[ -d "$src" ]]; then
			parent="$(dirname "$m")"
			[[ "$parent" != "." ]] && mkdir -p "${dest}/${parent}"
			rsync -a --delete "${src%/}/" "${dest}/${m}/"
		else
			rsync -a "$src" "${dest}/"
		fi
	done
	if [[ -f "${REPO_ROOT}/BUILD_STAMP" ]]; then
		# exFAT cannot store Unix ownership — skip -o/-g on that filesystem.
		if findmnt -T "$dest" -no FSTYPE 2>/dev/null | grep -qxF exfat; then
			install -m 0644 "${REPO_ROOT}/BUILD_STAMP" "${dest}/BUILD_STAMP"
		else
			install -m 0644 -o root -g root "${REPO_ROOT}/BUILD_STAMP" "${dest}/BUILD_STAMP"
		fi
	fi
	chown -R "${USER_CASPAR}:${USER_CASPAR}" "$dest" 2>/dev/null || true
}

verify_drop_update_seed() {
	local root="$1"
	local req f
	for req in package.json index.js src dist-web/index.html tools/runtime/exfat-sync-cli.js; do
		f="${root}/${req}"
		[[ -e "$f" ]] || {
			echo "ERROR: seed incomplete — missing drop-update/${req}" >&2
			exit 1
		}
	done
}

apply_remote() {
	ensure_dist_web
	local tmp_dir socket
	tmp_dir="$(mktemp -d)"
	socket="$(mktemp -u /tmp/highascg-seed-drop.XXXXXX)"
	cleanup_remote() {
		[[ -n "${tmp_dir:-}" && -d "${tmp_dir}" ]] && rm -rf "$tmp_dir"
		ssh -O exit -o ControlPath="$socket" "$REMOTE" 2>/dev/null || true
		rm -f "$socket"
	}
	trap cleanup_remote EXIT

	rsync_drop_members "${tmp_dir}/drop-update"
	verify_drop_update_seed "${tmp_dir}/drop-update"

	echo "==> SSH to ${REMOTE} (enter password once if prompted — reused for rsync + apply)"
	ssh -o ControlMaster=yes -o ControlPath="$socket" -o ControlPersist=120 -f -N "$REMOTE"

	echo "==> Push drop-update → ${REMOTE}:/home/casparcg/exfat/drop-update/"
	rsync -az --delete -e "ssh -o ControlPath=${socket}" \
		"${tmp_dir}/drop-update/" "${REMOTE}:/home/casparcg/exfat/drop-update/"

	echo "==> Apply drop on remote (stops/starts highascg.service)"
	local apply_ok=0
	if ssh -o ControlPath="$socket" -o BatchMode=yes "$REMOTE" \
		'sudo -n systemctl start highascg-exfat-server-update.service'; then
		apply_ok=1
	elif ssh -t -o ControlPath="$socket" "$REMOTE" \
		'sudo systemctl start highascg-exfat-server-update.service'; then
		apply_ok=1
	fi

	local host
	host="$(echo "$REMOTE" | cut -d@ -f2)"
	if [[ "$apply_ok" -eq 1 ]]; then
		echo "OK: remote drop applied — open http://${host}/ or :4200/"
	else
		echo "WARN: drop-update pushed to ${REMOTE}:/home/casparcg/exfat/drop-update/ but remote apply failed." >&2
		echo "      On the laptop (console or SSH with -t), run:" >&2
		echo "        sudo systemctl start highascg-exfat-server-update.service" >&2
		echo "      Or reboot the stick — boot applies drop-update/ automatically." >&2
		echo "      (Passwordless sudo for systemctl helps: see docs/HIGHASCG_PASSWORDLESS_SUDO.md)" >&2
		exit 0
	fi
}

apply_local_exfat() {
	# Build host udev may apply the drop when the stick mounts — use retain-safe helper.
	local apply_src="${REPO_ROOT}/scripts/exfat/highascg-apply-server-drop.sh"
	local apply_dst=/usr/local/lib/highascg/highascg-apply-server-drop.sh
	if [[ -f "$apply_src" ]]; then
		install -d /usr/local/lib/highascg
		install -m 0755 "$apply_src" "$apply_dst"
	fi
	if [[ -n "$DEV" ]] && [[ -b "$DEV" ]]; then
		bash "${HERE}/unmount-usb-for-partitioning.sh" "$DEV" 2>/dev/null || true
	fi
	if ! blkid -L HIGHASCGEXF &>/dev/null; then
		echo "WARN: no LABEL=HIGHASCGEXF — skip drop-update seed" >&2
		exit 0
	fi
	mkdir -p "$MP"
	if ! findmnt -n "$MP" &>/dev/null; then
		local uid gid
		uid="$(id -u "$USER_CASPAR" 2>/dev/null || echo 1000)"
		gid="$(id -g "$USER_CASPAR" 2>/dev/null || echo 1000)"
		mount -t exfat -o "defaults,uid=${uid},gid=${gid},umask=002" -L HIGHASCGEXF "$MP"
	fi
	ensure_dist_web
	echo "==> Seed ${MP}/drop-update/ (server + dist-web for live UI)"
	rsync_drop_members "${MP}/drop-update"
	sync
	verify_drop_update_seed "${MP}/drop-update"
	echo "OK: drop-update seeded — $(findmnt -n -o SOURCE "$MP")"
	echo "    $(find "${MP}/drop-update" -type f 2>/dev/null | wc -l) files on stick (retain mode — safe on build host)"
}

if [[ -n "$REMOTE" ]]; then
	apply_remote
else
	apply_local_exfat
fi
