# Shared kernel selection for eggs build host (source, do not execute).
# Prefer newest installed linux-image-*-generic, not necessarily the running kernel.

highascg_latest_installed_kernel() {
	dpkg -l 'linux-image-[0-9]*-generic' 2>/dev/null |
		awk '/^ii/{print $2}' |
		sed 's/^linux-image-//' |
		sort -V |
		tail -1
}

# Sets KVER, VM, IR.
# /etc/highascg/pinned-kernel wins (playout host must stay on 6.8.0-117).
# HIGHASCG_ENSURE_LATEST_KERNEL=1 installs linux-image-generic only when NOT pinned.
highascg_resolve_eggs_kernel() {
	local running pin_file=/etc/highascg/pinned-kernel
	running="$(uname -r)"

	if [[ -f "$pin_file" ]]; then
		KVER="$(tr -d '[:space:]' <"$pin_file")"
		echo "==> Using pinned kernel from ${pin_file}: ${KVER}" >&2
	elif [[ "${HIGHASCG_ENSURE_LATEST_KERNEL:-0}" == "1" ]]; then
		echo "WARN: HIGHASCG_ENSURE_LATEST_KERNEL=1 without ${pin_file} — may pull newest HWE kernel" >&2
		export DEBIAN_FRONTEND=noninteractive
		apt-get update
		apt-get install -y --no-install-recommends linux-image-generic linux-headers-generic
		KVER="$(highascg_latest_installed_kernel)"
	else
		KVER="$(highascg_latest_installed_kernel)"
	fi

	[[ -n "$KVER" ]] || KVER="$running"

	VM="/boot/vmlinuz-${KVER}"
	IR="/boot/initrd.img-${KVER}"

	if [[ ! -f "$VM" || ! -f "$IR" ]]; then
		echo "Missing ${VM} or ${IR}" >&2
		return 1
	fi

	if [[ "$KVER" != "$running" ]]; then
		echo "WARN: running kernel is ${running}; eggs ISO will use latest ${KVER} — reboot before/after build so host and ISO match." >&2
	fi
	return 0
}

# Rebuild /boot/initrd.img-$KVER when Plymouth/theme changed. Skips repeat work in one eggs build.
# Env: HIGHASCG_FORCE_INITRAMFS=1 | HIGHASCG_SKIP_HOST_INITRAMFS=1
highascg_rebuild_host_initramfs() {
	local kver="${1:-}"
	local reason="${2:-}"
	local stamp_dir=/var/lib/highascg
	local stamp="${stamp_dir}/plymouth-host-initrd.stamp"
	local theme_dir=/usr/share/plymouth/themes/highascg
	local initrd="/boot/initrd.img-${kver}"

	[[ -n "$kver" ]] || return 1
	[[ "${HIGHASCG_SKIP_HOST_INITRAMFS:-0}" == "1" ]] && {
		echo "==> Skip host initramfs rebuild (${reason:-plymouth install only})"
		return 0
	}

	mkdir -p "$stamp_dir"
	local new_hash=""
	if [[ -d "$theme_dir" ]]; then
		new_hash="$(find "$theme_dir" -type f -printf '%s %T@ %p\n' 2>/dev/null | sort | md5sum | awk '{print $1}')"
	fi

	if [[ "${HIGHASCG_FORCE_INITRAMFS:-0}" != "1" && -f "$stamp" && -f "$initrd" && "$(cat "$stamp")" == "$new_hash" && "$initrd" -nt "$stamp" ]]; then
		echo "==> Skip host initramfs (unchanged Plymouth theme, ${kver}) — ${reason:-}"
		return 0
	fi

	echo ""
	echo "==> Rebuilding HOST initramfs for ${kver} (2–8 min, 30 PNG frames — NOT a loop)"
	echo "    Reason: ${reason:-plymouth branding}"
	echo "    (eggs produce will run mkinitramfs again for the ISO /live/initrd)"
	echo ""
	update-initramfs -u -k "$kver"
	echo "$new_hash" >"$stamp"
	echo "==> Host initramfs done: ${initrd}"
}
