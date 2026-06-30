#!/usr/bin/env bash
# Ensure NVMe / VMD / AHCI block drivers are in live initrd and load at runtime.
# Without vmd/nvme, Calamares on live USB sees no internal disk ("no partition available").
#
# Usage: sudo bash tools/eggs/live-usb/install-storage-drivers-for-iso.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULES_D=/etc/initramfs-tools/modules.d
MODPROBE_D=/etc/modprobe.d
MODULES_FILE=/etc/initramfs-tools/modules

KVER="$(uname -r)"
mkdir -p "$MODULES_D" "$MODPROBE_D"

echo "==> linux-modules-extra for ${KVER} (VMD and other out-of-tree-ish block drivers)"
apt-get update
if apt-cache show "linux-modules-extra-${KVER}" &>/dev/null; then
	apt-get install -y --no-install-recommends "linux-modules-extra-${KVER}"
elif apt-cache show linux-modules-extra-generic &>/dev/null; then
	apt-get install -y --no-install-recommends linux-modules-extra-generic
else
	echo "WARN: linux-modules-extra not in apt — continuing with in-tree modules only" >&2
fi

STORAGE_MODS=(
	nvme_core
	nvme
	vmd
	ahci
	libahci
	sd_mod
	scsi_mod
	scsi_transport_sas
)

cat >"${MODULES_D}/highascg-storage-block.conf" <<'EOF'
# HighAsCG live ISO — internal NVMe/SATA for Calamares install-to-disk.
nvme_core
nvme
vmd
ahci
libahci
sd_mod
scsi_mod
EOF

touch "$MODULES_FILE"
for m in "${STORAGE_MODS[@]}"; do
	grep -qxF "$m" "$MODULES_FILE" 2>/dev/null || echo "$m" >>"$MODULES_FILE"
done

cat >"${MODPROBE_D}/highascg-storage-block.conf" <<'EOF'
# Load Intel VMD before child NVMe namespaces appear (common on Xeon/Workstation boards).
softdep nvme pre: vmd
EOF

HOOK_SRC="${HERE}/etc-initramfs-tools-hooks-highascg-storage.sh"
HOOK_DEST=/etc/initramfs-tools/hooks/highascg-storage
install -m 0755 -o root -g root "$HOOK_SRC" "$HOOK_DEST"

PROBE_SRC="${HERE}/../../runtime/probe-internal-storage.sh"
PROBE_DST=/usr/local/lib/highascg/probe-internal-storage.sh
install -d /usr/local/lib/highascg
install -m 0755 -o root -g root "$PROBE_SRC" "$PROBE_DST"

REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
SVC_SRC="${REPO_ROOT}/scripts/systemd/highascg-storage-probe.service"
SVC_DEST=/etc/systemd/system/highascg-storage-probe.service
install -m 0644 -o root -g root "$SVC_SRC" "$SVC_DEST"
systemctl daemon-reload
systemctl enable highascg-storage-probe.service

found=0
for m in nvme_core nvme vmd; do
	if modinfo "$m" &>/dev/null; then
		echo "OK: module $m present ($(modinfo -n "$m" 2>/dev/null || echo builtin))"
		found=$((found + 1))
	else
		echo "WARN: module $m not found on build host — internal NVMe may need linux-modules-extra" >&2
	fi
done

echo "OK: storage drivers configured for ISO"
echo "     ${MODULES_D}/highascg-storage-block.conf"
echo "     ${HOOK_DEST}"
echo "     ${PROBE_DST}"
echo "     ${SVC_DEST} (enabled)"
