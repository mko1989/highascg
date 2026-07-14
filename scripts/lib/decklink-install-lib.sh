#!/usr/bin/env bash
# DeckLink Desktop Video — discover operator .deb drops on exFAT/bridge (WO-92).
# Sourced by scripts/runtime/decklink-install-from-exfat.sh and smoke tests.

decklink_version_gte() {
	local a="${1:-}"
	local b="${2:-}"
	[[ -n "$a" && -n "$b" ]] || return 1
	[[ "$(printf '%s\n' "$a" "$b" | sort -V | head -n1)" == "$b" ]]
}

# @param basename e.g. desktopvideo_16.0.1a2_amd64.deb
decklink_deb_version_from_basename() {
	local base="${1:-}"
	case "$base" in
		desktopvideo-gui_*) echo "$base" | sed -nE 's/^desktopvideo-gui_(.+)_amd64\.deb$/\1/p' ;;
		desktopvideo_*) echo "$base" | sed -nE 's/^desktopvideo_(.+)_amd64\.deb$/\1/p' ;;
		*) echo "" ;;
	esac
}

decklink_pkg_installed_version() {
	local pkg="${1:-}"
	local v
	v="$(dpkg-query -W -f='${Version}' "$pkg" 2>/dev/null | head -1 || true)"
	[[ -n "$v" ]] || return 1
	v="${v#*:}"
	printf '%s' "$v"
}

decklink_both_packages_installed_at_least() {
	local target_ver="${1:-}"
	local v_main v_gui
	[[ -n "$target_ver" ]] || return 1
	v_main="$(decklink_pkg_installed_version desktopvideo || true)"
	[[ -n "$v_main" ]] || return 1
	if ! decklink_version_gte "$v_main" "$target_ver"; then
		return 1
	fi
	v_gui="$(decklink_pkg_installed_version desktopvideo-gui || true)"
	if [[ -n "$v_gui" ]]; then
		decklink_version_gte "$v_gui" "$target_ver"
	else
		return 0
	fi
}

# Prints mounted …/decklink directories (USB exFAT then bridge), one per line.
decklink_vendor_search_dirs() {
	local mp
	for mp in /home/casparcg/exfat /home/casparcg/bridge; do
		if mountpoint -q "$mp" 2>/dev/null && [[ -d "${mp}/decklink" ]]; then
			printf '%s\n' "${mp}/decklink"
		fi
	done
}

