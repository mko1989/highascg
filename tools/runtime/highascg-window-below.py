#!/usr/bin/env python3
"""WO-317: park a helper window BELOW the Caspar consumer and let the kiosk reclaim the top.

This is the inverse of highascg-window-above.py. WO-283 could put a helper OVER the kiosk; WO-317
adds the other half of a taskbar — sending a still-running helper back DOWN so the operator's video
holes are clean again without closing the window.

WHY EWMH AND NOT xdotool (same reason as the promote script)
------------------------------------------------------------
This box ships xdotool 3.20160805.1, which has no `windowstate` verb, so `_NET_WM_STATE_ABOVE`
cannot be removed with xdotool here. python-xlib (0.33) is installed and is what
operator-shape-overlay.py already uses, so we speak EWMH directly.

WHAT PARKING ACTUALLY REQUIRES
  1. Remove _NET_WM_STATE_ABOVE from the helper — while it carries ABOVE it shares the kiosk's
     layer and Openbox will not let it drop beneath NORMAL-layer content.
  2. Lower it. If a --below <consumer-wid> is given, stack it directly beneath that window (the
     Caspar screen consumer the video holes reveal); otherwise a plain lower to the bottom.
  3. The CALLER refocuses the kiosk afterwards (xdotool windowactivate <kiosk>) — that is what
     pulls the kiosk back into Openbox's fullscreen layer over the parked helper. This script does
     not do it, to keep the "who owns focus" decision in one place (the planner/applier).

Both load-bearing facts from the promote script still hold: the ClientMessage must go to the ROOT
window with SubstructureRedirect|SubstructureNotify, and the wid must be the CLIENT window (xdotool
search returns client windows, so the ids handed in are already correct).

Usage:  highascg-window-below.py <wid> [--below <consumer-wid>]
Exit 0 only if the helper was processed without error.
"""

import sys

try:
    from Xlib import X, display, error  # type: ignore
    from Xlib.protocol import event  # type: ignore
except Exception as e:  # pragma: no cover - environment without python-xlib
    print(f"python-xlib unavailable: {e}", file=sys.stderr)
    sys.exit(2)


def send_root_message(dpy, root, win, type_atom, data):
    """EWMH ClientMessage → root, the only form Openbox acts on for a mapped window."""
    ev = event.ClientMessage(window=win, client_type=type_atom, data=(32, data))
    root.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
    dpy.flush()


def park(dpy, root, wid, below_wid):
    a_state = dpy.intern_atom("_NET_WM_STATE")
    a_above = dpy.intern_atom("_NET_WM_STATE_ABOVE")
    win = dpy.create_resource_object("window", wid)

    # 1) out of the ABOVE layer. data = [action=_NET_WM_STATE_REMOVE(0), prop1, prop2=0, source=1, 0]
    send_root_message(dpy, root, win, a_state, [0, a_above, 0, 1, 0])

    # 2) lower — beneath a named sibling (the Caspar consumer) when we have one, else to the bottom.
    if below_wid is not None:
        sibling = dpy.create_resource_object("window", below_wid)
        win.configure(sibling=sibling, stack_mode=X.Below)
    else:
        win.configure(stack_mode=X.Below)
    dpy.sync()


def main(argv):
    args = argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2

    below_wid = None
    positional = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--below":
            if i + 1 >= len(args):
                print("--below requires a window id", file=sys.stderr)
                return 2
            try:
                below_wid = int(args[i + 1], 0)
            except ValueError:
                print(f"bad --below window id: {args[i + 1]}", file=sys.stderr)
                return 2
            i += 2
            continue
        positional.append(a)
        i += 1

    if not positional:
        print("no helper window id given", file=sys.stderr)
        return 2

    try:
        dpy = display.Display()
    except Exception as e:
        print(f"cannot open display: {e}", file=sys.stderr)
        return 2
    root = dpy.screen().root

    try:
        wid = int(positional[0], 0)
    except ValueError:
        print(f"bad window id: {positional[0]}", file=sys.stderr)
        return 2
    try:
        park(dpy, root, wid, below_wid)
        ref = f" below {below_wid}" if below_wid is not None else ""
        print(f"parked {wid} (removed ABOVE + lowered{ref})")
    except (error.XError, Exception) as e:  # noqa: B014 - XError is a subclass, keep both explicit
        print(f"park {wid} failed: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
