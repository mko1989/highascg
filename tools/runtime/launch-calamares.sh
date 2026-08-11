#!/usr/bin/env bash
# Launch Calamares disk installer on DISPLAY :0 (live ISO or installed playout host).
# Must be invoked as root: sudo -n /usr/local/bin/launch-calamares.sh
set -euo pipefail

USER_CASPAR="${HIGHASCG_USER:-casparcg}"
HOME_CASPAR="/home/${USER_CASPAR}"
CALAMARES_BIN="${CALAMARES_BIN:-/usr/bin/calamares}"
BRAND="${CALAMARES_BRAND_DIR:-/etc/calamares/branding/highascg-eggs-theme}"
DISPLAY_WAIT_SEC="${HIGHASCG_CALAMARES_DISPLAY_WAIT_SEC:-45}"

run_branding_fix() {
	if [[ -x /usr/local/lib/highascg/fix-calamares-branding.sh ]]; then
		/usr/local/lib/highascg/fix-calamares-branding.sh
	fi
}

branding_images_ok() {
	[[ -f "${BRAND}/branding.desc" ]] || return 1
	local icon logo want
	icon="$(awk -F': *' '/^[[:space:]]*productIcon:/{print $2; exit}' "${BRAND}/branding.desc" | tr -d ' \"')"
	logo="$(awk -F': *' '/^[[:space:]]*productLogo:/{print $2; exit}' "${BRAND}/branding.desc" | tr -d ' \"')"
	for want in "$icon" "$logo"; do
		[[ -n "$want" ]] || continue
		[[ -f "${BRAND}/${want}" ]] || return 1
	done
	return 0
}

wait_for_display() {
	local i
	for ((i = 0; i < DISPLAY_WAIT_SEC; i++)); do
		if runuser -u "${USER_CASPAR}" -- env DISPLAY="${DISPLAY:-:0}" \
			XAUTHORITY="${XAUTHORITY:-${HOME_CASPAR}/.Xauthority}" \
			xdpyinfo -display "${DISPLAY:-:0}" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done
	echo "ERROR: X display ${DISPLAY:-:0} not ready after ${DISPLAY_WAIT_SEC}s (nodm / .Xauthority)" >&2
	return 1
}

if [[ "${1:-}" == "--check" ]]; then
	command -v "${CALAMARES_BIN}" >/dev/null 2>&1 || exit 1
	run_branding_fix || exit 1
	branding_images_ok || {
		echo "ERROR: Calamares branding images missing in ${BRAND}" >&2
		exit 1
	}
	exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
	echo "ERROR: launch-calamares.sh must run as root (passwordless sudo for ${USER_CASPAR})" >&2
	echo "       Run: sudo bash scripts/setup/12-passwordless-sudo.sh" >&2
	exit 1
fi


# WO-475 (owner 11.08): the install failed with the bridge partition still mounted, even though
# the operator left that partition untouched — Calamares/KPMcore re-reads the TARGET DISK's
# partition table, and the kernel refuses while any partition on it is mounted. The bridge
# (LABEL=HIGHASCGDAT) lives on the internal disk being installed to, so it must be released.
# Must run AFTER the services above: highascg.service holds the media root and the projects sync.
# The exFAT operator stick is deliberately left alone — it is the live boot medium, not a target.
BRIDGE_UNITS=(
	home-casparcg-highascg-media-bridge.mount
	home-casparcg-bridge.mount
	highascg-bridge-arrive.service
	highascg-bridge-boot.service
	highascg-bridge-media-prep.service
	highascg-exfat-sync.service
)
# Deepest first: the media bind sits inside ~/bridge.
BRIDGE_PATHS=(
	/home/casparcg/highascg/media/bridge
	/home/casparcg/bridge
)
BRIDGE_RELEASED=0

release_bridge() {
	local unit mp
	for unit in "${BRIDGE_UNITS[@]}"; do
		systemctl stop "${unit}" 2>/dev/null || true
		# Runtime mask only — udev's arrive unit would otherwise remount mid-install, and a
		# runtime mask evaporates on the reboot into the freshly installed system.
		systemctl mask --runtime "${unit}" 2>/dev/null || true
	done
	for mp in "${BRIDGE_PATHS[@]}"; do
		findmnt -n "${mp}" >/dev/null 2>&1 || continue
		umount "${mp}" 2>/dev/null && continue
		echo "WARN: ${mp} busy — processes holding it:" >&2
		fuser -mv "${mp}" 2>&1 | head -20 >&2 || true
		umount -l "${mp}" 2>/dev/null || true
	done
	BRIDGE_RELEASED=1
	local still=0
	for mp in "${BRIDGE_PATHS[@]}"; do
		if findmnt -n "${mp}" >/dev/null 2>&1; then
			echo "WARN: ${mp} is STILL mounted — Calamares may fail to re-read the partition table" >&2
			still=1
		fi
	done
	[[ "${still}" -eq 0 ]] && echo "OK: bridge volumes released for the installer"
	return 0
}

