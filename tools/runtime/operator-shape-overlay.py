#!/usr/bin/env python3
"""
operator-shape-overlay.py — WO-255 T255.1 / WO-262 pivot: shape the operator_gui FIREFOX kiosk
window so the reported preview rects (compose/timeline/mv-edit) are punched out as HOLES, letting
the Caspar screen-consumer window BELOW show video through them. Firefox keeps normal click input
everywhere it is still visible (outside the holes); a click inside a hole falls through to the
(inert, display-only) Caspar window — the accepted WO-262 tradeoff.

WO-262 INVERSION (why this now targets Firefox, not the Caspar consumer): the original design
shaped the always-on-top Caspar consumer to show only the preview rects and set an EMPTY input
shape so clicks passed through to Firefox below. Live-proven failure: the interactive Firefox
window ALWAYS wins stacking on click (it gets focus + raises above the always-on-top Caspar
window), so the video vanished the instant the operator clicked anything. Video-window-on-top is
fundamentally wrong. So we INVERT: leave Caspar as a plain window UNDER Firefox and instead punch
holes in Firefox so the video shows through — Firefox staying on top is now exactly what we want.
(Server follow-up, tracked separately: config-generator-operator-gui.js should set
<always-on-top>false for the operator_gui consumer and let it sit below Firefox.)

Long-running (mirrors tools/runtime/confine-pointer-barriers.py's conventions: log file under
~/.highascg/log/, pid file under ~/.highascg/run/, DISPLAY defaults to :0). Fed over stdin
(protocol is IN-only — this script never writes events back).

Protocol: one JSON object per line on stdin:
    {"monitor": {"x":, "y":, "w":, "h":}, "rects": [[x,y,w,h], ...], "channel": <int|null>}
`monitor` is the operator monitor's rect in ROOT (absolute) pixels. `rects` are RECT-in-monitor
pixels — because the match strategy below only accepts a window whose absolute origin equals
`monitor.x,monitor.y`, monitor-relative and window-relative are the same numbers; no extra
translation happens here. Empty `rects` -> RESTORE Firefox to unshaped (fill the holes) — this is
how interaction-suppression lets a modal render whole over the preview areas. `channel` is carried
for protocol compatibility with the JS feeder but is not used to match Firefox (Firefox has no
Caspar channel; the WM_CLASS signature is unambiguous).

Window match strategy:
  - The operator GUI is a single fullscreen firefox-esr --kiosk instance placed at the exact
    operator monitor rect. Its WM_CLASS is "Navigator" (instance) / "Navigator" or "firefox"
    (class) on this box — see GUI_WINDOW_CLASS.firefox in src/utils/x-display-session-runtime.js,
    an existing, working convention for the same Firefox ESR install. This is the INVERSE of the
    retired Caspar matcher, which used the same "navigator"/"firefox" tokens as a NEGATIVE signal.
  - A WM is running, so Firefox sits at depth <= 3 inside an unnamed WM frame; geometry is checked
    on the TOP-LEVEL ancestor (the window the X server stacks/composites), and the firefox
    signature is matched recursively inside it (same recursive matcher shape as WO-255, signature
    flipped). Caspar's consumer also sits at the monitor rect but has no firefox-class descendant,
    so it is never matched.

Applies on every stdin line and on a 2s poll (catches a Firefox restart that spawns a NEW window
id at the same geometry — the previous window's holes do not carry over). Clean exit restores
Firefox to unshaped (holes filled) so a dead helper never leaves permanent dead regions.

Usage: operator-shape-overlay.py   (no CLI args — everything comes over stdin)
"""

import json
import os
import select
import signal
import sys
import time

from Xlib import X, display
from Xlib.ext import shape
from Xlib.protocol import event

LOG_PATH = os.path.expanduser("~/.highascg/log/operator-shape-overlay.log")
PID_PATH = os.path.expanduser("~/.highascg/run/operator-shape-overlay.pid")

POLL_INTERVAL_SEC = 2.0

