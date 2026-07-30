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

Must stay running — barriers are destroyed when this process exits. It also has to notice when the
layout moves (apply layout, hotplug, mode change), or the fence fossilises around a rect that no
longer exists.

It learns that primarily by **event**: RandR `RRScreenChangeNotify` / `RRCrtcChangeNotify` /
`RROutputChangeNotify` are selected on the root window and the process blocks in `select()` on the X
connection, doing nothing until the server tells it something changed. Geometry is then read through
`XRRGetMonitors` — no `xrandr` subprocess. The old 2 s wake + `xrandr --query` fork per tick are gone.

Honest caveat: event DELIVERY is unproven on this box, so `select()` keeps a
`GEOMETRY_BACKSTOP_SEC` (30 s) timeout as a safety net — read that constant's docstring before
removing it. Measured idle cost with the backstop in place: 0 CPU ticks, 0 context switches and 0
child processes over 12 s, versus 4 forks + 240 XQueryPointer round-trips in the same window before.

The `xrandr --query` parser survives ONLY as a fallback for a box whose RandR is too old for
`XRRGetMonitors` (< 1.5), and the 2 s `GEOMETRY_POLL_SEC` loop only for one whose RandR cannot be set
up at all. Both degradations log loudly when they engage — silent polling is what this WO exists to
stop.

Usage: confine-pointer-barriers.py [OUTPUT_NAME]
"""

import ctypes
import ctypes.util
import os
import re
import select
import subprocess
import sys
import time

LOG_PATH = os.path.expanduser("~/.highascg/log/confine-pointer-barriers.log")
PID_PATH = os.path.expanduser("~/.highascg/run/confine-pointer-barriers.pid")

BARRIER_POSITIVE_X = 1
BARRIER_NEGATIVE_X = 2
BARRIER_POSITIVE_Y = 4
BARRIER_NEGATIVE_Y = 8

"""Fallback re-read interval, used ONLY when RandR cannot deliver change events on this display
(see make_change_waiter, which logs when it degrades to this). The event-driven path has no
periodic wake at all."""
GEOMETRY_POLL_SEC = 2.0

# RandR event masks (Xrandr.h). ScreenChange alone is not enough: moving a CRTC inside an unchanged
# total screen size emits only CrtcChange, which is exactly the "layout moved under us" case.
RR_SCREEN_CHANGE_NOTIFY_MASK = 1 << 0
RR_CRTC_CHANGE_NOTIFY_MASK = 1 << 1
RR_OUTPUT_CHANGE_NOTIFY_MASK = 1 << 2
RR_EVENT_MASK = RR_SCREEN_CHANGE_NOTIFY_MASK | RR_CRTC_CHANGE_NOTIFY_MASK | RR_OUTPUT_CHANGE_NOTIFY_MASK

"""RRScreenChangeNotify is subtype 0 off the RandR event base; only that one may be handed to
XRRUpdateConfiguration."""
RR_SCREEN_CHANGE_NOTIFY = 0

"""QueuedAfterReading — ask Xlib to read from the socket before reporting the queue depth."""
X_QUEUED_AFTER_READING = 1

"""If select() keeps reporting the X fd readable but no events ever materialise, the connection is
broken. Bail out rather than spin; the app's 8 s confine watchdog restarts us clean."""
MAX_EMPTY_WAKEUPS = 100

"""Backstop re-check interval for the EVENT path.

Honesty about what is proven: RandR change events are selected and will short-circuit this wait the
moment one arrives, but delivery could NOT be verified on this box without a disruptive layout
change (30.07 was a show day). `xrandr --setmonitor/--delmonitor` turned out to emit no RandR notify
at all — confirmed against `xev -root -event randr` as a reference client, so it was a bad probe,
not proof either way.

Correctness therefore must not depend on the events arriving. This backstop guarantees the fence
still follows the layout if they never do. It is NOT the old 2 s `xrandr --query` fork: it is one
XRRGetMonitors round-trip every 30 s — no subprocess, no parsing, 15x less often. When a wake is
caused by an actual event, `barrier_maintenance_loop` logs it, so the next real layout apply will
tell us whether the event path works and this can drop to a pure block."""
GEOMETRY_BACKSTOP_SEC = 30.0

