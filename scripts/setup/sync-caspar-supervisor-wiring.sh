#!/usr/bin/env bash
# Idempotent: systemd owns Caspar (scanner + run.sh); Openbox autostart trimmed.
#
#   sudo bash scripts/setup/sync-caspar-supervisor-wiring.sh [casparcg]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

USER_CASPAR="${1:-casparcg}"
export OPENBOX_SKIP_NODM_RESTART="${OPENBOX_SKIP_NODM_RESTART:-1}"

log "Caspar supervisor wiring (systemd owns playout; refresh Openbox autostart)"
bash "${SCRIPT_DIR}/13-caspar-systemd-units.sh" "$USER_CASPAR"
bash "${SCRIPT_DIR}/09-openbox-autostart.sh"

if command -v casparcg-scanner >/dev/null 2>&1; then
	systemctl enable casparcg-scanner.service 2>/dev/null || true
fi
if [[ -x "/home/${USER_CASPAR}/highascg/run.sh" ]]; then
	systemctl enable casparcg-server.service 2>/dev/null || true
fi

AUTOSTART="/home/${USER_CASPAR}/.config/openbox/autostart"
if [[ -f "$AUTOSTART" ]] \
	&& grep -vE '^\s*#' "$AUTOSTART" | grep -q 'casparcg-scanner' 2>/dev/null; then
	echo "ERROR: autostart must not start casparcg-scanner — use casparcg-scanner.service" >&2
	exit 1
fi
if grep -vE '^\s*#' "$AUTOSTART" 2>/dev/null | grep -qE 'exec \./run\.sh|\./run\.sh >>' \
	&& systemctl is-enabled --quiet casparcg-server.service 2>/dev/null; then
	echo "ERROR: autostart still starts run.sh while casparcg-server.service is enabled" >&2
	exit 1
fi

ok "Caspar wiring synced — use: bash ${REPO_ROOT}/tools/runtime/diagnose-caspar-supervisors.sh"
echo "On a running laptop with duplicates: sudo systemctl restart casparcg-scanner casparcg-server"