# URL-tied guard: only a Firefox whose window title contains this marker (set by the operator page
# in client/lib/operator-gui-mode.js — kept in sync there) is shaped. Prevents holing OTHER firefox
# windows: the WO-258 browser sources (also firefox, on the operator monitor during "Interact"),
# or any browser the operator opens. X11 exposes no URL property, so the page title stands in for it.
OPERATOR_TITLE_MARKER = "HIGHASCG-OPERATOR-GUI"

# Interned lazily in main() once the display is open; window_title() falls back to legacy WM_NAME
# when these are still None (get_full_property tolerates a bad atom via the surrounding try/except).
_ATOM_NET_WM_NAME = None
_ATOM_UTF8_STRING = None
_ATOM_NET_WM_STATE = None
_ATOM_NET_WM_STATE_ABOVE = None
_ATOM_NET_WM_STATE_BELOW = None
_DISPLAY = None
_ROOT = None
STDIN_SELECT_TIMEOUT_SEC = 0.5


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} [pid={os.getpid()}] {msg}\n"
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    print(msg, flush=True)


def write_pid_file() -> None:
    try:
        os.makedirs(os.path.dirname(PID_PATH), exist_ok=True)
        with open(PID_PATH, "w", encoding="utf-8") as f:
            f.write(f"{os.getpid()}\n")
    except OSError:
        pass


def remove_pid_file() -> None:
    try:
        os.remove(PID_PATH)
    except OSError:
        pass


def window_title(win) -> str:
    # Firefox sets its page title in _NET_WM_NAME (EWMH, UTF-8) and leaves the legacy WM_NAME empty
    # (live-verified 2026-07-16: WM_NAME=b'' but _NET_WM_NAME='HIGHASCG-OPERATOR-GUI — Mozilla
    # Firefox'). Reading only get_wm_name() saw '' and the title-marker match always failed → no
    # holes. Prefer _NET_WM_NAME, fall back to the legacy name.
    try:
        prop = win.get_full_property(_ATOM_NET_WM_NAME, _ATOM_UTF8_STRING)
        if prop and prop.value:
            val = prop.value
            return val.decode("utf-8", "replace") if isinstance(val, (bytes, bytearray)) else str(val)
    except Exception:
        pass
    try:
        name = win.get_wm_name()
        return name if isinstance(name, str) else ""
    except Exception:
        return ""


def window_class(win):
    try:
        wc = win.get_wm_class()
        if not wc:
            return "", ""
        return (wc[0] or "").lower(), (wc[1] or "").lower()
    except Exception:
        return "", ""


def is_operator_firefox(win, title_marker=OPERATOR_TITLE_MARKER) -> bool:
    """WO-262: firefox by WM_CLASS. WO-263 follow-up: AND the window title must carry `title_marker`
    (the operator page forces it) — WM_CLASS alone would also match the WO-258 browser-source
    firefoxes and any other firefox, which must NEVER be shaped. An empty/None marker disables the
    title requirement (back-compat)."""
    inst, cls = window_class(win)
    if not ("navigator" in inst or "navigator" in cls or "firefox" in inst or "firefox" in cls):
        return False
    if title_marker:
        return title_marker in window_title(win)
    return True


def absolute_geometry(win, root):
    """Returns (x, y, width, height) in ROOT coordinates, or None if unavailable.

    Only called on DIRECT children of root, whose get_geometry() x/y are already root-relative.
    (win.translate_coords(root, 0, 0) is the INVERSE mapping — live-verified 2026-07-16: it
    returned (-3072,0) for the operator-monitor windows at (3072,0), so a translate-based version
    never matched the monitor rect and the helper found no window.)
    """
    try:
        geom = win.get_geometry()
        return geom.x, geom.y, geom.width, geom.height
    except Exception:
        return None


