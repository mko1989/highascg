#!/usr/bin/env bash
# WO-52: LABEL=HIGHASCGDAT → /home/casparcg/bridge (internal playout disk, media library).
# WO-47: LABEL=HIGHASCGEXF → /home/casparcg/exfat (USB stick — field configs/media ingest).
# Neither volume is required for boot (nofail / boot scripts exit 0 when absent).
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
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOC_PKG=/usr/share/doc/highascg-wo47
prep_svc="highascg-exfat-media-prep.service"
bind_mount_esc="home-casparcg-highascg-media-exfat.mount"
update_svc="highascg-exfat-server-update.service"
arrive_svc="highascg-exfat-arrive.service"
bridge_arrive_svc="highascg-bridge-arrive.service"
ARRIVE_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-exfat-arrive.sh"
BRIDGE_ARRIVE_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-bridge-arrive.sh"
FIX_CFG_SRC="${REPO_ROOT}/scripts/exfat/highascg-fix-config-permissions.sh"
FIX_CFG_DST=/usr/local/lib/highascg/highascg-fix-config-permissions.sh
ARRIVE_SH_DST=/usr/local/lib/highascg/highascg-exfat-arrive.sh
BRIDGE_ARRIVE_SH_DST=/usr/local/lib/highascg/highascg-bridge-arrive.sh
UDEV_RULE_SRC="${REPO_ROOT}/config/udev/99-highascg-exfat-arrive.rules"
UDEV_RULE_DST=/etc/udev/rules.d/99-highascg-exfat-arrive.rules
UDEV_BRIDGE_RULE_SRC="${REPO_ROOT}/config/udev/99-highascg-bridge-arrive.rules"
UDEV_BRIDGE_RULE_DST=/etc/udev/rules.d/99-highascg-bridge-arrive.rules
UPDATE_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-exfat-server-update.sh"
APPLY_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-apply-server-drop.sh"
WEBUI_UPDATE_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-webui-server-update.sh"
BOOT_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-exfat-boot.sh"
BRIDGE_BOOT_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-bridge-boot.sh"
DECKLINK_INSTALL_SH_SRC="${REPO_ROOT}/scripts/runtime/decklink-install-from-exfat.sh"
DECKLINK_INSTALL_LIB_SRC="${REPO_ROOT}/scripts/lib/decklink-install-lib.sh"
SYSTEM_TIME_SH_SRC="${REPO_ROOT}/scripts/runtime/highascg-set-system-time.sh"
NETWORK_APPLY_SH_SRC="${REPO_ROOT}/scripts/exfat/highascg-exfat-network-apply.sh"
SEED_LAYOUT_SH="${REPO_ROOT}/tools/eggs/live-usb/seed-exfat-operator-layout.sh"
SEED_BRIDGE_SH="${REPO_ROOT}/tools/eggs/live-usb/seed-bridge-operator-layout.sh"
LEGACY_USB_MEDIA_BIND="${HIGHASCG_LEGACY_USB_MEDIA_BIND:-0}"
bridge_prep_svc="highascg-bridge-media-prep.service"
# systemd: unit name must match Where= path (/home/.../media/bridge → …-media-bridge.mount)
bridge_media_mount="home-casparcg-highascg-media-bridge.mount"
UPDATE_SH_DST=/usr/local/lib/highascg/highascg-exfat-server-update.sh
APPLY_SH_DST=/usr/local/lib/highascg/highascg-apply-server-drop.sh
WEBUI_UPDATE_SH_DST=/usr/local/lib/highascg/highascg-webui-server-update.sh
BOOT_SH_DST=/usr/local/lib/highascg/highascg-exfat-boot.sh
BRIDGE_BOOT_SH_DST=/usr/local/lib/highascg/highascg-bridge-boot.sh
DECKLINK_INSTALL_SH_DST=/usr/local/lib/highascg/decklink-install-from-exfat.sh
DECKLINK_INSTALL_LIB_DST=/usr/local/lib/highascg/decklink-install-lib.sh
SYSTEM_TIME_SH_DST=/usr/local/lib/highascg/highascg-set-system-time.sh
NETWORK_APPLY_SH_DST=/usr/local/lib/highascg/highascg-exfat-network-apply.sh
decklink_install_svc="highascg-decklink-install.service"
network_apply_svc="highascg-exfat-network-apply.service"
BOOT_EXCLUDE_SRC="${REPO_ROOT}/config/bootstrap-rsync-excludes.txt"
BOOT_EXCLUDE_DST=/etc/highascg/bootstrap-rsync-excludes.txt
UPDATE_EXCLUDE_SRC="${REPO_ROOT}/config/server-update-rsync-excludes.txt"
UPDATE_EXCLUDE_DST=/etc/highascg/server-update-rsync-excludes.txt

