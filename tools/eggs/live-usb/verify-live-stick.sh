#!/usr/bin/env bash
# Run on the booted live system (SSH or console) — persistence, exFAT config, boot branding.
#
# Usage:
#   bash tools/eggs/live-usb/verify-live-stick.sh
#   sudo bash tools/eggs/live-usb/verify-live-stick.sh
set -euo pipefail

EXFAT="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
CFG="${HIGHASCG_ROOT:-/home/casparcg/highascg}/config"
MARKER="${VERIFY_MARKER:-}"

ok() { echo "OK: $*"; }
warn() { echo "WARN: $*" >&2; }
bad() { echo "FAIL: $*" >&2; FAIL=1; }

initrd_contains() {
	local img="$1" needle="$2"
	local list
	list="$(mktemp)"
	lsinitramfs "$img" 2>/dev/null >"$list" || {
		rm -f "$list"
		return 1
	}
	grep -qF "$needle" "$list"
	local rc=$?
	rm -f "$list"
	return "$rc"
}

FAIL=0

echo "=== 1. Union persistence (OS overlay on USB) ==="
echo "cmdline: $(cat /proc/cmdline)"
if grep -qw persistence /proc/cmdline 2>/dev/null; then
	ok "kernel booted with persistence (USB / union overlay)"
elif grep -q cow_spacesize /proc/cmdline 2>/dev/null; then
	warn "cmdline has cow_spacesize but NOT persistence — OS changes use RAM overlay (2G), not LABEL=persistence partition"
	bad "rebuild ISO with highascg-eggs-theme + reflash; boot entry must include persistence kernel param"
else
	bad "no persistence in cmdline — rebuild ISO with eggs produce --theme highascg-eggs-theme"
fi
if grep -E 'overlay|live-rw' /proc/mounts 2>/dev/null | head -3; then
	ok "overlay/live-rw active"
else
	warn "no overlay in mounts — union persist may be off (settings under /etc may not stick)"
fi
if blkid -L persistence &>/dev/null; then
	ok "LABEL=persistence partition exists"
	pconf=""
	for mp in /media/persistence /mnt/persist; do
		[[ -f "${mp}/persistence.conf" ]] && pconf="${mp}/persistence.conf" && break
	done
	if [[ -z "$pconf" ]] && command -v findmnt >/dev/null; then
		dev=$(blkid -L persistence 2>/dev/null || true)
		if [[ -n "$dev" ]]; then
			mp=$(findmnt -n -o TARGET "$dev" 2>/dev/null || true)
			[[ -f "${mp}/persistence.conf" ]] && pconf="${mp}/persistence.conf"
		fi
	fi
	if [[ -f "$pconf" ]]; then
		ok "persistence.conf: $(cat "$pconf")"
	else
		bad "persistence partition missing persistence.conf with '/ union'"
	fi
else
	warn "no LABEL=persistence — run finish-operator-stick.sh after dd"
fi

echo
echo "=== 2. exFAT operator config (show settings on stick) ==="
lsblk -f | grep -E 'NAME|sd|HIGHASCG|persistence|exfat' || lsblk -f
if mountpoint -q "$EXFAT" 2>/dev/null; then
	ok "exFAT mounted at $EXFAT ($(findmnt -n -o SOURCE,FSTYPE "$EXFAT"))"
else
	bad "exFAT not mounted at $EXFAT — config cannot sync to/from stick"
fi
if [[ -f /etc/highascg/exfat-sync.json ]]; then
	ok "/etc/highascg/exfat-sync.json present"
	grep -q bootPrefer /etc/highascg/exfat-sync.json && ok "bootPrefer in sync map" || warn "no bootPrefer in map (old image)"
else
	bad "missing /etc/highascg/exfat-sync.json"