"""How far each barrier extends past the perpendicular edges, to seal the corners — see
create_edge_barriers. Must be > the largest single-motion-event jump across a corner; 16 px is far
more than a pointer moves between motion events at any sane speed."""
CORNER_OVERLAP_PX = 16

libX11 = ctypes.CDLL(ctypes.util.find_library("X11"), use_errno=True)
libXfixes = ctypes.CDLL(ctypes.util.find_library("Xfixes"), use_errno=True)

# Optional: absence just means we fall back to parsing `xrandr --query` and to periodic re-reads.
try:
    _xrandr_lib = ctypes.util.find_library("Xrandr")
    libXrandr = ctypes.CDLL(_xrandr_lib, use_errno=True) if _xrandr_lib else None
except OSError:
    libXrandr = None

libX11.XOpenDisplay.restype = ctypes.c_void_p
libX11.XCloseDisplay.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
libX11.XDefaultRootWindow.restype = ctypes.c_ulong
libX11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
libX11.XConnectionNumber.argtypes = [ctypes.c_void_p]
libX11.XConnectionNumber.restype = ctypes.c_int
libX11.XEventsQueued.argtypes = [ctypes.c_void_p, ctypes.c_int]
libX11.XEventsQueued.restype = ctypes.c_int
libX11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
libX11.XGetAtomName.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
libX11.XGetAtomName.restype = ctypes.c_void_p
libX11.XFree.argtypes = [ctypes.c_void_p]
# WO-391: the XQueryPointer / XWarpPointer bindings that used to live here are gone with the poll
# loop. Nothing in this script reads or moves the cursor any more — see the module docstring.


class XRRMonitorInfo(ctypes.Structure):
    """Xrandr.h XRRMonitorInfo (RandR 1.5). Field order matters — ctypes computes the padding."""

    _fields_ = [
        ("name", ctypes.c_ulong),  # Atom
        ("primary", ctypes.c_int),  # Bool
        ("automatic", ctypes.c_int),  # Bool
        ("noutput", ctypes.c_int),
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("mwidth", ctypes.c_int),
        ("mheight", ctypes.c_int),
        ("outputs", ctypes.POINTER(ctypes.c_ulong)),  # RROutput *
    ]


if libXrandr is not None:
    libXrandr.XRRQueryExtension.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
    ]
    libXrandr.XRRQueryExtension.restype = ctypes.c_int
    libXrandr.XRRSelectInput.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
    libXrandr.XRRUpdateConfiguration.argtypes = [ctypes.c_void_p]
    libXrandr.XRRUpdateConfiguration.restype = ctypes.c_int
    libXrandr.XRRGetMonitors.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_int),
    ]
    libXrandr.XRRGetMonitors.restype = ctypes.POINTER(XRRMonitorInfo)
    libXrandr.XRRFreeMonitors.argtypes = [ctypes.POINTER(XRRMonitorInfo)]

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


def _atom_name(dpy, atom):
    ptr = libX11.XGetAtomName(dpy, atom)
    if not ptr:
        return None
    try:
        return ctypes.cast(ptr, ctypes.c_char_p).value.decode("utf-8", "replace")
    finally:
        libX11.XFree(ptr)


