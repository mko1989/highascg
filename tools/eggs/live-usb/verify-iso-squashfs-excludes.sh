#!/usr/bin/env bash
# Post-build: prove squashfs does not contain swap, nvidia-pool, or IDE trees.
#
# Usage:
#   bash tools/eggs/live-usb/verify-iso-squashfs-excludes.sh [/path/to/filesystem.squashfs]
set -euo pipefail

SQ="${1:-/home/eggs/mnt/iso/live/filesystem.squashfs}"
[[ -f "$SQ" ]] || {
	echo "Missing squashfs: $SQ" >&2
	exit 1
}

FAIL=0
bad() {
	echo "FAIL: $*" >&2
	FAIL=$((FAIL + 1))
}
ok() {
	echo "OK: $*"
}
warn() {
	echo "WARN: $*" >&2
}

echo "==> verify squashfs excludes: $SQ"

# WO-168 T168.5: directory-name constants shared with write-iso-default-config.js
# live in src/config/factory-defaults-manifest.js. Shell can't require() JS, so
# pull them via a tiny `node -e` print step instead of hardcoding a second copy
# that could drift; falls back to the (currently identical) literal if node or
# the manifest is unavailable.
HERE_VERIFY="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
MANIFEST_JS="${HERE_VERIFY}/../../../src/config/factory-defaults-manifest.js"
manifest_const() {
	local key="$1" fallback="$2" v=""
	if command -v node >/dev/null 2>&1 && [[ -f "$MANIFEST_JS" ]]; then
		v="$(node -e "try{const m=require(process.argv[1]);process.stdout.write(String(m[process.argv[2]]||''))}catch(e){}" \
			"$MANIFEST_JS" "$key" 2>/dev/null || true)"
	fi
	[[ -n "$v" ]] && echo "$v" || echo "$fallback"
}
PROJECTS_TRASH_DIR="$(manifest_const PROJECTS_TRASH_DIR '_trash')"
PRIVATE_IDENTITY_DIR="$(manifest_const PRIVATE_IDENTITY_DIR '.private')"

# pipefail + `grep -q` on a large `unsquashfs -l` stream: early match closes the pipe,
# unsquashfs exits SIGPIPE, and the pipeline status becomes failure (false negative).
squash_grep_list() {
	local pattern="$1"
	shift
	local rc=0
	set +o pipefail
	unsquashfs -l "$SQ" "$@" 2>/dev/null | grep -qE "$pattern" || rc=$?
	set -o pipefail
	[[ "$rc" -eq 0 ]]
}

squash_has_path() {
	local rel="${1#./}"
	rel="${rel%/}"
	squash_grep_list "^squashfs-root/${rel}$" "$rel"
}

squash_has_tree() {
	local prefix="${1%/}"
	squash_grep_list "^squashfs-root/${prefix}(/|\$)" "$prefix"
}

# unsquashfs -cat streams large files; grep -q closes early → SIGPIPE (141) with pipefail.
squash_cat_grep() {
	local file="$1"
	local pattern="$2"
	local fixed="${3:-0}"
	local rc=0
	set +o pipefail
	if [[ "$fixed" == "1" ]]; then
		unsquashfs -cat "$SQ" "$file" 2>/dev/null | grep -qF "$pattern" || rc=$?
	else
		unsquashfs -cat "$SQ" "$file" 2>/dev/null | grep -qE "$pattern" || rc=$?
	fi
	set -o pipefail
	[[ "$rc" -eq 0 ]]
}

# Root-level swap file (not usr/bin/live-swapfile or kernel headers)
if squash_grep_list '^squashfs-root/(swapfile|swap\.img)$'; then
	bad "root swapfile or swap.img is inside squashfs"
else
	ok "no root /swapfile or /swap.img in squashfs"
fi

if squash_has_tree 'opt/zoom'; then
	bad "/opt/zoom is in squashfs — Zoom is a build-host test tool and MUST NOT ship on the ISO (WO-142 G1; check exclude fragment merge)"
