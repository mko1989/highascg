#!/usr/bin/env bash
# Post-build: prove squashfs does not contain swap, nvidia-pool, or IDE trees.
#
# Usage:
#   bash tools/eggs/live-usb/verify-iso-squashfs-excludes.sh [/path/to/highascg*.iso | /path/to/filesystem.squashfs]
#
# WO-870 Phase 5: given an ISO (default for eggs 26.10: the newest one in the nest) the squashfs is read straight out
# of the image — `unsquashfs -o <offset>` (iso-read-lib.sh, needs xorriso), no mount, no copy, no root. Legacy eggs
# keeps the old default, the staged /home/eggs/mnt/iso/live/filesystem.squashfs. Layout (Calamares paths): new =
# overlay at etc/penguins-eggs.d/branding/calamares/; legacy = /etc/calamares patched at build time.
# HIGHASCG_ISO_LAYOUT=new|legacy overrides the detection.
set -euo pipefail

HERE_VERIFY="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE_VERIFY}/flash-stick-common.sh"
# shellcheck source=iso-read-lib.sh
source "${HERE_VERIFY}/iso-read-lib.sh"
# shellcheck source=eggs-cli-lib.sh
source "${HERE_VERIFY}/eggs-cli-lib.sh"
# shellcheck source=verify-iso-squashfs-calamares.sh
source "${HERE_VERIFY}/verify-iso-squashfs-calamares.sh"
command -v unsquashfs >/dev/null 2>&1 || {
	echo "missing tool: unsquashfs (sudo apt install squashfs-tools)" >&2
	exit 1
}

SQ="${1:-}"
LAYOUT="${HIGHASCG_ISO_LAYOUT:-}"
if [[ -z "$SQ" ]]; then
	if [[ "$(highascg_eggs_flavor)" == "legacy" ]]; then
		SQ=/home/eggs/mnt/iso/live/filesystem.squashfs
	else
		SQ="$(find_latest_iso 2>/dev/null || true)"
	fi
fi
[[ -f "$SQ" ]] || {
	echo "Missing squashfs: ${SQ:-no ISO in /home/eggs (pass the ISO path)}" >&2
	exit 1
}
UNSQ=(unsquashfs)
SQ_BYTES="$(stat -L -c %s "$SQ")"
if [[ "$SQ" == *.iso ]]; then
	iso_read_open "$SQ" || exit 1
	SQ_OFF="$(iso_file_offset "$SQ" live/filesystem.squashfs)" || {
		echo "cannot locate live/filesystem.squashfs inside ${SQ} (needs xorriso: sudo apt install xorriso)" >&2
		exit 1
	}
	SQ_BYTES="$(iso_file_size "$SQ" live/filesystem.squashfs)"
	if [[ -z "$LAYOUT" ]]; then
		if iso_grep '^live/initrd\.img-' >/dev/null; then LAYOUT=legacy; else LAYOUT=new; fi
	fi
	iso_read_close
	UNSQ=(unsquashfs -o "$SQ_OFF")
elif [[ -z "$LAYOUT" ]]; then
	if [[ "$(highascg_eggs_flavor)" == "legacy" ]]; then LAYOUT=legacy; else LAYOUT=new; fi
fi
# coa (eggs 26.10) reads only custom.exclude.list; legacy eggs reads exclude.list.
EXCL_LIST=/etc/penguins-eggs.d/custom.exclude.list
[[ "$LAYOUT" == legacy ]] && EXCL_LIST=/etc/penguins-eggs.d/exclude.list

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

echo "==> verify squashfs excludes: ${SQ}${SQ_OFF:+ (squashfs at byte ${SQ_OFF})} (layout ${LAYOUT})"

# WO-168 T168.5: directory-name constants shared with write-iso-default-config.js
# live in src/config/factory-defaults-manifest.js. Shell can't require() JS, so
# pull them via a tiny `node -e` print step instead of hardcoding a second copy
# that could drift; falls back to the (currently identical) literal if node or
# the manifest is unavailable.
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
	"${UNSQ[@]}" -l "$SQ" "$@" 2>/dev/null | grep -qE "$pattern" || rc=$?
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
		"${UNSQ[@]}" -cat "$SQ" "$file" 2>/dev/null | grep -qF "$pattern" || rc=$?
	else
		"${UNSQ[@]}" -cat "$SQ" "$file" 2>/dev/null | grep -qE "$pattern" || rc=$?
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

