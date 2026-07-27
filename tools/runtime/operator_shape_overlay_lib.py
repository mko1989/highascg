"""
operator_shape_overlay_lib — X11/Xlib plumbing for tools/runtime/operator-shape-overlay.py: log/pid
file utilities, EWMH atom setup, Firefox-kiosk/Caspar-consumer window matching, SHAPE-extension hole
punching, stacking enforcement, and the stdin JSON-line protocol parser. See
operator-shape-overlay.py for the full behavior contract and protocol docstring; imported via a
plain `import` (python3 sets sys.path[0] to the script's own directory when run by path, so this
module resolves with no extra path handling).
"""

import json
import os
import time

from Xlib import X
from Xlib.ext import shape
from Xlib.protocol import event

LOG_PATH = os.path.expanduser("~/.highascg/log/operator-shape-overlay.log")
PID_PATH = os.path.expanduser("~/.highascg/run/operator-shape-overlay.pid")

# URL-tied guard: only a Firefox whose window title contains this marker (set by the operator page
# in client/lib/operator-gui-mode.js — kept in sync there) is shaped. Prevents holing OTHER firefox
# windows: the WO-258 browser sources (also firefox, on the operator monitor during "Interact"),
# or any browser the operator opens. X11 exposes no URL property, so the page title stands in for it.
OPERATOR_TITLE_MARKER = "HIGHASCG-OPERATOR-GUI"

# Interned lazily in init_atoms() once the display is open; window_title() falls back to legacy
# WM_NAME when these are still None (get_full_property tolerates a bad atom via the surrounding
# try/except).
_ATOM_NET_WM_NAME = None
_ATOM_UTF8_STRING = None
_ATOM_NET_WM_STATE = None
_ATOM_NET_WM_STATE_ABOVE = None
_ATOM_NET_WM_STATE_BELOW = None
_LAST_GAP_LOGGED = False
_ATOM_NET_ACTIVE_WINDOW = None
_DISPLAY = None
_ROOT = None


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} [pid={os.getpid()}] {msg}\n"
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    print(msg, flush=True)


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


def init_atoms(d, root) -> None:
    global _ATOM_NET_WM_NAME, _ATOM_UTF8_STRING
    global _ATOM_NET_WM_STATE, _ATOM_NET_WM_STATE_ABOVE, _ATOM_NET_WM_STATE_BELOW, _ATOM_NET_ACTIVE_WINDOW, _DISPLAY, _ROOT
    _DISPLAY = d
    _ROOT = root
    try:
        _ATOM_NET_WM_NAME = d.intern_atom("_NET_WM_NAME")
        _ATOM_UTF8_STRING = d.intern_atom("UTF8_STRING")
    except Exception as e:
        log(f"warning: could not intern _NET_WM_NAME atoms ({e}); title match falls back to WM_NAME")
    try:
        _ATOM_NET_WM_STATE = d.intern_atom("_NET_WM_STATE")
        _ATOM_NET_WM_STATE_ABOVE = d.intern_atom("_NET_WM_STATE_ABOVE")
        _ATOM_NET_WM_STATE_BELOW = d.intern_atom("_NET_WM_STATE_BELOW")
        _ATOM_NET_ACTIVE_WINDOW = d.intern_atom("_NET_ACTIVE_WINDOW")
    except Exception as e:
        log(f"warning: could not intern _NET_WM_STATE atoms ({e}); persistent always-on-top disabled")


def window_title(win) -> str:
    # Firefox sets its page title in _NET_WM_NAME (EWMH, UTF-8) and leaves the legacy WM_NAME empty
    # (live-verified 2026-07-16: WM_NAME=b'' but _NET_WM_NAME='HIGHASCG-OPERATOR-GUI — Mozilla
    # Firefox'). Reading only get_wm_name() saw '' and the title-marker match always failed → no
    # holes. Prefer _NET_WM_NAME, fall back to the legacy name.
    try:
        prop = win.get_full_property(_ATOM_NET_WM_NAME, _ATOM_UTF8_STRING)
        if prop and prop.value:
            val = prop.value
            return val.decode("utf-8", "replace") if isinstance(val, (bytes, bytearray)) else str(val)
    except Exception:
        pass
    try:
        name = win.get_wm_name()
        return name if isinstance(name, str) else ""
    except Exception:
        return ""