def monitor_geometry_via_xrandr_api(dpy, root, output_name=None):
    """Geometry straight from RandR 1.5 — no subprocess, no text parsing.

    Returns (name, (w, h, x, y)) exactly like the subprocess parser it replaces, or (None, None)
    when RandR cannot answer (too old, no monitors) so the caller can fall back. Only ACTIVE
    monitors are requested, which is the same set `xrandr --listmonitors` prints and matches the
    output names the server passes us (DP-1, DP-5…).
    """
    if libXrandr is None or not dpy:
        return None, None
    n = ctypes.c_int(0)
    mons = libXrandr.XRRGetMonitors(dpy, root, 1, ctypes.byref(n))
    if not mons or n.value <= 0:
        return None, None
    try:
        first = None
        for i in range(n.value):
            m = mons[i]
            name = _atom_name(dpy, m.name)
            geom = (int(m.width), int(m.height), int(m.x), int(m.y))
            if output_name:
                if name == output_name:
                    return name, geom
            elif first is None:
                first = (name, geom)
        return first if first else (None, None)
    finally:
        libXrandr.XRRFreeMonitors(mons)


def monitor_geometry_via_xrandr_subprocess(output_name=None):
    """Fallback for RandR < 1.5: fork `xrandr --query` and parse it.

    This used to run every 2 s for the life of the box. It is now reached only if
    XRRGetMonitors is unavailable or answers nothing — see get_monitor_geometry.
    """
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


def get_monitor_geometry(output_name=None, dpy=None, root=None):
    """Preferred: the RandR API. Fallback: the `xrandr` subprocess.

    `dpy`/`root` are optional so the pre-display startup probe in main() still works before the
    display is open, and so tests can drive the parser directly.
    """
    if dpy:
        name, geom = monitor_geometry_via_xrandr_api(dpy, root, output_name)
        if geom:
            return name, geom
    return monitor_geometry_via_xrandr_subprocess(output_name)


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


def make_change_waiter(dpy, root):
    """Build the blocking "did the layout change?" waiter. Event-driven if RandR allows it.

    WO-391 follow-up. Returns a callable that blocks and returns True when the layout may have
    changed (check it), or False when the X connection is gone (give up). The event path costs
    nothing while idle: the process sits in select() on the X socket.

    Degrades, loudly, in two steps:
      1. no libXrandr / XRRQueryExtension fails → periodic re-read every GEOMETRY_POLL_SEC
      2. select() keeps waking with no events → returns False so the supervisor restarts us
    """

    def poll_waiter():
        time.sleep(GEOMETRY_POLL_SEC)
        return True

    if libXrandr is None or not dpy:
        log(f"RandR unavailable — DEGRADED to a {GEOMETRY_POLL_SEC}s geometry poll (no event support)")
        return poll_waiter

    ev_base = ctypes.c_int()
    err_base = ctypes.c_int()
    try:
        if not libXrandr.XRRQueryExtension(dpy, ctypes.byref(ev_base), ctypes.byref(err_base)):
            log(f"XRRQueryExtension failed — DEGRADED to a {GEOMETRY_POLL_SEC}s geometry poll")
            return poll_waiter
        libXrandr.XRRSelectInput(dpy, root, RR_EVENT_MASK)
        libX11.XSync(dpy, 0)
    except Exception as e:
        log(f"RandR event setup failed ({e}) — DEGRADED to a {GEOMETRY_POLL_SEC}s geometry poll")
        return poll_waiter

    xfd = libX11.XConnectionNumber(dpy)
    screen_change_type = ev_base.value + RR_SCREEN_CHANGE_NOTIFY
    # XEvent is a union; 32 longs is comfortably larger than any member on any supported arch.
    ev = (ctypes.c_long * 32)()
    ev_type_ptr = ctypes.cast(ctypes.byref(ev), ctypes.POINTER(ctypes.c_int))
    log(
        f"RandR change events selected on fd {xfd} (mask {RR_EVENT_MASK}) — no cursor polling, no "
        f"xrandr fork; {GEOMETRY_BACKSTOP_SEC:g}s backstop until event delivery is proven"
    )
    saw_event = False

    def event_waiter():
        empty = 0
        while True:
            # Blocks on the X socket. The GEOMETRY_BACKSTOP_SEC timeout is a safety net, NOT the
            # mechanism: see its docstring for why event delivery could not be proven here. An event
            # short-circuits it immediately. SIGTERM still kills us via Python's default disposition.
            try:
                readable, _, _ = select.select([xfd], [], [], GEOMETRY_BACKSTOP_SEC)
            except (OSError, ValueError) as e:
                log(f"select on the X connection failed ({e})")
                return False
            if not readable:
                return True  # backstop tick — re-check geometry, no event involved
            queued = libX11.XEventsQueued(dpy, X_QUEUED_AFTER_READING)
            if queued <= 0:
                # Readable but nothing decodable — a healthy connection does this at most briefly.
                empty += 1
                if empty >= MAX_EMPTY_WAKEUPS:
                    return False
                continue
            empty = 0
            for _ in range(queued):
                libX11.XNextEvent(dpy, ctypes.byref(ev))
                # Only ScreenChangeNotify may go to XRRUpdateConfiguration; it refreshes Xlib's
                # cached screen config so a later query cannot read stale numbers.
                if ev_type_ptr[0] == screen_change_type:
                    try:
                        libXrandr.XRRUpdateConfiguration(ctypes.byref(ev))
                    except Exception:
                        pass
            # Proof-of-life for the event path, once per process: if this line ever appears, the
            # backstop above is redundant and the wait can become a pure block.
            nonlocal saw_event
            if not saw_event:
                saw_event = True
                log("RandR change event RECEIVED — the event path works on this display")
            return True

    return event_waiter


