#!/usr/bin/env bash
# Append the HighAsCG mksquashfs exclude fragment to the penguins-eggs exclude
# file. Run on the *source* host as root, after:
#   - penguins-eggs is installed, and
#   - /etc/penguins-eggs.d/exclude.list exists (usually: first "eggs produce" or config step).
# Then: sudo eggs produce --clone --excludes static --basename "…"
set -euo pipefail
TARGET="${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FRAG="${HIGHASCG_EGGS_EXCLUDE_FRAGMENT:-${HERE}/penguins-eggs-exclude-highascg-fragment.list}"
EMBED_FRAG="${HERE}/penguins-eggs-exclude-highascg-embed-server.list"
MARKER="# --- HighAsCG tools/eggs/live-usb: merge-penguins-eggs-exclude-highascg.sh ---"

# WO-47-only: omit Node server from squashfs (exFAT drop-update/). Must not remain when
# embedding server + dist-web on the ISO (embed-server fragment).
WO47_SERVER_EXCLUDES=(
	home/casparcg/highascg/index.js
	home/casparcg/highascg/package.json
	home/casparcg/highascg/package-lock.json
	home/casparcg/highascg/npm-shrinkwrap.json
	home/casparcg/highascg/src
	home/casparcg/highascg/src/*
	home/casparcg/highascg/scripts
	home/casparcg/highascg/scripts/*
	home/casparcg/highascg/tools
	home/casparcg/highascg/tools/*
	home/casparcg/highascg/dist-web
	home/casparcg/highascg/dist-web/*
	home/casparcg/highascg/node_modules
	home/casparcg/highascg/node_modules/*
)

strip_wo47_server_excludes() {
	local file="$1"
	local tmp removed=0
	tmp="$(mktemp)"
	while IFS= read -r line || [[ -n "${line:-}" ]]; do
		local skip=0
		for pat in "${WO47_SERVER_EXCLUDES[@]}"; do
			if [[ "$line" == "$pat" ]]; then
				skip=1
				removed=$((removed + 1))
				break
			fi
		done
		[[ "$skip" -eq 1 ]] && continue
		printf '%s\n' "$line"
	done <"$file" >"$tmp"
	mv "$tmp" "$file"
	if [[ "$removed" -gt 0 ]]; then
		echo "Stripped $removed WO-47 server exclude line(s) from: $file" >&2
	fi
}

using_embed_server_fragment() {
	[[ "$(readlink -f "$FRAG" 2>/dev/null || realpath "$FRAG" 2>/dev/null || echo "$FRAG")" == \
		"$(readlink -f "$EMBED_FRAG" 2>/dev/null || realpath "$EMBED_FRAG" 2>/dev/null || echo "$EMBED_FRAG")" ]]
}
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: sudo $0 [--replace]"
  echo "  Appends to ${TARGET} (set EGGS_EXCLUDE_LIST to override)."
  echo "  --replace  Remove every HighAsCG marker block, then append one fresh block."
  exit 0
fi
REPLACE=0
[[ "${1:-}" == "--replace" ]] && REPLACE=1
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi
if [[ ! -f "$FRAG" ]]; then
  echo "Fragment not found: $FRAG" >&2
  exit 1
fi
TEMPLATE="${HERE}/exclude.list"
if [[ ! -f "$TARGET" ]]; then
  if [[ ! -f "$TEMPLATE" ]]; then
    echo "Not found: $TARGET (and no template at $TEMPLATE)" >&2
    exit 1
  fi
  install -d "$(dirname "$TARGET")"
  install -m 0644 "$TEMPLATE" "$TARGET"
  echo "Installed eggs exclude template → $TARGET (from $TEMPLATE)" >&2
fi
if [[ "$REPLACE" -eq 1 ]]; then
  tmp="$(mktemp)"
  awk '/^# --- HighAsCG tools\/(live-usb|eggs\/live-usb):/ { exit } { print }' "$TARGET" >"$tmp"
  mv "$tmp" "$TARGET"
  echo "Removed prior HighAsCG exclude blocks from: $TARGET" >&2
fi
if using_embed_server_fragment; then
  strip_wo47_server_excludes "$TARGET"
fi
if grep -qF "$MARKER" "$TARGET" 2>/dev/null && [[ "$REPLACE" -eq 0 ]]; then
  added=0
  while IFS= read -r line || [[ -n "${line:-}" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    if grep -qxF "$line" "$TARGET" 2>/dev/null; then
      continue
    fi
    echo "$line" >>"$TARGET"
    added=$((added + 1))
  done < <(sed -e 's/^[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$FRAG")
  if [[ "$added" -gt 0 ]]; then
    echo "Appended $added missing HighAsCG exclude line(s) to: $TARGET" >&2
  else
    echo "Marker already present; all fragment lines are in $TARGET." >&2
    echo "To replace the whole block, delete from the marker through EOF in $TARGET, then re-run." >&2
  fi
  exit 0
fi
{
  echo ""
  echo "$MARKER"
  # Strip comment-only and blank lines from the fragment; keep the patterns
  sed -e 's/^[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$FRAG"
} >> "$TARGET"
echo "Appended HighAsCG excludes to: $TARGET" >&2
echo "Next: sudo eggs produce --clone --excludes static --basename \"…\"" >&2