# 22.10: a backup of the previous ISO in ~/iso-backup rode into the squashfs (+3.2 GB).
# config/casparcg.config.iso is a Caspar config, not a disk image.
set +o pipefail
iso_leak="$("${UNSQ[@]}" -l "$SQ" home 2>/dev/null | grep -E '^squashfs-root/home/.*\.iso$' \
	| grep -vE '^squashfs-root/home/casparcg/highascg/config/casparcg\.config\.iso$' | head -1)"
set -o pipefail
if [[ -n "$iso_leak" ]]; then
	bad "disk image in squashfs: ${iso_leak#squashfs-root/} — move it out of /home/casparcg or exclude it"
else
	ok "no disk images (.iso) under home/ in squashfs"
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
	'home/casparcg/.antigravity-ide-server' \
	'home/casparcg/highascg/config/certs/highascg-key.pem' \
	'etc/ssh/ssh_host_ed25519_key' \
	'home/casparcg/.config/companion/v5.0' \
	'home/casparcg/.config/companion/machid' \
	'home/casparcg/highascg/godot/extensions/hshm/build' \
	'usr/NX' \
	'usr/lib/systemd/system/nxserver.service' \
	'etc/systemd/system/multi-user.target.wants/nxserver.service'; do
	if squash_has_tree "$needle"; then
		bad "unexpected path in squashfs: ${needle}"
	else
		ok "absent: ${needle}"
	fi
done

# WO-669: the operator GUI is the Godot binary under ~/.local (a blanket .local/* exclude used to drop it).
if squash_has_path 'home/casparcg/.local/opt/godot/godot'; then
	ok "present: home/casparcg/.local/opt/godot/godot (operator GUI)"
else
	bad "missing ~/.local/opt/godot/godot — fresh installs get no operator GUI (check .local lines in ${EXCL_LIST})"
fi

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
		bad "missing index.js — WO-47 exclude lines may still be in ${EXCL_LIST}"
	fi
	if squash_has_tree 'home/casparcg/highascg/node_modules'; then
		ok "present: home/casparcg/highascg/node_modules (embed-server ISO)"
	else
		bad "missing node_modules — embed-server ISO will not boot (check WO-47 lines in ${EXCL_LIST})"
	fi
	if squash_has_path 'home/casparcg/highascg/dist-web/index.html'; then
		ok "present: home/casparcg/highascg/dist-web/index.html (operator UI on :4200)"
	else
		bad "missing dist-web/index.html — run install-iso-defaults.sh (HIGHASCG_ISO_BUILD_WEB=1) before the build"
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
		bad "new-project.js still requires tools/eggs/starter-project — fix before the build"
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
			bad "missing from squashfs: ${needle} — run prepare-companion-for-eggs-clone.sh before the build"
		fi
	done
else
	ok "HIGHASCG_ISO_EMBED_COMPANION=0 — skip Companion squashfs checks"
fi

