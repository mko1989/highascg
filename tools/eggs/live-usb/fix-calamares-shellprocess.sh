#!/usr/bin/env bash
# Fix eggs Calamares shellprocess steps that exit 127 in chroot (sbin not on PATH,
# check-language-support missing offline, update-grub without path).
#
#   sudo bash tools/eggs/live-usb/fix-calamares-shellprocess.sh
#   HIGHASCG_CALAMARES_ROOT=/home/eggs/mnt/squashfs-calamares-patch-root sudo bash ...
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
ROOT="${HIGHASCG_CALAMARES_ROOT:-}"
MOD="${ROOT}/etc/calamares/modules"
LIB="${ROOT}/usr/libexec/calamares"
SBIN="${ROOT}/usr/sbin"

if [[ -n "$ROOT" ]]; then
	echo "==> Calamares shellprocess fix target: ${ROOT} (squashfs unpack / liveroot)"
else
	MOD=/etc/calamares/modules
	LIB=/usr/libexec/calamares
	SBIN=/usr/sbin
	echo "==> Calamares shellprocess fix target: live system (/)"
fi

mkdir -p "$MOD" "$LIB" "$SBIN"

echo "==> Calamares shellprocess: full paths for chroot (mkinitramfs, dpkg-reconfigure)"

cat >"${MOD}/shellprocess@mkinitramfs.conf" <<'EOF'
# HighAsCG — /usr/sbin not always on Calamares chroot PATH (eggs 26.6.2)
---
message: Creating the boot image (initramfs)...
dontChroot: false
timeout: 300
script:
  - /bin/bash -c '/usr/sbin/mkinitramfs -o /boot/initrd.img-$(uname -r)'
EOF

cat >"${MOD}/shellprocess@boot_reconfigure.conf" <<'EOF'
# HighAsCG — explicit bash + /usr/sbin for chroot PATH
---
message: Final reconfiguration of the kernel and bootloader...
dontChroot: false
timeout: 300
script:
  - /bin/bash -c 'chmod 644 /boot/vmlinuz-$(uname -r)'
  - /bin/bash -c 'chown 0:0 /boot/vmlinuz-$(uname -r)'
  - /bin/bash -c 'INITRD=No /usr/sbin/dpkg-reconfigure -fnoninteractive linux-image-$(uname -r)'
EOF

cat >"${MOD}/shellprocess@release_bridge.conf" <<'EOF'
# HighAsCG WO-481 — free the bridge partition (LABEL=HIGHASCGDAT) before partitioning.
# KPMcore asks the kernel to re-read the TARGET DISK's partition table and the kernel refuses
# while ANY partition on that disk is mounted, so an install onto the internal disk fails even
# when the operator leaves the bridge untouched. launch-calamares.sh already does this (WO-475),
# but only when the installer was started through it — this step also covers a terminal
# `calamares`, a desktop entry, and a live ISO whose launcher predates that fix.
---
message: Releasing the bridge data partition...
dontChroot: true
timeout: 60
script:
  - /bin/bash -c '[ -x /usr/local/bin/launch-calamares.sh ] && /usr/local/bin/launch-calamares.sh --release-bridge || true'
EOF

cat >"${MOD}/shellprocess@boot_deploy.conf" <<'EOF'
# HighAsCG — live medium vmlinuz copy (eggs boot_deploy)
---
message: Preparing the boot environment...
dontChroot: true
timeout: 300
script:
  - /bin/bash -c 'cp --preserve=timestamps /run/live/medium/live/vmlinuz-$(uname -r) ${ROOT}/boot/vmlinuz-$(uname -r)'
EOF

cat >"${MOD}/before_bootloader_context.conf" <<'EOF'
# HighAsCG — eggs only installs grub-efi in before_bootloader; Legacy BIOS needs grub-pc.
---
firmwareType:
    efi:
    - command: apt install -y --no-upgrade -o Acquire::gpgv::Options::=--ignore-time-conflict grub-efi-amd64-signed
      timeout: 300
    - command: apt install -y --no-upgrade -o Acquire::gpgv::Options::=--ignore-time-conflict shim-signed
      timeout: 300
    bios:
    - command: apt install -y --no-upgrade -o Acquire::gpgv::Options::=--ignore-time-conflict grub-pc grub-pc-bin
      timeout: 300
EOF

# WO-481 — schedule the release as the FIRST exec step, i.e. after the operator has chosen a
# layout and before Calamares commits anything. Pure awk so the edit is idempotent and needs no
# interpreter beyond what the live ISO already has.
SETTINGS="${ROOT}/etc/calamares/settings.conf"
[[ -n "$ROOT" ]] || SETTINGS=/etc/calamares/settings.conf
if [[ ! -f "$SETTINGS" ]]; then
	echo "WARN: ${SETTINGS} not found — cannot schedule shellprocess@release_bridge" >&2
elif grep -q 'shellprocess@release_bridge' "$SETTINGS"; then
	echo "==> settings.conf already runs shellprocess@release_bridge"
