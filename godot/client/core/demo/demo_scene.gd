extends RefCounted
## WO-815 — the simulated server's looks and buses (core/demo/demo_server.gd routes here). The node's take path builds an
## AMCP batch for Caspar (src/api/routes-scene-take-look.js); the demo only does what the client can see of it: the
## look goes into `scene.live` for the main's PGM or PRV channel (channelMap programChannels / previewChannels) and the
## `change scene.live` broadcast follows (src/state/live-scene-state.js broadcastSceneLive, with ws-server.js's seq).
## The show document: autosave / save replace the in-memory project; the `scene_deck_sync` socket message replaces its
## looks (the node's live deck mirror, routes-data-project-handlers.js enrichProjectScenesFromLiveDeck).
## Phase 2: the operator channel's compose windows (routes-operator-gui.js GET / POST /api/operator-gui/layout) are kept
## so demo_video.gd can draw the operator picture; never atlas mode (like a screen surface, the reply has no slots).


## → a result, or null when the path is not one of these.
static func route(s: RefCounted, verb: String, path: String, b: Variant) -> Variant:
	var body: Dictionary = b if b is Dictionary else {}
	match [verb, path]:
		["POST", "/api/scene/take-look"]:
			return take(s, str(body.get("sceneId", "")), body.get("mainIdx"), str(body.get("target", "program")), body)
		["POST", "/api/scene/preview-push"]:
			var r: Dictionary = take(s, str(body.get("sceneId", "")), body.get("mainIdx"), "preview")
			if r.ok:
				r.data["mode"] = "take"
			return r
		["POST", "/api/scene/live/preview/clear"]:
			return clear_bus(s, int(body.get("mainIdx", 0)), "preview")
		["POST", "/api/ftb"]:
			return clear_bus(s, int(body.get("screenIdx", 0)), "program")
		["POST", "/api/scene/new-look"]:
			return new_look(s, body)
		["GET", "/api/operator-gui/layout"]:
			return s.reply({"ok": true, "channel": null, "cells": s.op_cells, "atlas": null})
		["POST", "/api/operator-gui/layout"]:
			s.op_cells = (body.cells as Array).filter(func(c: Variant) -> bool: return c is Dictionary) if body.get("cells") is Array else []
			return s.reply({"ok": true, "atlas": null, "demo": true})
		["POST", "/api/project/autosave"], ["POST", "/api/project/save"]:
			if not (body.get("project") is Dictionary):
				return s.refuse(400, "project required")
			s.project = body.project
			s.project["rev"] = int(s.project.get("rev", 0)) + 1
			return s.reply({"ok": true, "rev": s.project.rev, "changed": false})
	return null


static func find_look(s: RefCounted, id: String) -> Dictionary:
	for l in looks(s):
		if l is Dictionary and str(l.get("id", "")) == id:
			return l
	return {}


static func looks(s: RefCounted) -> Array:
	var root: Variant = s.project.get("scenes")
	return (root as Dictionary).get("scenes", []) if root is Dictionary else []


## The PGM (`program`) or PRV (`preview`) channel of a main; 0 when it has none (a PGM-only main has no PRV).
static func bus_channel(s: RefCounted, main: int, target: String) -> int:
	var cm: Dictionary = s.state.get("channelMap", {}) if s.state.get("channelMap") is Dictionary else {}
	var list: Array = cm.get("previewChannels" if target == "preview" else "programChannels", [])
	return int(list[main]) if main >= 0 and main < list.size() and list[main] != null else 0


