#!/usr/bin/env python3
"""WO-1012 — drive the Zoom desktop client through its accessibility tree (AT-SPI), no pointer and no screen positions.

Zoom (Qt) puts every control on the accessibility bus by name with a "Press" action. This helper is the only place
that talks AT-SPI; src/zoom/zoom-ui.js calls it and holds the meaning (which control is "mute", …).

  zoom_a11y.py dump  [--frame RE]                       → {"ok":true,"frames":[{"name","controls":[{role,name,states,actions}]}]}
  zoom_a11y.py press --name RE [--frame RE] [--role R] [--nth N] [--action A] [--click]
                                                        → {"ok":true,"pressed":{frame,role,name}} | {"ok":false,"error"}
  zoom_a11y.py close --frame RE                         → close Zoom windows by title (window manager request)
  zoom_a11y.py key --keysym 0xff1b                      → one key to whatever holds the keyboard (Escape closes a menu)
Names are matched as case-insensitive regular expressions against the whole control name (re.search).
Needs python3-gi + gir1.2-atspi-2.0 and the session bus (DBUS_SESSION_BUS_ADDRESS).
"""
import argparse
import json
import re
import sys

MAX_DEPTH = 24
MAX_NODES = 6000


def load():
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    return Atspi


def zoom_frames(Atspi):
    desk = Atspi.get_desktop(0)
    for i in range(desk.get_child_count()):
        # Other applications on the bus may not answer at all (10.11, live: ibus and the desktop portal hung and every
        # name lookup waited seconds for them, so each call here timed out). Ask them briefly; Zoom gets real time.
        Atspi.set_timeout(250, 250)
        try:
            app = desk.get_child_at_index(i)
            if (app.get_name() or "") != "zoom":
                continue
            Atspi.set_timeout(4000, 4000)
            for j in range(app.get_child_count()):
                f = app.get_child_at_index(j)
                if f is not None:
                    yield f
        except Exception:
            continue


def states_of(Atspi, node):
    out = []
    try:
        ss = node.get_state_set()
        for label, st in (
            ("checked", Atspi.StateType.CHECKED),
            ("showing", Atspi.StateType.SHOWING),
            ("enabled", Atspi.StateType.ENABLED),
            ("selected", Atspi.StateType.SELECTED),
            ("pressed", Atspi.StateType.PRESSED),
        ):
            if ss.contains(st):
                out.append(label)
    except Exception:
        pass
    return out


def actions_of(node):
    try:
        ai = node.get_action_iface()
        if not ai:
            return []
        return [ai.get_action_name(k) for k in range(ai.get_n_actions())]
    except Exception:
        return []


def walk(Atspi, node, visit, depth=0, count=None):
    count = count if count is not None else [0]
    if depth > MAX_DEPTH or count[0] > MAX_NODES:
        return
    count[0] += 1
    try:
        n = node.get_child_count()
    except Exception:
        return
    for i in range(n):
        try:
            c = node.get_child_at_index(i)
        except Exception:
            continue
        if c is None:
            continue
        try:
            name = c.get_name() or ""
            role = c.get_role_name() or ""
        except Exception:
            continue
        if name and name != "window_ta_label":
            if visit(c, role, name) is False:
                return
        walk(Atspi, c, visit, depth + 1, count)


def cmd_dump(Atspi, args):
    frames = []
    fre = re.compile(args.frame, re.I) if args.frame else None
    for f in zoom_frames(Atspi):
        fname = f.get_name() or ""
        if fre and not fre.search(fname):
            continue
        controls = []

        def visit(c, role, name):
            controls.append({"role": role, "name": name, "states": states_of(Atspi, c), "actions": sorted(set(actions_of(c)))})

        walk(Atspi, f, visit)
        if controls or fre:
            frames.append({"name": fname, "states": states_of(Atspi, f), "controls": controls})
    return {"ok": True, "frames": frames}


def pointer_position():
    try:
        from Xlib import display

        d = display.Display()
        q = d.screen().root.query_pointer()
        d.close()
        return q.root_x, q.root_y
    except Exception:
        return None


def raise_window(title):
    """Bring the Zoom window with exactly this title to the front (a click lands on whatever is on top)."""
    try:
        from Xlib import X, display, protocol

        d = display.Display()
        root = d.screen().root
        ids = root.get_full_property(d.intern_atom("_NET_CLIENT_LIST"), X.AnyPropertyType)
        for wid in ids.value if ids else []:
            w = d.create_resource_object("window", wid)
            try:
                t = w.get_full_property(d.intern_atom("_NET_WM_NAME"), d.intern_atom("UTF8_STRING"))
                if "zoom" in (w.get_wm_class() or ("", "")) and t and t.value.decode("utf-8", "replace") == title:
                    ev = protocol.event.ClientMessage(window=w, client_type=d.intern_atom("_NET_ACTIVE_WINDOW"), data=(32, [2, X.CurrentTime, 0, 0, 0]))
                    root.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
            except Exception:
                continue
        d.flush()
        d.close()
    except Exception:
        pass