DOC_EXFAT="${REPO_ROOT}/tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md"
DOC_MATRIX="${REPO_ROOT}/docs/WO47_ISO_VS_EXFAT.md"

mkdir -p /usr/local/lib/highascg /etc/highascg /var/cache/highascg/update-staging /var/cache/highascg/updates "$DOC_PKG"
install -d -m 0755 -o "$USER_CASPAR" -g "$GNAME" /var/cache/highascg/updates 2>/dev/null || install -d -m 0755 /var/cache/highascg/updates
[[ -f "$ARRIVE_SH_SRC" ]] && install -m 0755 -o root -g root "$ARRIVE_SH_SRC" "$ARRIVE_SH_DST"
[[ -f "$BRIDGE_ARRIVE_SH_SRC" ]] && install -m 0755 -o root -g root "$BRIDGE_ARRIVE_SH_SRC" "$BRIDGE_ARRIVE_SH_DST"
[[ -f "$FIX_CFG_SRC" ]] && install -m 0755 -o root -g root "$FIX_CFG_SRC" "$FIX_CFG_DST"
[[ -f "$UPDATE_SH_SRC" ]] && install -m 0755 -o root -g root "$UPDATE_SH_SRC" "$UPDATE_SH_DST"
[[ -f "$APPLY_SH_SRC" ]] && install -m 0755 -o root -g root "$APPLY_SH_SRC" "$APPLY_SH_DST"
[[ -f "$WEBUI_UPDATE_SH_SRC" ]] && install -m 0755 -o root -g root "$WEBUI_UPDATE_SH_SRC" "$WEBUI_UPDATE_SH_DST"
[[ -f "$BOOT_SH_SRC" ]] && install -m 0755 -o root -g root "$BOOT_SH_SRC" "$BOOT_SH_DST"
[[ -f "$BRIDGE_BOOT_SH_SRC" ]] && install -m 0755 -o root -g root "$BRIDGE_BOOT_SH_SRC" "$BRIDGE_BOOT_SH_DST"
[[ -f "$DECKLINK_INSTALL_LIB_SRC" ]] && install -m 0644 -o root -g root "$DECKLINK_INSTALL_LIB_SRC" "$DECKLINK_INSTALL_LIB_DST"
[[ -f "$DECKLINK_INSTALL_SH_SRC" ]] && install -m 0755 -o root -g root "$DECKLINK_INSTALL_SH_SRC" "$DECKLINK_INSTALL_SH_DST"
[[ -f "$SYSTEM_TIME_SH_SRC" ]] && install -m 0755 -o root -g root "$SYSTEM_TIME_SH_SRC" "$SYSTEM_TIME_SH_DST"
[[ -f "$NETWORK_APPLY_SH_SRC" ]] && install -m 0755 -o root -g root "$NETWORK_APPLY_SH_SRC" "$NETWORK_APPLY_SH_DST"
if [[ -f "$UDEV_RULE_SRC" ]]; then
	install -m 0644 -o root -g root "$UDEV_RULE_SRC" "$UDEV_RULE_DST"
	echo "installed ${UDEV_RULE_DST}"
fi
if [[ -f "$UDEV_BRIDGE_RULE_SRC" ]]; then
	install -m 0644 -o root -g root "$UDEV_BRIDGE_RULE_SRC" "$UDEV_BRIDGE_RULE_DST"
	echo "installed ${UDEV_BRIDGE_RULE_DST}"
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