fi
n_exfat=0
if [[ -d "${EXFAT}/configs" ]]; then
	n_exfat=$(find "${EXFAT}/configs" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
	((n_exfat > 0)) && ok "exFAT configs/: ${n_exfat} JSON files" || warn "exFAT configs/ empty — save in UI once, wait 2s, reboot"
fi
if journalctl -u highascg-exfat-sync.service -b --no-pager 2>/dev/null | grep -qE 'EACCES.*config/'; then
	bad "exfat-sync hit EACCES on config/ — run: sudo chown -R casparcg:casparcg ${CFG} && sudo systemctl start highascg-exfat-sync"
elif journalctl -u highascg-exfat-sync.service -b --no-pager -q 2>/dev/null | grep -q 'Finished'; then
	ok "highascg-exfat-sync finished this boot"
elif systemctl is-active highascg-exfat-sync.service &>/dev/null; then
	ok "highascg-exfat-sync.service active this boot"
else
	warn "exfat-sync did not run — check journalctl -u highascg-exfat-sync.service -b"
fi
if [[ -f "${CFG}/general.json" ]] && [[ "$(stat -c '%U' "${CFG}/general.json" 2>/dev/null)" != "casparcg" ]]; then
	bad "config/*.json owned by $(stat -c '%U:%G' "${CFG}/general.json") not casparcg — exfat-sync cannot apply stick settings"
fi
if [[ -f "${CFG}/general.json" ]]; then
	ok "loaded config: ${CFG}/general.json"
	[[ -n "$MARKER" ]] && grep -q "$MARKER" "${CFG}/general.json" 2>/dev/null && ok "marker $MARKER found in general.json" || true
fi

echo
echo "=== 3. Boot chain (last boot) ==="
systemctl show highascg.service -p After --value 2>/dev/null | tr ' ' '\n' | grep -E 'exfat|network' | head -10 || true
journalctl -b -u highascg-exfat-boot.service -u highascg-exfat-sync.service \
	-u home-casparcg-exfat.mount -u highascg.service --no-pager -n 15 2>/dev/null || true

echo
echo "=== 4. GRUB / Plymouth (what the ISO was built with) ==="
# Live medium may be under casper paths
for g in /run/live/medium/boot/grub/grub.cfg /lib/live/mount/medium/boot/grub/grub.cfg; do
	[[ -f "$g" ]] || continue
	if grep -q persistence "$g"; then
		ok "ISO grub.cfg has persistence: $g"
	else
		warn "ISO grub.cfg without persistence: $g"
	fi
	break
done
for sp in /run/live/medium/boot/grub/splash.png /lib/live/mount/medium/boot/grub/splash.png; do
	[[ -f "$sp" ]] && ok "ISO splash.png on medium ($(stat -c '%s bytes' "$sp"))" && break
done
INITRD=""
for i in /boot/initrd.img /boot/initrd.img-*; do
	[[ -f "$i" ]] && INITRD="$i" && break
done
[[ -z "$INITRD" ]] && shopt -s nullglob && for i in /run/live/medium/live/initrd*.img; do INITRD="$i"; break; done && shopt -u nullglob
if [[ -n "$INITRD" ]] && command -v lsinitramfs >/dev/null 2>&1; then
	if initrd_contains "$INITRD" 'usr/share/plymouth/themes/highascg'; then
		ok "initrd has plymouth theme highascg"
	else
		bad "initrd missing highascg plymouth — rebuild ISO with finalize-boot-branding + eggs produce"
	fi
else
	warn "could not inspect initrd for plymouth (path unknown on this live layout)"
fi
[[ -f /etc/plymouth/plymouthd.conf ]] && ok "plymouthd: $(grep ^Theme= /etc/plymouth/plymouthd.conf 2>/dev/null || true)"

echo
echo "=== 5. Reboot persistence test (manual) ==="
echo "  1. Change one setting in UI → Save"
echo "  2. sudo ls -la ${EXFAT}/configs/   # should update immediately"
echo "  3. Reboot → default GRUB entry with persistence"
echo "  4. Re-run this script; setting should match"
echo "  Optional marker: VERIFY_MARKER=my-test-key bash $0"

echo
if ((FAIL)); then
	echo "Some checks failed — see FLASH_AND_PERSIST.md and rebuild/flash if branding failed."
	exit 1
fi
echo "Checks complete."