# Extract DeckLink .debs from Blackmagic_Desktop_Video_Linux_*.tar.gz to a temp directory.
# Returns path to temp dir in DECKLINK_EXTRACT_TMPDIR; caller is responsible for cleanup.
decklink_extract_tar_gz_debs() {
	local tar_gz="${1:-}"
	local temp_dir
	[[ -f "$tar_gz" ]] || return 1
	temp_dir="$(mktemp -d)" || return 1
	DECKLINK_EXTRACT_TMPDIR="$temp_dir"
	# List deb/x86_64/*.deb entries; if found, extract them to temp dir
	if tar -tzf "$tar_gz" 2>/dev/null | grep -q '^deb/x86_64/.*\.deb$'; then
		tar -xzf "$tar_gz" -C "$temp_dir" deb/x86_64/*.deb 2>/dev/null || {
			rm -rf "$temp_dir"
			DECKLINK_EXTRACT_TMPDIR=""
			return 1
		}
		return 0
	fi
	rm -rf "$temp_dir"
	DECKLINK_EXTRACT_TMPDIR=""
	return 1
}

# Sets DECKLINK_VENDOR_MAIN_DEB, DECKLINK_VENDOR_GUI_DEB, DECKLINK_VENDOR_VERSION, DECKLINK_VENDOR_DIR.
# Returns 0 when a matching pair is found.
decklink_find_newest_vendor_pair() {
	DECKLINK_VENDOR_MAIN_DEB=""
	DECKLINK_VENDOR_GUI_DEB=""
	DECKLINK_VENDOR_VERSION=""
	DECKLINK_VENDOR_DIR=""

	local dir f base ver gui_deb
	local best_ver="" best_main="" best_gui="" best_dir=""

	while IFS= read -r dir; do
		[[ -n "$dir" ]] || continue
		for f in "$dir"/desktopvideo_*.deb; do
			[[ -f "$f" ]] || continue
			base="$(basename "$f")"
			[[ "$base" == desktopvideo-gui_* ]] && continue
			ver="$(decklink_deb_version_from_basename "$base")"
			[[ -n "$ver" ]] || continue
			gui_deb="${dir}/desktopvideo-gui_${ver}_amd64.deb"
			if [[ ! -f "$gui_deb" ]]; then
				gui_deb=""
			fi
			if [[ -z "$best_ver" ]] || [[ "$(printf '%s\n' "$ver" "$best_ver" | sort -V | tail -1)" == "$ver" ]]; then
				best_ver="$ver"
				best_main="$f"
				best_gui="$gui_deb"
				best_dir="$dir"
			fi
		done
	done < <(decklink_vendor_search_dirs)

	# No pre-extracted debs found; check for tar.gz and extract
	if [[ -z "$best_main" ]]; then
		local tar_gz search_dir
		while IFS= read -r search_dir; do
			[[ -n "$search_dir" ]] || continue
			for tar_gz in "$search_dir"/Blackmagic_Desktop_Video_Linux_*.tar.gz; do
				[[ -f "$tar_gz" ]] || continue
				if decklink_extract_tar_gz_debs "$tar_gz"; then
					# Look for debs in extracted temp dir (deb/x86_64/ structure)
					for f in "${DECKLINK_EXTRACT_TMPDIR}"/deb/x86_64/desktopvideo_*.deb; do
						[[ -f "$f" ]] || continue
						base="$(basename "$f")"
						[[ "$base" == desktopvideo-gui_* ]] && continue
						ver="$(decklink_deb_version_from_basename "$base")"
						[[ -n "$ver" ]] || continue
						gui_deb="${DECKLINK_EXTRACT_TMPDIR}/deb/x86_64/desktopvideo-gui_${ver}_amd64.deb"
						if [[ ! -f "$gui_deb" ]]; then
							gui_deb=""
						fi
						if [[ -z "$best_ver" ]] || [[ "$(printf '%s\n' "$ver" "$best_ver" | sort -V | tail -1)" == "$ver" ]]; then
							best_ver="$ver"
							best_main="$f"
							best_gui="$gui_deb"
							best_dir="${DECKLINK_EXTRACT_TMPDIR}/deb/x86_64"
						fi
					done
					# Keep the temp dir for later cleanup after install
					break 2
				fi
			done
		done < <(decklink_vendor_search_dirs)
	fi

	[[ -n "$best_main" && -n "$best_ver" ]] || return 1
	DECKLINK_VENDOR_MAIN_DEB="$best_main"
	DECKLINK_VENDOR_GUI_DEB="${best_gui:-}"
	DECKLINK_VENDOR_VERSION="$best_ver"
	DECKLINK_VENDOR_DIR="$best_dir"
	return 0
}

# @param reason_var_name — name of variable to set with skip/install reason (optional)
decklink_needs_install_from_vendor() {
	local reason_var="${1:-}"
	decklink_find_newest_vendor_pair || {
		[[ -n "$reason_var" ]] && printf -v "$reason_var" "no vendor debs in ~/exfat/decklink or ~/bridge/decklink"
		return 1
	}
	if decklink_both_packages_installed_at_least "$DECKLINK_VENDOR_VERSION"; then
		[[ -n "$reason_var" ]] && printf -v "$reason_var" "already installed (>= ${DECKLINK_VENDOR_VERSION})"
		return 1
	fi
	[[ -n "$reason_var" ]] && printf -v "$reason_var" "install or upgrade to ${DECKLINK_VENDOR_VERSION}"
	return 0
}

decklink_install_vendor_pair() {
	local main_deb="${1:-}"
	local gui_deb="${2:-}"
	local extract_dir="${3:-}"
	[[ -f "$main_deb" ]] || return 1
	decklink_ensure_dkms_prereqs || return 1
	if [[ -n "$gui_deb" && -f "$gui_deb" ]]; then
		DEBIAN_FRONTEND=noninteractive dpkg -i "$main_deb" "$gui_deb" || {
			DEBIAN_FRONTEND=noninteractive apt-get install -f -y
			DEBIAN_FRONTEND=noninteractive dpkg -i "$main_deb" "$gui_deb"
		}
	else
		DEBIAN_FRONTEND=noninteractive dpkg -i "$main_deb" || {
			DEBIAN_FRONTEND=noninteractive apt-get install -f -y
			DEBIAN_FRONTEND=noninteractive dpkg -i "$main_deb"
		}
	fi
	decklink_rebuild_blackmagic_dkms || true
	modprobe blackmagic_io 2>/dev/null || true
	modprobe blackmagic 2>/dev/null || true
	# Clean up temporary extraction directory if provided
	[[ -z "$extract_dir" || ! -d "$extract_dir" ]] || rm -rf "$extract_dir"
	return 0
}

# True when /lib/modules/$KREL/build is usable for DKMS (DeckLink, NVIDIA, …).
decklink_kernel_headers_ready() {
	local krel="${1:-$(uname -r)}"
	[[ -n "$krel" ]] || return 1
	[[ -e "/lib/modules/${krel}/build/Makefile" ]] && return 0
	[[ -e "/lib/modules/${krel}/build/include/linux/version.h" ]] && return 0
	return 1
}

# Install linux-headers for the running kernel before desktopvideo postinst runs DKMS.
decklink_ensure_dkms_prereqs() {
	local krel hdr_pkg
	krel="$(uname -r)"
	if decklink_kernel_headers_ready "$krel"; then
		return 0
	fi
	if ! command -v apt-get >/dev/null 2>&1; then
		echo "ERROR: linux-headers-${krel} required for DeckLink DKMS — apt-get missing" >&2
		return 1
	fi
	hdr_pkg="linux-headers-${krel}"
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq 2>/dev/null || apt-get update -qq || true
	apt-get install -y --no-install-recommends \
		"${hdr_pkg}" \
		build-essential \
		dkms \
		gcc \
		make \
		|| {
			echo "ERROR: failed to install ${hdr_pkg} (network or apt repo required)" >&2
			return 1
		}
	if ! decklink_kernel_headers_ready "$krel"; then
		echo "ERROR: ${hdr_pkg} installed but /lib/modules/${krel}/build still missing" >&2
		return 1
	fi
	return 0
}

# Re-run DKMS when desktopvideo postinst failed (common when headers were missing on first dpkg).
decklink_rebuild_blackmagic_dkms() {
	local krel ver mod
	krel="$(uname -r)"
	ver="$(decklink_pkg_installed_version desktopvideo || true)"
	[[ -n "$ver" ]] || return 0
	command -v dkms >/dev/null 2>&1 || return 0
	for mod in blackmagic blackmagic-io; do
		if dkms status -m "$mod" -v "$ver" -k "$krel" -a 2>/dev/null | grep -q ': installed'; then
			continue
		fi
		dkms install -m "$mod" -v "$ver" -k "$krel" 2>/dev/null \
			|| dkms build -m "$mod" -v "$ver" -k "$krel" 2>/dev/null \
			|| true
		dkms install -m "$mod" -v "$ver" -k "$krel" 2>/dev/null || true
	done
}
