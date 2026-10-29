#!/bin/sh
# WO-811 phase 3 — "Change casparcg login password" (Settings -> Nuclear). The node opens this in a terminal on the box's
# own screen (:0) as the casparcg user: src/api/system-hardware-gui.js action 'os-password'.
# passwd (setuid, PAM) asks for the CURRENT password, then the new one twice; it never echoes what is typed.
# This script never reads, stores, prints or passes on a password: it only runs passwd and reports its exit status,
# then waits for Enter so the window does not vanish before the result is read.
# It cannot reset a forgotten password (passwd needs the current one) — recovery is the console / root.

if [ "$(id -u)" = "0" ]; then
	printf '%s\n' "Refusing to run as root (this would change root's password)." "Press Enter to close this window."
	read -r _ || true
	exit 1
fi

who="$(id -un)"
printf '%s\n' "Change the login password of '$who'." \
	"It is also the sudo and SSH password. Auto-login on this screen is not affected." \
	"Type the current password, then the new one twice. Nothing you type is shown." ""

/usr/bin/passwd
rc=$?

printf '\n'
if [ "$rc" -eq 0 ]; then
	printf '%s\n' "Password changed."
else
	printf '%s\n' "Password NOT changed (passwd exit status $rc)."
fi
printf '%s' "Press Enter to close this window. "
read -r _ || true
exit "$rc"
