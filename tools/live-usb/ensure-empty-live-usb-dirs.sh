#!/usr/bin/env bash
# Ensure /home/serwer and /opt/casparcg/media exist on the *source* machine before
# eggs produce, so the squashfs contains empty mount points. Content under them
# is dropped via penguins-eggs-exclude-highascg-fragment.list (see merge script).
# Run as root.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi
mkdir -p /opt/casparcg/media
if getent passwd serwer >/dev/null 2>&1; then
  mkdir -p /home/serwer
  u="$(getent passwd serwer | cut -d: -f3)"
  g="$(getent passwd serwer | cut -d: -f4)"
  chown -h "$u":"$g" /home/serwer
else
  echo "Note: user 'serwer' not found — create the account or mkdir /home/serwer yourself if needed." >&2
  mkdir -p /home/serwer || true
fi
if getent passwd casparcg >/dev/null 2>&1; then
  u="$(getent passwd casparcg | cut -d: -f3)"
  g="$(getent passwd casparcg | cut -d: -f4)"
  chown -h "$u":"$g" /opt/casparcg/media
fi
echo "OK: /home/serwer and /opt/casparcg/media exist (tweak ownership if your site uses different UIDs)."
