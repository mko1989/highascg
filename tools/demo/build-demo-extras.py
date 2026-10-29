#!/usr/bin/env python3
"""WO-815 phase 2 — the demo data set's pictures and Devices view (godot/client/demo/thumbs.json, device_view.json).

Reads the phase-1 data set (godot/client/demo/state.json, project.json) and one read-only capture of GET /api/device-view
from a node. Writes:

  thumbs.json       {"version", "type": "image/jpeg", "thumbs": {media id: base64 JPEG}} — one generated still per
                    picture media (a gradient, a motif and the clip's name; nothing from a real file). The simulated
                    server answers GET /api/thumbnail/<id> from it (look cards) and composites each look's still for
                    the PGM / PRV previews from it (core/demo/demo_video.gd). JSON, not .jpg files: res://demo/*.json is
                    already in every export preset and is read with FileAccess without Godot's importer.
  device_view.json  the capture, rebuilt for the demo: destinations / labels / ids mapped onto the demo's screen
                    destinations, the demo's channel map, no host name / MAC / EDID / serials / log paths / device paths.

  python3 tools/demo/build-demo-extras.py --device-view <capture.json> [--out godot/client/demo]

Both outputs pass build-demo-data.py's public-safe scan (thumbs.json: its keys; the base64 payload is image data).
"""
import argparse
import base64
import copy
import importlib.util
import io
import json
import math
import os
import re

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
_spec = importlib.util.spec_from_file_location("build_demo_data", os.path.join(HERE, "build-demo-data.py"))
BDD = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(BDD)

THUMB_W = 640
# media → (top colour, bottom colour, motif); anything else gets the default
STYLE = {
	"demo/opener.mov": ("#ff7a18", "#3a0ca3", "rings"), "demo/loop_a.mov": ("#00c9ff", "#1b1464", "bars"),
	"demo/loop_b.mov": ("#f72585", "#240046", "grid"), "demo/song_1_wall.mov": ("#ffd166", "#7b2cbf", "rays"),
	"demo/bumper.mov": ("#06d6a0", "#073b4c", "rings"), "demo/projection_loop.mov": ("#4cc9f0", "#3a0ca3", "bars"),
	"demo/song_1_projection.mov": ("#ffd166", "#9d0208", "rays"), "demo/black.png": ("#000000", "#000000", None),
}
DEFAULT_STYLE = ("#8d99ae", "#2b2d42", "grid")
HOST = {"hostname": "demo", "hardwareId": "demo", "mac": "", "platform": "linux", "collectedAt": "2026-10-29T12:00:00.000Z"}
MONITOR = "Demo display"
RENAME = {"sc60mon": "monitor"}  # owner-specific device names in the capture → neutral


def load(path):
	with open(path, encoding="utf-8") as f:
		return json.load(f)


def _rgb(h):
	return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _title(media_id):
	words = os.path.splitext(os.path.basename(media_id))[0].split("_")
	text = " ".join(w.upper() if len(w) == 1 else w for w in words)  # loop_a → "Loop A"
	return text[:1].upper() + text[1:]


def media_aspects(project, state):
	"""media id → w / h of the first screen a look shows it on (programResolutions[mainScope])."""
	res = state["channelMap"]["programResolutions"]
	out = {}
	for look in project["scenes"]["scenes"]:
		r = res[min(int(look.get("mainScope", 0)), len(res) - 1)]
		for layer in look.get("layers", []):
			out.setdefault(layer["source"]["value"], r["w"] / r["h"])
	return out


