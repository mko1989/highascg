#!/usr/bin/env bash
# Build a HighAsCG live ISO with ONE baked NVIDIA driver (the installed branch, e.g. 615).
#
#   sudo bash tools/eggs/live-usb/build-highascg-egg.sh        # branch auto-detected (HIGHASCG_NVIDIA_DRIVER=615 to be explicit)
#
# Does NOT download multi-branch /opt/nvidia-pool debs.
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"

# WO-832: the branch used to be a hard-coded 535|580|595 whitelist — the 26.04 upgrade put the box on 615
# and the build refused to start. The ISO is a CLONE of this host, so the baked driver IS the installed
# one: default to it, accept any 3-digit branch, and refuse a stamp that contradicts the host.
# shellcheck source=../../../scripts/lib/nvidia-branch.sh
source "${REPO_ROOT}/scripts/lib/nvidia-branch.sh"
BR="${HIGHASCG_NVIDIA_DRIVER:-}"
DETECTED_BR="$(highascg_installed_nvidia_branch 2>/dev/null || true)"
if [[ -z "$BR" && -n "$DETECTED_BR" ]]; then
	BR="$DETECTED_BR"
	echo "==> HIGHASCG_NVIDIA_DRIVER unset — using the installed driver branch ${BR}"
fi
export HIGHASCG_ISO_FORBID_DECKLINK="${HIGHASCG_ISO_FORBID_DECKLINK:-1}"
if [[ ! "$BR" =~ ^[0-9]{3}$ ]]; then
	echo "Set HIGHASCG_NVIDIA_DRIVER to the installed driver branch (e.g. 615; detected: ${DETECTED_BR:-none}) — one driver per ISO." >&2
	exit 1
fi
if [[ -n "$DETECTED_BR" && "$DETECTED_BR" != "$BR" ]]; then
	echo "ERROR: HIGHASCG_NVIDIA_DRIVER=${BR} but this host runs driver ${DETECTED_BR}; the clone would ship ${DETECTED_BR}" >&2
	echo "       under a ${BR} stamp. Unset it (auto-detect) or install the ${BR} driver first." >&2
	exit 1
fi

export HIGHASCG_NVIDIA_DRIVER="$BR"
BASENAME="${BASENAME:-highascg-nvidia-${BR}}"

# WO-464: a previous `eggs produce` leaves its liveroot bind mounts behind, and the audit that
# catches them only runs at line ~92 — after prepare has already done apt, `npm ci`, a vite build
# and the Companion packaging (~5 min) and mutated the host tree. The condition is knowable before
# any of that, so check it here. Effectively: one produce per boot.
# shellcheck source=eggs-liveroot-safety.sh
source "${HERE}/eggs-liveroot-safety.sh"
_LIVEROOT="$(eggs_liveroot_default)"
if eggs_liveroot_has_host_bind_mounts "$_LIVEROOT"; then
	echo "ERROR: a previous eggs produce left LIVE system bind mounts under ${_LIVEROOT}." >&2
	echo "       Reboot, then re-run this script. Nothing has been changed on this host yet." >&2
	echo "       Do NOT run 'umount -R ${_LIVEROOT}' or 'rm -rf ${_LIVEROOT}' — that path has" >&2
	echo "       erased /usr on this project before (see RECOVER_DESTROYED_USR.md)." >&2
	eggs_liveroot_print_host_bind_mounts "$_LIVEROOT"
	exit 1
fi

mkdir -p /etc/highascg
echo "$BR" > /etc/highascg/nvidia-iso-driver
chmod 0644 /etc/highascg/nvidia-iso-driver
echo "[build-highascg-egg] stamped /etc/highascg/nvidia-iso-driver = $BR"

export HIGHASCG_PURGE_NVIDIA_POOL=1
DISABLE="$REPO_ROOT/scripts/disable-nvidia-multi-driver-boot.sh"
if [[ -f "$DISABLE" ]]; then
	bash "$DISABLE"
fi