def find_firefox_window(root, monitor, title_marker=OPERATOR_TITLE_MARKER):
    """Return (toplevel, client) for the operator kiosk Firefox on `monitor`, or None.

    Geometry is checked on the TOP-LEVEL ancestor (what the X server stacks/composites); the
    firefox WM_CLASS signature is matched recursively (depth <= 3) because a WM reparents Firefox
    inside an unnamed frame. Caspar's consumer shares the monitor rect but has no firefox-class
    descendant, so it is never returned.
    """
    try:
        toplevels = root.query_tree().children
    except Exception as e:
        log(f"query_tree failed: {e}")
        return None

    def signature_in(win, depth):
        if is_operator_firefox(win, title_marker):
            return win
        if depth >= 3:
            return None
        try:
            kids = win.query_tree().children
        except Exception:
            return None
        for k in kids:
            hit = signature_in(k, depth + 1)
            if hit is not None:
                return hit
        return None

    candidates = []
    for top in toplevels:
        try:
            attrs = top.get_attributes()
        except Exception:
            continue
        if attrs.map_state != X.IsViewable:
            continue
        geom = absolute_geometry(top, root)
        if not geom:
            continue
        x, y, w, h = geom
        if x != monitor["x"] or y != monitor["y"] or w != monitor["w"] or h != monitor["h"]:
            continue
        client = signature_in(top, 0)
        if client is not None:
            candidates.append((top, client))

    if not candidates:
        return None
    if len(candidates) > 1:
        log(f"WARNING: {len(candidates)} firefox windows matched monitor rect; using the first")
    return candidates[0]


def set_net_wm_state(win, state_atom, add=True):
    """EWMH _NET_WM_STATE client message to root (WM is Openbox; ABOVE/BELOW both in _NET_SUPPORTED).
    MUST target the CLIENT window Openbox manages, NOT the WM frame — a message for the frame is
    silently ignored (the 2026-07-16 'ABOVE did not stick' bug: it was sent for the frame)."""
    if _ATOM_NET_WM_STATE is None or state_atom is None or _ROOT is None or _DISPLAY is None:
        return
    try:
        data = [1 if add else 0, state_atom, 0, 1, 0]  # action(ADD/REMOVE), prop1, prop2=0, source=app
        ev = event.ClientMessage(window=win, client_type=_ATOM_NET_WM_STATE, data=(32, data))
        _ROOT.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        _DISPLAY.flush()
    except Exception as e:
        log(f"set_net_wm_state failed: {e}")


def find_caspar_consumer(root, monitor, channel):
    """Find the operator_gui Caspar screen-consumer CLIENT window (WM_CLASS 'casparcg', title
    'Screen consumer [<channel>|...]') so it can be forced BELOW Firefox. The operator_gui channel is
    unique, so match by the channel signature in title/class ANYWHERE in the tree — NOT by exact
    monitor geometry (Openbox may frame/place the consumer at a different origin than the monitor
    rect, unlike Firefox which we position exactly). `monitor` is unused; kept for call symmetry."""
    def walk(win, depth):
        title = window_title(win)
        inst, cls = window_class(win)
        firefoxy = "navigator" in inst or "navigator" in cls or "firefox" in inst or "firefox" in cls
        is_caspar = (not firefoxy) and ("casparcg" in inst or "casparcg" in cls or title.startswith("Screen consumer"))
        sig = f"[{channel}|" if channel is not None else None
        if is_caspar and (sig is None or sig in title or sig in cls):
            return win
        if depth >= 4:
            return None
        try:
            for k in win.query_tree().children:
                hit = walk(k, depth + 1)
                if hit is not None:
                    return hit
        except Exception:
            return None
        return None

    try:
        for top in root.query_tree().children:
            hit = walk(top, 0)
            if hit is not None:
                return hit
    except Exception:
        return None
    return None


def lock_window_above(win):
    """Keep the Firefox CLIENT window above others (EWMH _NET_WM_STATE_ABOVE)."""
    set_net_wm_state(win, _ATOM_NET_WM_STATE_ABOVE, add=True)


