# Detect the installed NVIDIA driver branch (source, do not execute).
# WO-832: the driver branch was hard-coded as 535|580|595 in build/licence/persistenced helpers; the 26.04
# upgrade moved the box to 615 and every hard-coded list rejected it. Detect instead.

# Prints the full version (e.g. 615.71.09) of the driver in use; returns 1 when none is found.
# Order: loaded module → /proc → nvidia-smi → newest dpkg nvidia-driver-NNN[-open].
highascg_installed_nvidia_version() {
	local v=""
	[[ -r /sys/module/nvidia/version ]] && v="$(tr -d '[:space:]' </sys/module/nvidia/version 2>/dev/null || true)"
	if [[ -z "$v" && -r /proc/driver/nvidia/version ]]; then
		v="$(grep -oE '[0-9]{3,}\.[0-9]+(\.[0-9]+)?' /proc/driver/nvidia/version 2>/dev/null | head -1 || true)"
	fi
	if [[ -z "$v" ]] && command -v nvidia-smi >/dev/null 2>&1; then
		v="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
	fi
	if [[ -z "$v" ]] && command -v dpkg-query >/dev/null 2>&1; then
		v="$(dpkg-query -W -f='${Package} ${Version}\n' 'nvidia-driver-[0-9]*' 2>/dev/null \
			| awk '$1 ~ /^nvidia-driver-[0-9]+(-open)?$/ {print $2}' | sort -V | tail -1 | grep -oE '^[0-9]+(\.[0-9]+)*' || true)"
	fi
	[[ -n "$v" ]] || return 1
	printf '%s\n' "$v"
}

# Prints the major branch (e.g. 615); returns 1 when no driver is found.
highascg_installed_nvidia_branch() {
	local v
	v="$(highascg_installed_nvidia_version)" || return 1
	printf '%s\n' "${v%%.*}"
}