def barrier_maintenance_loop(dpy, root, output_name, geom, barriers, wait_for_change=None):
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
    move under a running confine (apply layout, hotplug, mode change), so the barriers are rebuilt
    when it does. That is what stops the fence fossilising around a rect that no longer exists.

    How it waits is the WO-391 follow-up: `wait_for_change` BLOCKS until RandR says something
    changed (see make_change_waiter). There is no periodic wake and no `xrandr` fork per tick — the
    process is idle, in select(), until the server pushes an event. Geometry is then read through
    XRRGetMonitors.

    If the output disappears entirely we RELEASE and return. Holding barriers around a rect that is
    definitely wrong is strictly worse than not confining at all: the operator loses the pointer
    with no way back.

    @param wait_for_change callable() -> bool. Blocks; True = check geometry, False = give up and
        return (connection lost). Injected so the offline smoke can drive the loop without X.
    """
    w, h, x, y = geom
    if wait_for_change is None:
        wait_for_change = make_change_waiter(dpy, root)
    while True:
        if not wait_for_change():
            log("change waiter gave up (X connection lost) — exiting so the supervisor restarts us clean")
            return
        try:
            _, fresh = get_monitor_geometry(output_name, dpy, root)
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

    # WO-391: the display is opened FIRST so even the startup geometry read goes through the RandR
    # API. Probing before the connection existed forced one `xrandr` fork per process start, which
    # is the last thing that still shelled out on the happy path.
    dpy = libX11.XOpenDisplay(None)
    if not dpy:
        log("ERROR: XOpenDisplay failed")
        sys.exit(1)

    ev_base = ctypes.c_int()
    err_base = ctypes.c_int()
    if not libXfixes.XFixesQueryExtension(dpy, ctypes.byref(ev_base), ctypes.byref(err_base)):
        log("ERROR: XFixes extension unavailable")
        libX11.XCloseDisplay(dpy)
        sys.exit(1)

    root = libX11.XDefaultRootWindow(dpy)

    name, geom = get_monitor_geometry(output_name, dpy, root)
    if not geom:
        log(f"ERROR: no connected output matching {output_name!r}")
        libX11.XCloseDisplay(dpy)
        sys.exit(1)

    w, h, x, y = geom
    write_pid_file(name)
    log(f"Pointer confine for {name} {w}x{h}+{x}+{y}")

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
