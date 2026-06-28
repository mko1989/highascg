#!/usr/bin/env bash
# WO-59: install network apply helper + passwordless sudo for casparcg service user.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APPLY_SRC="$REPO_ROOT/tools/runtime/highascg-network-apply.sh"
RESET_SRC="$REPO_ROOT/tools/runtime/highascg-network-reset.sh"
APPLY_DST=/usr/local/lib/highascg/highascg-network-apply.sh
RESET_DST=/usr/local/lib/highascg/highascg-network-reset.sh
SUDOERS=/etc/sudoers.d/highascg-network
USER_CASPAR="${1:-casparcg}"

if [ ! -f "$APPLY_SRC" ] || [ ! -f "$RESET_SRC" ]; then
	echo "Missing network helper script(s) under tools/runtime/" >&2
	exit 1
fi

mkdir -p /usr/local/lib/highascg
install -m 755 "$APPLY_SRC" "$APPLY_DST"
install -m 755 "$RESET_SRC" "$RESET_DST"
cat > "$SUDOERS" <<EOF
${USER_CASPAR} ALL=(root) NOPASSWD: ${APPLY_DST}
${USER_CASPAR} ALL=(root) NOPASSWD: ${RESET_DST}
EOF
chmod 440 "$SUDOERS"
if command -v visudo >/dev/null 2>&1; then
	visudo -cf "$SUDOERS"
fi
echo "Installed ${APPLY_DST}, ${RESET_DST}, and ${SUDOERS}"
