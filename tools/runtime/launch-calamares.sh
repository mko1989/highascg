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

status=0
"${CALAMARES_BIN}" -d || status=$?

# Installer closed (finished or cancelled) — bring the box back. After a real install the
# user reboots into the new system anyway; restarting first costs nothing and un-bricks a
# cancelled attempt.
for unit in highascg.service casparcg-server.service casparcg-scanner.service; do
	systemctl start "${unit}" 2>/dev/null || true
done
exit "${status}"
