#!/usr/bin/env python3
"""WO-815 — build the Godot client's demo data set (godot/client/demo/*.json) for the simulated server.

Input: a show project (default projects/mhp_harder.json) and a directory of read-only GET captures from a node
(state.json, fixtures_types.json, fixtures_pixelmap_pixels.json, scene_effect-registry.json, …; file name = the
path with "/", "?" and "=" turned into "_"). Output: small, public-safe JSON — nothing is copied wholesale:
every look, media name, fixture and setting is rebuilt from a whitelist with neutral names, and the result is
scanned for IP addresses, home paths, show names and secrets before it is written (the build fails on a hit).

  python3 tools/demo/build-demo-data.py --capture <dir> [--project projects/mhp_harder.json] [--out godot/client/demo]
"""
import argparse
import copy
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
T0 = 1793000000000  # a fixed "server" time for updatedAt stamps (ms)

# source look name (+ main) → (demo id, demo name, [demo media per layer])
LOOKS = [
	("Intro", "0", "look-opener", "Opener", ["demo/opener.mov", "demo/backing_track.wav", "demo/click.wav"]),
	("Loop1", "0", "look-loop-a", "Loop A", ["demo/loop_a.mov"]),
	("KV LOOP 2", "0", "look-loop-b", "Loop B", ["demo/loop_b.mov"]),
	("W głowie dioda", "0", "look-song-1", "Song 1", ["demo/song_1_wall.mov"]),
	("BUMPER", "0", "look-bumper", "Bumper", ["demo/loop_b.mov", "demo/bumper.mov"]),
	("blackFHD", "0", "look-black-wall", "Black", ["demo/black.png"]),
	("KV LOOP projekcja", "1", "look-proj-loop", "Projection loop", ["demo/projection_loop.mov"]),
	("W głowie projekcja", "1", "look-proj-song-1", "Song 1 projection", ["demo/song_1_projection.mov"]),
	("blackFHD", "1", "look-black-proj", "Black", ["demo/black.png"]),
]
MEDIA = {  # demo media id → (type, durationMs, fps, fileSize)
	"demo/opener.mov": ("MOVIE", 63320, 50, 412000000), "demo/backing_track.wav": ("AUDIO", 63000, 0, 22000000),
	"demo/click.wav": ("AUDIO", 63000, 0, 11000000), "demo/loop_a.mov": ("MOVIE", 20000, 50, 130000000),
	"demo/loop_b.mov": ("MOVIE", 24000, 50, 156000000), "demo/song_1_wall.mov": ("MOVIE", 215000, 50, 1400000000),
	"demo/bumper.mov": ("MOVIE", 8000, 50, 52000000), "demo/black.png": ("STILL", 0, 0, 25000),
	"demo/projection_loop.mov": ("MOVIE", 20000, 50, 64000000), "demo/song_1_projection.mov": ("MOVIE", 215000, 50, 690000000),
}
LIVE = {"1": "look-opener", "2": "look-loop-a", "3": "look-proj-loop", "4": "look-proj-song-1"}  # channel → look on air
TEMPLATES = ["BLACK", "COLOR_BG", "PLAYBACK_TIMERS", "COUNTDOWN/COUNTDOWN", "LED_TEST_PATTERN/INDEX", "PIP_BORDER",
	"PIP_GLOW", "PIP_SHADOW", "SHADERS/SH-BG-AURORAS", "SHADERS/SH-BG-SYNTH-WAVES", "SHADERS/SH-BG-STARFIELD02"]
PIXEL_TYPE = "6ad826d14d1b"
PIXEL_COUNT = 8
ALLOWED_IPS = {"127.0.0.1", "0.0.0.0", "255.255.255.255", "236.10.10.10"}
FORBIDDEN = ["/home/", "mhp", "harder", "casparcg/", "VISUALE", "visuale", "BRIDGE", "bridge/", "MARCIN", "Marcin",
	"projekcja", "dioda", "testowe", "/dev/", "Bearer", "api-token", "LUNG", "Lung"]


