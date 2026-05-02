#!/usr/bin/env bash
# Append the HighAsCG mksquashfs exclude fragment to the penguins-eggs exclude
# file. Run on the *source* host as root, after:
#   - penguins-eggs is installed, and
#   - /etc/penguins-eggs.d/exclude.list exists (usually: first "eggs produce" or config step).
# Then: sudo eggs produce --clone --excludes static --basename "…"
set -euo pipefail
TARGET="${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FRAG="${HERE}/penguins-eggs-exclude-highascg-fragment.list"
MARKER="# --- HighAsCG tools/live-usb: merge-penguins-eggs-exclude-highascg.sh ---"
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: sudo $0"
  echo "  Appends to ${TARGET} (set EGGS_EXCLUDE_LIST to override)."
  echo "  Idempotent: skips if the marker is already in the file."
  exit 0
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi
if [[ ! -f "$FRAG" ]]; then
  echo "Fragment not found: $FRAG" >&2
  exit 1
fi
if [[ ! -f "$TARGET" ]]; then
  echo "Not found: $TARGET" >&2
  echo "Create it first (e.g. run penguins-eggs configuration or one" >&2
  echo "  eggs produce without --excludes static so the template is built)." >&2
  exit 1
fi
if grep -qF "$MARKER" "$TARGET" 2>/dev/null; then
  echo "Marker already present in $TARGET — nothing to do." >&2
  echo "To re-append, remove the block starting at that marker, then re-run." >&2
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
