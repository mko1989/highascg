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
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
# shellcheck source=eggs-liveroot-safety.sh
source "${HERE}/eggs-liveroot-safety.sh"
STRICT="${HIGHASCG_AUDIT_STRICT:-1}"
EXCLUDE="${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list}"
LIVEROOT="$(eggs_liveroot_default)"
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

# --- liveroot: never produce/clean while eggs bind-mounts live /usr, /opt, … ---
if eggs_liveroot_has_host_bind_mounts "$LIVEROOT"; then
	fail "eggs liveroot has LIVE system bind mounts under ${LIVEROOT} — reboot before produce (rm/umount there can erase /usr, /bin, …)"
	eggs_liveroot_print_host_bind_mounts "$LIVEROOT"
else
	ok "no eggs liveroot bind mounts (safe to run eggs produce — never rm ${LIVEROOT})"
fi

# --- swap: file may stay on disk (and even active on build host) when exclude.list omits it ---
swap_listed_in_exclude() {
	local name="$1"
	[[ -f "$EXCLUDE" ]] && grep -qF "$name" "$EXCLUDE"
}

for sw in /swap.img /swapfile; do
	sw_name="${sw#/}"
	if swapon --show 2>/dev/null | grep -qF "$sw"; then
		if swap_listed_in_exclude "$sw_name"; then
			warn "swap is active: $sw — excluded from squashfs (OK for produce); optional: strip-host-swap-for-live-iso.sh prepare (swapoff + drop fstab swap lines for live boot)"
		else
			fail "swap is active: $sw — add to exclude.list or run strip-host-swap-for-live-iso.sh prepare"
		fi
	else
		ok "swap not active: $sw"
	fi
	if [[ -f "$sw" ]]; then
		SZ="$(du -h "$sw" 2>/dev/null | awk '{print $1}')"
		if swap_listed_in_exclude "$sw_name"; then
			ok "$sw on disk (${SZ}) — listed in exclude.list (will not be in squashfs)"
		else
			fail "$sw exists (${SZ}) but not excluded in ${EXCLUDE}"
		fi
	fi
done

# --- WO-47 volumes: warn only when path is an actual mount point (not merely on /) ---
for mp in /home/casparcg/highascg/media/bridge /home/casparcg/highascg/media/exfat /home/casparcg/exfat /home/casparcg/bridge; do
	if findmnt -n "$mp" >/dev/null 2>&1; then
		SRC="$(findmnt -n "$mp" -no SOURCE 2>/dev/null || true)"
		FST="$(findmnt -n "$mp" -no FSTYPE 2>/dev/null || true)"
		case "$FST" in
		tmpfs | autofs) fail "$mp is on $FST ($SRC) — umount before clone" ;;
		exfat | ext4 | btrfs | xfs | vfat)
			warn "$mp is mounted ($FST $SRC) — umount before produce (stop-and-unmount-wo47-for-eggs-produce.sh)"
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

# --- NVIDIA 595 for ISO clone (Blackwell needs open kernel modules) ---
if dpkg-query -W cuda-drivers &>/dev/null && journalctl -k -b --no-pager 2>/dev/null | grep -q 'requires use of the NVIDIA open kernel modules'; then
	fail "closed cuda-drivers cannot init Blackwell — run: sudo bash scripts/setup/03-nvidia-open-595.sh"
elif dpkg-query -W nvidia-open &>/dev/null || dpkg-query -W nvidia-driver-open &>/dev/null; then
	if [[ -r /proc/driver/nvidia/version ]] && grep -q 'Open Kernel Module' /proc/driver/nvidia/version 2>/dev/null; then
		ok "nvidia-open + Open Kernel Module loaded (required for Blackwell)"
	else
		warn "nvidia-open installed but kernel still closed — reboot"
	fi
elif dpkg-query -W cuda-drivers &>/dev/null && dpkg-query -W cuda-keyring &>/dev/null; then
	ok "cuda-drivers + cuda-keyring (closed — OK only on pre-Blackwell GPUs)"
elif dpkg-query -W nvidia-driver-595 &>/dev/null && dpkg-query -W linux-modules-nvidia-595-generic &>/dev/null; then
	warn "Ubuntu nvidia-driver-595 stack — migrate: sudo bash scripts/setup/03-nvidia-open-595.sh"
elif dpkg-query -W linux-modules-nvidia-595-generic &>/dev/null && ! dpkg-query -W nvidia-driver-595 &>/dev/null; then
	fail "linux-modules without userspace — run: sudo bash scripts/setup/03-nvidia-open-595.sh"
