#!/usr/bin/env bash
# Install licenses/ tree to system path for ISO and Calamares installs.
#
#   sudo bash scripts/setup/15-licenses-install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SRC="${REPO_ROOT}/licenses"
DEST="/usr/share/doc/highascg/licenses"
PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

if [[ ! -f "${SRC}/manifest.json" ]]; then
	log "manifest missing — running collector"
	bash "${REPO_ROOT}/tools/release/collect-third-party-licenses.sh"
fi

log "Install licenses → ${DEST}"
mkdir -p "${DEST}"
rsync -a --delete "${SRC}/" "${DEST}/"
chmod -R a+rX "${DEST}"

if [[ -d "${PLAYOUT}" ]]; then
	log "Symlink ${PLAYOUT}/licenses → ${DEST}"
	rm -rf "${PLAYOUT}/licenses"
	ln -sfn "${DEST}" "${PLAYOUT}/licenses"
	chown -h "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/licenses" 2>/dev/null || true
fi

ok "licenses installed at ${DEST}"
