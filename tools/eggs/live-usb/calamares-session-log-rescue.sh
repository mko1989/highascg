#!/bin/sh
# HighAsCG — copy the Calamares session log to the operator exFAT while installing.
#
# WO-417: a bootloader (or any exec-phase) failure aborts the Calamares sequence
# BEFORE shellprocess@logs runs, so session.log dies with the live tmpfs and the
# failure is undiagnosable afterwards. This loop runs only in live sessions
# (unit has ConditionPathExists=/run/live/medium) and, whenever a session.log
# exists, copies it to LABEL=HIGHASCGEXF → logs/calamares-session-<host>.log
# every INTERVAL seconds. After a failed install, read the log from the stick.
#
# Installed to /usr/libexec/calamares/ by fix-calamares-shellprocess.sh.
set -u

INTERVAL="${CALAMARES_LOG_RESCUE_INTERVAL:-20}"
LABEL=HIGHASCGEXF
OWN_MP=/run/calamares-log-rescue

find_session_log() {
	for d in /root /home/*; do
		[ -f "$d/.cache/calamares/session.log" ] && {
			printf '%s' "$d/.cache/calamares/session.log"
			return 0
		}
	done
	return 1
}

copy_to_exfat() {
	src="$1"
	dev="$(blkid -L "$LABEL" 2>/dev/null)" || return 1
	[ -n "$dev" ] || return 1
	mp="$(findmnt -nr -o TARGET -S "$dev" 2>/dev/null | head -1)"
	mounted_here=0
	if [ -z "$mp" ]; then
		mkdir -p "$OWN_MP"
		mount "$dev" "$OWN_MP" 2>/dev/null || return 1
		mp="$OWN_MP"
		mounted_here=1
	fi
	mkdir -p "$mp/logs"
	cp "$src" "$mp/logs/calamares-session-$(hostname).log" 2>/dev/null
	sync
	# Only unmount what this loop mounted — never a mount the system owns.
	[ "$mounted_here" = 1 ] && umount "$OWN_MP" 2>/dev/null
	return 0
}

while :; do
	log="$(find_session_log)" && copy_to_exfat "$log"
	sleep "$INTERVAL"
done
