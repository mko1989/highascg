#!/usr/bin/env bash
# WO-161 T161.3 — Manual casparcg.config backup with rotation.
#
# Copies config/casparcg.config to config/backups/casparcg.config.bak.<epoch>
# and prunes config/backups/ to the newest 10 backups. Replaces the old
# unbounded `cp casparcg.config casparcg.config.bak.$(date +%s)` pattern that
# accumulated .bak files directly in config/ (which rides the exFAT sync).
#
# Usage: bash scripts/backup-caspar-config.sh [path/to/casparcg.config]
#   Default source: <repo>/config/casparcg.config
#   Backups dir:    <source dir>/backups/
# Never touches the live config or any pre-existing .bak files in config/.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$REPO_ROOT/config/casparcg.config}"
KEEP="${HIGHASCG_CASPAR_BACKUP_KEEP:-10}"

if [[ ! -f "$SRC" ]]; then
	echo "backup-caspar-config: source not found: $SRC" >&2
	exit 1
fi

BACKUP_DIR="$(dirname "$SRC")/backups"
mkdir -p "$BACKUP_DIR"

DEST="$BACKUP_DIR/casparcg.config.bak.$(date +%s)"
cp -p "$SRC" "$DEST"
echo "backup-caspar-config: saved $DEST"

# Prune: keep the newest $KEEP casparcg.config.bak.* in the backups folder only.
# Sort by the epoch suffix (field 4 of the basename), NOT mtime — cp -p
# preserves the source mtime so all backups share it.
mapfile -t OLD < <(cd "$BACKUP_DIR" && ls -1 casparcg.config.bak.* 2>/dev/null | sort -t. -k4 -rn | tail -n +$((KEEP + 1)))
for f in "${OLD[@]:-}"; do
	[[ -n "$f" && -f "$BACKUP_DIR/$f" ]] || continue
	rm -f -- "$BACKUP_DIR/$f"
	echo "backup-caspar-config: pruned $BACKUP_DIR/$f"
done

echo "backup-caspar-config: $(ls -1 "$BACKUP_DIR"/casparcg.config.bak.* 2>/dev/null | wc -l) backup(s) kept in $BACKUP_DIR (max $KEEP)"