elif command -v nvidia-smi &>/dev/null; then
	warn "nvidia-smi present but cuda-drivers not installed — run scripts/setup/03-nvidia-open-595.sh before eggs produce"
else
	warn "no NVIDIA driver — run: sudo bash scripts/setup/03-nvidia-open-595.sh"
fi
if ! command -v aplay &>/dev/null; then
	warn "alsa-utils missing (aplay) — sudo apt install alsa-utils"
else
	ok "alsa-utils present"
fi

# --- exclude.list installed and merged ---
if [[ ! -f "$EXCLUDE" ]]; then
	fail "missing ${EXCLUDE} — run: sudo HIGHASCG_EGGS_EXCLUDE_FRAGMENT=${HERE}/penguins-eggs-exclude-highascg-embed-server.list bash ${HERE}/merge-penguins-eggs-exclude-highascg.sh --replace"
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

# --- IDE bloat on build host (always excluded from squashfs) ---
for dir in /home/casparcg/.antigravity-ide-server /home/casparcg/.cursor-server; do
	if [[ -d "$dir" ]]; then
		warn "$(du -sh "$dir" 2>/dev/null | awk -v d="$dir" '{print $1 " " d}') on host — must stay out of squashfs via exclude.list"
	fi
done

# --- node_modules: embed-server ISO needs it; WO-47 shell omits it (exFAT drop-update/) ---
EMBED_SERVER="${HIGHASCG_ISO_EMBED_SERVER:-1}"
NM="/home/casparcg/highascg/node_modules"
if [[ "$EMBED_SERVER" == "1" ]]; then
	if [[ -d "$NM" ]] && [[ -f /home/casparcg/highascg/package.json ]]; then
		ok "node_modules present ($(du -sh "$NM" 2>/dev/null | awk '{print $1}')) — embed-server ISO will include production deps"
	else
		warn "node_modules missing — run prepare / install-iso-defaults (npm ci) before produce for standalone boot"
	fi
	if [[ -f "$EXCLUDE" ]] && grep -qE '^home/casparcg/highascg/node_modules' "$EXCLUDE"; then
		fail "exclude.list omits node_modules but HIGHASCG_ISO_EMBED_SERVER=1 — re-merge embed-server fragment (node_modules must be IN squashfs)"
	fi
else
	if [[ -d "$NM" ]]; then
		warn "$(du -sh "$NM" 2>/dev/null | awk '{print $1}') $NM on host — WO-47 shell: must stay out of squashfs (server from exFAT drop-update/)"
	fi
	if [[ -f "$EXCLUDE" ]] && ! grep -qE '^home/casparcg/highascg/node_modules' "$EXCLUDE"; then
		warn "exclude.list missing node_modules lines (WO-47 shell should omit them from squashfs)"
	fi
fi

# --- Companion + highpass-highascg module (clone snapshot) ---
EMBED_COMPANION="${HIGHASCG_ISO_EMBED_COMPANION:-1}"
if [[ "$EMBED_COMPANION" == "1" ]]; then
	COMPANION_BIN="/home/casparcg/companion/companion_headless.sh"
	COMPANION_MOD="/home/casparcg/.config/companion/modules/highpass-highascg/main.js"
	if [[ -x "$COMPANION_BIN" ]]; then
		ok "Companion headless present ($(du -sh /home/casparcg/companion 2>/dev/null | awk '{print $1}'))"
	else
		fail "Companion missing at ${COMPANION_BIN} — extract tarball to /home/casparcg/companion before produce"
	fi
	if [[ -f "$COMPANION_MOD" ]]; then
		ok "highpass-highascg module packaged under .config/companion/modules"
	else
		fail "highpass-highascg module missing — run tools/eggs/companion/prepare-companion-for-eggs-clone.sh"
	fi
	if [[ -f /etc/systemd/system/companion.service ]]; then
		ok "companion.service unit installed"
	else
		fail "missing /etc/systemd/system/companion.service — run prepare-companion-for-eggs-clone.sh"
	fi
	if [[ -f "$EXCLUDE" ]] && grep -qE '^home/casparcg/companion(/|$)' "$EXCLUDE"; then
		fail "exclude.list omits /home/casparcg/companion but HIGHASCG_ISO_EMBED_COMPANION=1"
	fi
	if [[ -f "$EXCLUDE" ]] && grep -qE '^home/casparcg/\.config/companion(/|$)' "$EXCLUDE"; then
		fail "exclude.list omits .config/companion but HIGHASCG_ISO_EMBED_COMPANION=1"
	fi
else
	ok "HIGHASCG_ISO_EMBED_COMPANION=0 — skipping Companion clone checks"
fi

