#!/usr/bin/env bash
# eggs produce regenerates /etc/calamares from eggs templates (see log:
# "creating calamares configuration files" / "cleanup calamares configuration files")
# AFTER preflight fix — squashfs ends up with unpatched shellprocess (Calamares exit 127).
#
# Re-apply fix-calamares-shellprocess into the ISO squashfs tree, then rebuild squashfs.
#
#   sudo bash tools/eggs/live-usb/patch-iso-squashfs-calamares.sh
#   sudo bash tools/eggs/live-usb/patch-iso-squashfs-calamares.sh /path/to/filesystem.squashfs
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQ="${1:-/home/eggs/mnt/iso/live/filesystem.squashfs}"
WORK="${HIGHASCG_SQUASHFS_PATCH_WORK:-/home/eggs/mnt/squashfs-calamares-patch-root}"

[[ -f "$SQ" ]] || {
	echo "Missing squashfs: $SQ" >&2
	exit 1
}

command -v unsquashfs >/dev/null 2>&1 && command -v mksquashfs >/dev/null 2>&1 || {
	echo "ERROR: unsquashfs and mksquashfs required (apt install squashfs-tools)" >&2
	exit 1
}

sq_mib="$(du -sm "$SQ" | awk '{print $1}')"
if [[ "$sq_mib" -lt 2000 ]]; then
	echo "ERROR: squashfs only ${sq_mib} MiB — truncated; run full eggs produce first." >&2
	exit 1
fi

echo "==> Patch Calamares shellprocess inside ISO squashfs (eggs produce clobbers preflight fix)"
echo "     squashfs: $SQ (${sq_mib} MiB)"
echo "     work dir: $WORK"

if [[ "${HIGHASCG_FORCE_SQUASHFS_UNPACK:-0}" == "1" ]] && [[ -d "$WORK" ]]; then
	echo "==> Removing prior unpack ($HIGHASCG_FORCE_SQUASHFS_UNPACK=1)"
	rm -rf "$WORK"
fi

if [[ ! -f "${WORK}/etc/os-release" ]]; then
	echo "==> unsquashfs full tree (one-time per build; ~5–15 min for 4 GiB)"
	rm -rf "$WORK"
	mkdir -p "$(dirname "$WORK")"
	unsquashfs -f -d "$WORK" "$SQ"
else
	echo "==> Reusing unpacked tree at $WORK (set HIGHASCG_FORCE_SQUASHFS_UNPACK=1 to refresh)"
fi

HIGHASCG_CALAMARES_ROOT="$WORK" bash "${HERE}/fix-calamares-shellprocess.sh"

SQ_NEW="${SQ}.calamares-patched.$$"
echo "==> mksquashfs (xz, same family as eggs produce)"
mksquashfs "$WORK" "$SQ_NEW" \
	-comp xz -Xbcj x86 -b 1M \
	-no-duplicates -no-recovery -always-use-fragments \
	-processors "$(nproc)"

mv -f "$SQ_NEW" "$SQ"
echo "OK: patched squashfs → $SQ"

# eggs produce also overwrites the build host; restore for next audit/produce cycle.
bash "${HERE}/fix-calamares-shellprocess.sh"

if unsquashfs -cat "$SQ" etc/calamares/modules/shellprocess@mkinitramfs.conf 2>/dev/null \
	| grep -q '/usr/sbin/mkinitramfs'; then
	echo "OK: squashfs shellprocess@mkinitramfs patched"
else
	echo "ERROR: squashfs still unpatched after rebuild" >&2
	exit 1
fi

# WO-721: the release step only runs WITH its config when settings.conf declares the instance — WO-481 shipped the
# sequence line alone and Calamares logged "No script given for ShellProcessJob shellprocess@release_bridge".
SQ_SETTINGS="$(unsquashfs -cat "$SQ" etc/calamares/settings.conf 2>/dev/null || true)"
if grep -Eq '^[[:space:]]*-[[:space:]]*id:[[:space:]]*release_bridge[[:space:]]*$' <<<"$SQ_SETTINGS" \
	&& grep -Eq '^[[:space:]]*-[[:space:]]*shellprocess@release_bridge[[:space:]]*$' <<<"$SQ_SETTINGS"; then
	echo "OK: squashfs settings.conf declares + schedules shellprocess@release_bridge"
else
	echo "ERROR: squashfs settings.conf does not declare AND schedule shellprocess@release_bridge (WO-721)" >&2
	exit 1
fi