else
	awk '
		/^[[:space:]]*-[[:space:]]*exec:[[:space:]]*$/ { in_exec = 1 }
		{
			if (in_exec && !done && $0 ~ /^[[:space:]]*-[[:space:]]*partition[[:space:]]*$/) {
				indent = $0
				sub(/-.*/, "", indent)
				print indent "- shellprocess@release_bridge"
				done = 1
			}
			print
		}
	' "$SETTINGS" >"${SETTINGS}.tmp" && mv "${SETTINGS}.tmp" "$SETTINGS"
	if grep -q 'shellprocess@release_bridge' "$SETTINGS"; then
		echo "==> settings.conf: shellprocess@release_bridge inserted before partition"
	else
		echo "WARN: no 'exec:' / '- partition' anchor in ${SETTINGS} — release step NOT scheduled" >&2
	fi
fi


if [[ -f "${MOD}/bootloader.conf" ]]; then
	# Full paths — Calamares chroot PATH may omit /usr/sbin (grub-install exit 1 / 127).
	if ! grep -q 'grubInstall: "/usr/sbin/grub-install"' "${MOD}/bootloader.conf" 2>/dev/null; then
		sed -i \
			-e 's|^grubInstall: grub-install|grubInstall: "/usr/sbin/grub-install"|' \
			-e 's|^grubMkconfig: grub-mkconfig|grubMkconfig: "/usr/sbin/grub-mkconfig"|' \
			-e 's|^grubProbe: grub-probe|grubProbe: "/usr/sbin/grub-probe"|' \
			-e 's|^efiBootMgr: efibootmgr|efiBootMgr: "/usr/bin/efibootmgr"|' \
			"${MOD}/bootloader.conf" 2>/dev/null || true
		echo "==> patched ${MOD}/bootloader.conf (full paths to grub-install)"
	fi
else
	cat >"${MOD}/bootloader.conf" <<'EOF'
# HighAsCG — full paths for Calamares chroot
---
efiBootLoader: grub
kernelSearchPath: /usr/lib/modules
kernelPattern: ^vmlinuz.*
loaderEntries:
  - timeout 5
  - console-mode keep
kernelParams:
  - quiet
grubInstall: "/usr/sbin/grub-install"
grubMkconfig: "/usr/sbin/grub-mkconfig"
grubCfg: /boot/grub/grub.cfg
grubProbe: "/usr/sbin/grub-probe"
efiBootMgr: "/usr/bin/efibootmgr"
installEFIFallback: true
installHybridGRUB: false
EOF
	echo "==> wrote ${MOD}/bootloader.conf (full paths to grub-install)"
fi

L10N_SRC="${HERE}/calamares-l10n-helper.sh"
NOMODESET_SRC="${HERE}/calamares-nomodeset-helper.sh"
LOGS_SRC="${HERE}/calamares-logs-helper.sh"
RESCUE_SRC="${HERE}/calamares-session-log-rescue.sh"
RESCUE_UNIT_SRC="${HERE}/systemd/calamares-session-log-rescue.service"
if [[ -f "$L10N_SRC" ]]; then
	install -m 0755 "$L10N_SRC" "${LIB}/calamares-l10n-helper.sh"
	echo "==> installed ${LIB}/calamares-l10n-helper.sh (offline-safe)"
fi
if [[ -f "$NOMODESET_SRC" ]]; then
	install -m 0755 "$NOMODESET_SRC" "${LIB}/calamares-nomodeset.sh"
	echo "==> installed ${LIB}/calamares-nomodeset.sh (/usr/sbin/update-grub)"
fi
if [[ -f "$LOGS_SRC" ]]; then
	install -m 0755 "$LOGS_SRC" "${LIB}/calamares-logs-helper.sh"
	echo "==> installed ${LIB}/calamares-logs-helper.sh (offline-safe install logs)"
fi

# WO-417: an exec-phase failure (bootloader) aborts BEFORE shellprocess@logs, losing
# session.log with the live tmpfs. Live-only unit mirrors it to HIGHASCGEXF instead.
if [[ -f "$RESCUE_SRC" && -f "$RESCUE_UNIT_SRC" ]]; then
	SYSD="${ROOT}/etc/systemd/system"
	mkdir -p "$SYSD" "${SYSD}/multi-user.target.wants"
	install -m 0755 "$RESCUE_SRC" "${LIB}/calamares-session-log-rescue.sh"
	install -m 0644 "$RESCUE_UNIT_SRC" "${SYSD}/calamares-session-log-rescue.service"
	ln -sf ../calamares-session-log-rescue.service \
		"${SYSD}/multi-user.target.wants/calamares-session-log-rescue.service"
	echo "==> installed + enabled calamares-session-log-rescue (live sessions only)"
fi

if [[ ! -x "${SBIN}/cleanup.sh" ]]; then
	CLEANUP_SRC="/usr/lib/penguins-eggs/conf/distros/noble/calamares/calamares-modules/cleanup/cleanup.sh"
	if [[ -f "$CLEANUP_SRC" ]]; then
		install -m 0755 "$CLEANUP_SRC" "${SBIN}/cleanup.sh"
		echo "==> installed ${SBIN}/cleanup.sh"
	fi
fi

echo "OK: Calamares shellprocess fixes applied"
echo "     ${MOD}/shellprocess@mkinitramfs.conf"
echo "     ${MOD}/shellprocess@boot_reconfigure.conf"
echo "     ${MOD}/shellprocess@boot_deploy.conf"
echo "     ${MOD}/before_bootloader_context.conf"
echo "     ${MOD}/bootloader.conf (full paths)"
echo "     ${LIB}/calamares-logs-helper.sh (offline-safe)"
echo "     ${LIB}/calamares-session-log-rescue.sh (+ live-only systemd unit)"
