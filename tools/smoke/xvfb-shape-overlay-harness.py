#!/usr/bin/env python3
"""
xvfb-shape-overlay-harness.py — behavioral lock for tools/runtime/operator-shape-overlay.py on a
throwaway Xvfb (driven by smoke-shape-overlay-input-dead.test.js; prints one JSON verdict line).

Boots Xvfb, fabricates the two windows the helper targets (a "firefox" toplevel: WM_CLASS
Navigator + the HIGHASCG-OPERATOR-GUI title marker, at the exact monitor rect; a "caspar"
toplevel: WM_CLASS casparcg, title 'Screen consumer [5|...]', created LAST so it starts stacked
ABOVE firefox — the inverted state), spawns the real helper against that display, feeds one rects
payload, and asserts the 2026-07-16 invariants end-to-end:

  holes_punched        firefox bounding shape has the preview rect subtracted (>1 rectangle)
  caspar_input_empty   consumer INPUT region is EMPTY (input-dead — the ONLY thing that keeps
                       hole clicks off it; X SHAPE intersects input with bounding, so firefox's
                       input=full can never cover its own holes)
  stack_fixed          the watchdog raised firefox back above the consumer (started inverted)
  input_restored       after SIGTERM the consumer's input region is FULL again (exit cleanup)
  bounding_restored    firefox bounding restored to a single full rect on exit

No WM runs on the Xvfb: EWMH client messages are harmless no-ops there, which is fine — this
harness locks the SHAPE + restack behavior; the Openbox-specific EWMH side stays grep-guarded.
"""

import json
import os
import signal
import subprocess
import sys
import time

DISPLAY = ":87"
MON = {"x": 0, "y": 0, "w": 800, "h": 600}
MARKER = "HIGHASCG-OPERATOR-GUI"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HELPER = os.path.join(REPO, "tools/runtime/operator-shape-overlay.py")

verdict = {
    "holes_punched": False,
    "caspar_input_empty": False,
    "stack_fixed": False,
    "input_restored": False,
    "bounding_restored": False,
}


def main() -> int:
    xvfb = subprocess.Popen(
        ["Xvfb", DISPLAY, "-screen", "0", f"{MON['w']}x{MON['h']}x24", "-nolisten", "tcp"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    helper = None
    try:
        sock = f"/tmp/.X11-unix/X{DISPLAY[1:]}"
        for _ in range(100):
            if os.path.exists(sock):
                break
            time.sleep(0.05)

        from Xlib import X, display
        from Xlib.ext import shape

        d = display.Display(DISPLAY)
        root = d.screen().root
        NET_WM_NAME = d.intern_atom("_NET_WM_NAME")
        UTF8 = d.intern_atom("UTF8_STRING")

        def make_window(x, y, w, h, wm_class, title):
            win = root.create_window(
                x, y, w, h, 0, d.screen().root_depth,
                X.InputOutput, X.CopyFromParent,
                background_pixel=d.screen().white_pixel,
                event_mask=0, override_redirect=0,
            )
            win.set_wm_class(wm_class, wm_class)
            win.set_wm_name(title.encode("ascii", "ignore").decode("ascii"))  # legacy prop is latin-1-only
            win.change_property(NET_WM_NAME, UTF8, 8, title.encode("utf-8"))
            win.map()
            d.sync()
            return win

        # firefox FIRST, caspar SECOND -> caspar starts stacked ABOVE (the inverted state the
        # watchdog must fix).
        firefox = make_window(MON["x"], MON["y"], MON["w"], MON["h"], "Navigator", f"{MARKER} — Mozilla Firefox")
        caspar = make_window(0, 0, MON["w"], MON["h"], "casparcg", "Screen consumer [5|800x600]")

        helper = subprocess.Popen(
            [sys.executable, "-u", HELPER],
            env={**os.environ, "DISPLAY": DISPLAY, "HOME": os.environ.get("HOME", "/tmp")},
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        payload = {"monitor": MON, "rects": [[100, 100, 200, 150]], "channel": 5, "titleMarker": MARKER}
        helper.stdin.write((json.dumps(payload) + "\n").encode())
        helper.stdin.flush()

        def input_rect_count(win):
            return len(win.shape_get_rectangles(shape.SK.Input).rectangles)

        def bounding_rect_count(win):
            return len(win.shape_get_rectangles(shape.SK.Bounding).rectangles)

        def stack_order_ok():
            order = [w.id for w in root.query_tree().children]
            try:
                return order.index(firefox.id) > order.index(caspar.id)
            except ValueError:
                return False

        # apply_holes fires on the stdin line; enforce_caspar_under on the poll tick (<=2.5s).
        deadline = time.time() + 8
        while time.time() < deadline:
            d.sync()
            verdict["holes_punched"] = bounding_rect_count(firefox) > 1
            verdict["caspar_input_empty"] = input_rect_count(caspar) == 0
            verdict["stack_fixed"] = stack_order_ok()
            if all((verdict["holes_punched"], verdict["caspar_input_empty"], verdict["stack_fixed"])):
                break
            time.sleep(0.25)

        helper.send_signal(signal.SIGTERM)
        helper.wait(timeout=5)
        helper = None

        d.sync()
        verdict["input_restored"] = input_rect_count(caspar) == 1
        verdict["bounding_restored"] = bounding_rect_count(firefox) == 1
        return 0
    finally:
        if helper is not None:
            helper.kill()
        xvfb.terminate()
        try:
            xvfb.wait(timeout=5)
        except Exception:
            xvfb.kill()
        print(json.dumps(verdict), flush=True)


if __name__ == "__main__":
    sys.exit(main())
