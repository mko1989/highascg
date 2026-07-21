#!/usr/bin/env python3
"""
confine-pointer-barriers.py — confine cursor to one monitor (Caspar-safe).

1. XFixes pointer barriers on all four edges (hard stop at boundaries).
2. Warp watchdog polls every 50ms and pulls the pointer back if it escapes
   (NVIDIA multi-head sometimes lets the pointer slip past barriers).

Must stay running — barriers are destroyed when this process exits.

Usage: confine-pointer-barriers.py [OUTPUT_NAME]
"""

import ctypes
import ctypes.util
import os
import re
import subprocess
import sys
import time

LOG_PATH = os.path.expanduser("~/.highascg/log/confine-pointer-barriers.log")
PID_PATH = os.path.expanduser("~/.highascg/run/confine-pointer-barriers.pid")

BARRIER_POSITIVE_X = 1
BARRIER_NEGATIVE_X = 2
BARRIER_POSITIVE_Y = 4
BARRIER_NEGATIVE_Y = 8

"""How often to re-read the output geometry. The layout can move under a running confine (apply
layout, hotplug, mode change) and a stale rect means the watchdog drags the pointer off-screen."""
GEOMETRY_POLL_SEC = 2.0

libX11 = ctypes.CDLL(ctypes.util.find_library("X11"), use_errno=True)
libXfixes = ctypes.CDLL(ctypes.util.find_library("Xfixes"), use_errno=True)

libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XCloseDisplay.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.restype = ctypes.c_ulong
libX11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
libX11.XQueryPointer.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_ulong),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_ulong),
]
libX11.XQueryPointer.restype = ctypes.c_int
libX11.XWarpPointer.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_ulong,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_uint,
    ctypes.c_uint,
    ctypes.c_int,
    ctypes.c_int,
]

libXfixes.XFixesQueryExtension.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
]
libXfixes.XFixesCreatePointerBarrier.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_void_p,
]
libXfixes.XFixesCreatePointerBarrier.restype = ctypes.c_ulong
libXfixes.XFixesDestroyPointerBarrier.argtypes = [ctypes.c_void_p, ctypes.c_ulong]


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} [pid={os.getpid()}] {msg}\n"
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    print(msg, flush=True)


def write_pid_file(output_name: str) -> None:
    try:
        os.makedirs(os.path.dirname(PID_PATH), exist_ok=True)
        with open(PID_PATH, "w", encoding="utf-8") as f:
            f.write(f"{os.getpid()} {output_name}\n")
    except OSError:
        pass


def remove_pid_file() -> None:
    try:
        os.remove(PID_PATH)
    except OSError:
        pass


def get_monitor_geometry(output_name=None):
    env = os.environ.copy()
    env.setdefault("DISPLAY", ":0")
    out = subprocess.check_output(["xrandr", "--query"], env=env).decode()
    for line in out.splitlines():
        if " connected" not in line:
            continue
        name = line.split()[0]
        m = re.search(r"(\d+)x(\d+)\+(\d+)\+(\d+)", line)
        if not m:
            continue
        geom = tuple(map(int, m.groups()))
        if output_name:
            if name == output_name:
                return name, geom
        else:
            return name, geom
    return None, None


def create_edge_barriers(dpy, root, x, y, w, h):
    barriers = []
    specs = [
        ("left", x, y, x, y + h, BARRIER_NEGATIVE_X),
        ("right", x + w, y, x + w, y + h, BARRIER_POSITIVE_X),
        ("top", x, y, x + w, y, BARRIER_NEGATIVE_Y),
        ("bottom", x, y + h, x + w, y + h, BARRIER_POSITIVE_Y),
    ]
    for edge, x1, y1, x2, y2, directions in specs:
        bid = libXfixes.XFixesCreatePointerBarrier(
            dpy, root, x1, y1, x2, y2, directions, 0, None
        )
        if not bid:
            raise RuntimeError(f"XFixesCreatePointerBarrier failed for {edge}")
        barriers.append((edge, bid))
        log(f"barrier {edge}: ({x1},{y1})-({x2},{y2}) dir={directions} id={bid}")
    return barriers