def window_class(win):
    try:
        wc = win.get_wm_class()
        if not wc:
            return "", ""
        return (wc[0] or "").lower(), (wc[1] or "").lower()
    except Exception:
        return "", ""


def is_operator_firefox(win, title_marker=OPERATOR_TITLE_MARKER) -> bool:
    """WO-262: firefox by WM_CLASS. WO-263 follow-up: AND the window title must carry `title_marker`
    (the operator page forces it) — WM_CLASS alone would also match the WO-258 browser-source
    firefoxes and any other firefox, which must NEVER be shaped. An empty/None marker disables the
    title requirement (back-compat)."""
    inst, cls = window_class(win)
    if not ("navigator" in inst or "navigator" in cls or "firefox" in inst or "firefox" in cls):
        return False
    if title_marker:
        return title_marker in window_title(win)
    return True


def absolute_geometry(win, root):
    """Returns (x, y, width, height) in ROOT coordinates, or None if unavailable.

    Only called on DIRECT children of root, whose get_geometry() x/y are already root-relative.
    (win.translate_coords(root, 0, 0) is the INVERSE mapping — live-verified 2026-07-16: it
    returned (-3072,0) for the operator-monitor windows at (3072,0), so a translate-based version
    never matched the monitor rect and the helper found no window.)
    """
    try:
        geom = win.get_geometry()
        return geom.x, geom.y, geom.width, geom.height
    except Exception:
        return None


def find_firefox_window(root, monitor, title_marker=OPERATOR_TITLE_MARKER):
    """Return (toplevel, client) for the operator kiosk Firefox on `monitor`, or None.

    Geometry is checked on the TOP-LEVEL ancestor (what the X server stacks/composites); the
    firefox WM_CLASS signature is matched recursively (depth <= 3) because a WM reparents Firefox
    inside an unnamed frame. Caspar's consumer shares the monitor rect but has no firefox-class
    descendant, so it is never returned.
    """
    try:
        toplevels = root.query_tree().children
    except Exception as e:
        log(f"query_tree failed: {e}")
        return None

    def signature_in(win, depth):
        if is_operator_firefox(win, title_marker):
            return win
        if depth >= 3:
            return None
        try:
            kids = win.query_tree().children
        except Exception:
            return None
        for k in kids:
            hit = signature_in(k, depth + 1)
            if hit is not None:
                return hit
        return None

    candidates = []
    for top in toplevels:
        try:
            attrs = top.get_attributes()
        except Exception:
            continue
        if attrs.map_state != X.IsViewable:
            continue
        geom = absolute_geometry(top, root)
        if not geom:
            continue
        x, y, w, h = geom
        if x != monitor["x"] or y != monitor["y"] or w != monitor["w"] or h != monitor["h"]:
            continue
        client = signature_in(top, 0)
        if client is not None:
            candidates.append((top, client))

    if not candidates:
        return None
    if len(candidates) > 1:
        log(f"WARNING: {len(candidates)} firefox windows matched monitor rect; using the first")
    return candidates[0]


def set_net_wm_state(win, state_atom, add=True):
    """EWMH _NET_WM_STATE client message to root (WM is Openbox; ABOVE/BELOW both in _NET_SUPPORTED).
    MUST target the CLIENT window Openbox manages, NOT the WM frame — a message for the frame is
    silently ignored (the 2026-07-16 'ABOVE did not stick' bug: it was sent for the frame)."""
    if _ATOM_NET_WM_STATE is None or state_atom is None or _ROOT is None or _DISPLAY is None:
        return
    try:
        data = [1 if add else 0, state_atom, 0, 1, 0]  # action(ADD/REMOVE), prop1, prop2=0, source=app
        ev = event.ClientMessage(window=win, client_type=_ATOM_NET_WM_STATE, data=(32, data))
        _ROOT.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        _DISPLAY.flush()
    except Exception as e:
        log(f"set_net_wm_state failed: {e}")


