#!/usr/bin/env bash
# WO-78: install rsync-only forced-command wrapper for replication SSH.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$REPO_ROOT/tools/runtime/highascg-replication-ssh.sh"
DST=/usr/local/bin/highascg-replication-ssh

if [[ ! -f "$SRC" ]]; then
	echo "Missing wrapper script: $SRC" >&2
	exit 1
fi

mkdir -p "$(dirname "$DST")"
install -m 755 "$SRC" "$DST"
echo "Installed ${DST}"
echo "Tip: set hardware hostname once if still on clone ISO name:"
echo "  sudo hostnamectl set-hostname highascg####   # #### from config/hardware-identity.json"
