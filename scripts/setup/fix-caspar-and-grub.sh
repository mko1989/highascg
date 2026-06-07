#!/usr/bin/env bash
# One-shot fix: Caspar missing runtime .so + GRUB Advanced-submenu default.
#
#   cd ~/highascg
#   sudo bash scripts/setup/fix-caspar-and-grub.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log "Caspar runtime libraries"
bash "${SCRIPT_DIR}/05-caspar-deps.sh"

log "GRUB: saved default (top-level Ubuntu, not Advanced submenu)"
GRUB=/etc/default/grub
sed -i 's|^GRUB_DEFAULT=.*|GRUB_DEFAULT=saved|' "$GRUB"
if grep -q '^GRUB_SAVEDEFAULT=' "$GRUB"; then
	sed -i 's/^GRUB_SAVEDEFAULT=.*/GRUB_SAVEDEFAULT=true/' "$GRUB"
else
	echo 'GRUB_SAVEDEFAULT=true' >>"$GRUB"
fi
update-grub
grub-set-default 0 2>/dev/null || true

log "Restart HighAsCG / Caspar"
systemctl restart highascg.service 2>/dev/null || true
systemctl restart nodm 2>/dev/null || true

echo
echo "OK. Verify:"
echo "  LD_LIBRARY_PATH=${REPO_ROOT}/lib ldd ${REPO_ROOT}/bin/casparcg | grep 'not found' || echo '  all libs OK'"
echo "  grep GRUB_DEFAULT /etc/default/grub"
echo "  systemctl status highascg"
