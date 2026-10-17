extends RefCounted
## WO-600 step 1 — pure deck logic ported 1:1 from the web client (no UI, unit-tested):
##   screen count       client/components/scenes-editor.js:45  max(1, channelMap.screenCount)
##   looks per main     client/lib/scene-state.js:266-272      mainScope === 'all' || == mainIdx
##   PGM/PRV per main   client/lib/scene-live-main-sync.js:62  resolveBusLookIdsForMain()
## Godot JSON numbers are floats → channel numbers are compared via int(), ids via str().


static func screen_count(channel_map: Dictionary) -> int:
	return max(1, int(channel_map.get("screenCount", 1)))


static func scene_matches_main(scene: Dictionary, main_idx: int) -> bool:
	var m := str(scene.get("mainScope", ""))
	return m == "all" or m == str(main_idx)


static func scenes_for_main(scenes: Array, main_idx: int) -> Array:
	return scenes.filter(func(s: Variant) -> bool: return s is Dictionary and scene_matches_main(s, main_idx))


## Returns {pgm: id|"" , prv: id|""} for one main column.
## `project_scenes` = project.scenes (liveSceneIdByMain / previewSceneIdByMain are the fallback the
## web client reads through sceneState when scene.live has no entry for the main's channels).
static func resolve_bus_look_ids(main_idx: int, scene_live: Dictionary, channel_map: Dictionary,
		known_ids: Dictionary, project_scenes: Dictionary) -> Dictionary:
	var idx: int = max(0, main_idx)
	var programs: Array = channel_map.get("programChannels", [])
	var previews: Array = channel_map.get("previewChannels", [])
	var pgm_ch: int = int(programs[idx]) if idx < programs.size() and programs[idx] != null else 0
	var prv_ch: int = int(previews[idx]) if idx < previews.size() and previews[idx] != null else 0
	var has_separate_prv := prv_ch > 0 and prv_ch != pgm_ch

	var pgm := ""
	if pgm_ch > 0:
		pgm = _known(_live_scene_id(scene_live, pgm_ch), known_ids)
	var prv := ""
	if has_separate_prv:
		prv = _known(_live_scene_id(scene_live, prv_ch), known_ids)
	if pgm == "":
		pgm = _known(_by_main(project_scenes.get("liveSceneIdByMain", []), idx), known_ids)
	if has_separate_prv and prv == "":
		prv = _known(_by_main(project_scenes.get("previewSceneIdByMain", []), idx), known_ids)
	# PGM-only mains (no PRV channel): the armed look lives in client state (B150.3).
	if not has_separate_prv:
		prv = _known(_by_main(project_scenes.get("previewSceneIdByMain", []), idx), known_ids)
	if prv == pgm:
		prv = ""
	return {"pgm": pgm, "prv": prv}


static func _live_scene_id(scene_live: Dictionary, ch: int) -> String:
	var entry: Variant = scene_live.get(str(ch))
	if entry is Dictionary:
		return str((entry as Dictionary).get("sceneId", "")).strip_edges()
	return ""


static func _by_main(arr: Variant, idx: int) -> String:
	if arr is Array and idx < (arr as Array).size() and (arr as Array)[idx] != null:
		return str((arr as Array)[idx])
	return ""


static func _known(id: String, known_ids: Dictionary) -> String:
	return id if id != "" and known_ids.has(id) else ""


static func screen_label(channel_map: Dictionary, idx: int) -> String:
	var labels: Array = channel_map.get("screenLabels", [])
	if idx < labels.size() and str(labels[idx]) != "":
		return str(labels[idx])
	return "Main %d" % (idx + 1)
