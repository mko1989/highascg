#!/usr/bin/env python3
"""
operator-shape-overlay.py — WO-255 T255.1: shape the Caspar operator_gui screen-consumer window
so only the reported preview rects (compose/timeline/mv-edit) are visible, with an EMPTY input
shape so every click passes through to the fullscreen Firefox GUI beneath it.

Long-running (mirrors tools/runtime/confine-pointer-barriers.py's conventions: log file under
~/.highascg/log/, pid file under ~/.highascg/run/, DISPLAY defaults to :0). Unlike that script,
this one is fed over stdin (mirrors tools/runtime/cef-interactive-x11.py's stdin-JSON idea, but
here the protocol is IN-only — this script never needs to write events back).

Protocol: one JSON object per line on stdin:
    {"monitor": {"x":, "y":, "w":, "h":}, "rects": [[x,y,w,h], ...]}
`monitor` is the operator monitor's rect in ROOT (absolute) pixels. `rects` are RECT-in-monitor
pixels — because the match strategy below only accepts a window whose absolute origin equals
`monitor.x,monitor.y`, monitor-relative and window-relative are the same numbers; no extra
translation happens here. Empty `rects` -> hide the window entirely (empty bounding shape).

Window match strategy (see WO-255 for the research trail — no live xprop was run against this
box's :0 display per the LIVE-box constraint; this is grounded directly in the CasparCG source
tree already checked out on this box, /home/casparcg/caspar-build/src-tree):
  - src/modules/screen/consumer/screen_consumer.cpp creates an `sf::Window` (SFML) whose title is
    `print()` = `config_.name + " " + "[" + channel_index + "|" + format_name + "]"`, and
    `config_.name` defaults to `L"Screen consumer"` (our generator, config-generator-operator-gui.js,
    never sets a `<name>` for the operator_gui channel, so the default stands) — so the title always
    starts with "Screen consumer ".
  - The systemd unit (casparcg-server.service) launches the binary as
    `/home/casparcg/highascg/bin/casparcg`; SFML's X11 backend sets WM_CLASS (both the instance and
    class hints) from the running binary's name by convention, i.e. "casparcg" — this half of the
    match could not be confirmed with a live xprop query (no DISPLAY in the dev/build sandbox this
    script was authored in, and the constraint forbids running this script against the live :0
    display), so it is used only as a secondary signal, never required alone.
  - Geometry ALONE is not suffient: Firefox (kiosk, fullscreen) is deliberately placed at the exact
    same monitor rect as the operator_gui screen consumer (that is the whole point of the shaped
    overlay), so a window matching the monitor rect could just as easily be the Firefox window.
    Firefox's own WM_CLASS is "Navigator" on this box (see GUI_WINDOW_CLASS.firefox in
    src/utils/x-display-session-runtime.js, an existing, working convention for the same Firefox
    ESR install) and is explicitly excluded below as a negative signal.
  - Final rule: candidate top-level windows are filtered to those whose ABSOLUTE geometry equals
    `monitor` exactly, and among those, the one whose title starts with "Screen consumer" OR whose
    WM_CLASS mentions "casparcg" (case-insensitive) AND whose WM_CLASS does NOT mention "navigator"
    or "firefox" wins. If more than one still matches (shouldn't happen), the first is used and a
    warning is logged.

Applies on every stdin line and on a 2s poll (catches a Caspar restart that spawns a NEW window
id at the same geometry — the previous window's custom shape does not carry over to the new one).
Clean exit (restore default/unshaped window state, so a dead helper never leaves Firefox
permanently unclickable) on stdin EOF or SIGTERM.

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

LOG_PATH = os.path.expanduser("~/.highascg/log/operator-shape-overlay.log")
PID_PATH = os.path.expanduser("~/.highascg/run/operator-shape-overlay.pid")

POLL_INTERVAL_SEC = 2.0
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


def is_caspar_screen_consumer(win) -> bool:
    title = window_title(win)
    inst, cls = window_class(win)
    if "navigator" in inst or "navigator" in cls or "firefox" in inst or "firefox" in cls:
        return False
    if title.startswith("Screen consumer"):
        return True
    if "casparcg" in inst or "casparcg" in cls:
        return True
    return False


def absolute_geometry(win, root):
    """Returns (x, y, width, height) in ROOT coordinates, or None if unavailable.

    Only called on DIRECT children of root, whose get_geometry() x/y are already root-relative.
    (win.translate_coords(root, 0, 0) is the INVERSE mapping — live-verified 2026-07-16: it
    returned (-3072,0) for the operator-monitor windows at (3072,0), so the original
    translate-based version never matched the monitor rect and the helper found no window.)
    """
    try:
        geom = win.get_geometry()
        return geom.x, geom.y, geom.width, geom.height
    except Exception:
        return None


def find_consumer_window(root, monitor, channel=None):
    """Return (toplevel, client) for the CasparCG screen consumer on `monitor`, or None.

    Live-verified on this box (2026-07-16): a WM IS running (_NET_SUPPORTING_WM_CHECK present), so
    the caspar client window (title 'Screen consumer [<ch>|<WxH>]', WM_CLASS 'casparcg') sits at
    depth 2 inside an UNNAMED WM frame — a top-level-only enumeration finds zero candidates. The
    signature is matched recursively (depth <= 3); geometry is checked on the TOP-LEVEL ancestor
    (the window the X server actually stacks/composites). When `channel` is given the title must
    contain '[<channel>|' — an exact, geometry-independent match (Firefox shares the monitor rect).
    """
    try:
        toplevels = root.query_tree().children
    except Exception as e:
        log(f"query_tree failed: {e}")
        return None

    def signature_in(win, depth):
        if is_caspar_screen_consumer(win):
            title = window_title(win)
            if channel is not None and f"[{channel}|" not in title:
                return None
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
        log(f"WARNING: {len(candidates)} windows matched monitor rect + caspar signature; using the first")
    return candidates[0]


def apply_shape(pair, rects):
    """pair: (toplevel, client). rects: (x,y,w,h) tuples, window-relative (== monitor-relative).

    Shapes are applied to BOTH the WM frame (toplevel — what the server composites and routes
    input by) and the caspar client inside it: some WMs mirror a client's bounding shape onto the
    frame but none mirror the INPUT shape, so shaping only the client would leave the frame
    catching every click instead of passing them through to Firefox below.
    """
    toplevel, client = pair
    try:
        for win in (toplevel, client):
            win.shape_rectangles(shape.SO.Set, shape.SK.Bounding, 0, 0, 0, list(rects))
            win.shape_rectangles(shape.SO.Set, shape.SK.Input, 0, 0, 0, [])
        toplevel.configure(stack_mode=X.Above)
        return True
    except Exception as e:
        log(f"apply_shape failed: {e}")
        return False


def clear_shape(pair):
    """Restore both windows' default (unshaped, fully clickable) state — used on clean exit so a
    dead helper never leaves Firefox permanently unclickable under a stuck invisible/passthrough
    Caspar window."""
    try:
        for win in pair:
            win.shape_mask(shape.SO.Set, shape.SK.Bounding, 0, 0, X.NONE)
            win.shape_mask(shape.SO.Set, shape.SK.Input, 0, 0, X.NONE)
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
    return monitor, rects, channel


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

    state_monitor = None
    state_rects = []
    state_channel = None
    win = None
    last_poll = 0.0

    try:
        while True:
            now = time.time()
            if state_monitor and (now - last_poll) >= POLL_INTERVAL_SEC:
                last_poll = now
                found = find_consumer_window(root, state_monitor, state_channel)
                if found is not None:
                    is_new = win is None or found[0].id != win[0].id
                    win = found
                    if is_new:
                        log(f"consumer window (re)found: toplevel={win[0].id} client={win[1].id} — (re)applying shape")
                        apply_shape(win, state_rects)
                elif win is not None:
                    log("consumer window no longer present (Caspar restart?) — will re-search")
                    win = None

            r, _, _ = select.select([sys.stdin], [], [], STDIN_SELECT_TIMEOUT_SEC)
            if sys.stdin not in r:
                continue

            line = sys.stdin.readline()
            if line == "":
                log("stdin EOF — exiting")
                break
            line = line.strip()
            if not line:
                continue

            try:
                monitor, rects, channel = parse_line(line)
            except Exception as e:
                log(f"bad stdin line ({e}): {line[:200]}")
                continue

            state_monitor = monitor
            state_rects = rects
            state_channel = channel

            if win is None:
                win = find_consumer_window(root, state_monitor, state_channel)
            if win is not None:
                if not apply_shape(win, state_rects):
                    win = None  # stale handle — force re-search next iteration
            else:
                log("no consumer window matching monitor rect yet (will retry on next update/poll)")

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