else
	ok "no /opt/zoom in squashfs"
fi

if squash_has_tree 'opt/nvidia-pool'; then
	bad "/opt/nvidia-pool is in squashfs — ISO ~1.5 GiB larger than needed; purge pool and rebuild"
else
	ok "no /opt/nvidia-pool in squashfs"
fi

# WO-168 T168.1 — device identity/auth material (Syncthing device ID, Tailscale
# status, replication pairing manifest). MUST NOT ship on any produced ISO/clone.
if squash_has_tree "home/casparcg/highascg/${PRIVATE_IDENTITY_DIR}"; then
	bad "home/casparcg/highascg/${PRIVATE_IDENTITY_DIR} is in squashfs — device identity/auth material leaked (WO-168 T168.1); check exclude fragment merge, then rotate Syncthing/Tailscale identities on any box cloned from a prior ISO"
else
	ok "no home/casparcg/highascg/${PRIVATE_IDENTITY_DIR} in squashfs"
fi

# WO-429 — credentials + user-supplied driver packages MUST NOT ship.
if squash_has_path 'home/casparcg/.config/gh/hosts.yml'; then
	bad "home/casparcg/.config/gh/hosts.yml is in squashfs — the GitHub OAuth token leaked (WO-429); check exclude fragment merge, then ROTATE the token (gh auth logout && gh auth login) on any box cloned from a prior ISO"
else
	ok "no gh auth token in squashfs"
fi
if squash_has_path 'home/casparcg/.bash_history'; then
	bad "home/casparcg/.bash_history is in squashfs — shell history leaked (WO-429); check exclude fragment merge"
else
	ok "no shell history in squashfs"
fi
if squash_has_tree 'home/casparcg/highascg/vendor'; then
	bad "home/casparcg/highascg/vendor is in squashfs — user-supplied Blackmagic packages leaked (WO-429: 2 GB + EULA-bound, never redistributable); check exclude fragment merge"
else
	ok "no vendor driver packages in squashfs"
fi

# WO-168 T168.4/T168.6 — deleted-project tombstones; reset also purges these.
if squash_has_tree "home/casparcg/highascg/projects/${PROJECTS_TRASH_DIR}"; then
	bad "home/casparcg/highascg/projects/${PROJECTS_TRASH_DIR} is in squashfs — deleted-project tombstones leaked (WO-168 T168.4); check exclude fragment merge and factory reset"
else
	ok "no home/casparcg/highascg/projects/${PROJECTS_TRASH_DIR} in squashfs"
fi

# WO-168 T168.4/T168.6 — config/*.bak* and "casparcg copy.config"-style duplicates.
if squash_grep_list '^squashfs-root/home/casparcg/highascg/config/[^/]*(\.bak(\.[0-9]+)?|copy\.config)$' 'home/casparcg/highascg/config'; then
	bad "config/*.bak* or *copy*.config is in squashfs — build-host config backups leaked (WO-168 T168.4); check exclude fragment merge and factory reset"
else
	ok "no config/*.bak* or *copy*.config in squashfs"
fi

# NOTE: usr/src/linux-headers-* is NOT in this list — headers ship on purpose since
# WO-433 (DeckLink DKMS at GUI-install time); only driver SOURCE trees stay masked,
# checked separately below.
for needle in \
	'home/casparcg/highascg/.git' \
	'usr/lib/penguins-eggs' \
	'home/casparcg/.antigravity-ide-server'; do
	if squash_has_tree "$needle"; then
		bad "unexpected path in squashfs: ${needle}"
	else
		ok "absent: ${needle}"
	fi
done

# WO-433: headers ship, but driver SOURCE trees must not (fragments mask them).
if squash_grep_list '^squashfs-root/usr/src/(nvidia|blackmagic)'; then
	bad "driver source tree in squashfs (WO-433): usr/src/nvidia-*|blackmagic-* — check fragment merge"