def apply_holes(pair, monitor, rects, channel=None):
    """pair: (toplevel, client). Punch `rects` (window-relative == monitor-relative px) as HOLES in
    Firefox's BOUNDING shape (visual): SET bounding to the full window rect, then SUBTRACT each
    preview rect so the Caspar consumer below shows through.

    Crucially the INPUT shape is SET to the FULL window (not the holed bounding). Bounding and input
    are independent SHAPE regions: Firefox is DRAWN with holes but RECEIVES clicks everywhere — a
    'show-through but still clickable' layer. Otherwise a click in a hole fell through to the Caspar
    window, and the WM raised it over Firefox, burying the GUI (owner, 2026-07-16). With input full,
    clicks over the video hit the (inert) GUI area and Caspar is never raised. Tradeoff: you cannot
    click the video itself — fine, previews are display-only, chrome/drag handles sit below.

    Empty `rects` -> restore unshaped (bounding + input reset) so a modal can render whole over
    preview areas. Applied to BOTH the WM frame (toplevel) and the firefox client inside it.
    """
    toplevel, client = pair
    full = (0, 0, int(monitor["w"]), int(monitor["h"]))
    try:
        for win in (toplevel, client):
            if not rects:
                win.shape_mask(shape.SO.Set, shape.SK.Bounding, 0, 0, X.NONE)
                win.shape_mask(shape.SO.Set, shape.SK.Input, 0, 0, X.NONE)
                continue
            win.shape_rectangles(shape.SO.Set, shape.SK.Bounding, 0, 0, 0, [full])
            for r in rects:
                win.shape_rectangles(shape.SO.Subtract, shape.SK.Bounding, 0, 0, 0, [tuple(r)])
            # INPUT = FULL window: catch clicks over the holes so they never reach Caspar below.
            win.shape_rectangles(shape.SO.Set, shape.SK.Input, 0, 0, 0, [full])
        # Keep Firefox on top — with holes punched, that is exactly what shows the video through.
        # Persistent (_NET_WM_STATE_ABOVE) so a click routed through a hole to the Caspar window
        # below cannot let the WM raise it over Firefox and hide the GUI.
        toplevel.configure(stack_mode=X.Above)
        lock_window_above(toplevel)
        return True
    except Exception as e:
        log(f"apply_holes failed: {e}")
        return False


def clear_shape(pair):
    """Restore both windows' default (unshaped, no holes) bounding state — used on clean exit so a
    dead helper never leaves Firefox with permanent holes (dead regions the operator can't click).
    Only the bounding shape is reset; the input shape was never explicitly set."""
    try:
        for win in pair:
            win.shape_mask(shape.SO.Set, shape.SK.Bounding, 0, 0, X.NONE)
        return True
    except Exception as e:
        log(f"clear_shape failed: {e}")
        return False


def parse_line(line: str):
    obj = json.loads(line)
    m = obj.get("monitor") or {}
    monitor = {
        "x": int(m.get("x", 0)),
        "y": int(m.get("y", 0)),
        "w": int(m.get("w", 0)),
        "h": int(m.get("h", 0)),
    }
    rects = []
    for r in obj.get("rects") or []:
        rects.append((int(r[0]), int(r[1]), int(r[2]), int(r[3])))
    channel = obj.get("channel")
    channel = int(channel) if channel is not None else None
    title_marker = obj.get("titleMarker")
    title_marker = str(title_marker) if title_marker else OPERATOR_TITLE_MARKER
    return monitor, rects, channel, title_marker


