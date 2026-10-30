extends RefCounted
## WO-860 — a look card's ▶ while its overlay look (lower third) is on air over PGM: ■, which plays the overlay out
## (POST /api/scene/overlay/stop: CG STOP → the template's outro → cleared). Owner 30.10: "make the play button change
## to stop when on screen, hitting it plays out the cg". The server's `scene.liveOverlay` ({pgm channel: [{sceneId,
## hosts, until}]}) drops the look when it is played out or has timed out — the deck rebuilds and ▶ comes back.

const PATH := "scene.liveOverlay"


## Is `scene_id` an overlay on air on `main`'s PGM channel?
static func on_air(live_overlay: Variant, cm: Dictionary, main: int, scene_id: String) -> bool:
	var programs: Array = cm.get("programChannels", []) if cm.get("programChannels") is Array else []
	if scene_id == "" or live_overlay is not Dictionary or main < 0 or main >= programs.size() or programs[main] == null:
		return false
	var entries: Variant = (live_overlay as Dictionary).get(str(int(programs[main])))
	if entries is not Array:
		return false
	for e in entries:
		if e is Dictionary and str((e as Dictionary).get("sceneId", "")) == scene_id:
			return true
	return false


## The stop request body for `main`'s overlay `scene_id`.
static func stop_body(main: int, scene_id: String) -> Dictionary:
	return {"mainIdx": main, "sceneId": scene_id}