echo "==> WO-47 exFAT + empty mount stubs + eggs exclude merge (operator-stick truth baked into clone snapshot)"
HIGHASCG_SKIP_BOOT_BRANDING_IN_PREPARE=1 SKIP_HIGHASCG_SYSTEMD_RESTART=1 bash "${HERE}/prepare-eggs-clone-with-exfat.sh"

if [[ -f /etc/highascg/pinned-kernel ]]; then
	echo "==> Pinned kernel $(cat /etc/highascg/pinned-kernel) — eggs.yaml + purge non-pinned images (no linux-image-generic)"
	HIGHASCG_SKIP_HOST_INITRAMFS=1 bash "${HERE}/sync-eggs-kernel-and-purge-stale.sh"
else
	echo "==> Latest single kernel (apt generic + eggs.yaml + purge older images)"
	echo "WARN: no /etc/highascg/pinned-kernel — this may install a newer HWE kernel" >&2
	HIGHASCG_ENSURE_LATEST_KERNEL=1 HIGHASCG_SKIP_HOST_INITRAMFS=1 bash "${HERE}/sync-eggs-kernel-and-purge-stale.sh"
fi

echo "==> Install network + firmware essentials for live image"
apt-get update
apt-get install -y --no-install-recommends \
	network-manager wpasupplicant isc-dhcp-client \
	iproute2 ethtool pciutils usbutils rfkill wireless-regdb \
	linux-firmware netplan.io

echo "==> Live auto-network without NM (systemd-networkd + netplan)"
mkdir -p /etc/systemd/network /etc/netplan

tee /etc/systemd/network/10-live-wired.network >/dev/null <<'NETEOF'
[Match]
Name=en* eth*

[Network]
DHCP=yes
LinkLocalAddressing=ipv4
MulticastDNS=yes
IPv6AcceptRA=yes
NETEOF

tee /etc/netplan/01-live-networkd.yaml >/dev/null <<'PLANEOF'
network:
  version: 2
  renderer: networkd
PLANEOF

chmod 600 /etc/netplan/01-live-networkd.yaml
chown root:root /etc/netplan/01-live-networkd.yaml

systemctl enable systemd-networkd systemd-resolved || true
ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf 2>/dev/null || true

echo "==> Hostname for ISO naming (${BASENAME})"
hostnamectl set-hostname "${BASENAME}" 2>/dev/null || hostname "${BASENAME}"

echo "==> Factory operator config (not eggs build-host JSON / .env)"
bash "${HERE}/reset-iso-operator-config.sh"

echo "==> Clone host audit (swap, nvidia-pool, excludes, branding)"
bash "${HERE}/audit-eggs-clone-host.sh"

echo "==> Third-party license bundle (NVIDIA / NDI / DeckLink notices)"
bash "${REPO_ROOT}/tools/release/collect-third-party-licenses.sh"
if [[ -f "${REPO_ROOT}/licenses/manifest.json" ]]; then
	bash "${REPO_ROOT}/scripts/setup/15-licenses-install.sh"
else
	echo "WARN: licenses/manifest.json missing after collect" >&2
fi

bash "${HERE}/pre-produce-preflight.sh"

echo "==> Finalize GRUB splash + Plymouth initramfs (must run immediately before eggs produce)"
bash "${HERE}/install-storage-drivers-for-iso.sh"
bash "${HERE}/finalize-boot-branding-for-eggs-produce.sh"

sample="$(file -b /usr/share/plymouth/themes/highascg/throbber-0001.png 2>/dev/null || true)"
echo "==> Host Plymouth throbber sample before produce: ${sample:-missing}"
if echo "$sample" | grep -q RGBA; then
	echo "ERROR: host Plymouth frames still RGBA — prepare-branding-assets.sh did not run" >&2
	exit 1
fi

THEME_ABS="$(cd "${HERE}/highascg-eggs-theme" && pwd)"
[[ -f "${THEME_ABS}/theme/livecd/grub.main.cfg" ]] || {
	echo "Missing highascg-eggs-theme — run install-eggs-live-grub-theme.sh first." >&2
	exit 1
}

echo "==> Stop highascg + companion during squashfs (avoid state changing mid-pack; free RAM)"
systemctl stop highascg.service companion.service 2>/dev/null || true