def load(path):
	with open(path, encoding="utf-8") as f:
		return json.load(f)


def cap(d, name):
	return load(os.path.join(d, name))


def demo_looks(project):
	src = project["scenes"]["scenes"]
	out = []
	for name, main, lid, lname, media in LOOKS:
		s = next(x for x in src if x["name"] == name and str(x.get("mainScope")) == main)
		look = {k: copy.deepcopy(s[k]) for k in ("layers", "mainScope", "defaultTransition", "globalBorder") if k in s}
		look["id"], look["name"] = lid, lname
		look["layers"] = look["layers"][: len(media)]
		for layer, value in zip(look["layers"], media):
			layer["source"] = {"type": "media", "value": value, "label": value}
			for k in ("trimInMs", "trimOutMs"):
				layer.pop(k, None)
			if layer.get("startBehaviour") == "custom":
				layer["startBehaviour"] = "beginning"
		out.append({"id": lid, "name": lname, **look})
	return out


def pixel_fixtures(project):
	src = [f for f in project["fixtures"]["patch"] if f.get("typeId") == PIXEL_TYPE][:PIXEL_COUNT]
	ids, out = {}, []
	for i, f in enumerate(src, 1):
		fx = copy.deepcopy(f)
		ids[f["id"]] = "fx-pixelline-%02d" % i
		fx["id"], fx["name"], fx["dest"] = ids[f["id"]], "PixelLine %d" % i, "127.0.0.1"
		fx["universe"] = 1
		fx.pop("mvr", None)
		out.append(fx)
	return out, ids


def build_project(project, looks, fixtures, ids):
	tl = copy.deepcopy(project["timelines"])
	for t in tl["timelines"]:
		t["id"], t["name"] = "tl-opener", "Opener timeline"
		for li, layer in enumerate(t["layers"]):
			layer["id"] = "tl-opener-l%d" % (li + 1)
			for ci, c in enumerate(layer["clips"]):
				c["id"] = "tl-opener-c%d" % (ci + 1)
				c["source"] = {"type": "media", "value": "demo/opener.mov", "label": "demo/opener.mov"}
	tl["activeId"] = "tl-opener"
	stage = copy.deepcopy(project["previs"]["stage"])
	for o in stage["objects"]:
		o.pop("mvr", None)
	stage["objects"][0]["name"], stage["objects"][1]["name"], stage["objects"][2]["name"] = "LED wall L", "LED wall C", "LED wall R"
	maps = [dict(m, id="map-%s-%d" % (ids[m["fixtureId"]], m.get("pixel", 1)), fixtureId=ids[m["fixtureId"]])
		for m in project.get("pixelMappings", []) if m.get("fixtureId") in ids]
	fx = copy.deepcopy(project["fixtures"])
	fx["output"]["enabled"], fx["dmx"]["enabled"], fx["patch"] = False, False, fixtures
	fx["groups"], fx["looks"], fx["marks"] = [], {}, []
	oc = copy.deepcopy(project["operatorCompose"])
	oc.pop("savedAt", None)
	return {
		"version": 1, "name": "Demo show", "slug": "demo_show", "rev": 1, "savedAt": "2026-10-29T12:00:00.000Z",
		"scenes": {
			"scenes": looks, "liveSceneIdByMain": ["look-opener", "look-proj-loop", None, None],
			"previewSceneIdByMain": ["look-loop-a", "look-proj-song-1", None, None], "liveSceneId": "look-opener",
			"previewSceneId": "look-loop-a", "activeScreenIndex": 0,
			"globalDefaultTransition": copy.deepcopy(project["scenes"]["globalDefaultTransition"]),
			"mainEditorVisible": copy.deepcopy(project["scenes"]["mainEditorVisible"]), "layerPresets": [], "lookPresets": [],
			"timers": [], "globalBorders": copy.deepcopy(project["scenes"]["globalBorders"]),
		},
		"programOutput": copy.deepcopy(project["programOutput"]), "timelines": tl, "multiview": copy.deepcopy(project["multiview"]),
		"placeholders": [], "previs": {"stage": stage}, "fixtures": fx, "operatorCompose": oc, "pixelMappings": maps,
	}


