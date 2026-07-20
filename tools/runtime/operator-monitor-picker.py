#!/usr/bin/env python3
"""
operator-monitor-picker.py — WO-290: paint an unmissable "click here to make this your operator
screen" prompt on EVERY connected output and report the single left click that answers it.

Deliberately dumb and short-lived: this is spawned only by src/system/operator-monitor-picker.js,
which has already decided (and logged) that this box has NO operator monitor configured. It maps
one override-redirect window per output, waits for one of
  - left ButtonPress  -> {"action":"select","name":<output>,"rootX":..,"rootY":..}
  - Escape KeyPress   -> {"action":"abandon"}
  - the deadline      -> {"action":"timeout"}
  - SIGTERM/SIGINT    -> {"action":"abandon"}
then destroys every window and exits. Nothing is persisted here — the caller resolves the click to
a GPU port and writes the config, so the decision logic stays offline-testable.

Style/dependency follows tools/runtime/operator-shape-overlay.py (python-xlib, log under
~/.highascg/log/, pid under ~/.highascg/run/, DISPLAY defaults to :0) — no GUI toolkit.

PROTOCOL
  stdin  : ONE JSON line: {"outputs":[{"name":str,"x":int,"y":int,"width":int,"height":int}, ...],
                           "timeoutMs":int}
  stdout : ONE JSON line, the result (above). stdout is the protocol channel and carries NOTHING
           else — all logging goes to the log file and stderr.

Override-redirect is used so no window manager can reparent, resize or refuse the prompts, and so
this works on a bare X session where nothing else is running yet. The keyboard is grabbed for the
lifetime of the prompt (Esc must work without a focused window) and always released in `finally`.
"""

import json
import os
import select
import signal
import sys
import time

from Xlib import X, XK, display

LOG_PATH = os.path.expanduser("~/.highascg/log/operator-monitor-picker.log")
PID_PATH = os.path.expanduser("~/.highascg/run/operator-monitor-picker.pid")

DEFAULT_TIMEOUT_MS = 120_000
LOOP_SLEEP_SEC = 0.05

# Deep blue panel, white text, hot border — must read as "system prompt", not as content.
COLOR_BG = "#10284b"
COLOR_FG = "#ffffff"
COLOR_ACCENT = "#ff9d2e"

HEADLINE = "CLICK HERE"
SUBLINE = "to make this your operator screen"
FOOTLINE = "Esc cancels  -  no click within {secs}s cancels"

# Core X11 fonts, biggest first. `fixed` is the last-resort alias every X server ships.
FONT_CANDIDATES = [
    "-*-helvetica-bold-r-normal--34-*-*-*-*-*-iso8859-1",
    "-*-dejavu sans-bold-r-normal--34-*-*-*-*-*-iso8859-1",
    "-*-*-bold-r-normal--34-*-*-*-*-*-iso8859-1",
    "-*-*-bold-r-normal--24-*-*-*-*-*-iso8859-1",
    "10x20",
    "9x15",
    "fixed",
]


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} [pid={os.getpid()}] {msg}\n"
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    # NEVER stdout: that channel is the single JSON result line.
    print(msg, file=sys.stderr, flush=True)


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


