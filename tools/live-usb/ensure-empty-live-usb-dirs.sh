#!/usr/bin/env bash
# Ensure /home/casparcg/highascg/media/{drive,exfat} and /home/casparcg/exfat exist on the *source* machine before
# eggs produce, so the squashfs contains empty mount points. Content under them
# is dropped via penguins-eggs-exclude-highascg-fragment.list (see merge script).
# Run as root.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi
mkdir -p /home/casparcg/highascg/media/drive /home/casparcg/highascg/media/exfat
mkdir -p /home/casparcg/exfat
if getent passwd casparcg >/dev/null 2>&1; then
  u="$(getent passwd casparcg | cut -d: -f3)"
  g="$(getent passwd casparcg | cut -d: -f4)"
  chown -R "$u":"$g" /home/casparcg/highascg/media
  chown -h "$u":"$g" /home/casparcg/exfat
fi
echo "OK: /home/casparcg/highascg/media/{drive,exfat} and /home/casparcg/exfat exist (tweak ownership if your site uses different UIDs)."