def find_caspar_consumer(root, monitor, channel):
    """Find the operator_gui Caspar screen consumer (WM_CLASS 'casparcg', title
    'Screen consumer [<channel>|...]'). Returns (toplevel, client) — the toplevel (WM frame, a
    direct root child) is what the X server stacks, the client is what Openbox reads EWMH state
    from; both are needed. The operator_gui channel is unique, so match by the channel signature
    in title/class ANYWHERE in the tree — NOT by exact monitor geometry (Openbox may frame/place
    the consumer at a different origin than the monitor rect, unlike Firefox which we position
    exactly). `monitor` is unused; kept for call symmetry."""
    def walk(win, depth):
        title = window_title(win)
        inst, cls = window_class(win)
        firefoxy = "navigator" in inst or "navigator" in cls or "firefox" in inst or "firefox" in cls
        is_caspar = (not firefoxy) and ("casparcg" in inst or "casparcg" in cls or title.startswith("Screen consumer"))
        sig = f"[{channel}|" if channel is not None else None
        if is_caspar and (sig is None or sig in title or sig in cls):
            return win
        if depth >= 4:
            return None
        try:
            for k in win.query_tree().children:
                hit = walk(k, depth + 1)
                if hit is not None:
                    return hit
        except Exception:
            return None
        return None

    try:
        for top in root.query_tree().children:
            hit = walk(top, 0)
            if hit is not None:
                return (top, hit)
    except Exception:
        return None
    return None


def lock_window_above(win):
    """Keep the Firefox CLIENT window above others (EWMH _NET_WM_STATE_ABOVE)."""
    set_net_wm_state(win, _ATOM_NET_WM_STATE_ABOVE, add=True)


def set_input_empty(pair):
    """Make a (toplevel, client) pair INPUT-DEAD: SET each window's input shape to the empty
    region. X SHAPE semantics make this the ONLY way to keep clicks off the Caspar consumer: a
    window's effective input region is the INTERSECTION of its input and bounding regions, so
    Firefox's input=full does NOT cover its bounding holes — a click inside a hole falls through
    to the window below no matter what (live-proven 2026-07-16: synthetic click in a hole raised
    Caspar over the FULLSCREEN+ABOVE Firefox, with BELOW still set on it — Openbox executes the
    focused client's restack). Input-dead, the consumer can never be clicked, focused, or
    click-raised; hole clicks land on the desktop, which is inert."""
    try:
        for win in pair:
            win.shape_rectangles(shape.SO.Set, shape.SK.Input, 0, 0, 0, [])
        return True
    except Exception as e:
        log(f"set_input_empty failed: {e}")
        return False


def restore_input(pair):
    """Reset both windows' input shape to default (full window) — exit cleanup, so a dead helper
    never leaves the consumer permanently unclickable outside operator mode."""
    try:
        for win in pair:
            win.shape_mask(shape.SO.Set, shape.SK.Input, 0, 0, X.NONE)
        return True
    except Exception as e:
        log(f"restore_input failed: {e}")
        return False


def activate_window(win):
    """EWMH _NET_ACTIVE_WINDOW (source=2, pager) — asks Openbox to focus AND raise `win` per its
    layer policy. Used by the stacking watchdog to put Firefox back on top after anything manages
    to hoist the consumer above it."""
    if _ATOM_NET_ACTIVE_WINDOW is None or _ROOT is None or _DISPLAY is None:
        return
    try:
        data = [2, 0, 0, 0, 0]  # source=pager, timestamp=0, currently-active=0
        ev = event.ClientMessage(window=win, client_type=_ATOM_NET_ACTIVE_WINDOW, data=(32, data))
        _ROOT.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
        _DISPLAY.flush()
    except Exception as e:
        log(f"activate_window failed: {e}")


def stacking_gap(root, caspar_top_id, firefox_top_id):
    """Owner request 2026-07-26: firefox must sit DIRECTLY above the consumer. Root children are
    bottom->top, so adjacency means fi == ci + 1. Returns 'inverted' (caspar above firefox),
    'gap' (window(s) between them), 'ok', or None when either id is unknown (nothing to fix)."""
    try:
        order = [w.id for w in root.query_tree().children]
        ci = order.index(caspar_top_id)
        fi = order.index(firefox_top_id)
        if ci > fi:
            return 'inverted'
        if fi != ci + 1:
            return 'gap'
        return 'ok'
    except Exception:
        return None


