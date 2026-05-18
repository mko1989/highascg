#!/usr/bin/env bash
# Install WO-47 systemd units: mount exFAT by LABEL=HIGHASCGEXF at /home/casparcg/exfat,
# bind ~/exfat/media → ~/highascg/media/exfat when present, then boot sync.
# Uses casparcg's uid/gid in mount options (no manual UUID — partition must be labelled HIGHASCGEXF).
#
# Usage:
#   sudo bash scripts/install-exfat-systemd-units.sh [casparcg]
#
# Idempotent. Safe to re-run after useradd changes UIDs.
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

USER_CASPAR="${1:-casparcg}"
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	echo "Unknown user: $USER_CASPAR" >&2
	exit 1
}
UIDN="$(id -u "$USER_CASPAR")"
GIDN="$(id -g "$USER_CASPAR")"
GNAME="$(id -gn "$USER_CASPAR")"

prep_svc="highascg-exfat-media-prep.service"
bind_mount_esc="home-casparcg-highascg-media-exfat.mount"

install -d /home/casparcg/exfat /etc/systemd/system
install -d -m 0755 -o "$USER_CASPAR" -g "$GNAME" /home/casparcg/highascg/media/exfat 2>/dev/null || install -d /home/casparcg/highascg/media/exfat
chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/exfat /home/casparcg/highascg/media/exfat

# shellcheck disable=SC2094
cat > /etc/systemd/system/home-casparcg-exfat.mount <<EOF
[Unit]
Description=HighAsCG exFAT data (LABEL=HIGHASCGEXF)
Documentation=file:/home/casparcg/highascg/tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md
DefaultDependencies=no
Conflicts=umount.target
Before=${prep_svc} ${bind_mount_esc} highascg-exfat-sync.service highascg.service
After=blk-availability.target systemd-remount-fs.service

[Mount]
What=/dev/disk/by-label/HIGHASCGEXF
Where=/home/casparcg/exfat
Type=exfat
Options=defaults,uid=${UIDN},gid=${GIDN},umask=002,nofail,x-systemd.device-timeout=20

[Install]
WantedBy=local-fs.target
EOF

cat > "/etc/systemd/system/${prep_svc}" <<EOF
[Unit]
Description=Ensure exFAT exposes media/ before bind into HighAsCG (WO-47)
Documentation=file:/home/casparcg/highascg/tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md
DefaultDependencies=no
BindsTo=home-casparcg-exfat.mount
After=home-casparcg-exfat.mount
Before=${bind_mount_esc}

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/install -d -m 0755 -o ${UIDN} -g ${GIDN} /home/casparcg/exfat/media

[Install]
RequiredBy=${bind_mount_esc}
EOF

cat > "/etc/systemd/system/${bind_mount_esc}" <<EOF
[Unit]
Description=Bind ~/exfat/media → ~/highascg/media/exfat (WO-47)
Documentation=file:/home/casparcg/highascg/tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md
DefaultDependencies=no
Requires=${prep_svc} home-casparcg-exfat.mount
After=${prep_svc} home-casparcg-exfat.mount
BindsTo=home-casparcg-exfat.mount
RequiresMountsFor=/home/casparcg/exfat
Before=highascg-exfat-sync.service highascg.service

[Mount]
What=/home/casparcg/exfat/media
Where=/home/casparcg/highascg/media/exfat
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/highascg-exfat-sync.service <<SVCEOF
[Unit]
Description=HighAsCG exFAT to project mtime sync (WO-47)
Documentation=file:/home/casparcg/highascg/tools/live-usb/EXFAT_DATA_ZERO_TOUCH.md
DefaultDependencies=no
After=network-pre.target home-casparcg-exfat.mount ${bind_mount_esc}
Wants=home-casparcg-exfat.mount
Before=highascg.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=${USER_CASPAR}
Group=${GNAME}
WorkingDirectory=/home/casparcg/highascg
ExecStart=/usr/bin/node /home/casparcg/highascg/tools/exfat-sync-cli.js

[Install]
WantedBy=multi-user.target
SVCEOF

chmod 0644 "/etc/systemd/system/home-casparcg-exfat.mount" \
	"/etc/systemd/system/highascg-exfat-sync.service" \
	"/etc/systemd/system/${prep_svc}" \
	"/etc/systemd/system/${bind_mount_esc}"

systemctl daemon-reload
systemctl enable home-casparcg-exfat.mount highascg-exfat-sync.service \
	"${bind_mount_esc}" "${prep_svc}" 2>/dev/null || true

echo "Installed:"
echo "  /etc/systemd/system/home-casparcg-exfat.mount  (What=/dev/disk/by-label/HIGHASCGEXF)"
echo "  /etc/systemd/system/${prep_svc}  (mkdir exfat/media when data volume attached)"
echo "  /etc/systemd/system/${bind_mount_esc}  (bind ~/exfat/media → ~/highascg/media/exfat)"
echo "  /etc/systemd/system/highascg-exfat-sync.service"
echo "Enable is set; mount activates when a volume labelled HIGHASCGEXF appears (e.g. after add-exfat-data-partition.sh)."
