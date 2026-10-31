#!/usr/bin/env bash
# WO-906: install the two-screen X layout helper + passwordless sudo for the casparcg service user.
# Run once as root on a box: sudo bash scripts/runtime/install-xorg-screens-apply.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$REPO_ROOT/tools/runtime/highascg-xorg-screens-apply.sh"
DST=/usr/local/lib/highascg/highascg-xorg-screens-apply.sh
SUDOERS=/etc/sudoers.d/highascg-xorg-screens
USER_CASPAR="${1:-casparcg}"

if [ ! -f "$SRC" ]; then
	echo "Missing $SRC" >&2
	exit 1
fi

mkdir -p /usr/local/lib/highascg
install -m 755 -o root -g root "$SRC" "$DST"
cat >"$SUDOERS" <<EOF
${USER_CASPAR} ALL=(root) NOPASSWD: ${DST}
EOF
chmod 440 "$SUDOERS"
if command -v visudo >/dev/null 2>&1; then
	visudo -cf "$SUDOERS"
fi
echo "Installed ${DST} and ${SUDOERS}"
