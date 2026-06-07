#!/usr/bin/env bash
# Step 4: NDI SDK v6 (system libndi + copy into playout lib/).
#
#   sudo bash scripts/setup/04-ndi.sh
#
# Offline: export HIGHASCG_NDI_SDK_TAR=/path/to/Install_NDI_SDK_v6_Linux.tar.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

# shellcheck source=../install-config.sh
source "${SCRIPTS_DIR}/install-config.sh"
# shellcheck source=../install-helpers.sh
source "${SCRIPTS_DIR}/install-helpers.sh"

MIN_NDI="${MIN_NDI:-6.1}"
PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

ndi_installed() {
	[[ -f /usr/lib/x86_64-linux-gnu/libndi.so.6 ]] || ldconfig -p 2>/dev/null | grep -q libndi
}

if ndi_installed; then
	NDI_VER=$(ls /usr/lib/x86_64-linux-gnu/libndi.so.6.* 2>/dev/null | head -1 | sed 's/.*libndi.so.//')
	log "NDI already present (libndi.so.${NDI_VER:-?}) — skipping download"
else
	log "Install NDI SDK v6"
	apt-get update -y
	apt-get install -y wget curl tar
	cd /tmp
	if ! fetch_ndi_sdk_tarball /tmp/ndi-sdk.tar.gz; then
		echo "ERROR: NDI download failed. Set HIGHASCG_NDI_SDK_TAR or place tarball at /tmp/ndi-sdk.tar.gz" >&2
		exit 1
	fi
	tar -xzf ndi-sdk.tar.gz
	chmod +x Install_NDI_SDK_v6_Linux.sh
	./Install_NDI_SDK_v6_Linux.sh --accept-license || true

	NDI_LIB_SRC=""
	if [[ -d "NDI SDK for Linux/lib/x86_64-linux-gnu" ]]; then
		NDI_LIB_SRC=$(find "NDI SDK for Linux/lib/x86_64-linux-gnu" -maxdepth 1 -type f -name 'libndi.so.6.*' 2>/dev/null | head -1)
	fi
	if [[ -n "$NDI_LIB_SRC" && -f "$NDI_LIB_SRC" ]]; then
		install -m 0644 "$NDI_LIB_SRC" /usr/lib/x86_64-linux-gnu/
		NDI_BASE=$(basename "$NDI_LIB_SRC")
		ln -sf "$NDI_BASE" /usr/lib/x86_64-linux-gnu/libndi.so.6
		ln -sf libndi.so.6 /usr/lib/x86_64-linux-gnu/libndi.so
		ldconfig
		ok "installed $NDI_BASE"
	else
		echo "ERROR: libndi.so.6.* not found in SDK tree" >&2
		exit 1
	fi
fi

log "Copy NDI libs into ${PLAYOUT}/lib/"
mkdir -p "${PLAYOUT}/lib"
cp -f /usr/lib/x86_64-linux-gnu/libndi.so.6* "${PLAYOUT}/lib/" 2>/dev/null || true
if id "$USER_CASPAR" &>/dev/null; then
	chown "$USER_CASPAR:$USER_CASPAR" "${PLAYOUT}/lib"/libndi.so.6* 2>/dev/null || true
fi

echo
ls -la /usr/lib/x86_64-linux-gnu/libndi.so* 2>/dev/null || true
echo
echo "Next: sudo bash ${SCRIPT_DIR}/05-caspar-deps.sh"