def click(Atspi, node, what, matches, button=1, at=""):
    if what.get("raise"):
        import time

        raise_window(what["frame"])
        time.sleep(0.4)
        what = {k: v for k, v in what.items() if k != "raise"}
    try:
        e = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
    except Exception as ex:
        return {"ok": False, "error": f"no position for the control: {ex}"}
    if e.width <= 0 or e.height <= 0:
        return {"ok": False, "error": "control is not on screen", "name": what["name"]}
    fx, fy = 0.5, 0.5
    if at:
        fx, fy = (float(v) for v in at.split(","))
    x, y = e.x + int(e.width * fx), e.y + int(e.height * fy)
    back = pointer_position()
    done = Atspi.generate_mouse_event(x, y, f"b{3 if button == 3 else 1}c")
    if back:
        import time

        time.sleep(0.15)
        Atspi.generate_mouse_event(back[0], back[1], "abs")
    return {"ok": bool(done), "pressed": what, "matches": matches, "clicked": [x, y]}


def cmd_close(args):
    """Ask the window manager to close Zoom windows by title (_NET_CLOSE_WINDOW): the Settings window has no close
    control of its own in the tree."""
    from Xlib import X, display, protocol

    d = display.Display()
    root = d.screen().root
    rx = re.compile(args.frame, re.I)
    ids = root.get_full_property(d.intern_atom("_NET_CLIENT_LIST"), X.AnyPropertyType)
    closed = []
    for wid in ids.value if ids else []:
        w = d.create_resource_object("window", wid)
        try:
            cls = w.get_wm_class() or ("", "")
            title = w.get_full_property(d.intern_atom("_NET_WM_NAME"), d.intern_atom("UTF8_STRING"))
            title = title.value.decode("utf-8", "replace") if title else (w.get_wm_name() or "")
        except Exception:
            continue
        if "zoom" not in cls or not rx.search(title):
            continue
        ev = protocol.event.ClientMessage(window=w, client_type=d.intern_atom("_NET_CLOSE_WINDOW"), data=(32, [X.CurrentTime, 2, 0, 0, 0]))
        root.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        closed.append(title)
    d.flush()
    d.close()
    return {"ok": True, "closed": closed}


def cmd_press(Atspi, args):
    fre = re.compile(args.frame, re.I) if args.frame else None
    nre = re.compile(args.name, re.I)
    hits = []
    for f in zoom_frames(Atspi):
        fname = f.get_name() or ""
        if fre and not fre.search(fname):
            continue

        def visit(c, role, name, fname=fname):
            if nre.search(name) and (not args.role or role == args.role):
                hits.append((fname, role, name, c))

        walk(Atspi, f, visit)
    if not hits:
        return {"ok": False, "error": "no Zoom control matches", "name": args.name, "frame": args.frame or ""}
    if args.nth >= len(hits):
        return {"ok": False, "error": f"only {len(hits)} match(es)", "name": args.name}
    fname, role, name, node = hits[args.nth]
    # Zoom's menu items take the Press action and do nothing (10.11, live). They are clicked at the place Zoom itself
    # reports for them (the pointer goes there and comes back); buttons, tabs and check boxes use the action.
    if args.click or (role == "menu item" and not args.action):
        return click(Atspi, node, {"frame": fname, "role": role, "name": name, "raise": args.raise_first}, len(hits), args.button, args.at)
    ai = node.get_action_iface()
    if not ai or ai.get_n_actions() < 1:
        return {"ok": False, "error": "control has no action", "name": name}
    idx = 0
    if args.action:
        names = [ai.get_action_name(k) for k in range(ai.get_n_actions())]
        if args.action not in names:
            return {"ok": False, "error": f"no action {args.action}", "actions": names}
        idx = names.index(args.action)
    done = ai.do_action(idx)
    return {"ok": bool(done), "pressed": {"frame": fname, "role": role, "name": name}, "matches": len(hits)}


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dump")
    d.add_argument("--frame", default="")
    p = sub.add_parser("press")
    p.add_argument("--name", required=True)
    p.add_argument("--frame", default="")
    p.add_argument("--role", default="")
    p.add_argument("--nth", type=int, default=0)
    p.add_argument("--action", default="")
    p.add_argument("--click", action="store_true")
    p.add_argument("--raise", dest="raise_first", action="store_true", help="with --click: bring the window to the front first")
    p.add_argument("--button", type=int, default=1, help="with --click: 1 = left, 3 = right (context menu)")
    p.add_argument("--at", default="", help="with --click: x,y inside the control as fractions, e.g. 0.05,0.1")
    c = sub.add_parser("close")
    c.add_argument("--frame", required=True)
    k = sub.add_parser("key")
    k.add_argument("--keysym", required=True, help="X keysym, e.g. 0xff1b (Escape)")
    args = ap.parse_args()
    try:
        Atspi = load()
    except Exception as e:  # no gi / no typelib
        print(json.dumps({"ok": False, "error": f"AT-SPI bindings missing (python3-gi, gir1.2-atspi-2.0): {e}"}))
        return 3
    try:
        if args.cmd == "dump":
            out = cmd_dump(Atspi, args)
        elif args.cmd == "close":
            out = cmd_close(args)
        elif args.cmd == "key":  # to whatever holds the keyboard: an open Zoom menu (Escape closes it)
            out = {"ok": bool(Atspi.generate_keyboard_event(int(args.keysym, 0), None, Atspi.KeySynthType.SYM))}
        else:
            out = cmd_press(Atspi, args)
    except Exception as e:
        out = {"ok": False, "error": str(e)}
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
