#!/usr/bin/env python3
"""WO-1123 — exit 0 while a Shift key is held on the X display (the modifier mask of XQueryPointer), else 1.

The Godot client asks this at a desktop drop: during a drag from the file manager the keyboard belongs to the file
manager, so the client's own key state never sees the Shift that means "move instead of copy".
"""
import ctypes, ctypes.util, sys

try:
    x = ctypes.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
    x.XOpenDisplay.restype = ctypes.c_void_p
    d = x.XOpenDisplay(None)
    if not d:
        sys.exit(2)
    x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x.XDefaultRootWindow.restype = ctypes.c_ulong
    w1, w2 = ctypes.c_ulong(), ctypes.c_ulong()
    a, b, c, e = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    mask = ctypes.c_uint()
    x.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong] + [ctypes.c_void_p] * 7
    x.XQueryPointer(d, x.XDefaultRootWindow(d), ctypes.byref(w1), ctypes.byref(w2), ctypes.byref(a), ctypes.byref(b),
                    ctypes.byref(c), ctypes.byref(e), ctypes.byref(mask))
    sys.exit(0 if mask.value & 1 else 1)  # ShiftMask
except SystemExit:
    raise
except Exception:
    sys.exit(2)