else
	ok "absent: usr/src/{nvidia,blackmagic}-* source trees"
fi

# WO-47 exFAT-only server omits node_modules; embed-server ISO keeps production deps.
if [[ "${HIGHASCG_ISO_EMBED_SERVER:-1}" == "0" ]]; then
	if squash_has_tree 'home/casparcg/highascg/node_modules'; then
		bad "unexpected path in squashfs: home/casparcg/highascg/node_modules"
	else
		ok "absent: home/casparcg/highascg/node_modules"
	fi
else
	if squash_has_path 'home/casparcg/highascg/index.js'; then
		ok "present: home/casparcg/highascg/index.js"
	else
		bad "missing index.js — WO-47 exclude lines may still be in /etc/penguins-eggs.d/exclude.list"
	fi
	if squash_has_tree 'home/casparcg/highascg/node_modules'; then
		ok "present: home/casparcg/highascg/node_modules (embed-server ISO)"
	else
		bad "missing node_modules — embed-server ISO will not boot (check exclude.list WO-47 lines)"
	fi
	if squash_has_path 'home/casparcg/highascg/dist-web/index.html'; then
		ok "present: home/casparcg/highascg/dist-web/index.html (operator UI on :4200)"
	else
		bad "missing dist-web/index.html — run install-iso-defaults.sh (HIGHASCG_ISO_BUILD_WEB=1) before produce"
	fi
	for needle in \
		'home/casparcg/highascg/src/config/factory-starter.js' \
		'home/casparcg/highascg/src/config/default-empty-project.json'; do
		if squash_has_path "$needle"; then
			ok "present: ${needle} (highascg new-project boot)"
		else
			bad "missing ${needle} — highascg.service will crash on boot"
		fi
	done
	if squash_cat_grep 'home/casparcg/highascg/src/engine/new-project.js' '../config/factory-starter' 1; then
		ok "new-project.js uses src/config/factory-starter (not tools/eggs/)"
	else
		bad "new-project.js still requires tools/eggs/starter-project — fix before produce"
	fi
	if squash_has_tree 'home/casparcg/highascg/tools/eggs'; then
		warn "tools/eggs present in squashfs (unexpected on embed-server ISO)"
	else
		ok "absent: home/casparcg/highascg/tools/eggs (runtime uses src/config/)"
	fi
fi

# Companion + highpass-highascg module (when embed is on — default).
if [[ "${HIGHASCG_ISO_EMBED_COMPANION:-1}" == "1" ]]; then
	for needle in \
		'home/casparcg/companion/companion_headless.sh' \
		'home/casparcg/.config/companion/modules/highpass-highascg/main.js' \
		'etc/systemd/system/companion.service'; do
		if squash_has_path "$needle"; then
			ok "present: ${needle}"
		else
			bad "missing from squashfs: ${needle} — run prepare-companion-for-eggs-clone.sh before produce"
		fi
	done
else
	ok "HIGHASCG_ISO_EMBED_COMPANION=0 — skip Companion squashfs checks"
fi

