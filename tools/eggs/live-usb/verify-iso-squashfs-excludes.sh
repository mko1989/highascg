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

# Root-level swap file (not usr/bin/live-swapfile or kernel headers)
if squash_grep_list '^squashfs-root/(swapfile|swap\.img)$'; then
	bad "root swapfile or swap.img is inside squashfs"
else
	ok "no root /swapfile or /swap.img in squashfs"
fi

if squash_has_tree 'opt/nvidia-pool'; then
	bad "/opt/nvidia-pool is in squashfs — ISO ~1.5 GiB larger than needed; purge pool and rebuild"
else
	ok "no /opt/nvidia-pool in squashfs"
fi

for needle in \
	'home/casparcg/highascg/.git' \
	'usr/lib/penguins-eggs' \
	'usr/src/linux-headers-6.8.0-117' \
	'home/casparcg/.antigravity-ide-server'; do
	if squash_has_tree "$needle"; then
		bad "unexpected path in squashfs: ${needle}"
	else
		ok "absent: ${needle}"
	fi
done

# WO-47 exFAT-only server omits node_modules; embed-server ISO keeps production deps.
if [[ "${HIGHASCG_ISO_EMBED_SERVER:-1}" == "0" ]]; then
	if squash_has_tree 'home/casparcg/highascg/node_modules'; then
		bad "unexpected path in squashfs: home/casparcg/highascg/node_modules"
	else
		ok "absent: home/casparcg/highascg/node_modules"
	fi
else
	if squash_has_tree 'home/casparcg/highascg/node_modules'; then
		ok "present: home/casparcg/highascg/node_modules (embed-server ISO)"
	else
		warn "missing node_modules — embed-server ISO may not boot standalone"
	fi
	if squash_has_path 'home/casparcg/highascg/dist-web/index.html'; then
		ok "present: home/casparcg/highascg/dist-web/index.html (operator UI on :4200)"
	else
		bad "missing dist-web/index.html — run install-iso-defaults.sh (HIGHASCG_ISO_BUILD_WEB=1) before produce"
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
else
	ok "HIGHASCG_ISO_EMBED_CALAMARES=0 — skip Calamares squashfs checks"
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