def emit(obj) -> None:
    """The one and only stdout write."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def read_request(timeout_sec: float = 10.0):
    """Read the single JSON request line from stdin (raw fd + own buffer, per the
    operator-shape-overlay.py note about buffered readline() stranding payloads)."""
    fd = sys.stdin.fileno()
    buf = b""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.25)
        if fd not in r:
            continue
        chunk = os.read(fd, 65536)
        if chunk == b"":
            break
        buf += chunk
        if b"\n" in buf:
            line = buf.split(b"\n", 1)[0]
            return json.loads(line.decode("utf-8", "replace"))
    if buf.strip():
        return json.loads(buf.decode("utf-8", "replace"))
    raise ValueError("no request line on stdin")


def parse_request(obj):
    outputs = []
    for o in obj.get("outputs") or []:
        name = str(o.get("name") or "").strip()
        w = int(o.get("width") or 0)
        h = int(o.get("height") or 0)
        if not name or w <= 0 or h <= 0:
            continue
        outputs.append(
            {"name": name, "x": int(o.get("x") or 0), "y": int(o.get("y") or 0), "width": w, "height": h}
        )
    timeout_ms = int(obj.get("timeoutMs") or DEFAULT_TIMEOUT_MS)
    if timeout_ms <= 0:
        timeout_ms = DEFAULT_TIMEOUT_MS
    return outputs, timeout_ms


def alloc(colormap, spec, fallback):
    try:
        return colormap.alloc_named_color(spec).pixel
    except Exception:
        return fallback


def open_font(d):
    for pattern in FONT_CANDIDATES:
        try:
            return d.open_font(pattern)
        except Exception:
            continue
    log("warning: no core X font opened — text will use the server default")
    return None


def text_width(font, text: str) -> int:
    if font is not None:
        try:
            return int(font.query_text_extents(text.encode("iso8859-1", "replace")).overall_width)
        except Exception:
            pass
    return len(text) * 9


def draw_prompt(win, gcs, font, out, secs):
    """Repaint one prompt window. Called on Expose (and once right after mapping)."""
    w, h = out["width"], out["height"]
    gc_bg, gc_fg, gc_accent = gcs
    try:
        win.fill_rectangle(gc_bg, 0, 0, w, h)
        # Thick accent frame — the prompt must be impossible to mistake for content.
        border = max(8, min(w, h) // 60)
        for i in range(border):
            win.rectangle(gc_accent, i, i, w - 1 - 2 * i, h - 1 - 2 * i)

        lines = [
            (HEADLINE, gc_accent, 0),
            (SUBLINE, gc_fg, 1),
            (out["name"], gc_fg, 2),
            (FOOTLINE.format(secs=secs), gc_fg, 3),
        ]
        step = max(28, h // 12)
        top = h // 2 - step
        for text, gc, row in lines:
            tw = text_width(font, text)
            win.draw_text(gc, max(border + 8, (w - tw) // 2), top + row * step, text.encode("iso8859-1", "replace"))
    except Exception as e:
        log(f"draw failed on {out['name']}: {e}")


def main() -> int:
    display_name = os.environ.get("DISPLAY", ":0")
    write_pid_file()

    try:
        outputs, timeout_ms = parse_request(read_request())
    except Exception as e:
        log(f"ERROR: bad request on stdin: {e}")
        remove_pid_file()
        emit({"action": "abandon", "reason": "bad_request"})
        return 1

    if not outputs:
        log("ERROR: request contained no usable outputs")
        remove_pid_file()
        emit({"action": "abandon", "reason": "no_outputs"})
        return 1

    log(f"picker starting, DISPLAY={display_name}, outputs={[o['name'] for o in outputs]}, timeout={timeout_ms}ms")

    # SIGTERM/SIGINT must leave the box exactly as it was: SystemExit unwinds into the `finally`
    # below, which destroys every window before the result line is written.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))

    try:
        d = display.Display(display_name)
    except Exception as e:
        log(f"ERROR: XOpenDisplay failed: {e}")
        remove_pid_file()
        emit({"action": "abandon", "reason": "no_display"})
        return 1

    screen = d.screen()
    root = screen.root
    colormap = screen.default_colormap
    bg = alloc(colormap, COLOR_BG, screen.black_pixel)
    fg = alloc(colormap, COLOR_FG, screen.white_pixel)
    accent = alloc(colormap, COLOR_ACCENT, screen.white_pixel)
    font = open_font(d)

    windows = {}
    grabbed = False
    result = {"action": "timeout"}
    secs = max(1, round(timeout_ms / 1000))

    try:
        for out in outputs:
            win = root.create_window(
                out["x"],
                out["y"],
                out["width"],
                out["height"],
                0,
                X.CopyFromParent,
                X.InputOutput,
                X.CopyFromParent,
                background_pixel=bg,
                event_mask=(X.ExposureMask | X.ButtonPressMask | X.KeyPressMask),
                override_redirect=True,
            )
            gc_kwargs = {"foreground": fg, "background": bg}
            if font is not None:
                gc_kwargs["font"] = font
            gcs = (
                win.create_gc(foreground=bg, background=bg),
                win.create_gc(**gc_kwargs),
                win.create_gc(**{**gc_kwargs, "foreground": accent}),
            )
            win.map()
            win.configure(stack_mode=X.Above)
            windows[win.id] = (win, gcs, out)
        d.sync()

        for win, gcs, out in windows.values():
            draw_prompt(win, gcs, font, out, secs)
        d.sync()

        # Esc has to work with nothing focused (override-redirect windows get no WM focus).
        try:
            d.grab_keyboard(root, True, X.GrabModeAsync, X.GrabModeAsync, X.CurrentTime)
            grabbed = True
        except Exception as e:
            log(f"warning: keyboard grab failed ({e}); Esc only works on a focused prompt")

        deadline = time.time() + timeout_ms / 1000.0
        while time.time() < deadline:
            if d.pending_events() == 0:
                time.sleep(LOOP_SLEEP_SEC)
                continue
            e = d.next_event()
            if e.type == X.Expose:
                hit = windows.get(getattr(e.window, "id", None))
                if hit:
                    draw_prompt(hit[0], hit[1], font, hit[2], secs)
                continue
            if e.type == X.ButtonPress and getattr(e, "detail", 0) == 1:
                hit = windows.get(getattr(e.window, "id", None))
                name = hit[2]["name"] if hit else ""
                result = {"action": "select", "name": name, "rootX": int(e.root_x), "rootY": int(e.root_y)}
                log(f"left click on {name or '?'} @ root {e.root_x},{e.root_y}")
                break
            if e.type == X.KeyPress:
                try:
                    keysym = d.keycode_to_keysym(e.detail, 0)
                except Exception:
                    keysym = 0
                if keysym == XK.XK_Escape:
                    result = {"action": "abandon", "reason": "escape"}
                    log("Esc — abandoning, nothing changed")
                    break
        else:
            log(f"no click within {secs}s — abandoning, nothing changed")
    except SystemExit:
        result = {"action": "abandon", "reason": "signal"}
        log("signal — abandoning, nothing changed")
    except Exception as e:
        result = {"action": "abandon", "reason": "error"}
        log(f"ERROR: {e}")
    finally:
        if grabbed:
            try:
                d.ungrab_keyboard(X.CurrentTime)
            except Exception:
                pass
        for win, _gcs, _out in windows.values():
            try:
                win.unmap()
                win.destroy()
            except Exception:
                pass
        try:
            d.sync()
            d.close()
        except Exception:
            pass
        remove_pid_file()

    emit(result)
    log(f"picker exiting: {result.get('action')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