if [[ "${HIGHASCG_ISO_EMBED_CALAMARES:-1}" == "1" ]]; then
	if squash_has_path 'usr/bin/calamares'; then
		ok "present: /usr/bin/calamares (install-to-disk)"
	else
		bad "missing /usr/bin/calamares — run install-eggs-calamares.sh before produce"
	fi
	if squash_has_path 'usr/local/bin/launch-calamares.sh'; then
		ok "present: /usr/local/bin/launch-calamares.sh"
	else
		bad "missing launch-calamares.sh — re-run prepare-eggs-clone-with-exfat.sh (sync-caspar-supervisor-wiring)"
	fi
	if squash_has_path 'etc/sudoers.d/highascg'; then
		ok "present: /etc/sudoers.d/highascg (Nuclear + Calamares NOPASSWD)"
	else
		bad "missing /etc/sudoers.d/highascg — re-run prepare-eggs-clone-with-exfat.sh (12-passwordless-sudo)"
	fi
	if squash_has_path 'usr/local/lib/highascg/highascg-tailscale-up.sh'; then
		ok "present: /usr/local/lib/highascg/highascg-tailscale-up.sh (Tailscale login)"
	else
		bad "missing tailscale helper — re-run prepare-eggs-clone-with-exfat.sh (12-passwordless-sudo)"
	fi
	if squash_has_path 'etc/calamares/branding/highascg-eggs-theme/branding.desc'; then
		ok "present: /etc/calamares/branding/highascg-eggs-theme/branding.desc"
	else
		bad "missing Calamares branding — run install-eggs-calamares.sh before produce"
	fi
	if squash_has_path 'etc/calamares/branding/highascg-eggs-theme/highascg-eggs-theme-logo.png'; then
		ok "present: /etc/calamares/branding/highascg-eggs-theme/highascg-eggs-theme-logo.png"
	elif squash_has_path 'etc/calamares/branding/highascg-eggs-theme/eggs-logo.png'; then
		bad "only eggs-logo.png in squashfs — run install-eggs-calamares.sh (branding fix not baked)"
	else
		bad "missing Calamares logo in squashfs — run install-eggs-calamares.sh"
	fi
	if squash_has_path 'usr/local/lib/highascg/fix-calamares-branding.sh'; then
		ok "present: /usr/local/lib/highascg/fix-calamares-branding.sh"
	else
		bad "missing Calamares branding fixer — run install-eggs-calamares.sh before produce"
	fi
	if squash_has_path 'etc/calamares/modules/shellprocess@mkinitramfs.conf'; then
		if unsquashfs -cat "$SQ" etc/calamares/modules/shellprocess@mkinitramfs.conf 2>/dev/null \
			| grep -q '/usr/sbin/mkinitramfs'; then
			ok "present: shellprocess@mkinitramfs uses /usr/sbin/mkinitramfs (avoids exit 127)"
		else
			bad "shellprocess@mkinitramfs not patched — eggs produce overwrote preflight; run patch-iso-squashfs-calamares.sh"
		fi
	else
		bad "missing etc/calamares/modules/shellprocess@mkinitramfs.conf"
	fi
	if squash_has_path 'usr/sbin/cleanup.sh'; then
		ok "present: /usr/sbin/cleanup.sh (Calamares cleanup job)"
	else
		bad "missing /usr/sbin/cleanup.sh — run install-eggs-calamares.sh (fix-calamares-shellprocess)"
	fi
	if squash_has_path 'usr/libexec/calamares/calamares-l10n-helper.sh'; then
		if unsquashfs -cat "$SQ" usr/libexec/calamares/calamares-l10n-helper.sh 2>/dev/null \
			| grep -q 'HighAsCG — offline-safe'; then
			ok "present: /usr/libexec/calamares/calamares-l10n-helper.sh (offline-safe l10n)"
		else
			bad "calamares-l10n-helper.sh is eggs default — run fix-calamares-shellprocess.sh before produce"
		fi
	else
		bad "missing calamares-l10n-helper.sh — run install-eggs-calamares.sh"
	fi
	if squash_has_path 'usr/libexec/calamares/calamares-logs-helper.sh'; then
		if unsquashfs -cat "$SQ" usr/libexec/calamares/calamares-logs-helper.sh 2>/dev/null \
			| grep -q 'HighAsCG — offline-safe'; then
			ok "present: /usr/libexec/calamares/calamares-logs-helper.sh (avoids end-of-install exit 1)"
		else
			bad "calamares-logs-helper.sh is eggs default — run fix-calamares-shellprocess.sh / patch-iso-squashfs-calamares.sh"
		fi
	else
		bad "missing calamares-logs-helper.sh — run fix-calamares-shellprocess.sh"
	fi
	if squash_has_path 'etc/calamares/modules/shellprocess@boot_reconfigure.conf'; then
		if unsquashfs -cat "$SQ" etc/calamares/modules/shellprocess@boot_reconfigure.conf 2>/dev/null \
			| grep -q '/usr/sbin/dpkg-reconfigure'; then
			ok "present: shellprocess@boot_reconfigure uses /usr/sbin/dpkg-reconfigure"
		else
			bad "shellprocess@boot_reconfigure not patched — run fix-calamares-shellprocess.sh before produce"
		fi
	fi
	if squash_has_path 'usr/local/lib/highascg/probe-internal-storage.sh'; then
		ok "present: /usr/local/lib/highascg/probe-internal-storage.sh (NVMe/VMD for Calamares)"
	else
		bad "missing probe-internal-storage.sh — run install-storage-drivers-for-iso.sh"
	fi
	if squash_cat_grep 'var/lib/dpkg/status' '^Package: grub-pc$'; then
		ok "present: grub-pc in squashfs (Legacy BIOS Calamares bootloader)"
	else
		bad "missing grub-pc in squashfs — run install-grub-for-calamares-iso.sh before produce"
	fi
	kver="$(unsquashfs -cat "$SQ" etc/highascg/pinned-kernel 2>/dev/null | tr -d '[:space:]' || echo '6.8.0-117-generic')"
	if squash_cat_grep 'var/lib/dpkg/status' "Package: linux-headers-${kver}" 1; then
		ok "present: linux-headers-${kver} in squashfs (DeckLink/NVIDIA DKMS)"
	else
		bad "missing linux-headers-${kver} in squashfs — run install-kernel-headers-for-dkms-iso.sh before produce"
	fi
	# WO-433: the dpkg-status grep above is phantom-blind — clones shipped a status
	# CLAIMING headers while a blanket usr/src exclude stripped the actual tree and the
	# DeckLink GUI install died on "/lib/modules/<kver>/build still missing". Check the
	# real files too.
	if squash_has_path "usr/src/linux-headers-${kver}/Makefile"; then
		ok "present: usr/src/linux-headers-${kver} FILES in squashfs (not just dpkg status)"
	else
		bad "linux-headers-${kver} files missing from squashfs (dpkg status may still claim them, WO-433) — remove any usr/src exclude and re-run install-kernel-headers-for-dkms-iso.sh"
	fi
	if unsquashfs -cat "$SQ" etc/calamares/modules/before_bootloader_context.conf 2>/dev/null \
		| grep -q 'grub-pc'; then
		ok "present: before_bootloader_context installs grub-pc on BIOS firmware"
	else
		bad "before_bootloader_context missing BIOS grub-pc — run fix-calamares-shellprocess.sh"
	fi
	if squash_has_path 'usr/local/bin/caspar-systemd-cleanup.sh'; then
		ok "present: /usr/local/bin/caspar-systemd-cleanup.sh (orphan caspar cleanup)"
	else
		bad "missing caspar-systemd-cleanup.sh — re-run sync-caspar-supervisor-wiring.sh"
	fi
	if squash_has_path 'etc/systemd/system/multi-user.target.wants/calamares-session-log-rescue.service' \
		&& squash_has_path 'usr/libexec/calamares/calamares-session-log-rescue.sh'; then
		ok "present: calamares-session-log-rescue enabled (WO-417 — failed installs leave session.log on HIGHASCGEXF)"
	else
		bad "missing calamares-session-log-rescue — run fix-calamares-shellprocess.sh / patch-iso-squashfs-calamares.sh"
	fi
