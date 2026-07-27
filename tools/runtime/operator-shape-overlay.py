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
    {"monitor": {"x":, "y":, "w":, "h":}, "rects": [[x,y,w,h], ...], "channel": <int|null>,
     "titleMarker": <str>, "helperOpen": <bool>}
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

import os
import select
import signal
import sys
import time

from Xlib import display

from operator_shape_overlay_lib import (
    OPERATOR_TITLE_MARKER,
    apply_holes,
    clear_shape,
    enforce_caspar_under,
    find_firefox_window,
    init_atoms,
    log,
    parse_line,
    remove_pid_file,
    restore_input,
    write_pid_file,
)

POLL_INTERVAL_SEC = 2.0
STDIN_SELECT_TIMEOUT_SEC = 0.5


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
    init_atoms(d, root)

    state_monitor = None
    state_rects = []
    state_channel = None
    state_title_marker = OPERATOR_TITLE_MARKER
    state_helper_open = False
    win = None
    caspar_pair = None
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
    # WO-269: compress repeated identical stdin lines in the log. WO-262's log-before-parse
    # guarantee is kept for every NEW payload; unchanged repeats are counted and summarized (on
    # change, and at most once per REPEAT_SUMMARY_SEC while the repeats continue).
    REPEAT_SUMMARY_SEC = 60.0
    last_stdin_line = None
    stdin_repeat_count = 0
    last_repeat_summary_ts = 0.0

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
                        apply_holes(win, state_monitor, state_rects, state_channel, state_helper_open)
                elif win is not None:
                    log("firefox window no longer present (restart?) — will re-search")
                    win = None
                # Re-assert the Caspar-under lock every poll tick (idempotent): a restarted
                # consumer window arrives with no EWMH state and a live input region, and must be
                # re-neutralized within 2s. Also runs the stacking watchdog (firefox back on top).
                caspar_pair = enforce_caspar_under(
                    root, state_monitor, state_channel, win,
                    caspar_pair[1].id if caspar_pair else None,
                    helper_open=state_helper_open,
                )

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
                # WO-262 T262.3 heartbeat: log every stdin line the moment it is read, before any
                # window match/shape, so a repeat of this class is diagnosable straight from the
                # log. WO-269: identical repeats are counted, not re-logged (see summary below).
                if line == last_stdin_line:
                    stdin_repeat_count += 1
                    if (now - last_repeat_summary_ts) >= REPEAT_SUMMARY_SEC:
                        log(f"stdin line repeated x{stdin_repeat_count} (unchanged, suppressed)")
                        stdin_repeat_count = 0
                        last_repeat_summary_ts = now
                else:
                    if stdin_repeat_count:
                        log(f"stdin line repeated x{stdin_repeat_count} (unchanged, suppressed)")
                        stdin_repeat_count = 0
                    last_repeat_summary_ts = now
                    last_stdin_line = line
                    log(f"stdin line received: {line[:200]}")
                try:
                    monitor, rects, channel, title_marker, helper_open = parse_line(line)
                except Exception as e:
                    log(f"bad stdin line ({e}): {line[:200]}")
                    continue
                state_monitor = monitor
                state_rects = rects
                state_channel = channel
                state_title_marker = title_marker
                if helper_open != state_helper_open:
                    log(f"helperOpen={helper_open} — kiosk top-assert {'suspended' if helper_open else 'resumed'}")
                state_helper_open = helper_open
                got_update = True

            if not got_update:
                continue

            if win is None:
                win = find_firefox_window(root, state_monitor, state_title_marker)
            if win is not None:
                if not apply_holes(win, state_monitor, state_rects, state_channel, state_helper_open):
                    win = None  # stale handle — force re-search next iteration
            else:
                log("no firefox window matching monitor rect yet (will retry on next update/poll)")

            d.sync()
    except KeyboardInterrupt:
        pass
    finally:
        if win is not None:
            clear_shape(win)
        if caspar_pair is not None:
            restore_input(caspar_pair)
        if win is not None or caspar_pair is not None:
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
