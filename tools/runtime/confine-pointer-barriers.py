#!/usr/bin/env python3
"""
confine-pointer-barriers.py — confine cursor to one monitor (Caspar-safe).

XFixes pointer barriers on all four edges — a hard stop enforced by the X server. The four segments
OVERLAP at the corners (see create_edge_barriers); barriers that merely touch leak a pixel at a time
through their shared endpoints on a diagonal move.

The cursor is NEVER polled or warped. A `warp_watchdog` used to do that at 20 Hz to cover an alleged
"NVIDIA multi-head lets the pointer slip past barriers" quirk; when finally instrumented (WO-391) the
only escape it ever caught was the corner-endpoint gap above, which is now fixed at the source. Do
not reintroduce pointer polling — if the fence ever leaks again, the answer is
XFixesSelectBarrierInput (barrier HIT EVENTS, which the server pushes to us) not a poll loop.

Must stay running — barriers are destroyed when this process exits. The loop it runs re-reads the
monitor geometry so the fence follows the layout instead of fossilising around a stale rect.

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

"""How far each barrier extends past the perpendicular edges, to seal the corners — see
create_edge_barriers. Must be > the largest single-motion-event jump across a corner; 16 px is far
more than a pointer moves between motion events at any sane speed."""
CORNER_OVERLAP_PX = 16

libX11 = ctypes.CDLL(ctypes.util.find_library("X11"), use_errno=True)
libXfixes = ctypes.CDLL(ctypes.util.find_library("Xfixes"), use_errno=True)

libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XCloseDisplay.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.restype = ctypes.c_ulong
libX11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
# WO-391: the XQueryPointer / XWarpPointer bindings that used to live here are gone with the poll
# loop. Nothing in this script reads or moves the cursor any more — see the module docstring.

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
    """Four directional barriers around the rect, OVERLAPPING at the corners.

    WO-391: the four segments used to merely *touch* at each corner (left ran y..y+h, top ran
    x..x+w, both starting exactly at the corner). A diagonal move that crosses the corner passes
    through the barriers' shared endpoint, and X's barrier test misses it — the pointer leaks out
    one pixel at a time. Measured live on this box at 12:44:06: the pointer escaped to (1919,0),
    i.e. one px left of the fence at exactly y=0, the top-left corner. It was NOT a driver bug, and
    the warp-poll loop that used to paper over it has been deleted.

    Extending every segment past both perpendicular edges by CORNER_OVERLAP_PX seals the corners:
    a crossing at the corner now lands in the middle of a barrier, not on its endpoint.

    The overlap sticks out into coordinates just outside the monitor. That is harmless here (the
    pointer is being confined INTO this rect, so it has no business out there) but note it would
    also block motion in a monitor stacked directly above/below this one.
    """
    m = CORNER_OVERLAP_PX
    barriers = []
    specs = [
        ("left", x, y - m, x, y + h + m, BARRIER_NEGATIVE_X),
        ("right", x + w, y - m, x + w, y + h + m, BARRIER_POSITIVE_X),
        ("top", x - m, y, x + w + m, y, BARRIER_NEGATIVE_Y),
        ("bottom", x - m, y + h, x + w + m, y + h, BARRIER_POSITIVE_Y),
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


def destroy_barriers(dpy, barriers):
    for edge, bid in barriers:
        try:
            libXfixes.XFixesDestroyPointerBarrier(dpy, bid)
        except Exception as e:
            log(f"destroy {edge} warning: {e}")


def barrier_maintenance_loop(dpy, root, output_name, geom, barriers):
    """Keep the barriers alive and matched to the monitor. NEVER touches the pointer.

    WO-391. This replaces `warp_watchdog`, which polled XQueryPointer (20 Hz, later 4 Hz) and
    XWarpPointer'd the cursor back whenever it found it outside the rect. Owner 30.07: "i dont like
    that mouse cursor poll loop at all … it worked but in a false situation. i dont see the need for
    that at all." Both halves of that are right:

      * XFixes barriers are enforced BY THE X SERVER. Polling the cursor to re-enforce them is
        re-implementing the kernel of the feature in userspace.
      * The one escape the instrumented build ever caught was (1919,0) — one pixel out, at exactly
        y=0, the top-left corner. That was the barrier segments only TOUCHING at their endpoints,
        not the NVIDIA slip-past quirk the loop was written for. Fixed properly in
        create_edge_barriers by overlapping the corners, so there is nothing left to poll for.

    What still needs a loop: this process must stay alive (barriers die with it), and the layout can
    move under a running confine (apply layout, hotplug, mode change), so the geometry is re-read
    every GEOMETRY_POLL_SEC and the barriers rebuilt if it moved. That is a cheap xrandr read, not
    pointer polling, and it is what stops the fence from fossilising around a rect that no longer
    exists.

    If the output disappears entirely we RELEASE and return. Holding barriers around a rect that is
    definitely wrong is strictly worse than not confining at all: the operator loses the pointer
    with no way back.
    """
    w, h, x, y = geom
    while True:
        time.sleep(GEOMETRY_POLL_SEC)
        try:
            _, fresh = get_monitor_geometry(output_name)
        except Exception as e:
            log(f"geometry re-read failed ({e}) — keeping current rect")
            continue
        if fresh is None:
            log(f"output {output_name!r} is no longer connected — releasing instead of holding a stale fence")
            return
        if fresh != (w, h, x, y):
            w, h, x, y = fresh
            log(f"geometry changed → {w}x{h}+{x}+{y} — rebuilding barriers")
            destroy_barriers(dpy, barriers)
            barriers[:] = create_edge_barriers(dpy, root, x, y, w, h)
            libX11.XSync(dpy, 0)


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
        log(f"Pointer barriers active ({len(barriers)} edges, corners sealed) — cursor is not polled")
        barrier_maintenance_loop(dpy, root, name, (w, h, x, y), barriers)
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