else
	ok "HIGHASCG_ISO_EMBED_CALAMARES=0 — skip Calamares squashfs checks"
fi

if [[ "${HIGHASCG_ISO_EMBED_SERVER:-1}" == "1" ]]; then
	for needle in \
		'home/casparcg/highascg/tools/startup/run-health-checks.sh' \
		'home/casparcg/highascg/tools/startup/verify-live-stick.sh' \
		'home/casparcg/highascg/tools/startup/verify-passwordless-sudo.sh' \
		'home/casparcg/highascg/tools/startup/verify-decklink.sh' \
		'home/casparcg/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh'; do
		if squash_has_path "$needle"; then
			ok "present: ${needle} (post-boot QA on stick)"
		else
			bad "missing ${needle} — re-run eggs produce (tools/startup on host now; ISO squashfs is from last clone)"
		fi
	done
else
	ok "HIGHASCG_ISO_EMBED_SERVER=0 — skip tools/startup squashfs checks"
fi

if [[ "${HIGHASCG_ISO_FORBID_DECKLINK:-1}" == "1" ]]; then
	for needle in \
		'usr/lib/blackmagic' \
		'var/lib/dkms/blackmagic' \
		'lib/udev/rules.d/55-blackmagic.rules' \
		'usr/lib/udev/rules.d/55-blackmagic.rules'; do
		if squash_has_tree "$needle"; then
			bad "DeckLink path in squashfs (WO-92): ${needle} — merge penguins-eggs-exclude-decklink.list and rebuild"
		else
			ok "absent (DeckLink): ${needle}"
		fi
	done
	# WO-430: merged-usr real path of the DKMS modules — lib/modules/* excludes never
	# matched (lib is a symlink), so the kernel driver shipped and autoloaded on
	# "driver-free" ISOs (found live on a fresh install: 16.2a1 loading, /dev/blackmagic/io0-3).
	if squash_grep_list '^squashfs-root/usr/lib/modules/[^/]+/updates/dkms/(snd_)?blackmagic' 'usr/lib/modules'; then
		bad "DeckLink DKMS kernel module in squashfs (WO-430): usr/lib/modules/*/updates/dkms/blackmagic* — merged-usr paths missing from penguins-eggs-exclude-decklink.list"
	else
		ok "absent (DeckLink): usr/lib/modules/*/updates/dkms/blackmagic*"
	fi
