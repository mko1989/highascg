#!/usr/bin/env bash
# EMERGENCY: restore wiped /usr /bin /lib from a penguins-eggs squashfs or ISO on disk.
#
# Use when liveroot rm destroyed the live system but /home and /home/eggs artifacts remain.
# Requires: ROOT shell (su - or ssh root@host). sudo may be missing.
#
# If /bin/mount is gone, bootstrap static busybox first (from another machine):
#   curl -fsSL -o busybox https://busybox.net/downloads/binaries/1.36.1-x86_64-linux-musl/busybox
#   scp busybox root@HOST:/root/busybox
#   ssh root@HOST 'chmod +x /root/busybox'
#   export BB=/root/busybox
#   $BB --install -s /root/bb
#   export PATH="/root/bb:$PATH"
#
# Then:
#   export BB=/root/busybox   # or leave empty if /bin/mount works
#   bash /home/casparcg/highascg/tools/eggs/live-usb/recover-host-usr-from-eggs-artifact.sh
#
# After recovery: reboot, run scripts/setup/, remount exfat.
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${HOME}/bb:/root/bb:${BB:+$(dirname "${BB}")}"

[[ "$(id -u)" -eq 0 ]] || {
	echo "ERROR: run as root (su - or ssh root@this-host). sudo may be missing." >&2
	exit 1
}

BB="${BB:-}"
if [[ -n "$BB" && -x "$BB" ]]; then
	export PATH="$(dirname "$BB"):$PATH"
	MOUNT() { "$BB" mount "$@"; }
	CP() { "$BB" cp "$@"; }
	LS() { "$BB" ls "$@"; }
	MKDIR() { "$BB" mkdir "$@"; }
	UMOUNT() { "$BB" umount "$@"; }
elif command -v mount >/dev/null 2>&1; then
	MOUNT() { mount "$@"; }
	CP() { cp -a "$@"; }
	LS() { ls "$@"; }
	MKDIR() { mkdir -p "$@"; }
	UMOUNT() { umount "$@"; }
else
	echo "ERROR: no mount and no BB=busybox — scp static busybox to /root/busybox first (see script header)." >&2
	exit 1
fi

WORKDIR=/tmp/highascg-recover.$$
ISO_MNT="${WORKDIR}/iso"
SQ_MNT="${WORKDIR}/sq"
ARTIFACT="${HIGHASCG_RECOVER_ARTIFACT:-}"

liveroot_staging_ok() {
	[[ -f /home/eggs/liveroot/usr/bin/bash && -f /home/eggs/liveroot/bin/bash ]]
}

