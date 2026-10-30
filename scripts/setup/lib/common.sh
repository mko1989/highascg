#!/usr/bin/env bash
# Shared helpers for scripts/setup/*.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SETUP_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_DIR="$(cd "${SETUP_LIB}/.." && pwd)"
REPO_ROOT="$(cd "${SETUP_DIR}/../.." && pwd)"
SCRIPTS_DIR="${REPO_ROOT}/scripts"
SCRIPTS_LIB="${SCRIPTS_DIR}/lib"
SCRIPTS_EXFAT="${SCRIPTS_DIR}/exfat"
SCRIPTS_BOOT="${SCRIPTS_DIR}/boot"

# shellcheck source=../../lib/apt-block-service-starts.sh
source "${SCRIPTS_LIB}/apt-block-service-starts.sh"

TARGET_KVER="6.8.0-117"
TARGET_KREL="${TARGET_KVER}-generic"
USER_CASPAR="${USER_CASPAR:-casparcg}"

log()  { echo "==> $*"; }
ok()   { echo "  ok: $*"; }
fail() { echo "  FAIL: $*" >&2; }

require_root() {
	[[ "$(id -u)" -eq 0 ]] || {
		echo "Run as root: sudo $0" >&2
		exit 1
	}
}

# WO-832: steps 01/02/03 are the Ubuntu 24.04 flow (kernel 6.8.0-117 pin, CUDA-repo nvidia-open 595,
# ubuntu2404 keyring). Since the 26.04 upgrade the box runs the archive kernel + nvidia-driver-<N>-open, and
# 01 would install 6.8 and PURGE the running kernel. Refuse unless the host really is 24.04 (or the owner
# overrides with HIGHASCG_ALLOW_LEGACY_2404=1).
require_legacy_2404() {
	local vid=""
	[[ -r /etc/os-release ]] && vid="$(. /etc/os-release && echo "${VERSION_ID:-}")"
	if [[ "$vid" != "24.04" && "${HIGHASCG_ALLOW_LEGACY_2404:-0}" != "1" ]]; then
		echo "ERROR: $(basename "$0") is the Ubuntu 24.04 flow (kernel ${TARGET_KREL}, CUDA-repo NVIDIA) — this host is ${vid:-unknown}." >&2
		echo "       26.04+: keep the archive kernel and pin it with: echo \"\$(uname -r)\" | sudo tee /etc/highascg/pinned-kernel" >&2
		echo "       GPU: sudo apt install nvidia-driver-<N>-open  (615 on the reference box)" >&2
		echo "       Override (24.04 rebuild only): HIGHASCG_ALLOW_LEGACY_2404=1" >&2
		exit 1
	fi
}

setup_trap_apt_cleanup() {
	cleanup() { highascg_apt_unblock_service_starts; }
	trap cleanup EXIT
}

pkg_installed() {
	# Held packages report "hold ok installed", not "install ok installed".
	dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -qE '(install|hold) ok installed'
}