else
	ok "HIGHASCG_ISO_FORBID_DECKLINK=0 — skip DeckLink squashfs absence checks"
fi

if squash_grep_list '^squashfs-root/usr_[0-9]/'; then
	bad "squashfs has usr_N duplicate trees (~+1 GiB bloat) — reboot and rerun full eggs produce (never rm /home/eggs)"
fi

tmp="$(mktemp -d)"
if unsquashfs -f -d "$tmp" "$SQ" usr/share/plymouth/themes/highascg/throbber-0001.png >/dev/null 2>&1; then
	ply="${tmp}/usr/share/plymouth/themes/highascg/throbber-0001.png"
	if [[ -f "$ply" ]]; then
		pinfo="$(file -b "$ply")"
		if echo "$pinfo" | grep -q RGBA; then
			bad "Plymouth animation in squashfs is still RGBA (${pinfo}) — run finalize + produce again"
		else
			ok "Plymouth animation in squashfs: ${pinfo}"
		fi
	fi
fi
rm -rf "$tmp"

sz_mib="$(du -m "$SQ" | awk '{print $1}')"
if [[ "$sz_mib" -lt 2000 ]]; then
	bad "squashfs is only ${sz_mib} MiB — truncated (inject rebuilt from stale liveroot?). Run full eggs produce"
elif [[ "$sz_mib" -gt 4300 ]]; then
	warn "squashfs is ${sz_mib} MiB (>4.3 GiB) — check for nvidia-pool, usr_N duplicates, or unmerged excludes"
else
	ok "squashfs size ${sz_mib} MiB"
fi

if [[ "$FAIL" -gt 0 ]]; then
	echo "Squashfs exclude verification FAILED." >&2
	exit 1
fi
echo "Squashfs exclude verification passed."