find_artifact() {
	local f
	for f in \
		"$ARTIFACT" \
		/home/eggs/mnt/iso/live/filesystem.squashfs \
		/home/eggs/mnt/highascg-nvidia-595_amd64_*.iso \
		/home/eggs/highascg-nvidia-595_amd64_*.iso \
		/home/eggs/mnt/*.iso \
		/home/eggs/*.iso; do
		[[ -n "$f" && -f "$f" ]] || continue
		# glob may not expand in [[ -f ]] with * — use bash
		for g in $f; do
			[[ -f "$g" ]] && {
				echo "$g"
				return 0
			}
		done
	done
	return 1
}

squashfs_ok() {
	local sq="$1"
	local mib
	if command -v du >/dev/null 2>&1; then
		mib="$(du -m "$sq" | awk '{print $1}')"
		[[ "$mib" -ge 2500 ]]
	else
		[[ -s "$sq" ]]
	fi
}

echo "==> HighAsCG emergency /usr recovery"
echo "    Do NOT rm /home/eggs/liveroot during this procedure."

if [[ -x /usr/bin/bash && -x /bin/ls && "$(echo /usr/bin/* 2>/dev/null | wc -w)" -gt 100 ]]; then
	echo "WARN: /usr/bin looks populated ($(echo /usr/bin/* 2>/dev/null | wc -w) entries) — abort unless you intend to overlay."
	[[ "${HIGHASCG_RECOVER_FORCE:-0}" == "1" ]] || exit 1
fi

MKDIR "$WORKDIR" "$ISO_MNT" "$SQ_MNT"

SQ=""
ISO=""
if SQ_CAND="$(find_artifact 2>/dev/null || true)"; then
	case "$SQ_CAND" in
	*.squashfs)
		SQ="$SQ_CAND"
		;;
	*.iso)
		ISO="$SQ_CAND"
		;;
	esac
fi

if [[ -z "$SQ" && -z "$ISO" ]] && liveroot_staging_ok; then
	echo "==> No ISO/squashfs — using eggs liveroot staging at /home/eggs/liveroot"
	SQ_MNT=/home/eggs/liveroot
elif [[ -z "$SQ" && -z "$ISO" ]]; then
	echo "ERROR: no squashfs, ISO, or liveroot/usr under /home/eggs — boot Ubuntu live USB." >&2
	exit 1
fi

if [[ "$SQ_MNT" == /home/eggs/liveroot ]]; then
	: # already set
elif [[ -n "$SQ" ]]; then
	echo "==> Using squashfs: $SQ"
	squashfs_ok "$SQ" || {
		echo "ERROR: squashfs too small/truncated — pick a complete ISO instead." >&2
		exit 1
	}
	MOUNT -t squashfs -o ro "$SQ" "$SQ_MNT"
else
	echo "==> Using ISO: $ISO"
	MOUNT -o loop,ro "$ISO" "$ISO_MNT"
	SQ="${ISO_MNT}/live/filesystem.squashfs"
	[[ -f "$SQ" ]] || {
		echo "ERROR: no live/filesystem.squashfs inside ISO" >&2
		exit 1
	}
	squashfs_ok "$SQ" || {
		echo "ERROR: ISO squashfs too small/truncated" >&2
		exit 1
	}
	MOUNT -t squashfs -o ro "$SQ" "$SQ_MNT"
fi

echo "==> Squashfs mounted at ${SQ_MNT}"
for probe in usr/bin/bash bin/bash usr/bin/ls; do
	[[ -e "${SQ_MNT}/${probe}" ]] || {
		echo "ERROR: squashfs missing ${probe} — artifact not a full system clone" >&2
		exit 1
	}
done

restore_tree() {
	local name="$1"
	local dest="/${name}"
	if [[ ! -d "${SQ_MNT}/${name}" ]]; then
		echo "  skip ${name} (not in squashfs)"
		return 0
	fi
	echo "==> Restore /${name} from squashfs"
	MKDIR "$dest"
	# Overlay copy — do not delete /home.
	CP -a "${SQ_MNT}/${name}/." "$dest/"
}

for tree in usr bin sbin lib lib64 opt; do
	restore_tree "$tree"
done

echo "==> Restore selected /etc (merge, keep live identity)"
for f in passwd group shadow gshadow hosts hostname nsswitch.conf; do
	[[ -f "${SQ_MNT}/etc/${f}" ]] || continue
	[[ -f "/etc/${f}" ]] && CP -a "/etc/${f}" "/etc/${f}.bak.recover" 2>/dev/null || true
	CP -a "${SQ_MNT}/etc/${f}" "/etc/${f}"
done

UMOUNT "$SQ_MNT" 2>/dev/null || true
[[ -n "$ISO" ]] && UMOUNT "$ISO_MNT" 2>/dev/null || true
rm -rf "$WORKDIR"

echo
echo "OK: core system trees restored from eggs artifact."
echo "    Reboot now:  /sbin/reboot  or  echo b > /proc/sysrq-trigger"
echo "    After reboot:"
echo "      sudo bash /home/casparcg/highascg/scripts/setup/02-verify-kernel-117.sh"
echo "      sudo bash /home/casparcg/highascg/scripts/highascg-exfat-remount-sync.sh"
echo "    NEVER rm /home/eggs — reboot after interrupted eggs produce, then pre-produce-preflight.sh only."
