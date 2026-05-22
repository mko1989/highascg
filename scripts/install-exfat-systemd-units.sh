#!/usr/bin/env bash
# Install WO-47 systemd units: mount exFAT by LABEL=HIGHASCGEXF at /home/casparcg/exfat,
# bind ~/exfat/media → ~/highascg/media/exfat when present, optional rsync bootstrap (ISO→stick),
# then boot mtime sync (node).
# Uses casparcg's uid/gid in mount options (no manual UUID — partition must be labelled HIGHASCGEXF).
#
# Documentation= points at /usr/share/doc/highascg-wo47/ so units stay valid after eggs excludes
# drop ~/highascg/tools from the squashfs.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOC_PKG=/usr/share/doc/highascg-wo47
prep_svc="highascg-exfat-media-prep.service"
bind_mount_esc="home-casparcg-highascg-media-exfat.mount"
update_svc="highascg-exfat-server-update.service"
arrive_svc="highascg-exfat-arrive.service"
ARRIVE_SH_SRC="${REPO_ROOT}/scripts/highascg-exfat-arrive.sh"
ARRIVE_SH_DST=/usr/local/lib/highascg/highascg-exfat-arrive.sh
UDEV_RULE_SRC="${REPO_ROOT}/config/udev/99-highascg-exfat-arrive.rules"
UDEV_RULE_DST=/etc/udev/rules.d/99-highascg-exfat-arrive.rules
UPDATE_SH_SRC="${REPO_ROOT}/scripts/highascg-exfat-server-update.sh"
SEED_LAYOUT_SH="${REPO_ROOT}/tools/eggs/live-usb/seed-exfat-operator-layout.sh"
UPDATE_SH_DST=/usr/local/lib/highascg/highascg-exfat-server-update.sh
BOOT_EXCLUDE_SRC="${REPO_ROOT}/config/bootstrap-rsync-excludes.txt"
BOOT_EXCLUDE_DST=/etc/highascg/bootstrap-rsync-excludes.txt
UPDATE_EXCLUDE_SRC="${REPO_ROOT}/config/server-update-rsync-excludes.txt"
UPDATE_EXCLUDE_DST=/etc/highascg/server-update-rsync-excludes.txt

DOC_EXFAT="${REPO_ROOT}/tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md"
DOC_MATRIX="${REPO_ROOT}/docs/WO47_ISO_VS_EXFAT.md"

mkdir -p /usr/local/lib/highascg /etc/highascg "$DOC_PKG"
[[ -f "$ARRIVE_SH_SRC" ]] && install -m 0755 -o root -g root "$ARRIVE_SH_SRC" "$ARRIVE_SH_DST"
[[ -f "$UPDATE_SH_SRC" ]] && install -m 0755 -o root -g root "$UPDATE_SH_SRC" "$UPDATE_SH_DST"
if [[ -f "$UDEV_RULE_SRC" ]]; then
	install -m 0644 -o root -g root "$UDEV_RULE_SRC" "$UDEV_RULE_DST"
	echo "installed ${UDEV_RULE_DST}"
fi
if [[ -f "$BOOT_EXCLUDE_SRC" ]]; then
	install -m 0644 -o root -g root "$BOOT_EXCLUDE_SRC" "$BOOT_EXCLUDE_DST"
	echo "installed ${BOOT_EXCLUDE_DST}"
fi
if [[ -f "$UPDATE_EXCLUDE_SRC" ]]; then
	install -m 0644 -o root -g root "$UPDATE_EXCLUDE_SRC" "$UPDATE_EXCLUDE_DST"
	echo "installed ${UPDATE_EXCLUDE_DST}"
fi
for d in "$DOC_EXFAT" "$DOC_MATRIX"; do
	[[ -f "$d" ]] || continue
	base="$(basename "$d")"
	install -m 0644 -o root -g root "$d" "${DOC_PKG}/${base}"
done

DOC_URI="file:${DOC_PKG}/EXFAT_DATA_ZERO_TOUCH.md"

install -d /home/casparcg/exfat /etc/systemd/system
install -d -m 0755 -o "$USER_CASPAR" -g "$GNAME" /home/casparcg/highascg/media/exfat 2>/dev/null || install -d /home/casparcg/highascg/media/exfat
chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/exfat /home/casparcg/highascg/media/exfat
if [[ -f "$SEED_LAYOUT_SH" ]]; then
	HIGHASCG_SERVICE_USER="$USER_CASPAR" bash "$SEED_LAYOUT_SH" /home/casparcg/exfat
fi
touch /etc/highascg/disable-exfat-bootstrap 2>/dev/null || true

# shellcheck disable=SC2094
cat > /etc/systemd/system/home-casparcg-exfat.mount <<EOF
[Unit]
Description=HighAsCG exFAT data (LABEL=HIGHASCGEXF)
Documentation=${DOC_URI}
DefaultDependencies=no
Conflicts=umount.target
Before=${prep_svc} ${bind_mount_esc} ${update_svc} highascg-exfat-sync.service highascg.service
After=blk-availability.target systemd-remount-fs.service