def build_channel_map(state):
	cm = copy.deepcopy(state["channelMap"])
	cm["screenLabels"] = ["LED wall", "Projection"]
	return cm


def build_state(state, project, cm):
	by_id = {s["id"]: s for s in project["scenes"]["scenes"]}
	live = {ch: {"sceneId": lid, "scene": copy.deepcopy(by_id[lid]), "updatedAt": T0} for ch, lid in LIVE.items()}
	looks = [{"id": s["id"], "name": s["name"], "mainScope": s["mainScope"]} for s in project["scenes"]["scenes"]]
	channels = [{"id": c["id"], "layers": [], "videoMode": c.get("videoMode", ""), "status": "", "oscFormat": c.get("oscFormat", ""),
		"oscLayers": {}, "oscProfiler": {"actual": None, "expected": None, "healthy": True}, "oscOutputs": {},
		"framerate": c.get("framerate", "50")} for c in state["channels"]]
	media = [{"id": k, "label": k, "type": v[0], "fileSize": v[3], "fps": v[2], "durationMs": v[1]} for k, v in sorted(MEDIA.items())]
	dests = copy.deepcopy(state["screenDestinations"])
	for i, d in enumerate(dests["destinations"]):
		d.pop("stream", None)
		d["id"] = "dst_demo_%d" % i
		if d.get("mode") == "pgm_prv":
			d["label"] = cm["screenLabels"][int(d.get("mainScreenIndex", 0))]
	return {
		"channels": channels, "media": media, "templates": [{"id": t, "label": t} for t in TEMPLATES],
		"serverInfo": {"version": "demo (simulated server)"}, "decklinkInputs": [], "routes": {}, "osc": {"channels": {}, "updatedAt": T0},
		"audio": {}, "reconcileDiff": None, "variables": {}, "screenDestinations": dests,
		"caspar": {"connected": True, "host": "demo", "port": 0, "at": T0, "versionLine": "demo (simulated server)"},
		"ledTestPatternActive": False, "liveAudioInputsStatus": {"enabled": False, "reason": "demo"},
		"v4l2InputsStatus": {"enabled": False, "reason": "demo"}, "channelMap": cm,
		"scene": {"live": live, "liveAudioOnly": {}, "programLayerBankByChannel": {"1": "a", "2": "a", "3": "a", "4": "a"},
			"deck": {"looks": looks}, "globalBorders": copy.deepcopy(project["scenes"]["globalBorders"])},
		"timeline": {"list": copy.deepcopy(project["timelines"]["timelines"]), "playback": None}, "playback": {"matrix": {}},
		"composePreview": {"blocklist": {"channels": [], "byChannel": {}}}, "localMediaEnabled": False,
		"ui": {"oscFooterVu": True, "rundownPlaybackTimer": True, "nuclearRequirePassword": False, "nuclearPassword": "",
			"nuclearPasswordHash": "", "legacyJsPixelmap": False, "invertTouchpadScroll": False},
		"extraLiveSources": [], "sourceLabels": {}, "hostLiveMigrationWarnings": [], "hostOperatorFullscreen": None,
	}