restore_bridge() {
	[[ "${BRIDGE_RELEASED}" -eq 1 ]] || return 0
	local unit
	for unit in "${BRIDGE_UNITS[@]}"; do
		systemctl unmask --runtime "${unit}" 2>/dev/null || true
	done
	# Mount units only — the boot/arrive services re-run their own sync on the next boot.
	for unit in home-casparcg-bridge.mount home-casparcg-highascg-media-bridge.mount; do
		systemctl start "${unit}" 2>/dev/null || true
	done
	BRIDGE_RELEASED=0
}

# WO-481: the same release, callable on its own. Calamares' own `shellprocess@release_bridge` step
# invokes this so the bridge is freed even when the installer was NOT started through this script
# (a terminal `calamares`, a desktop entry, an ISO whose launcher predates WO-475). One
# implementation, two entry points — the logic must never exist twice (WO-471).
if [[ "${1:-}" == "--release-bridge" ]]; then
	release_bridge
	exit 0
fi

# WO-423: the Web UI spawns this via sudo from INSIDE highascg.service's cgroup — the
# owner-requested `systemctl stop highascg` below would kill this script mid-run with it.
# Re-exec into a transient systemd unit first so the stop cannot take us down.
if [[ -z "${HIGHASCG_CAL_SCOPED:-}" ]] && command -v systemd-run >/dev/null 2>&1; then
	exec systemd-run --quiet --collect --unit="highascg-calamares-launch-$$" \
		--setenv=HIGHASCG_CAL_SCOPED=1 \
		--setenv=DISPLAY="${DISPLAY:-:0}" \
		--setenv=XAUTHORITY="${XAUTHORITY:-${HOME_CASPAR}/.Xauthority}" \
		"$(readlink -f "$0")"
fi

if ! command -v "${CALAMARES_BIN}" >/dev/null 2>&1; then
	echo "Calamares not installed (eggs calamares --install or apt install calamares)" >&2
	exit 1
fi

CASPAR_UID="$(id -u "${USER_CASPAR}")"
export DISPLAY="${DISPLAY:-:0}"
export HOME="${HOME_CASPAR}"
export XAUTHORITY="${XAUTHORITY:-${HOME_CASPAR}/.Xauthority}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${CASPAR_UID}}"
unset WAYLAND_DISPLAY

# nodm :0 allows only SI:localuser:casparcg — grant root temporary GUI access.
wait_for_display

if command -v xhost >/dev/null 2>&1; then
	runuser -u "${USER_CASPAR}" -- env DISPLAY="${DISPLAY}" xhost +SI:localuser:root >/dev/null 2>&1 || true
fi

run_branding_fix
branding_images_ok || {
	echo "ERROR: Calamares branding images still missing after fix (${BRAND})" >&2
	exit 1
}

if [[ -x /usr/local/lib/highascg/probe-internal-storage.sh ]]; then
	/usr/local/lib/highascg/probe-internal-storage.sh || {
		echo "WARN: internal storage probe reported no install target disk (see /var/log/highascg/storage-probe.log)" >&2
	}
fi

# WO-423 (owner 04.08): only the installer on the glass — stop playout AND the control GUI.
# Done last, right before the launch, to keep the dead window short; safe because we run in
# our own transient unit (re-exec above).
for unit in casparcg-server.service casparcg-scanner.service highascg.service; do
	systemctl stop "${unit}" 2>/dev/null || true
done

# A cancelled or crashed installer must not leave the box without its media disk.
trap restore_bridge EXIT INT TERM

release_bridge

status=0
"${CALAMARES_BIN}" -d || status=$?

# Installer closed (finished or cancelled) — bring the box back. After a real install the
# user reboots into the new system anyway; restarting first costs nothing and un-bricks a
# cancelled attempt.
restore_bridge
for unit in highascg.service casparcg-server.service casparcg-scanner.service; do
	systemctl start "${unit}" 2>/dev/null || true
done
exit "${status}"
