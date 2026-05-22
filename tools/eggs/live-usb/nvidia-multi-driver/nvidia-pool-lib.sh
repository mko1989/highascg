# Shared NVIDIA offline-pool naming (open vs proprietary metapackages).
# Sourced by fetch-debs.sh, highascg-pick-nvidia.sh, highascg-nvidia-apply-from-pool.sh

nvidia_pool_read_flavor() {
	if [[ -n "${NVIDIA_DRIVER_FLAVOR:-}" ]]; then
		echo "${NVIDIA_DRIVER_FLAVOR}"
		return 0
	fi
	if [[ -f /etc/highascg/nvidia-driver-flavor ]]; then
		tr -d '[:space:]' < /etc/highascg/nvidia-driver-flavor
		return 0
	fi
	echo open
}

nvidia_pool_driver_pkg() {
	local branch="${1:?branch}"
	case "$(nvidia_pool_read_flavor)" in
	open) echo "nvidia-driver-${branch}-open" ;;
	*) echo "nvidia-driver-${branch}" ;;
	esac
}

nvidia_pool_dkms_pkg() {
	local branch="${1:?branch}"
	case "$(nvidia_pool_read_flavor)" in
	open) echo "nvidia-dkms-${branch}-open" ;;
	*) echo "nvidia-dkms-${branch}" ;;
	esac
}

# Map ubuntu-drivers recommendation (often closed name) to pool metapackage for current flavor.
nvidia_pool_map_recommended_pkg() {
	local pkg="${1:-}"
	local branch
	branch="$(echo "$pkg" | grep -oE '[0-9]+' | head -1)"
	[[ -n "$branch" ]] || {
		echo "$pkg"
		return 0
	}
	echo "$(nvidia_pool_driver_pkg "$branch")"
}

nvidia_pool_map_recommended_dkms() {
	local driver_pkg
	driver_pkg="$(nvidia_pool_map_recommended_pkg "${1:-}")"
	local branch
	branch="$(echo "$driver_pkg" | grep -oE '[0-9]+' | head -1)"
	[[ -n "$branch" ]] || return 1
	echo "$(nvidia_pool_dkms_pkg "$branch")"
}
