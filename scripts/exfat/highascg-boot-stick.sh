#!/usr/bin/env bash
# WO-697 — sourced, not run: is the HIGHASCGEXF volume at a mount point on the stick this live system booted from?
# Shell twin of src/system/boot-stick.js. Only the boot stick is synced / applied automatically (network.conf,
# server drop-update, config + projects); any other HighAsCG stick is a drive the operator saves to / loads from by
# hand. Booted from = /run/live/medium and the volume sit on the same disk (device-mapper followed to its slaves —
# Ventoy maps the ISO as /dev/mapper/ventoy over sdX1). An installed box has no live medium: never a boot stick.
#
#   source highascg-boot-stick.sh; highascg_exfat_is_boot_stick /home/casparcg/exfat && echo boot stick

# /dev/mapper/ventoy → sda; /dev/sda3 → sda; /dev/nvme0n1p3 → nvme0n1. Fails when sysfs does not know the device.
highascg_disk_of() {
	local sys="${HIGHASCG_SYSFS_BLOCK:-/sys/class/block}" name slave _
	local dm
	name="$(basename "$(readlink -f "$1" 2>/dev/null || echo "$1")")"
	# Ventoy's /dev/mapper/ventoy has no node after switch_root (only /dev/mapper/control): find it by its dm name
	if [[ ! -e "${sys}/${name}" ]]; then
		for dm in "${sys}"/dm-*; do
			[[ "$(cat "${dm}/dm/name" 2>/dev/null || true)" == "$name" ]] && name="$(basename "$dm")" && break
		done
	fi
	for _ in 1 2 3 4; do
		slave="$(ls -1 "${sys}/${name}/slaves" 2>/dev/null | sort | head -n1 || true)"
		[[ -n "$slave" ]] || break
		name="$slave"
	done
	[[ -e "${sys}/${name}" ]] || return 1
	if [[ -e "${sys}/${name}/partition" ]]; then
		basename "$(dirname "$(readlink -f "${sys}/${name}")")"
	else
		echo "$name"
	fi
}

highascg_exfat_is_boot_stick() {
	local mp="${1:-/home/casparcg/exfat}" medium src a b
	medium="$(findmnt -n -o SOURCE "${HIGHASCG_LIVE_MEDIUM:-/run/live/medium}" 2>/dev/null | head -n1 || true)"
	src="$(findmnt -n -o SOURCE "$mp" 2>/dev/null | head -n1 || true)"
	medium="${medium%%\[*}" # a bind / subvolume source reads /dev/sdX3[/path]
	src="${src%%\[*}"
	[[ -n "$medium" && -n "$src" ]] || return 1
	a="$(highascg_disk_of "$medium")" || return 1
	b="$(highascg_disk_of "$src")" || return 1
	[[ -n "$a" && "$a" == "$b" ]]
}
