#!/usr/bin/env bash
# Clean the eggs build host checkout under /home/casparcg/highascg.
# Safe for the machine that runs penguins-eggs — does not remove node_modules or live config.
#
# Usage (repo root):
#   bash scripts/clean-eggs-dev-host.sh
#   bash scripts/clean-eggs-dev-host.sh --dry-run
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

run() {
	if [[ "$DRY" -eq 1 ]]; then
		echo "[dry-run] $*"
	else
		"$@"
	fi
}

echo "==> Eggs dev host cleanup: $ROOT"
echo "    Layout: server at repo root (src/, index.js, tools/, …); UI only in client/"

# Accidental nested backend/ from partial migration
if [[ -d "$ROOT/backend" ]]; then
	echo "==> Removing stale backend/ (server belongs at repo root)"
	run rm -rf "$ROOT/backend"
fi

# Huge / stale artifacts (not needed to produce eggs)
for path in core core.*; do
	[[ -e "$ROOT/$path" ]] || continue
	echo "==> Remove crash dump: $path"
	run rm -f "$ROOT/$path"
done

[[ -d "$ROOT/.git_nested_backup" ]] && { echo "==> Remove .git_nested_backup"; run rm -rf "$ROOT/.git_nested_backup"; }

# Regenerable UI build output (keep client/ sources)
if [[ -d "$ROOT/dist-web" ]]; then
	echo "==> Remove dist-web/ (rebuild: npm run build:client)"
	run rm -rf "$ROOT/dist-web"
fi

# Release artifact dir
[[ -d "$ROOT/dist" ]] && { echo "==> Remove dist/ release tarballs"; run rm -rf "$ROOT/dist"; }

# Runtime churn (ISO excludes these anyway)
for dir in cef-cache log; do
	[[ -d "$ROOT/$dir" ]] || continue
	echo "==> Clear $dir/"
	run find "$ROOT/$dir" -mindepth 1 -delete 2>/dev/null || run rm -rf "$ROOT/$dir"/*
done

# Optional dev-only trees (not on stick payload)
for dir in examples samples scratch; do
	[[ -d "$ROOT/$dir" ]] || continue
	echo "==> Remove $dir/ (not needed on eggs host)"
	run rm -rf "$ROOT/$dir"
done

# Old split-repo checkouts (rsync + separate gh repos — not used for eggs)
for stale in /home/casparcg/highascg-server /home/casparcg/highascg-frontend; do
	if [[ -d "$stale" ]]; then
		echo "==> Remove stale split checkout: $stale"
		run rm -rf "$stale"
	fi
done

echo "==> Done. Kept: src/, client/, node_modules/, config/, tools/, scripts/, highascg.config.json"
echo "    Verify: npm run verify:structure"
