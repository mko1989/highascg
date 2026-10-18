extends RefCounted
## WO-602 — media lookups for timeline drops and the clip page (moved out of timeline_tab.gd in slice 5): the
## /api/media row (cached, refetched on a miss), a dropped source's duration and its content resolution.

const TE := preload("res://features/timeline/timeline_edit.gd")

var _rows: Array = []


func row(value: String) -> Dictionary:
	var r := TE.find_media_row(_rows, value)
	if r.is_empty():
		var res: Dictionary = await Api.get_json("/api/media")
		if res.ok and res.data is Array:
			_rows = res.data
			r = TE.find_media_row(_rows, value)
	return r


## resolveDroppedSourceDurationMs: the payload, the media row, CINF, else 5 s.
func drop_duration(src: Dictionary) -> float:
	if str(src.get("type", "")) != "media":
		return TE.DEFAULT_CLIP_MS
	if float(src.get("durationMs", 0)) > 0:
		return float(src.durationMs)
	var mr := await row(str(src.value))
	if float(mr.get("durationMs", 0)) > 0:
		return float(mr.durationMs)
	var r: Dictionary = await Api.post_json("/api/media/cinf", {"id": src.value})
	if r.ok and r.data is Dictionary and float(r.data.get("durationMs", 0)) > 0:
		return float(r.data.durationMs)
	return TE.DEFAULT_CLIP_MS


## fetchMediaContentResolution: the payload, the media row, then the ffprobe of a local file.
func res(src: Dictionary) -> Vector2i:
	var r := TE.parse_resolution(str(src.get("resolution", "")))
	if r.x <= 0:
		r = TE.parse_resolution(str((await row(str(src.value))).get("resolution", "")))
	if r.x <= 0 and str(src.get("type", "")) in ["media", "file"]:
		var p: Dictionary = await Api.get_json("/api/local-media/%s/probe" % str(src.value).uri_encode())
		if p.ok and p.data is Dictionary:
			r = TE.parse_resolution(str(p.data.get("resolution", "")))
	return r