def enforce_caspar_under(root, monitor, channel, firefox_pair, prev_caspar_id, helper_open=False):
    """Keep the operator_gui Caspar consumer DIRECTLY under Firefox, permanently:
      - EWMH: strip BELOW, add ABOVE — the consumer rides the kiosk's layer so no normal-layer
        window can ever sit between them (owner request 2026-07-26);
      - SHAPE: input region EMPTY on frame+client (see set_input_empty — clicks in the bounding
        holes otherwise reach the consumer and Openbox raises it);
      - watchdog: 'inverted' (consumer above Firefox) → re-activate Firefox; 'gap' (anything
        between them) → restack the consumer as Firefox's direct below-sibling.
    Re-run every poll tick — a restarted Caspar spawns a fresh window with none of this state.
    Returns the (toplevel, client) pair found, or None."""
    if channel is None:
        return None
    pair = find_caspar_consumer(root, monitor, channel)
    if pair is None:
        return None
    top, client = pair
    is_new = client.id != prev_caspar_id
    if _ATOM_NET_WM_STATE_BELOW is not None:
        # Owner request 2026-07-26: nothing may land BETWEEN the kiosk and the consumer and hide
        # the previews. BELOW-layer pinning made that structurally impossible to guarantee (every
        # normal-layer window stacks above the below layer), so the consumer now rides the ABOVE
        # layer — same layer as the kiosk — restacked directly under Firefox by the watchdog.
        # Input-dead + never activated, so it still can't steal clicks or focus.
        set_net_wm_state(client, _ATOM_NET_WM_STATE_BELOW, add=False)
        set_net_wm_state(client, _ATOM_NET_WM_STATE_ABOVE, add=True)
    set_input_empty(pair)
    if is_new:
        log(f"caspar consumer window {client.id} (ch {channel}): pinned under kiosk (ABOVE layer) + input-dead")
    # todos27.07.26: while a helper window is deliberately RAISED over the kiosk (helper_open),
    # the adjacency heal must stand down — raising the consumer+kiosk pair here is exactly what
    # shoved the operator's browser back under the video ~2s after every raise. EWMH pinning and
    # the input-dead shape above stay in force; only the restack watchdog pauses.
    if firefox_pair is not None and not helper_open:
        gap = stacking_gap(root, top.id, firefox_pair[0].id)
        if gap == 'inverted':
            log("stacking inverted (caspar above firefox) — re-activating firefox")
            activate_window(firefox_pair[1])
            try:
                firefox_pair[0].configure(stack_mode=X.Above)
            except Exception:
                pass
        elif gap == 'gap':
            # Raise the consumer to the top of its layer, then the kiosk straight back over it —
            # layer-agnostic adjacency assert (Openbox clamps sibling restacks, but plain raises
            # are honored; this is the same configure the kiosk top-assert already relies on).
            global _LAST_GAP_LOGGED
            if not _LAST_GAP_LOGGED:
                log("window(s) between kiosk and consumer — raising consumer+kiosk pair")
                _LAST_GAP_LOGGED = True
            try:
                top.configure(stack_mode=X.Above)
                firefox_pair[0].configure(stack_mode=X.Above)
                if _DISPLAY is not None:
                    _DISPLAY.flush()
            except Exception as e:
                log(f"adjacency restack failed: {e}")
        elif gap == 'ok' and _LAST_GAP_LOGGED:
            _LAST_GAP_LOGGED = False
            log("kiosk/consumer adjacency restored")
    return pair


