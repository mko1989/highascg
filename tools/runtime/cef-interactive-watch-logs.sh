#!/usr/bin/env bash
# Tail HighAsCG logs for CEF bridge click tracing (no extra test terminals).
set -euo pipefail
echo "Watching CEF bridge logs — click the multiview, then read x11: / x11→node / forwarded lines."
echo "Disable trace: HIGHASCG_CEF_BRIDGE_TRACE=0 in highascg.service environment"
echo "---"
exec journalctl -u highascg.service -f --no-pager 2>/dev/null | grep --line-buffered -E 'CEF bridge|x11:'