# --- Calamares (install-to-disk on live ISO) ---
EMBED_CALAMARES="${HIGHASCG_ISO_EMBED_CALAMARES:-1}"
if [[ "$EMBED_CALAMARES" == "1" ]]; then
	if command -v calamares >/dev/null 2>&1 && [[ -x /usr/bin/calamares || -x "$(command -v calamares)" ]]; then
		ok "Calamares present ($(calamares --version 2>/dev/null | head -1 || echo installed))"
	else
		fail "Calamares missing — run tools/eggs/live-usb/install-eggs-calamares.sh before produce"
	fi
	if command -v eggs >/dev/null 2>&1 && eggs calamares --help >/dev/null 2>&1; then
		ok "eggs calamares CLI available"
	else
		fail "eggs calamares not available — run install-eggs-calamares.sh"
	fi
else
	ok "HIGHASCG_ISO_EMBED_CALAMARES=0 — skipping Calamares checks"
fi

# --- boot branding ready ---
BRANDING="${HERE}/branding/splash.png"
THEME_SPLASH="${HERE}/highascg-eggs-theme/theme/livecd/splash.png"
if [[ ! -f "$BRANDING" ]]; then
	fail "missing ${BRANDING} — GRUB will show stock eggs penguins"
elif [[ -f "$THEME_SPLASH" ]] && { cmp -s "${HERE}/branding/splash.boot.png" "$THEME_SPLASH" 2>/dev/null \
	|| cmp -s "$BRANDING" "$THEME_SPLASH" 2>/dev/null; }; then
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

# --- third-party licenses (WO-90) ---
MANIFEST="${REPO_ROOT}/licenses/manifest.json"
if [[ -f "$MANIFEST" ]]; then
	ok "licenses/manifest.json present"
	if command -v jq &>/dev/null && jq -e '.components[] | select(.id=="ndi-sdk")' "$MANIFEST" &>/dev/null; then
		ok "manifest includes NDI SDK entry"
	else
		warn "manifest missing ndi-sdk — run tools/release/collect-third-party-licenses.sh after 04-ndi.sh"
	fi
else
	warn "missing ${MANIFEST} — run: bash tools/release/collect-third-party-licenses.sh"
fi
BMD_EULA="${REPO_ROOT}/licenses/third-party/blackmagic-desktopvideo-EULA.txt"
ISO_FORBID="${HIGHASCG_ISO_FORBID_DECKLINK:-1}"

decklink_excludes_in_exclude_list() {
	[[ -f "$EXCLUDE" ]] || return 1
	local needle
	for needle in \
		usr/lib/blackmagic \
		var/lib/dkms/blackmagic \
		lib/udev/rules.d/55-blackmagic.rules; do
		grep -qF "$needle" "$EXCLUDE" || return 1
	done
	return 0
}

if [[ "$ISO_FORBID" == "1" ]]; then
	if decklink_excludes_in_exclude_list; then
		ok "DeckLink exclude.list present (WO-92 — BMD omitted from squashfs)"
	else
		fail "DeckLink excludes missing in ${EXCLUDE} — run prepare or merge penguins-eggs-exclude-decklink.list"
	fi
	if dpkg-query -W desktopvideo &>/dev/null; then
		ok "desktopvideo on build host — stays installed locally, masked from ISO by exclude.list"
	elif [[ "${HIGHASCG_SKIP_DECKLINK_CHECK:-0}" == "1" ]]; then
		warn "desktopvideo not installed (HIGHASCG_SKIP_DECKLINK_CHECK=1)"
	else
		ok "desktopvideo not on build host — ISO ships without DeckLink (operator decklink/ on exFAT)"
	fi
elif dpkg-query -W desktopvideo &>/dev/null; then
	if [[ -f "$BMD_EULA" ]]; then
		ok "desktopvideo embedded — BMD EULA in licenses/ (legacy HIGHASCG_ISO_FORBID_DECKLINK=0)"
	else
		fail "desktopvideo installed but ${BMD_EULA} missing — run collect-third-party-licenses.sh"
	fi
elif [[ "${HIGHASCG_SKIP_DECKLINK_CHECK:-0}" == "1" ]]; then
	warn "desktopvideo not installed (HIGHASCG_SKIP_DECKLINK_CHECK=1)"
else
	fail "desktopvideo not installed — set HIGHASCG_ISO_FORBID_DECKLINK=1 (default) or install BMD for legacy embedded ISO"
fi

echo ""
if [[ "$FAIL" -gt 0 && "$STRICT" == "1" ]]; then
	echo "Audit FAILED (${FAIL} error(s), ${WARN} warning(s)). Fix before eggs produce." >&2
	exit 1
fi
echo "Audit passed (${WARN} warning(s))."
exit 0
