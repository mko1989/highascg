#!/usr/bin/env bash
# WO-1121 — desktop quality of life for the operator's X session (run as the session user, no root; safe to re-run):
#   • Super+Space → app search (scripts/desktop/app-search.sh, rofi) as an openbox keybind
#   • Thunar: Space on a video / image file → quick look (scripts/desktop/quicklook.sh, mpv; ffplay fallback)
#   • IBus gives up its own Super+Space (input-method switch) so the keybind reaches openbox
# Packages: sudo apt install rofi mpv
#   bash scripts/setup/desktop-quality-of-life.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
chmod +x "$ROOT/scripts/desktop/app-search.sh" "$ROOT/scripts/desktop/quicklook.sh"
command -v thunar >/dev/null 2>&1 && thunar -q 2>/dev/null || true # Thunar rewrites accels.scm when it exits
ROOT="$ROOT" python3 - <<'PY'
import os, re
root = os.environ['ROOT']; home = os.path.expanduser('~')
# --- openbox keybind
rc = os.path.join(home, '.config/openbox/rc.xml')
if os.path.isfile(rc):
    s = open(rc).read()
    bind = ('  <keybind key="W-space">\n    <action name="Execute"><command>%s/scripts/desktop/app-search.sh</command></action>\n  </keybind>\n' % root)
    s2 = re.sub(r'  <keybind key="W-space">.*?</keybind>\n', '', s, flags=re.S)
    s2 = s2.replace('</keyboard>', bind + '</keyboard>', 1)
    if s2 != s:
        open(rc, 'w').write(s2); print('openbox: W-space keybind written')
else:
    print('openbox: no rc.xml — skipped')
# --- Thunar custom action + Space accelerator
tdir = os.path.join(home, '.config/Thunar'); os.makedirs(tdir, exist_ok=True)
UID = 'highascg-quicklook-1'
uca = os.path.join(tdir, 'uca.xml')
s = open(uca).read() if os.path.isfile(uca) else '<?xml version="1.0" encoding="UTF-8"?>\n<actions>\n</actions>\n'
act = ('<action>\n\t<icon>video-display</icon>\n\t<name>Quick look</name>\n\t<submenu></submenu>\n\t<unique-id>%s</unique-id>\n'
       '\t<command>%s/scripts/desktop/quicklook.sh %%f</command>\n\t<description>Preview the video or image (Space)</description>\n'
       '\t<range></range>\n\t<patterns>*</patterns>\n\t<video-files/>\n\t<image-files/>\n</action>\n') % (UID, root)
s = re.sub(r'<action>(?:(?!</action>).)*<unique-id>%s</unique-id>.*?</action>\n' % UID, '', s, flags=re.S)
s = s.replace('</actions>', act + '</actions>', 1)
open(uca, 'w').write(s); print('thunar: Quick look action written')
acc = os.path.join(tdir, 'accels.scm')
lines = open(acc).read().split('\n') if os.path.isfile(acc) else []
key = '<Actions>/ThunarActions/uca-action-%s' % UID
lines = [l for l in lines if key not in l]
lines.append('(gtk_accel_path "%s" "space")' % key)
open(acc, 'w').write('\n'.join(l for l in lines if l.strip()) + '\n'); print('thunar: Space bound to Quick look')
PY
if command -v gsettings >/dev/null 2>&1 && gsettings get org.freedesktop.ibus.general.hotkey triggers >/dev/null 2>&1; then
	gsettings set org.freedesktop.ibus.general.hotkey triggers "[]" && echo "ibus: Super+Space released"
fi
[ -n "${DISPLAY:-}" ] && command -v openbox >/dev/null 2>&1 && openbox --reconfigure 2>/dev/null && echo "openbox: reconfigured" || true
for p in rofi mpv; do command -v "$p" >/dev/null 2>&1 || echo "MISSING: $p (sudo apt install $p)"; done
