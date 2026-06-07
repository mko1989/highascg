#!/usr/bin/env bash
# Shared helpers for scripts/setup/*.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SETUP_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_DIR="$(cd "${SETUP_LIB}/.." && pwd)"
REPO_ROOT="$(cd "${SETUP_DIR}/../.." && pwd)"
SCRIPTS_DIR="${REPO_ROOT}/scripts"

# shellcheck source=../../apt-block-service-starts.sh
source "${SCRIPTS_DIR}/apt-block-service-starts.sh"

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

setup_trap_apt_cleanup() {
	cleanup() { highascg_apt_unblock_service_starts; }
	trap cleanup EXIT
}

pkg_installed() {
	# Held packages report "hold ok installed", not "install ok installed".
	dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -qE '(install|hold) ok installed'
}