def build_settings(settings, state, cm):
	keep = ["composePreview", "editorDefaults", "dmx", "startup", "projectScopedMedia", "machineProfile", "companion", "usbIngest"]
	out = {k: copy.deepcopy(settings[k]) for k in keep if k in settings}
	ar = copy.deepcopy(settings.get("audioRouting", {}))
	for k, v in list(ar.items()):
		if isinstance(v, str) and k not in ("programLayout", "programOutput", "monitorOutput", "browserMonitor"):
			ar[k] = ""
	out.update({
		"caspar": {"host": "127.0.0.1", "port": 5250}, "server": {"httpPort": 4200, "bindAddress": "127.0.0.1"},
		"ui": dict(state["ui"]), "audioRouting": ar, "channelMap": cm, "offline_mode": False, "screen_count": 2,
		"screenDestinations": state["screenDestinations"], "security": {"enforceAuth": False, "exposeToNetwork": False, "hasApiToken": False},
		"local_media_path": "", "streamOutputs": [], "recordOutputs": [], "audioOutputs": [],
	})
	out["companion"] = {k: v for k, v in out.get("companion", {}).items() if k != "host"}
	return out


def build_fixture_data(cap_dir, ids, maps):
	types = [dict(t) for t in cap(cap_dir, "fixtures_types.json")["types"] if t["id"] == PIXEL_TYPE]
	for t in types:
		t.pop("file", None)
		t.pop("importedAt", None)
	pixels = []
	for f in cap(cap_dir, "fixtures_pixelmap_pixels.json")["fixtures"]:
		if f["id"] in ids:
			n = ids[f["id"]]
			pixels.append(dict(f, id=n, name="PixelLine %d" % int(n[-2:]), universe=1))
	return ({"types": types}, {"ok": True, "fixtures": pixels},
		{"ok": True, "mappings": [dict(m, problem=None) for m in maps]})


def scan(name, text):
	bad = [ip for ip in re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text) if ip not in ALLOWED_IPS]
	bad += [w for w in FORBIDDEN if w in text]
	bad += re.findall(r'"(?:password|nuclearPassword|token|apiToken|streamKey|passphrase|secret)":\s*"[^"]+"', text)
	if bad:
		sys.exit("[demo] %s is not public-safe: %s" % (name, sorted(set(bad))[:10]))


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--capture", required=True)
	ap.add_argument("--project", default=os.path.join(REPO, "projects", "mhp_harder.json"))
	ap.add_argument("--out", default=os.path.join(REPO, "godot", "client", "demo"))
	a = ap.parse_args()
	src, state, settings = load(a.project), cap(a.capture, "state.json"), cap(a.capture, "settings.json")
	fixtures, ids = pixel_fixtures(src)
	project = build_project(src, demo_looks(src), fixtures, ids)
	cm = build_channel_map(state)
	types, pixels, pixelmap = build_fixture_data(a.capture, ids, project["pixelMappings"])
	reg = cap(a.capture, "scene_effect-registry.json")
	files = {
		"project.json": project, "state.json": build_state(state, project, cm), "settings.json": build_settings(settings, state, cm),
		"fixture_types.json": types, "pixelmap_pixels.json": pixels, "pixelmap.json": pixelmap, "effect_registry.json": reg,
		"layer_options.json": cap(a.capture, "scene_layer-options_mainIdx_0.json"),
		"timers.json": {"ok": True, "timers": [{"timerId": "timer-show", "name": "Show clock", "config": {"mode": "duration", "durationSec": 300},
			"lastCmd": None, "cmdAt": None, "remainingSec": None, "screens": {"0": {"channel": 1, "layer": 980, "visible": False, "opacity": 1}}}]},
		"mixer.json": {"ok": True, "gains": {"pgm:1": 1.0, "pgm:3": 1.0}, "muted": {}, "solos": []},
	}
	os.makedirs(a.out, exist_ok=True)
	total = 0
	for name, data in files.items():
		text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
		scan(name, text)
		with open(os.path.join(a.out, name), "w", encoding="utf-8") as f:
			f.write(text + "\n")
		total += len(text.encode("utf-8")) + 1
		print("[demo] %-22s %7d bytes" % (name, len(text.encode("utf-8")) + 1))
	print("[demo] total %d bytes in %s" % (total, a.out))


if __name__ == "__main__":
	main()