[Mount]
What=/dev/disk/by-label/HIGHASCGEXF
Where=/home/casparcg/exfat
Type=exfat
Options=defaults,uid=${UIDN},gid=${GIDN},umask=002,nofail,x-systemd.device-timeout=90

[Install]
WantedBy=local-fs.target
EOF

cat > "/etc/systemd/system/${prep_svc}" <<EOF
[Unit]
Description=Ensure exFAT exposes media/ before bind into HighAsCG (WO-47)
Documentation=${DOC_URI}
DefaultDependencies=no
BindsTo=home-casparcg-exfat.mount
After=home-casparcg-exfat.mount
Before=${bind_mount_esc} ${update_svc} highascg-exfat-sync.service highascg.service

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
Documentation=${DOC_URI}
DefaultDependencies=no
Requires=${prep_svc} home-casparcg-exfat.mount
After=${prep_svc} home-casparcg-exfat.mount
BindsTo=home-casparcg-exfat.mount
RequiresMountsFor=/home/casparcg/exfat
Before=${update_svc} highascg-exfat-sync.service highascg.service

[Mount]
What=/home/casparcg/exfat/media
Where=/home/casparcg/highascg/media/exfat
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
EOF

cat > "/etc/systemd/system/${update_svc}" <<UPDEOF
[Unit]
Description=Apply server drop from exFAT drop-update/ (WO-47)
Documentation=${DOC_URI}
DefaultDependencies=no
After=home-casparcg-exfat.mount ${bind_mount_esc}
Before=highascg-exfat-sync.service highascg.service
ConditionPathIsMountPoint=/home/casparcg/exfat

[Service]
Type=oneshot
RemainAfterExit=yes
User=root
Group=root
Environment=HIGHASCG_SERVICE_USER=${USER_CASPAR}
ExecStart=${UPDATE_SH_DST}

[Install]
WantedBy=multi-user.target
UPDEOF

cat > /etc/systemd/system/highascg-exfat-sync.service <<SVCEOF
[Unit]
Description=HighAsCG exFAT to project mtime sync (WO-47)
Documentation=${DOC_URI}
DefaultDependencies=no
After=network-pre.target home-casparcg-exfat.mount ${bind_mount_esc} ${update_svc}
Before=highascg.service
ConditionPathIsMountPoint=/home/casparcg/exfat
ConditionPathExists=/home/casparcg/highascg/tools/runtime/exfat-sync-cli.js

[Service]
Type=oneshot
RemainAfterExit=yes
User=${USER_CASPAR}
Group=${GNAME}
WorkingDirectory=/home/casparcg/highascg
ExecStart=/usr/bin/node /home/casparcg/highascg/tools/runtime/exfat-sync-cli.js

[Install]
WantedBy=multi-user.target
SVCEOF

cat > "/etc/systemd/system/${arrive_svc}" <<ARRIVEEOF
[Unit]
Description=Mount HIGHASCGEXF and run WO-47 pipeline (late USB / hotplug)
Documentation=${DOC_URI}
DefaultDependencies=no
ConditionPathExists=/dev/disk/by-label/HIGHASCGEXF
ConditionPathExists=!/etc/highascg/disable-exfat-arrive

[Service]
Type=oneshot
RemainAfterExit=no
ExecStart=${ARRIVE_SH_DST}

[Install]
WantedBy=multi-user.target
ARRIVEEOF

chmod 0644 "/etc/systemd/system/home-casparcg-exfat.mount" \
	"/etc/systemd/system/highascg-exfat-sync.service" \
	"/etc/systemd/system/${update_svc}" \
	"/etc/systemd/system/${prep_svc}" \
	"/etc/systemd/system/${bind_mount_esc}"

systemctl daemon-reload
systemctl disable highascg-exfat-bootstrap.service 2>/dev/null || true
systemctl enable home-casparcg-exfat.mount "${update_svc}" highascg-exfat-sync.service \
	"${bind_mount_esc}" "${prep_svc}" "${arrive_svc}" 2>/dev/null || true
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=block --action=add 2>/dev/null || true

echo "Installed:"
echo "  ${ARRIVE_SH_DST}"
echo "  ${UDEV_RULE_DST} (hotplug + late USB → ${arrive_svc})"
echo "  ${UPDATE_SH_DST}"
echo "  /etc/highascg/disable-exfat-bootstrap (legacy sim/highascg seed off)"
echo "  ${BOOT_EXCLUDE_DST} (legacy bootstrap excludes — unused when disabled)"
echo "  ${UPDATE_EXCLUDE_DST} (server drop — skips client/, dist-web/, runtime)"
echo "  ${DOC_PKG}/ (offline Documentation= targets)"
echo "  /etc/systemd/system/home-casparcg-exfat.mount"
echo "  /etc/systemd/system/${prep_svc}"
echo "  /etc/systemd/system/${bind_mount_esc}"
echo "  /etc/systemd/system/${update_svc} (drop-update/ or legacy update/server/)"
echo "  /etc/systemd/system/highascg-exfat-sync.service"
echo "  /etc/systemd/system/${arrive_svc}"
echo "Re-run: sudo bash ${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh ${USER_CASPAR}"
