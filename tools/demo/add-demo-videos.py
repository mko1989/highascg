#!/usr/bin/env python3
"""WO-865 — put the two playable placeholder videos into the demo data set (run by build-demo-videos.sh, idempotent).

  state.json     media list: demo/placeholder_loop.ogv (10 s, 25 fps) and demo/placeholder_clip.ogv (30 s, 25 fps)
  project.json   two looks on the LED wall main, "Video loop" (loop on) and "Video clip" (loop off), cloned from Loop A
  state.json     scene.deck.looks lists them too
  thumbs.json    one JPEG still each (the look cards' thumbnails)

  python3 tools/demo/add-demo-videos.py --out godot/client/demo --stills <dir with placeholder_loop.jpg / placeholder_clip.jpg>
The result goes through build-demo-data.py's public-safe scan. build-demo-data.py's MEDIA also lists the two clips, so a
full rebuild of the data set keeps them in the media list (the looks and stills are added by this script afterwards).
"""
import argparse
import base64
import copy
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("build_demo_data", os.path.join(HERE, "build-demo-data.py"))
BDD = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(BDD)

CLIPS = [  # media id, durationMs, look id, look name, loop
	("demo/placeholder_loop.ogv", 10000, "look-video-loop", "Video loop", True),
	("demo/placeholder_clip.ogv", 30000, "look-video-clip", "Video clip", False),
]


def write(out, name, data):
	text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
	BDD.scan(name, text if name != "thumbs.json" else json.dumps({k: "" for k in data["thumbs"]}))
	with open(os.path.join(out, name), "w", encoding="utf-8") as f:
		f.write(text + "\n")


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--out", required=True)
	ap.add_argument("--stills", required=True)
	a = ap.parse_args()
	load = lambda n: BDD.load(os.path.join(a.out, n))
	state, project, thumbs = load("state.json"), load("project.json"), load("thumbs.json")
	ids = {c[0] for c in CLIPS}
	state["media"] = [m for m in state["media"] if m["id"] not in ids]
	looks = project["scenes"]["scenes"]
	looks[:] = [l for l in looks if l["id"] not in {c[2] for c in CLIPS}]
	proto = next(l for l in looks if l["id"] == "look-loop-a")
	for media, ms, lid, lname, loop in CLIPS:
		size = os.path.getsize(os.path.join(a.out, os.path.basename(media)))
		state["media"].append({"id": media, "label": media, "type": "MOVIE", "fileSize": size, "fps": 25, "durationMs": ms})
		look = copy.deepcopy(proto)
		look["id"], look["name"] = lid, lname
		layer = look["layers"][0]
		layer["source"] = {"type": "media", "value": media, "label": media}
		layer["loop"] = loop
		looks.append(look)
		with open(os.path.join(a.stills, os.path.basename(media).replace(".ogv", ".jpg")), "rb") as f:
			thumbs["thumbs"][media] = base64.b64encode(f.read()).decode("ascii")
	state["media"].sort(key=lambda m: m["id"])
	deck = state["scene"]["deck"]["looks"]
	deck[:] = [d for d in deck if d["id"] not in {c[2] for c in CLIPS}]
	deck += [{"id": c[2], "name": c[3], "mainScope": "0"} for c in CLIPS]
	for name, data in (("state.json", state), ("project.json", project), ("thumbs.json", thumbs)):
		write(a.out, name, data)
	print("[demo] added %s" % ", ".join(sorted(ids)))


if __name__ == "__main__":
	main()
