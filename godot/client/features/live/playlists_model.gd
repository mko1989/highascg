extends RefCounted
## WO-603 — Playlists panel text and request bodies (web playlist-control-panel.js). Pure. Every rule is the
## server's: GET /api/playlist/state carries live / activeIndex / startIndex, per item `timeless` and `missing`,
## per playlist `timelessSecs`; "Set all" is planned in node (action set_timeless).


static func key_of(p: Dictionary) -> String:
	return "%s:%d" % [str(p.get("sceneId", "")), int(p.get("layerNumber", 0))]


## "● Look · L10 · ch1" (live) / "Look · L10 · PRV ch2" (recalled on PRV, WO-581) / "Look · L10 · not live" (WO-347).
static func list_label(p: Dictionary) -> String:
	var where := " · not live"
	if p.get("live", false):
		where = " · ch%d" % int(p.get("channel", 0))
	elif p.get("previewChannel") != null:
		where = " · PRV ch%d" % int(p.previewChannel)
	return "%s%s · L%d%s" % ["● " if p.get("live", false) else "", str(p.get("sceneName", p.get("sceneId", ""))), int(p.get("layerNumber", 0)), where]


## The item the panel marks: the playing one when live, else the start item a take begins on.
static func current_index(p: Dictionary) -> int:
	return int(p.get("activeIndex", 0) if p.get("live", false) else p.get("startIndex", 0))


## "● ⚠ 3. logo.png (7s)" — ● playing / ▸ start item; ⚠ missing media; (Ns) only for timeless items (owner 27.07).
static func item_label(p: Dictionary, it: Dictionary, i: int) -> String:
	var mark := ""
	if i == current_index(p):
		mark = "● " if p.get("live", false) else "▸ "
	var warn := "⚠ " if it.get("missing", false) else ""
	var raw := str(it.get("label", it.get("value", ""))).replace("\\", "/")
	var parts := Array(raw.split("/", false))
	var base: String = parts.back() if not parts.is_empty() else raw
	var dur := ""
	if it.get("timeless", false) and it.get("duration") != null:
		dur = " (%ss)" % _num(it.duration)
	return "%s%s%d. %s%s" % [mark, warn, i + 1, base, dur]


static func _num(v: Variant) -> String:
	var f := float(v)
	return str(int(f)) if is_equal_approx(f, roundf(f)) else str(f)


## Picking an item: a live playlist jumps (goto); a not-live one sets the item playout starts on (WO-347).
static func pick_body(p: Dictionary, index: int) -> Dictionary:
	if p.get("live", false):
		return {"action": "goto", "channel": int(p.get("channel", 0)), "layerNumber": int(p.get("layerNumber", 0)), "index": index}
	return {"action": "set_start", "sceneId": str(p.get("sceneId", "")), "layerNumber": int(p.get("layerNumber", 0)), "index": index}


## ⏮ / ⏭: live → prev / next; not live → step_preview (moves the start item, re-stages PRV, WO-371 C).
static func step_body(p: Dictionary, dir: String) -> Dictionary:
	if p.get("live", false):
		return {"action": dir, "channel": int(p.get("channel", 0)), "layerNumber": int(p.get("layerNumber", 0))}
	return {"action": "step_preview", "sceneId": str(p.get("sceneId", "")), "layerNumber": int(p.get("layerNumber", 0)), "direction": dir}


static func timeless_body(p: Dictionary, secs: float) -> Dictionary:
	return {"action": "set_timeless", "sceneId": str(p.get("sceneId", "")), "layerNumber": int(p.get("layerNumber", 0)), "secs": secs}


## Store the server's planned playlist on the look's layer in the show document. → true when found.
static func store_playlist(project: Dictionary, scene_id: String, layer_number: int, playlist: Array) -> bool:
	var root: Variant = project.get("scenes")
	if not root is Dictionary:
		return false
	for s in (root as Dictionary).get("scenes", []):
		if s is Dictionary and str(s.get("id", "")) == scene_id:
			for l in s.get("layers", []):
				if l is Dictionary and int(l.get("layerNumber", -1)) == layer_number:
					l["playlist"] = playlist.duplicate(true)
					return true
	return false