def query_pointer(dpy, root):
    win = ctypes.c_ulong()
    child = ctypes.c_ulong()
    root_x = ctypes.c_int()
    root_y = ctypes.c_int()
    win_x = ctypes.c_int()
    win_y = ctypes.c_int()
    mask = ctypes.c_ulong()
    ok = libX11.XQueryPointer(
        dpy,
        root,
        ctypes.byref(win),
        ctypes.byref(child),
        ctypes.byref(root_x),
        ctypes.byref(root_y),
        ctypes.byref(win_x),
        ctypes.byref(win_y),
        ctypes.byref(mask),
    )
    if not ok:
        return None
    return root_x.value, root_y.value


def clamp(n, lo, hi):
    return max(lo, min(hi, n))


def destroy_barriers(dpy, barriers):
    for edge, bid in barriers:
        try:
            libXfixes.XFixesDestroyPointerBarrier(dpy, bid)
        except Exception as e:
            log(f"destroy {edge} warning: {e}")


def warp_watchdog(dpy, root, output_name, geom, barriers):
    """Pull pointer back inside the monitor if barriers fail on this driver.

    The geometry is RE-READ periodically. It used to be captured once at startup, and this loop
    warps the pointer every 50ms, so when the layout moved under us the watchdog spent 20 times a
    second dragging the pointer into coordinates where no monitor existed any more. Observed live:
    barriers built for DP-5 at 1920x1080+3072+0, xrandr later reporting DP-5 at +0+0, and the mouse
    unusable — it reads as a frozen cursor, not as a fence.

    If the output disappears entirely we RELEASE. Clamping to a rect that is definitely wrong is
    strictly worse than not confining at all: the operator loses the pointer with no way back.
    """
    w, h, x, y = geom
    last_geom_check = time.monotonic()
    while True:
        now = time.monotonic()
        if now - last_geom_check >= GEOMETRY_POLL_SEC:
            last_geom_check = now
            try:
                _, fresh = get_monitor_geometry(output_name)
            except Exception as e:
                log(f"geometry re-read failed ({e}) — keeping current rect")
                fresh = (w, h, x, y)
            if fresh is None:
                log(f"output {output_name!r} is no longer connected — releasing instead of clamping to a stale rect")
                return
            if fresh != (w, h, x, y):
                w, h, x, y = fresh
                log(f"geometry changed → {w}x{h}+{x}+{y} — rebuilding barriers")
                destroy_barriers(dpy, barriers)
                barriers[:] = create_edge_barriers(dpy, root, x, y, w, h)
                libX11.XSync(dpy, 0)

        min_x, min_y = x, y
        max_x, max_y = x + w - 1, y + h - 1
        pt = query_pointer(dpy, root)
        if pt:
            px, py = pt
            nx = clamp(px, min_x, max_x)
            ny = clamp(py, min_y, max_y)
            if nx != px or ny != py:
                libX11.XWarpPointer(dpy, 0, root, 0, 0, 0, 0, nx, ny)
                libX11.XSync(dpy, 0)
        time.sleep(0.05)


def main():
    output_name = sys.argv[1] if len(sys.argv) > 1 else None
    os.environ.setdefault("DISPLAY", ":0")

    name, geom = get_monitor_geometry(output_name)
    if not geom:
        log(f"ERROR: no connected output matching {output_name!r}")
        sys.exit(1)

    w, h, x, y = geom
    write_pid_file(name)
    log(f"Pointer confine for {name} {w}x{h}+{x}+{y}")

    dpy = libX11.XOpenDisplay(None)
    if not dpy:
        log("ERROR: XOpenDisplay failed")
        remove_pid_file()
        sys.exit(1)

    ev_base = ctypes.c_int()
    err_base = ctypes.c_int()
    if not libXfixes.XFixesQueryExtension(dpy, ctypes.byref(ev_base), ctypes.byref(err_base)):
        log("ERROR: XFixes extension unavailable")
        libX11.XCloseDisplay(dpy)
        remove_pid_file()
        sys.exit(1)

    root = libX11.XDefaultRootWindow(dpy)
    barriers = []
    try:
        barriers = create_edge_barriers(dpy, root, x, y, w, h)
        libX11.XSync(dpy, 0)
        log(f"Pointer barriers active ({len(barriers)} edges) + warp watchdog")
        warp_watchdog(dpy, root, name, (w, h, x, y), barriers)
    except KeyboardInterrupt:
        pass
    finally:
        destroy_barriers(dpy, barriers)
        libX11.XSync(dpy, 0)
        libX11.XCloseDisplay(dpy)
        remove_pid_file()
        log("Pointer confine released")


if __name__ == "__main__":
    main()