# WO-471: stamp EVERY produce, not just the flash wrapper. WO-432 put this write in
# build-produce-flash-stick.sh, but a bare `npm run eggs:build` (this script) is the main
# workflow and never stamped — so clones fell through src/system/build-stamp.js's precedence
# (BUILD_STAMP -> .highascg-build-stamp -> package.json.version) to the frozen legacy value and
# Settings -> Updates reported 2026.05.20 on a same-day ISO. Worse, compareBuildStamps() then
# weighed that against real release stamps, so the update check answered on a bogus version.
#
# This must land BEFORE `eggs produce` clones the filesystem, and BUILD_STAMP is deliberately
# absent from the eggs exclude fragments so it rides into the squashfs. The wrapper exports
# HIGHASCG_BUILD_STAMP so both phases report one identical stamp; standalone runs generate it.
PRODUCE_STAMP="${HIGHASCG_BUILD_STAMP:-$(date -u +%Y-%m-%d_%H%M%S)}"
echo "$PRODUCE_STAMP" >"${REPO_ROOT}/BUILD_STAMP"
chown --reference="$REPO_ROOT" "${REPO_ROOT}/BUILD_STAMP" 2>/dev/null || true
echo "==> BUILD_STAMP=${PRODUCE_STAMP}"

echo "==> Build ISO basename=${BASENAME} theme=${THEME_ABS} (single NVIDIA driver ${BR})"
eggs produce --nointeractive --clone --max --excludes static --basename "${BASENAME}" --theme "${THEME_ABS}"

echo "==> Patch Calamares in squashfs (eggs produce regenerates /etc/calamares after preflight)"
if [[ "${HIGHASCG_ISO_EMBED_CALAMARES:-1}" == "1" ]]; then
	# Required for install-to-disk: unsquashfs → fix shellprocess → mksquashfs (~5–15 min).
	bash "${HERE}/patch-iso-squashfs-calamares.sh"
else
	echo "     skip: HIGHASCG_ISO_EMBED_CALAMARES=0 (no Calamares in ISO)"
fi

echo "==> Inject GRUB splash + Plymouth initrd into ISO (eggs makeEfi ordering workaround)"
# Fresh produce already cloned host /usr into squashfs — skip 25 min squashfs rebuild.
HIGHASCG_SKIP_SQUASHFS_REFRESH=1 bash "${HERE}/inject-iso-boot-branding.sh"

echo "==> Verify squashfs excludes (no swap file, nvidia-pool, dev trees)"
bash "${HERE}/verify-iso-squashfs-excludes.sh"

if [[ "${HIGHASCG_SKIP_ISO_BOOT_BRANDING_VERIFY:-0}" == "1" ]]; then
	echo "==> Skip ISO boot branding verify (HIGHASCG_SKIP_ISO_BOOT_BRANDING_VERIFY=1)"
else
	echo "==> Verify ISO boot branding (set HIGHASCG_SKIP_ISO_BOOT_BRANDING_VERIFY=1 or FAST=1 to shorten)"
	HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST="${HIGHASCG_ISO_BOOT_BRANDING_VERIFY_FAST:-0}" \
		bash "${HERE}/verify-iso-boot-branding.sh" || {
		echo "ERROR: ISO boot branding check failed — do not flash this ISO." >&2
		echo "       The FAIL lines above name the missing asset (splash.png, font.pf2, plymouth theme, show.qml, …)." >&2
		exit 1
	}
fi

if [[ "${SKIP_STRIP_HOST_SWAP:-0}" != "1" ]]; then
	bash "${HERE}/strip-host-swap-for-live-iso.sh" restore
fi

echo "==> Remount bridge/USB + config sync (eggs produce umounts volumes for squashfs)"
bash "${HERE}/unmask-exfat-systemd.sh"
systemctl reset-failed highascg-exfat-boot.service 2>/dev/null || true
bash "${REPO_ROOT}/scripts/highascg-exfat-remount-sync.sh" casparcg 2>/dev/null || {
	echo "WARN: remount/sync skipped — run: sudo bash ${REPO_ROOT}/scripts/highascg-exfat-remount-sync.sh" >&2
}

