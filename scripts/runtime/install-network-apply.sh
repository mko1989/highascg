#!/usr/bin/env bash
# WO-59: install network apply helper + passwordless sudo for casparcg service user.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$REPO_ROOT/tools/runtime/highascg-network-apply.sh"
DST=/usr/local/lib/highascg/highascg-network-apply.sh
SUDOERS=/etc/sudoers.d/highascg-network
USER_CASPAR="${1:-casparcg}"

if [ ! -f "$SRC" ]; then
	echo "Missing $SRC" >&2
	exit 1
fi

mkdir -p /usr/local/lib/highascg
install -m 755 "$SRC" "$DST"
echo "${USER_CASPAR} ALL=(root) NOPASSWD: ${DST}" > "$SUDOERS"
chmod 440 "$SUDOERS"
if command -v visudo >/dev/null 2>&1; then
	visudo -cf "$SUDOERS"
fi
echo "Installed ${DST} and ${SUDOERS}"