install -d /home/casparcg/exfat /home/casparcg/bridge /etc/systemd/system
install -d -m 0755 -o "$USER_CASPAR" -g "$GNAME" /home/casparcg/highascg/media 2>/dev/null || install -d /home/casparcg/highascg/media
install -d -m 0755 -o "$USER_CASPAR" -g "$GNAME" /home/casparcg/highascg/media/exfat 2>/dev/null || install -d /home/casparcg/highascg/media/exfat
install -d -m 0755 -o "$USER_CASPAR" -g "$GNAME" /home/casparcg/highascg/media/bridge 2>/dev/null || install -d /home/casparcg/highascg/media/bridge
chown "$USER_CASPAR:$USER_CASPAR" /home/casparcg/exfat /home/casparcg/bridge \
	/home/casparcg/highascg/media /home/casparcg/highascg/media/exfat /home/casparcg/highascg/media/bridge
if [[ -f "$SEED_BRIDGE_SH" ]]; then
	HIGHASCG_SERVICE_USER="$USER_CASPAR" bash "$SEED_BRIDGE_SH" /home/casparcg/bridge
fi
STRIP_SIM_SH="${REPO_ROOT}/tools/eggs/live-usb/strip-legacy-exfat-sim.sh"
if [[ -f "$SEED_LAYOUT_SH" ]]; then
	HIGHASCG_SERVICE_USER="$USER_CASPAR" bash "$SEED_LAYOUT_SH" /home/casparcg/exfat
fi
if [[ -f "$STRIP_SIM_SH" ]]; then
	bash "$STRIP_SIM_SH" /home/casparcg/exfat
fi
touch /etc/highascg/disable-exfat-bootstrap 2>/dev/null || true
rm -f /etc/highascg/legacy-usb-media-bind 2>/dev/null || true
if [[ "$LEGACY_USB_MEDIA_BIND" == "1" ]]; then
	touch /etc/highascg/legacy-usb-media-bind
fi

# shellcheck source=install-exfat-systemd-units-units.sh
source "${SCRIPT_DIR}/install-exfat-systemd-units-units.sh"

# Wrong name refused bind at media/bridge (Where= mismatch).
rm -f /etc/systemd/system/home-casparcg-highascg-media.mount

chmod 0644 "/etc/systemd/system/home-casparcg-exfat.mount" \
	"/etc/systemd/system/highascg-exfat-sync.service" \
	"/etc/systemd/system/highascg-fix-config-permissions.service" \
	"/etc/systemd/system/highascg-exfat-boot.service" \
	"/etc/systemd/system/${update_svc}" \
	"/etc/systemd/system/${prep_svc}" \
	"/etc/systemd/system/${bind_mount_esc}"

systemctl daemon-reload
systemctl disable highascg-exfat-bootstrap.service 2>/dev/null || true
systemctl reset-failed highascg-exfat-arrive.service 2>/dev/null || true
systemctl reset-failed highascg-bridge-arrive.service 2>/dev/null || true
ENABLE_UNITS=(
	highascg-bridge-boot.service
	highascg-exfat-boot.service
	"${network_apply_svc}"
	"${update_svc}"
	"${decklink_install_svc}"
	highascg-fix-config-permissions.service
	highascg-exfat-sync.service
	"${prep_svc}"
	"${arrive_svc}"
	"${bridge_arrive_svc}"
)
# Mount/bind units are started on demand (bridge-boot / exfat-boot / udev). Enabling them
# pulls dev-disk-by-label.* into local-fs.target and can block boot ~90s when absent.
DISABLE_AT_BOOT=(
	home-casparcg-exfat.mount
	home-casparcg-bridge.mount
	"${bridge_media_mount}"
)
if [[ "$LEGACY_USB_MEDIA_BIND" == "1" ]]; then
	ENABLE_UNITS+=("${bind_mount_esc}")
else
	DISABLE_AT_BOOT+=("${bind_mount_esc}")
fi
systemctl enable "${ENABLE_UNITS[@]}" 2>/dev/null || true
for u in "${DISABLE_AT_BOOT[@]}"; do
	[[ -n "$u" ]] || continue
	systemctl disable "$u" 2>/dev/null || true
done
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=block --action=add 2>/dev/null || true