# WO-724: reset-iso-operator-config.sh put the factory casparcg.config in place and the npm step's
# pause/restore restarted Caspar on it; the sync above brings the real config back, so restart Caspar
# onto it (23.10: the build host ran the 1-channel factory config until the next Caspar restart).
echo "==> Restart Caspar on the restored config"
systemctl try-restart casparcg-server.service || echo "WARN: casparcg-server did not restart — sudo systemctl restart casparcg-server" >&2

# The squashfs step above stops companion.service; nothing started it again (22.10, Companion stayed down after a build).
if systemctl is-enabled --quiet companion.service 2>/dev/null; then
	echo "==> Restart Companion (stopped for the squashfs)"
	systemctl start companion.service || echo "WARN: companion.service did not start — sudo systemctl start companion" >&2
fi

# WO-465: install-iso-defaults.sh runs `npm prune --omit=dev --omit=optional` so the squashfs
# carries production deps only. That prune outlives the build, and the repo's own gates then die
# with `Cannot find module 'acorn'`. Safe to restore here: eggs produce has already cloned the
# tree into the squashfs, so nothing added now reaches the ISO.
# As casparcg, never root — npm as root leaves root-owned node_modules and ~/.npm entries that
# EACCES the operator's next npm/test run.
echo "==> Restore dev dependencies on the build host (post-produce; does not affect the ISO)"
sudo -u "${USER_CASPAR:-casparcg}" -H bash -lc "cd '${REPO_ROOT}' && npm install --include=optional" \
	|| echo "WARN: npm install --include=optional failed — run it manually before the offline suite" >&2

# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh" 2>/dev/null || true
BUILT_ISO=""
if declare -F find_latest_iso >/dev/null 2>&1; then
	BUILT_ISO="$(find_latest_iso 2>/dev/null || true)"
fi

# WO-462: the ISO file appears at `eggs produce` time and keeps CHANGING for minutes afterwards —
# patch-iso-squashfs-calamares.sh rewrites filesystem.squashfs and inject-iso-boot-branding.sh
# re-packs the whole image. A stick copy started inside that window gets a torn image: correct
# final size, mixed content, and GRUB dies with "invalid magic number" loading the kernel. The
# name's timestamp is the produce time, NOT the finish time, so it cannot be used as a signal.
# This sidecar is written LAST — its existence is the only reliable "safe to copy" marker.
if [[ -n "$BUILT_ISO" && -f "$BUILT_ISO" ]]; then
	echo "==> Completion sidecar (safe-to-copy marker + checksum) — this is written last"
	(cd "$(dirname "$BUILT_ISO")" && sha256sum "$(basename "$BUILT_ISO")" >"$(basename "$BUILT_ISO").sha256") \
		|| echo "WARN: could not write ${BUILT_ISO}.sha256" >&2
fi

echo
if [[ -n "$BUILT_ISO" ]]; then
	echo "Done. ISO: ${BUILT_ISO} (nvidia-${BR}, no nvidia-pool)"
	echo
	echo "DO NOT copy the ISO to a stick before this point — it was still being re-packed."
	echo "Copy, then flush and verify:"
	echo "  cp ${BUILT_ISO} /path/to/ventoy/ && sync"
	echo "  bash ${HERE}/verify-stick-iso.sh /path/to/ventoy/$(basename "$BUILT_ISO")"
else
	echo "Done. ISO is under /home/eggs/ (name starts with ${BASENAME}_, nvidia-${BR})"
fi
echo
echo "Full build + flash /dev/sda:"
echo "  sudo HIGHASCG_NVIDIA_DRIVER=${BR} bash ${HERE}/build-produce-flash-stick.sh -y"
echo
echo "Flash only (this ISO):"
echo "  sudo bash ${HERE}/create-operator-stick-from-dd.sh /dev/sda --iso ${BUILT_ISO:-/home/eggs/${BASENAME}_*.iso}"
echo "  (see tools/eggs/live-usb/FLASH_AND_PERSIST.md)"
