#!/usr/bin/env python3
"""
cef-interactive-x11.py — emit JSON lines for pointer + keyboard events inside configured zones.

Reads one JSON object from stdin:
  { "zones": [ { "id", "x", "y", "width", "height" }, ... ] }

Polls XQueryPointer (~60 Hz) and XQueryKeymap when the pointer is inside a zone.
Keyboard events are scoped to the zone under the pointer (operator focus follows mouse).
"""
from __future__ import annotations

import json
import os
import sys
import time

from Xlib import X, display

BUTTON_MASKS = (
	(getattr(X, "Button1Mask", 256), 1),
	(getattr(X, "Button2Mask", 512), 2),
	(getattr(X, "Button3Mask", 1024), 3),
)
KEYCODE_COUNT = 256
XK_SHIFT_L = 0xFFE1
XK_SHIFT_R = 0xFFE2
XK_CONTROL_L = 0xFFE3
XK_CONTROL_R = 0xFFE4
XK_ALT_L = 0xFFE9
XK_ALT_R = 0xFFEA
XK_META_L = 0xFFE7
XK_META_R = 0xFFE8


def load_zones() -> list[dict]:
	raw = sys.stdin.read()
	data = json.loads(raw or "{}")
	zones = data.get("zones") or []
	out: list[dict] = []
	for z in zones:
		out.append(
			{
				"id": str(z.get("id") or "?"),
				"x": int(z["x"]),
				"y": int(z["y"]),
				"width": int(z["width"]),
				"height": int(z["height"]),
			}
		)
	return out


def zone_at(zones: list[dict], rx: int, ry: int) -> dict | None:
	for z in zones:
		if z["x"] <= rx < z["x"] + z["width"] and z["y"] <= ry < z["y"] + z["height"]:
			return z
	return None


def trace_enabled() -> bool:
	v = os.environ.get("HIGHASCG_CEF_BRIDGE_TRACE", "1").strip().lower()
	return v not in ("0", "false", "no", "off")


def trace_all_motion() -> bool:
	v = os.environ.get("HIGHASCG_CEF_BRIDGE_TRACE", "").strip().lower()
	return v in ("all", "verbose")


def trace_event(obj: dict, root_x: int = 0, root_y: int = 0) -> None:
	if not trace_enabled():
		return
	typ = str(obj.get("type") or "")
	if typ == "mousemove" and not trace_all_motion():
		return
	if typ in ("keydown", "keyup"):
		sys.stderr.write(
			f"x11: {typ} zone={obj.get('zone')} keysym={obj.get('keysym', 0)} "
			f"text={json.dumps(obj.get('text') or '')}\n"
		)
	else:
		sys.stderr.write(
			f"x11: {typ} zone={obj.get('zone')} root=({root_x},{root_y}) "
			f"local=({obj.get('x')},{obj.get('y')}) btn={obj.get('button', 0)}\n"
		)
	sys.stderr.flush()


def emit(obj: dict, root_x: int = 0, root_y: int = 0) -> None:
	trace_event(obj, root_x, root_y)
	sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
	sys.stdout.flush()


def buttons_from_mask(mask: int) -> set[int]:
	out: set[int] = set()
	for bit, btn in BUTTON_MASKS:
		if mask & bit:
			out.add(btn)
	return out


def keycodes_down(keymap: bytes) -> set[int]:
	out: set[int] = set()
	for kc in range(KEYCODE_COUNT):
		byte = kc // 8
		bit = kc % 8
		if keymap[byte] & (1 << bit):
			out.add(kc)
	return out


def keysym_for_keycode(d: display.Display, keycode: int, shifted: bool = False) -> int:
	try:
		return int(d.keycode_to_keysym(keycode, 1 if shifted else 0))
	except Exception:
		return 0


def shift_keys_down(d: display.Display, keycodes: set[int]) -> bool:
	for kc in keycodes:
		ks = keysym_for_keycode(d, kc, False)
		if ks in (XK_SHIFT_L, XK_SHIFT_R):
			return True
	return False


def modifiers_from_held(d: display.Display, keycodes: set[int]) -> list[str]:
	mods: list[str] = []
	for kc in keycodes:
		ks = keysym_for_keycode(d, kc, False)
		if ks in (XK_CONTROL_L, XK_CONTROL_R) and "Control" not in mods:
			mods.append("Control")
		elif ks in (XK_ALT_L, XK_ALT_R) and "Alt" not in mods:
			mods.append("Alt")
		elif ks in (XK_SHIFT_L, XK_SHIFT_R) and "Shift" not in mods:
			mods.append("Shift")
		elif ks in (XK_META_L, XK_META_R) and "Meta" not in mods:
			mods.append("Meta")
	return mods


def keysym_text(keysym: int) -> str:
	if 0x20 <= keysym <= 0x7E:
		return chr(keysym)
	return ""


def emit_key_events(
	d: display.Display,
	zone: dict,
	pressed: set[int],
	released: set[int],
	held: set[int],
) -> None:
	shifted = shift_keys_down(d, held)
	for kc in sorted(pressed):
		keysym = keysym_for_keycode(d, kc, shifted)
		if keysym <= 0:
			continue
		emit(
			{
				"zone": zone["id"],
				"type": "keydown",
				"keysym": keysym,
				"text": keysym_text(keysym),
				"modifiers": modifiers_from_held(d, held),
			},
		)
	for kc in sorted(released):
		keysym = keysym_for_keycode(d, kc, shifted)
		if keysym <= 0:
			continue
		after = set(held)
		after.discard(kc)
		emit(
			{
				"zone": zone["id"],
				"type": "keyup",
				"keysym": keysym,
				"text": keysym_text(keysym),
				"modifiers": modifiers_from_held(d, after),
			},
		)


def main() -> int:
	zones = load_zones()
	if not zones:
		sys.stderr.write("cef-interactive-x11: no zones\n")
		return 1

	d = display.Display()
	root = d.screen().root
	prev_mask = 0
	last_move: tuple[int, int] | None = None
	prev_keys: set[int] = set()
	keyboard_zone: dict | None = None

	sys.stderr.write(f"cef-interactive-x11: watching {len(zones)} zone(s) + keyboard\n")
	sys.stderr.flush()

	while True:
		data = root.query_pointer()
		rx, ry = int(data.root_x), int(data.root_y)
		mask = int(data.mask)
		z = zone_at(zones, rx, ry)
		keymap = d.query_keymap()
		cur_keys = keycodes_down(keymap)

		if z:
			lx, ly = rx - z["x"], ry - z["y"]
			cur = buttons_from_mask(mask)
			prev = buttons_from_mask(prev_mask)
			for btn in sorted(cur - prev):
				emit({"zone": z["id"], "type": "mousedown", "x": lx, "y": ly, "button": btn}, rx, ry)
			for btn in sorted(prev - cur):
				emit({"zone": z["id"], "type": "mouseup", "x": lx, "y": ly, "button": btn}, rx, ry)
			if cur and (rx, ry) != last_move:
				emit({"zone": z["id"], "type": "mousemove", "x": lx, "y": ly, "button": 0}, rx, ry)
				last_move = (rx, ry)
			prev_mask = mask
			keyboard_zone = z
			emit_key_events(d, z, cur_keys - prev_keys, prev_keys - cur_keys, cur_keys)
			prev_keys = cur_keys
		else:
			if keyboard_zone and prev_keys:
				emit_key_events(d, keyboard_zone, set(), prev_keys, set())
			prev_mask = 0
			last_move = None
			prev_keys = set()
			keyboard_zone = None

		time.sleep(0.016)


if __name__ == "__main__":
	raise SystemExit(main())