## take-look: `target` "program" or "preview"; the main is `main_idx`, else the look's own mainScope.
## `opts` is the request body: `forceCut` / `transitionOverride` (program only) pick the fade like routes-scene-take-look.js.
static func take(s: RefCounted, scene_id: String, main_idx: Variant, target: String, opts := {}) -> Dictionary:
	if scene_id == "":
		return s.refuse(400, "sceneId required")
	var look := find_look(s, scene_id)
	if look.is_empty():
		return s.refuse(404, "look %s not found in the stored project" % scene_id)
	var main := int(main_idx) if main_idx is float or main_idx is int else int(str(look.get("mainScope", "0")).to_int())
	var tgt := "preview" if target == "preview" else "program"
	var ch := bus_channel(s, main, tgt)
	if ch <= 0:
		return s.refuse(400, "no %s channel for main %d" % [tgt, main])
	var live: Dictionary = (s.state.get("scene", {}) as Dictionary).get("live", {}).duplicate(true)
	live[str(ch)] = {"sceneId": scene_id, "scene": look.duplicate(true), "updatedAt": s.now_ms.call()}
	s.bus_fx[str(ch)] = {"kind": "take", "transition": transition_for(look, tgt, opts), "fps": channel_fps(s, ch), "at": s.clock()}
	s.change("scene.live", live)
	var bus := "previewSceneIdByMain" if tgt == "preview" else "liveSceneIdByMain"
	var by_main: Variant = (s.project.get("scenes", {}) as Dictionary).get(bus)
	if by_main is Array and main < (by_main as Array).size():
		by_main[main] = scene_id
	return s.reply({"ok": true, "sceneId": scene_id, "mainIdx": main, "target": tgt, "channel": ch, "demo": true})


## The transition of a take: the look's own `defaultTransition`; "Take (global)" replaces it on a program take; forceCut cuts.
static func transition_for(look: Dictionary, target: String, opts: Dictionary) -> Dictionary:
	if opts.get("forceCut") == true:
		return {"type": "CUT", "duration": 0, "tween": "linear"}
	if target == "program" and opts.get("transitionOverride") is Dictionary:
		return opts.transitionOverride
	return look.get("defaultTransition", {}) if look.get("defaultTransition") is Dictionary else {}


static func channel_fps(s: RefCounted, ch: int) -> float:
	var by: Variant = (s.state.get("channelMap", {}) as Dictionary).get("channelResolutionsByChannel")
	var res: Variant = (by as Dictionary).get(str(ch)) if by is Dictionary else null
	return float(res.get("fps", 25)) if res is Dictionary else 25.0


static func clear_bus(s: RefCounted, main: int, target: String) -> Dictionary:
	var ch := bus_channel(s, main, target)
	if ch <= 0:
		return s.refuse(400, "no %s channel for main %d" % [target, main])
	var live: Dictionary = (s.state.get("scene", {}) as Dictionary).get("live", {}).duplicate(true)
	live.erase(str(ch))
	s.bus_fx[str(ch)] = {"kind": "ftb" if target == "program" else "clear", "fps": channel_fps(s, ch), "at": s.clock()}
	s.change("scene.live", live)
	return s.reply({"ok": true, "channel": ch, "demo": true})


## web addScene: an empty look (or one with the dropped source on layer 10), named "Look N".
static func new_look(s: RefCounted, body: Dictionary) -> Dictionary:
	var n := looks(s).size() + 1
	var id := "look-demo-%d-%d" % [n, int(s.now_ms.call()) % 100000]
	var lk := {"id": id, "name": "Look %d" % n, "mainScope": str(body.get("mainScope", "0")), "layers": [],
		"defaultTransition": {"type": "MIX", "duration": 12, "tween": "linear"}}
	if body.get("source") is Dictionary:
		lk.layers.append({"layerNumber": 10, "source": body.source, "loop": false, "opacity": 1, "volume": 1, "muted": false,
			"fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}, "contentFit": "native", "aspectLocked": true})
	return s.reply({"ok": true, "look": lk})


## `scene_deck_sync {looks, sceneSnapshots, previewSceneId, layerPresets, lookPresets}` → the project's looks.
static func deck_sync(s: RefCounted, d: Dictionary) -> void:
	var root: Variant = s.project.get("scenes")
	if not (root is Dictionary):
		root = {}
		s.project["scenes"] = root
	if d.get("sceneSnapshots") is Array:
		root["scenes"] = d.sceneSnapshots
	for k in ["layerPresets", "lookPresets"]:
		if d.get(k) is Array:
			root[k] = d[k]
	if d.has("previewSceneId"):
		root["previewSceneId"] = d.previewSceneId
	var deck := {"looks": d.get("looks", [])}
	s.write_path(s.state, "scene.deck", deck)
