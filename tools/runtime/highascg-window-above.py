#!/usr/bin/env python3
"""WO-283: promote a helper window into the ABOVE layer, raise it and focus it.

WHY THIS SCRIPT EXISTS AT ALL
----------------------------
src/utils/x-display-session-runtime.js used to do this with:

    xdotool windowstate --add ABOVE <wid>

`windowstate` was added in xdotool 3.20211022. The box ships:

    $ xdotool version
    xdotool version 3.20160805.1
    $ xdotool windowstate --help
    xdotool: Unknown command: windowstate

so that call ALWAYS failed, and because the caller swallowed the error with `.catch(() => {})` it
failed silently. The result was precisely the operator's complaint — "nothing can be shown over the
gui": the kiosk client permanently carries _NET_WM_STATE_ABOVE (set by operator-shape-overlay.py's
lock_window_above), Openbox clamps every restack request to the window's own layer, so a helper left
in the NORMAL layer can never be raised over it. The promote was the one step that made WO-283 work
and it was a no-op on this machine. wmctrl is not installed either, so there was no fallback.

python-xlib (0.33) IS installed and is already the mechanism operator-shape-overlay.py uses, so we
speak EWMH directly instead of depending on a newer xdotool.

TWO THINGS THAT ARE LOAD-BEARING (both learned the hard way, see operator-shape-overlay.py)
  * The ClientMessage must be sent TO THE ROOT WINDOW with SubstructureRedirect|SubstructureNotify —
    a property set directly on a mapped window is ignored by the WM.
  * `window` in the message must be the CLIENT window Openbox manages, NOT its frame. xdotool's
    search returns client windows, so the ids we are handed are already correct; we do not walk up.

Usage:  highascg-window-above.py <wid> [<wid> ...]
Exit 0 only if every id was processed without error.
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


def promote(dpy, root, wid):
    a_state = dpy.intern_atom("_NET_WM_STATE")
    a_above = dpy.intern_atom("_NET_WM_STATE_ABOVE")
    a_active = dpy.intern_atom("_NET_ACTIVE_WINDOW")
    win = dpy.create_resource_object("window", wid)

    # 1) into the ABOVE layer — without this the raise below is clamped to the NORMAL layer.
    #    data = [action=_NET_WM_STATE_ADD, prop1, prop2=0, source=1 (application), 0]
    send_root_message(dpy, root, win, a_state, [1, a_above, 0, 1, 0])

    # 2) raise within the layer.
    win.configure(stack_mode=X.Above)
    dpy.flush()

    # 3) focus it. This is what drops the kiosk out of Openbox's fullscreen layer back to ABOVE
    #    ("fullscreen yields when unfocused"), letting the helper actually sit on top.
    send_root_message(dpy, root, win, a_active, [1, X.CurrentTime, 0, 0, 0])
    dpy.sync()


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        dpy = display.Display()
    except Exception as e:
        print(f"cannot open display: {e}", file=sys.stderr)
        return 2
    root = dpy.screen().root

    failed = 0
    for raw in argv[1:]:
        try:
            wid = int(raw, 0)
        except ValueError:
            print(f"bad window id: {raw}", file=sys.stderr)
            failed += 1
            continue
        try:
            promote(dpy, root, wid)
            print(f"promoted {wid} ABOVE + raised + activated")
        except (error.XError, Exception) as e:  # noqa: B014 - XError is a subclass, keep both explicit
            print(f"promote {wid} failed: {e}", file=sys.stderr)
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