def main() -> int:
    display_name = os.environ.get("DISPLAY", ":0")
    write_pid_file()
    log(f"operator-shape-overlay starting, DISPLAY={display_name}")

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    try:
        d = display.Display(display_name)
    except Exception as e:
        log(f"ERROR: XOpenDisplay failed: {e}")
        remove_pid_file()
        return 1

    if not d.has_extension("SHAPE"):
        log("ERROR: SHAPE extension unavailable on this X server")
        remove_pid_file()
        return 1

    root = d.screen().root

    global _ATOM_NET_WM_NAME, _ATOM_UTF8_STRING
    global _ATOM_NET_WM_STATE, _ATOM_NET_WM_STATE_ABOVE, _ATOM_NET_WM_STATE_BELOW, _DISPLAY, _ROOT
    _DISPLAY = d
    _ROOT = root
    try:
        _ATOM_NET_WM_NAME = d.intern_atom("_NET_WM_NAME")
        _ATOM_UTF8_STRING = d.intern_atom("UTF8_STRING")
    except Exception as e:
        log(f"warning: could not intern _NET_WM_NAME atoms ({e}); title match falls back to WM_NAME")
    try:
        _ATOM_NET_WM_STATE = d.intern_atom("_NET_WM_STATE")
        _ATOM_NET_WM_STATE_ABOVE = d.intern_atom("_NET_WM_STATE_ABOVE")
        _ATOM_NET_WM_STATE_BELOW = d.intern_atom("_NET_WM_STATE_BELOW")
    except Exception as e:
        log(f"warning: could not intern _NET_WM_STATE atoms ({e}); persistent always-on-top disabled")

    state_monitor = None
    state_rects = []
    state_channel = None
    state_title_marker = OPERATOR_TITLE_MARKER
    win = None
    last_poll = 0.0

    # WO-262: read stdin with os.read (raw fd) + our own newline buffer, NOT a buffered
    # sys.stdin.readline(). select() reports readiness on the fd, but a buffered readline() pulls a
    # whole OS-pipe chunk (possibly SEVERAL newline-terminated payloads) into Python's userspace
    # buffer and hands back only the first line; the next select() then sees an EMPTY fd and strands
    # the remaining line(s) until more bytes happen to arrive. That lost the 2nd payload after spawn
    # (e.g. an empty boot payload written just before the real rects) -> the window stayed shaped
    # per the first payload with nothing in the log. Reproduced on Xvfb :78.
    stdin_fd = sys.stdin.fileno()
    stdin_buf = b""

    try:
        while True:
            now = time.time()
            if state_monitor and (now - last_poll) >= POLL_INTERVAL_SEC:
                last_poll = now
                found = find_firefox_window(root, state_monitor, state_title_marker)
                if found is not None:
                    is_new = win is None or found[0].id != win[0].id
                    win = found
                    if is_new:
                        log(f"firefox window (re)found: toplevel={win[0].id} client={win[1].id} — (re)applying holes")
                        apply_holes(win, state_monitor, state_rects, state_channel)
                elif win is not None:
                    log("firefox window no longer present (restart?) — will re-search")
                    win = None

            r, _, _ = select.select([stdin_fd], [], [], STDIN_SELECT_TIMEOUT_SEC)
            if stdin_fd not in r:
                continue

            try:
                chunk = os.read(stdin_fd, 65536)
            except (BlockingIOError, InterruptedError):
                continue
            if chunk == b"":
                log("stdin EOF — exiting")
                break
            stdin_buf += chunk
            parts = stdin_buf.split(b"\n")
            stdin_buf = parts.pop()  # trailing partial line (b"" when chunk ended on a newline)

            got_update = False
            for raw in parts:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                # WO-262 T262.3 heartbeat: log EVERY stdin line the moment it is read, before any
                # window match/shape, so a repeat of this class is diagnosable straight from the log.
                log(f"stdin line received: {line[:200]}")
                try:
                    monitor, rects, channel, title_marker = parse_line(line)
                except Exception as e:
                    log(f"bad stdin line ({e}): {line[:200]}")
                    continue
                state_monitor = monitor
                state_rects = rects
                state_channel = channel
                state_title_marker = title_marker
                got_update = True

            if not got_update:
                continue

            if win is None:
                win = find_firefox_window(root, state_monitor, state_title_marker)
            if win is not None:
                if not apply_holes(win, state_monitor, state_rects, state_channel):
                    win = None  # stale handle — force re-search next iteration
            else:
                log("no firefox window matching monitor rect yet (will retry on next update/poll)")

            d.sync()
    except KeyboardInterrupt:
        pass
    finally:
        if win is not None:
            clear_shape(win)
            try:
                d.sync()
            except Exception:
                pass
        try:
            d.close()
        except Exception:
            pass
        remove_pid_file()
        log("operator-shape-overlay exiting")

    return 0


if __name__ == "__main__":
    sys.exit(main())