if [[ "${HIGHASCG_ISO_EMBED_CALAMARES:-1}" == "1" ]]; then
	if squash_has_path 'usr/bin/calamares'; then
		ok "present: /usr/bin/calamares (install-to-disk)"
	else
		bad "missing /usr/bin/calamares — run install-eggs-calamares.sh before the build"
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
	# Branding/modules: legacy /etc/calamares vs the eggs 26.10 overlay (verify-iso-squashfs-calamares.sh).
	if [[ "$LAYOUT" == legacy ]]; then calamares_checks_legacy; else calamares_checks_new; fi
	if squash_has_path 'usr/local/lib/highascg/probe-internal-storage.sh'; then
		ok "present: /usr/local/lib/highascg/probe-internal-storage.sh (NVMe/VMD for Calamares)"
	else
		bad "missing probe-internal-storage.sh — run install-storage-drivers-for-iso.sh"
	fi
	if squash_cat_grep 'var/lib/dpkg/status' '^Package: grub-pc$'; then
		ok "present: grub-pc in squashfs (Legacy BIOS Calamares bootloader)"
	else
		bad "missing grub-pc in squashfs — run install-grub-for-calamares-iso.sh before the build"
	fi
	# WO-832: the old `|| echo '6.8.0-117-generic'` never fired (the pipeline's status is tr's) and was a stale
	# literal anyway — a pin-less squashfs gave kver="" and checked "linux-headers-". Fall back to the host kernel.
	kver="$("${UNSQ[@]}" -cat "$SQ" etc/highascg/pinned-kernel 2>/dev/null | tr -d '[:space:]' || true)"
	if [[ -z "$kver" ]]; then
		kver="$(uname -r)"
		echo "WARN: squashfs has no etc/highascg/pinned-kernel — checking headers for the host kernel ${kver}" >&2
	fi
	if squash_cat_grep 'var/lib/dpkg/status' "Package: linux-headers-${kver}" 1; then
		ok "present: linux-headers-${kver} in squashfs (DeckLink/NVIDIA DKMS)"
	else
		bad "missing linux-headers-${kver} in squashfs — run install-kernel-headers-for-dkms-iso.sh before the build"
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
	# WO-870 30.10: build-only compilers are excluded by version (gcc 13/16 on 26.04); DKMS builds with the kernel's own
	# gcc (CONFIG_CC_VERSION_TEXT), so that one must ship whatever the default gcc becomes.
	ccmaj="$("${UNSQ[@]}" -cat "$SQ" "usr/src/linux-headers-${kver}/.config" 2>/dev/null \
		| sed -n 's/^CONFIG_CC_VERSION_TEXT=".* \([0-9][0-9]*\)\.[0-9.]*"$/\1/p' | head -1 || true)"
	if [[ -z "$ccmaj" ]]; then
		bad "cannot read the kernel's gcc from usr/src/linux-headers-${kver}/.config"
	elif squash_has_path "usr/libexec/gcc/x86_64-linux-gnu/${ccmaj}/cc1" && squash_has_path "usr/bin/x86_64-linux-gnu-gcc-${ccmaj}"; then
		ok "present: gcc-${ccmaj} (the kernel's compiler, DKMS)"
	else
		bad "gcc-${ccmaj} (the kernel's compiler) missing from squashfs — DKMS cannot build; check the build-only compiler excludes"
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
			bad "missing ${needle} — re-run the build (tools/startup on host now; ISO squashfs is from last clone)"
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

# WO-870 30.10 (owner): dev-box tools and data stay off the ISO — MagicQ and its shows, Godot exports for other OSes;
# 31.10: the WO-868 switch backups in ~/.highascg/backup.
for needle in 'opt/magicq' 'home/casparcg/Documents/MagicQ' 'home/casparcg/show' \
	'home/casparcg/highascg/godot/export/windows' 'home/casparcg/highascg/godot/export/web-demo' \
	'home/casparcg/.highascg/backup'; do
	if squash_has_tree "$needle"; then
		bad "dev-box path in squashfs: ${needle} — re-apply install-eggs-config.sh (WO-870 excludes)"
	else
		ok "absent (dev box): ${needle}"
	fi
done

if squash_grep_list '^squashfs-root/usr_[0-9]/'; then
	bad "squashfs has usr_N duplicate trees (~+1 GiB bloat) — reboot and rerun the full build (never rm /home/eggs)"
fi

tmp="$(mktemp -d)"
if "${UNSQ[@]}" -f -d "$tmp" "$SQ" usr/share/plymouth/themes/highascg/throbber-0001.png >/dev/null 2>&1; then
	ply="${tmp}/usr/share/plymouth/themes/highascg/throbber-0001.png"
	if [[ -f "$ply" ]]; then
		pinfo="$(file -b "$ply")"
		if echo "$pinfo" | grep -q RGBA; then
			bad "Plymouth animation in squashfs is still RGBA (${pinfo}) — run finalize + the build again"
		else
			ok "Plymouth animation in squashfs: ${pinfo}"
		fi
	fi
fi
rm -rf "$tmp"

sz_mib=$(((SQ_BYTES + 1048575) / 1048576))
if [[ "$sz_mib" -lt 2000 ]]; then
	bad "squashfs is only ${sz_mib} MiB — truncated (inject rebuilt from stale liveroot?). Run the full build (eggs remaster|produce)"
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
