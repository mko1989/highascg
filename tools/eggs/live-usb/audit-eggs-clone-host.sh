#!/usr/bin/env bash
# Pre-flight checks before `eggs produce --clone` — fail fast on bloat that must not enter squashfs.
#
# Usage:
#   sudo bash tools/eggs/live-usb/audit-eggs-clone-host.sh
#   sudo HIGHASCG_AUDIT_STRICT=0 bash ...   # warnings only
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRICT="${HIGHASCG_AUDIT_STRICT:-1}"
EXCLUDE="${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list}"
FAIL=0
WARN=0

fail() {
	echo "ERROR: $*" >&2
	FAIL=$((FAIL + 1))
	[[ "$STRICT" == "1" ]] || true
}
warn() {
	echo "WARN: $*" >&2
	WARN=$((WARN + 1))
}
ok() {
	echo "OK: $*"
}

echo "==> HighAsCG eggs clone host audit (strict=${STRICT})"

# --- swap: must not be active; file may stay on disk if excluded ---
for sw in /swap.img /swapfile; do
	if swapon --show 2>/dev/null | grep -qF "$sw"; then
		fail "swap is active: $sw — run strip-host-swap-for-live-iso.sh prepare"
	else
		ok "swap not active: $sw"
	fi
done
if [[ -f /swapfile ]]; then
	SZ="$(du -h /swapfile | awk '{print $1}')"
	if [[ -f "$EXCLUDE" ]] && grep -qE '^swapfile$|^swap\.img$' "$EXCLUDE"; then
		ok "/swapfile on disk (${SZ}) — listed in exclude.list (will not be in squashfs)"
	else
		fail "/swapfile exists (${SZ}) but not excluded in ${EXCLUDE}"
	fi
fi

# --- tmpfs / runtime mounts: must not be bind-mounted into clone paths ---
for mp in /home/casparcg/highascg/media /home/casparcg/exfat /home/casparcg/bridge; do
	if findmnt -T "$mp" >/dev/null 2>&1; then
		SRC="$(findmnt -T "$mp" -no SOURCE 2>/dev/null || true)"
		FST="$(findmnt -T "$mp" -no FSTYPE 2>/dev/null || true)"
		case "$FST" in
		tmpfs | autofs) fail "$mp is on $FST ($SRC) — umount before clone" ;;
		exfat | ext4 | btrfs | xfs | vfat)
			warn "$mp is mounted ($FST $SRC) — ensure content is empty/stubs only (see ensure-empty-live-usb-dirs.sh)"
			;;
		*) warn "$mp is mounted ($FST $SRC)" ;;
		esac
	else
		ok "$mp is not a separate mount (directory on root fs)"
	fi
done

# --- nvidia-pool removed from single-driver ISO model ---
if [[ -d /opt/nvidia-pool ]]; then
	POOL_SZ="$(du -sh /opt/nvidia-pool 2>/dev/null | awk '{print $1}')"
	fail "/opt/nvidia-pool still present (${POOL_SZ}) — run: HIGHASCG_PURGE_NVIDIA_POOL=1 sudo bash scripts/disable-nvidia-multi-driver-boot.sh"
elif [[ -f "$EXCLUDE" ]] && ! grep -qE '^opt/nvidia-pool' "$EXCLUDE"; then
	warn "exclude.list missing opt/nvidia-pool (stale ISO risk if pool is re-created)"
else
	ok "no /opt/nvidia-pool on host"
fi

# --- exclude.list installed and merged ---
if [[ ! -f "$EXCLUDE" ]]; then
	fail "missing ${EXCLUDE} — run: sudo cp tools/eggs/live-usb/exclude.list ${EXCLUDE} && sudo bash tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh --replace"
else
	ok "exclude.list present ($(wc -l <"$EXCLUDE") lines)"
	for needle in 'home/casparcg/.antigravity-ide-server' 'opt/nvidia-pool' 'swapfile' 'tmp/\*'; do
		if grep -qE "^${needle}$|^${needle//\*/\\*}" "$EXCLUDE" 2>/dev/null || grep -qF "$needle" "$EXCLUDE"; then
			ok "exclude.list contains: ${needle}"
		else
			warn "exclude.list missing line: ${needle}"
		fi
	done
fi

# --- IDE bloat on build host (excluded, but warn if huge) ---
for dir in /home/casparcg/.antigravity-ide-server /home/casparcg/.cursor-server /home/casparcg/highascg/node_modules; do
	if [[ -d "$dir" ]]; then
		warn "$(du -sh "$dir" 2>/dev/null | awk -v d="$dir" '{print $1 " " d}') on host — must stay out of squashfs via exclude.list"
	fi
done

# --- boot branding ready ---
BRANDING="${HERE}/branding/splash.png"
THEME_SPLASH="${HERE}/highascg-eggs-theme/theme/livecd/splash.png"
if [[ ! -f "$BRANDING" ]]; then
	fail "missing ${BRANDING} — GRUB will show stock eggs penguins"
elif [[ -f "$THEME_SPLASH" ]] && cmp -s "$BRANDING" "$THEME_SPLASH"; then
	ok "GRUB splash.png ready in highascg-eggs-theme"
else
	warn "run install-eggs-live-grub-theme.sh / finalize-boot-branding before produce"
fi
THEME_ALT="$(update-alternatives --query default.plymouth 2>/dev/null | sed -n 's/^Value: //p' || true)"
if [[ "$THEME_ALT" == *highascg* ]]; then
	ok "Plymouth default: highascg"
else
	warn "Plymouth default is not highascg (${THEME_ALT:-unset}) — run install-highascg-plymouth-theme.sh"
fi

echo ""
if [[ "$FAIL" -gt 0 && "$STRICT" == "1" ]]; then
	echo "Audit FAILED (${FAIL} error(s), ${WARN} warning(s)). Fix before eggs produce." >&2
	exit 1
fi
echo "Audit passed (${WARN} warning(s))."
exit 0