def thumb(media_id, aspect):
	w, h = THUMB_W, max(1, round(THUMB_W / aspect))
	top, bottom, motif = STYLE.get(media_id, DEFAULT_STYLE)
	a, b = _rgb(top), _rgb(bottom)
	img = Image.new("RGB", (w, h))
	px = img.load()
	for y in range(h):
		for x in range(w):
			t = min(1.0, max(0.0, 0.65 * y / h + 0.35 * x / w))
			px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
	if motif is None:
		return img
	d = ImageDraw.Draw(img, "RGBA")
	cx, cy = w * 0.62, h * 0.45
	if motif == "rings":
		for i in range(1, 12):
			r = i * h * 0.11
			d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 70 - i * 5), width=3)
	elif motif == "bars":
		for i in range(0, w, 36):
			d.rectangle([i, 0, i + 14, h], fill=(255, 255, 255, 28 + (i // 36 % 3) * 14))
	elif motif == "grid":
		for i in range(0, w, 40):
			d.line([i, 0, i - h, h], fill=(255, 255, 255, 50), width=2)
			d.line([i, 0, i + h, h], fill=(255, 255, 255, 30), width=2)
	elif motif == "rays":
		for i in range(24):
			ang = i * math.pi / 12
			d.line([cx, cy, cx + math.cos(ang) * w, cy + math.sin(ang) * w], fill=(255, 255, 255, 45), width=4)
	font = ImageFont.load_default(size=max(18, h // 6))
	text = _title(media_id)
	box = d.textbbox((0, 0), text, font=font)
	tx, ty = round(w * 0.06), round(h - (box[3] - box[1]) - h * 0.12)
	d.text((tx + 2, ty + 2), text, font=font, fill=(0, 0, 0, 140))
	d.text((tx, ty), text, font=font, fill=(255, 255, 255, 235))
	return img


def build_thumbs(project, state):
	aspects = media_aspects(project, state)
	out = {}
	for m in state["media"]:
		if m.get("type") not in ("MOVIE", "STILL"):
			continue
		buf = io.BytesIO()
		thumb(m["id"], aspects.get(m["id"], 16 / 9)).save(buf, "JPEG", quality=80, optimize=True)
		out[m["id"]] = base64.b64encode(buf.getvalue()).decode("ascii")
	return {"version": 1, "type": "image/jpeg", "thumbs": out}


def _dest_map(capture, demo_dests):
	"""capture destination id → demo destination (same mode and main, in order)."""
	free = list(demo_dests)
	out = {}
	for d in capture["screenDestinations"]["destinations"]:
		match = next((x for x in free if x["mode"] == d["mode"] and x["mainScreenIndex"] == d["mainScreenIndex"]), None)
		if match is None:
			raise SystemExit("[demo] capture destination %s (%s, main %s) has no demo twin" % (d["id"], d["mode"], d["mainScreenIndex"]))
		free.remove(match)
		out[d["id"]] = (d["label"], match)
	return out


def _scrub(v):
	"""EDID / monitor identity, long mode lists, device and home paths."""
	if isinstance(v, dict):
		for k in list(v.keys()):
			x = v[k]
			if k == "edid":
				v[k] = {"raw": "", "parsed": None}
			elif k == "monitor" and isinstance(x, dict):
				v[k] = {"monitorName": MONITOR, "preferredMode": x.get("preferredMode")}
			elif k == "monitorName" and x:
				v[k] = MONITOR
			elif k == "modes" and isinstance(x, list) and len(x) > 6:
				v[k] = [m for m in x if isinstance(m, dict) and m.get("current")][:1] + [m for m in x if not (isinstance(m, dict) and m.get("current"))][:5]
			elif k in ("logPath", "screensLogPath"):
				del v[k]
			else:
				_scrub(x)
				if isinstance(x, str) and (x.startswith("/dev/") or "/home/" in x):
					v[k] = ""
	elif isinstance(v, list):
		for x in v:
			_scrub(x)


def build_device_view(capture, state):
	cm = state["channelMap"]
	dests = state["screenDestinations"]
	text = json.dumps(capture, ensure_ascii=False)
	for old_id, (old_label, new) in _dest_map(capture, dests["destinations"]).items():
		text = text.replace(old_id, new["id"]).replace(json.dumps(old_label, ensure_ascii=False), json.dumps(new["label"], ensure_ascii=False))
	for old, new in RENAME.items():
		text = text.replace(old, new)
	for name in set(re.findall(r'"monitorName": "([^"]+)"', text)):  # also inside port labels ("HDMI 0 → DP-0 · P80 …")
		text = re.sub(r"\b%s\b" % re.escape(name), MONITOR, text)
	dv = json.loads(text)
	live = dv["live"]
	live["host"] = dict(HOST)
	_scrub(dv)
	hw = live.get("decklink", {}).get("hardware", {})
	for c in hw.get("connectors", []):
		c["externalRef"] = str(c.get("index", ""))
	audio = live.get("audio", {})
	ids = {p.get("id") for p in audio.get("portaudio", [])}
	audio["devices"] = [x for x in audio.get("devices", []) if x.get("id") in ids]
	caspar = live.get("caspar", {})
	caspar["host"], caspar["channelMap"] = "127.0.0.1", copy.deepcopy(cm)
	dv["screenDestinations"] = copy.deepcopy(dests)
	dv["live"]["warnings"] = []
	return dv


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--device-view", required=True, help="a capture of GET /api/device-view")
	ap.add_argument("--out", default=os.path.join(REPO, "godot", "client", "demo"))
	a = ap.parse_args()
	state, project = load(os.path.join(a.out, "state.json")), load(os.path.join(a.out, "project.json"))
	thumbs = build_thumbs(project, state)
	BDD.scan("thumbs.json", json.dumps({k: "" for k in thumbs["thumbs"]}))
	dv = build_device_view(load(a.device_view), state)
	for name, data in (("thumbs.json", thumbs), ("device_view.json", dv)):
		text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
		if name != "thumbs.json":
			BDD.scan(name, text)
		with open(os.path.join(a.out, name), "w", encoding="utf-8") as f:
			f.write(text + "\n")
		print("[demo] %-18s %7d bytes" % (name, len(text.encode("utf-8")) + 1))


if __name__ == "__main__":
	main()
