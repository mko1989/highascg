#!/usr/bin/env python3
"""
confine-cursor.py — confine the mouse pointer to a single monitor on X11.

Usage:
    confine-cursor.py [OUTPUT_NAME]

Requires: python3-xlib (apt install python3-xlib)

NVIDIA + multi-head: confine_to must be an InputOutput child window (InputOnly → BadWindow).
"""

import os
import re
import subprocess
import sys
import time

from Xlib import X, display

LOG_PATH = os.path.expanduser("~/.highascg/log/confine-cursor.log")


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n"
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    print(msg, flush=True)


def get_monitor_geometry(output_name=None):
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":0")
    out = subprocess.check_output(["xrandr", "--query"], env=env).decode()
    chosen = None
    for line in out.splitlines():
        if " connected" not in line:
            continue
        name = line.split()[0]
        m = re.search(r"(\d+)x(\d+)\+(\d+)\+(\d+)", line)
        if not m:
            continue
        geom = tuple(map(int, m.groups()))  # w, h, x, y
        if output_name:
            if name == output_name:
                chosen = (name, geom)
                break
        else:
            chosen = (name, geom)
            break
    return chosen


def grab_status_name(status: int) -> str:
    names = {
        X.GrabSuccess: "GrabSuccess",
        X.AlreadyGrabbed: "AlreadyGrabbed",
        X.GrabInvalidTime: "GrabInvalidTime",
        X.GrabNotViewable: "GrabNotViewable",
        X.GrabFrozen: "GrabFrozen",
    }
    return names.get(status, f"status={status}")


def main():
    output_name = sys.argv[1] if len(sys.argv) > 1 else None
    os.environ.setdefault("DISPLAY", ":0")

    hit = get_monitor_geometry(output_name)
    if not hit:
        log(f"ERROR: no connected output matching {output_name!r}")
        sys.exit(1)

    out_name, geom = hit
    w, h, x, y = geom
    log(f"Confining cursor to {out_name} {w}x{h}+{x}+{y}")

    d = display.Display()
    screen = d.screen()
    root = screen.root

    cx = x + max(0, w // 2)
    cy = y + max(0, h // 2)
    try:
        root.warp_pointer(cx, cy)
        d.sync()
    except Exception as e:
        log(f"warp_pointer warning: {e}")

    # InputOutput + empty input shape: NVIDIA rejects InputOnly (BadWindow on grab).
    # ParentRelative + no input shape → invisible, does not block Caspar mouse events.
    win = root.create_window(
        x,
        y,
        w,
        h,
        0,
        X.CopyFromParent,
        X.InputOutput,
        background_pixmap=X.ParentRelative,
        override_redirect=1,
        event_mask=0,
    )
    win.map()
    try:
        from Xlib.ext import shape

        shape.rectangles(win, shape.SO.Set, shape.SK.Input, 0, 0, 0, [])
    except Exception as e:
        log(f"shape input mask warning: {e}")
    d.sync()

    result = X.GrabNotViewable
    for attempt in range(1, 8):
        try:
            result = root.grab_pointer(
                True,
                0,
                X.GrabModeAsync,
                X.GrabModeAsync,
                win,
                X.NONE,
                X.CurrentTime,
            )
            d.sync()
        except Exception as e:
            log(f"grab attempt {attempt} exception: {e}")
            result = X.GrabNotViewable
        if result == X.GrabSuccess:
            break
        log(f"grab attempt {attempt}: {grab_status_name(result)}")
        time.sleep(0.25)
        try:
            root.warp_pointer(cx, cy)
            d.sync()
        except Exception:
            pass

    if result != X.GrabSuccess:
        log(f"ERROR: pointer grab failed ({grab_status_name(result)})")
        sys.exit(1)

    log("Pointer grab active")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            root.ungrab_pointer(X.CurrentTime)
            d.sync()
        except Exception as e:
            log(f"ungrab warning: {e}")
        try:
            win.destroy()
        except Exception:
            pass
        log("Pointer grab released")


if __name__ == "__main__":
    main()