echo "Installed:"
echo "  ${ARRIVE_SH_DST}"
echo "  ${UDEV_RULE_DST} (hotplug + late USB → ${arrive_svc})"
echo "  ${UDEV_BRIDGE_RULE_DST} (late NVMe → ${bridge_arrive_svc})"
echo "  ${BRIDGE_ARRIVE_SH_DST}"
echo "  ${UPDATE_SH_DST}"
echo "  ${APPLY_SH_DST}"
echo "  ${WEBUI_UPDATE_SH_DST}"
echo "  /etc/highascg/disable-exfat-bootstrap (legacy sim/highascg seed off)"
echo "  ${BOOT_EXCLUDE_DST} (legacy bootstrap excludes — unused when disabled)"
echo "  ${UPDATE_EXCLUDE_DST} (server drop — skips client/, dist-web/, runtime)"
echo "  ${DOC_PKG}/ (offline Documentation= targets)"
echo "  /etc/systemd/system/home-casparcg-bridge.mount (LABEL=HIGHASCGDAT)"
echo "  /etc/systemd/system/${bridge_prep_svc}"
	echo "  /etc/systemd/system/${bridge_media_mount} (bridge library → ~/highascg/media/bridge)"
echo "  /etc/systemd/system/highascg-bridge-boot.service"
echo "  ${BRIDGE_BOOT_SH_DST}"
echo "  legacy USB media bind: $([[ "$LEGACY_USB_MEDIA_BIND" == "1" ]] && echo enabled || echo disabled — WO-52)"
echo "  /etc/systemd/system/home-casparcg-exfat.mount"
echo "  /etc/systemd/system/${prep_svc}"
echo "  /etc/systemd/system/${bind_mount_esc}"
echo "  /etc/systemd/system/${update_svc} (drop-update/ or legacy update/server/)"
echo "  /etc/systemd/system/highascg-fix-config-permissions.service"
echo "  ${FIX_CFG_DST}"
echo "  /etc/systemd/system/highascg-exfat-sync.service"
echo "  /etc/systemd/system/highascg-exfat-boot.service"
echo "  ${BOOT_SH_DST}"
echo "  /etc/systemd/system/${network_apply_svc}"
echo "  ${NETWORK_APPLY_SH_DST}"
echo "  /etc/systemd/system/${decklink_install_svc}"
echo "  ${DECKLINK_INSTALL_SH_DST}"
echo "  ${DECKLINK_INSTALL_LIB_DST}"
echo "  ${SYSTEM_TIME_SH_DST}"
echo "  /etc/systemd/system/${arrive_svc}"
# WO-188: sudoers entry for DeckLink install (via Web UI password-gated POST)
SUDOERS_DECKLINK=/etc/sudoers.d/highascg-decklink-install
TMP_SUDOERS="$(mktemp)"
trap 'rm -f "$TMP_SUDOERS"' EXIT
cat >"$TMP_SUDOERS" <<SUDOERSEOF
# HighAsCG DeckLink install (WO-188) — passwordless sudo for highascg-webui-server-update user
${USER_CASPAR} ALL=(root) NOPASSWD: ${DECKLINK_INSTALL_SH_DST}
SUDOERSEOF
visudo -cf "$TMP_SUDOERS" >/dev/null 2>&1 && install -m 0440 -o root -g root "$TMP_SUDOERS" "$SUDOERS_DECKLINK"
echo "installed ${SUDOERS_DECKLINK}"

# WO-193: sudoers entry for system time setting (via Web UI password-gated POST)
SUDOERS_SYSTEM_TIME=/etc/sudoers.d/highascg-system-time
TMP_SUDOERS_TIME="$(mktemp)"
trap 'rm -f "$TMP_SUDOERS_TIME"' EXIT
cat >"$TMP_SUDOERS_TIME" <<SUDOERSTIMEEOF
# HighAsCG system time setting (WO-193) — passwordless sudo for system time control
${USER_CASPAR} ALL=(root) NOPASSWD: ${SYSTEM_TIME_SH_DST}
SUDOERSTIMEEOF
visudo -cf "$TMP_SUDOERS_TIME" >/dev/null 2>&1 && install -m 0440 -o root -g root "$TMP_SUDOERS_TIME" "$SUDOERS_SYSTEM_TIME"
echo "installed ${SUDOERS_SYSTEM_TIME}"

echo "Re-run: sudo bash ${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh ${USER_CASPAR}"