def apply_holes(pair, monitor, rects, channel=None, helper_open=False):
    """pair: (toplevel, client). Punch `rects` (window-relative == monitor-relative px) as HOLES in
    Firefox's BOUNDING shape (visual): SET bounding to the full window rect, then SUBTRACT each
    preview rect so the Caspar consumer below shows through.

    The INPUT shape is SET to the full window only as NORMALIZATION (an earlier design left holed
    input shapes behind). It does NOT make the holes clickable: X SHAPE intersects a window's
    input region with its bounding region, so where bounding has holes the window cannot receive
    input at all — 'drawn with holes but clicked everywhere' is impossible on one window
    (live-proven 2026-07-16). Clicks inside holes inevitably go to whatever is below; keeping them
    off the Caspar consumer is set_input_empty()'s job (the consumer is made input-dead, so hole
    clicks land on the inert desktop). Tradeoff stands: the video itself is not clickable —
    fine, previews are display-only, chrome/drag handles sit below.

    Empty `rects` -> restore unshaped (bounding + input reset) so a modal can render whole over
    preview areas. Applied to BOTH the WM frame (toplevel) and the firefox client inside it.
    """
    toplevel, client = pair
    full = (0, 0, int(monitor["w"]), int(monitor["h"]))
    try:
        for win in (toplevel, client):
            if not rects:
                win.shape_mask(shape.SO.Set, shape.SK.Bounding, 0, 0, X.NONE)
                win.shape_mask(shape.SO.Set, shape.SK.Input, 0, 0, X.NONE)
                continue
            win.shape_rectangles(shape.SO.Set, shape.SK.Bounding, 0, 0, 0, [full])
            for r in rects:
                win.shape_rectangles(shape.SO.Subtract, shape.SK.Bounding, 0, 0, 0, [tuple(r)])
            # INPUT = FULL window: catch clicks over the holes so they never reach Caspar below.
            win.shape_rectangles(shape.SO.Set, shape.SK.Input, 0, 0, 0, [full])
        # Keep Firefox on top — with holes punched, that is exactly what shows the video through.
        # Persistent (_NET_WM_STATE_ABOVE) so a click routed through a hole to the Caspar window
        # below cannot let the WM raise it over Firefox and hide the GUI. EWMH state MUST go to
        # the CLIENT window Openbox manages — a message for the frame is silently dropped (the
        # 2026-07-16 'ABOVE did not stick' bug).
        # WO-283: while the operator has a foreign window (DeckLink setup, nvidia-settings, file
        # manager, browser) open OVER the kiosk, skip the top-assert — re-raising here would bury
        # the very window they asked for. Everything else above still runs: the HOLES are applied
        # unchanged, and the kiosk keeps whatever _NET_WM_STATE_ABOVE it already has (we never
        # strip it), so the shaped-video contract is untouched and the kiosk is still in the ABOVE
        # layer. The helper is put in that same layer by the server side
        # (`xdotool windowstate --add ABOVE`, src/utils/x-display-session-runtime.js), which is what
        # lets an ordinary raise finally win against it. Restored the moment the helper closes or
        # dies (src/system/operator-helper-window.js's watchdog).
        if not helper_open:
            toplevel.configure(stack_mode=X.Above)
            lock_window_above(client)
        return True
    except Exception as e:
        log(f"apply_holes failed: {e}")
        return False


def clear_shape(pair):
    """Restore both windows' default (unshaped, no holes) bounding state — used on clean exit so a
    dead helper never leaves Firefox with permanent holes (dead regions the operator can't click).
    Only the bounding shape is reset; the input shape was never explicitly set."""
    try:
        for win in pair:
            win.shape_mask(shape.SO.Set, shape.SK.Bounding, 0, 0, X.NONE)
        return True
    except Exception as e:
        log(f"clear_shape failed: {e}")
        return False


def parse_line(line: str):
    obj = json.loads(line)
    m = obj.get("monitor") or {}
    monitor = {
        "x": int(m.get("x", 0)),
        "y": int(m.get("y", 0)),
        "w": int(m.get("w", 0)),
        "h": int(m.get("h", 0)),
    }
    rects = []
    for r in obj.get("rects") or []:
        rects.append((int(r[0]), int(r[1]), int(r[2]), int(r[3])))
    channel = obj.get("channel")
    channel = int(channel) if channel is not None else None
    title_marker = obj.get("titleMarker")
    title_marker = str(title_marker) if title_marker else OPERATOR_TITLE_MARKER
    # WO-283: the operator deliberately opened a foreign window over the kiosk. Absent/false in
    # every other state, so old feeders (and the boot payload) behave exactly as before.
    helper_open = obj.get("helperOpen") is True
    return monitor, rects, channel, title_marker, helper_open
