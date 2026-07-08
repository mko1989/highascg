#!/bin/sh
# HighAsCG — offline-safe Calamares install log archiver.
# Eggs default uses set -ex and aborts when /var/log/syslog or .disk/info is missing
# ("external command finished with errors" / logs-helper exit 1) even after a good install.
#
# Installed to /usr/libexec/calamares/calamares-logs-helper.sh by fix-calamares-shellprocess.sh
set -e

root="${1:-}"
if [ -z "$root" ] || [ ! -d "$root" ]; then
	echo "WARNING: calamares-logs-helper: missing install root" >&2
	exit 0
fi

install_dir="$root/var/log/installer"
log_path=".cache/calamares/session.log"
mkdir -p "$install_dir"

if [ -e "$HOME/$log_path" ]; then
	cp "$HOME/$log_path" "$install_dir/debug"
elif [ -e "/root/$log_path" ]; then
	cp "/root/$log_path" "$install_dir/debug"
else
	echo "WARNING: Cannot find calamares/session.log" >&2
fi

media_info=""
for info in \
	/run/live/medium/.disk/info \
	/cdrom/.disk/info \
	/lib/live/mount/medium/.disk/info; do
	if [ -e "$info" ]; then
		media_info="$info"
		break
	fi
done
if [ -n "$media_info" ]; then
	cp "$media_info" "$install_dir/media-info"
else
	echo "HighAsCG live medium (media-info unavailable at install time)" >"$install_dir/media-info"
fi

if [ -e /var/log/syslog ]; then
	cp /var/log/syslog "$install_dir/syslog"
elif command -v journalctl >/dev/null 2>&1; then
	journalctl -b --no-pager >"$install_dir/syslog" 2>/dev/null || : >"$install_dir/syslog"
else
	: >"$install_dir/syslog"
fi

if [ -f "$root/var/lib/dpkg/status" ]; then
	gzip --stdout "$root/var/lib/dpkg/status" >"$install_dir/initial-status.gz"
fi

[ -f "$install_dir/debug" ] && chmod 600 "$install_dir/debug"
[ -f "$install_dir/syslog" ] && chmod 600 "$install_dir/syslog"
[ -f "$install_dir/initial-status.gz" ] && chmod 644 "$install_dir/initial-status.gz"
[ -f "$install_dir/media-info" ] && chmod 644 "$install_dir/media-info"

exit 0
