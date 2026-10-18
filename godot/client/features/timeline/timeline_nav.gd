extends RefCounted
## WO-602 slice 7 — keyboard navigation and paste helpers, pure (web timeline-editor-inputs.js
## buildTimelineSnapCandidates / prevSnapPoint / nextSnapPoint / resolvePasteLayerIdx, timeline-state-clips.js
## insertClipClone, timeline-transport.js #tl-trim).

const TM := preload("res://features/timeline/timeline_math.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")


## Snap targets, sorted and unique: 0, the duration, the playhead, flag times and clip in / out edges (rounded ms),
## leaving out the flag / clip being moved.
static func snap_points(tl: Dictionary, playhead: Variant, skip_clip := "", skip_flag := "") -> Array:
	var seen := {0: true, roundi(float(tl.get("duration", 0))): true}
	if playhead != null:
		seen[roundi(float(playhead))] = true
	for f in tl.get("flags", []):
		if f is Dictionary and (skip_flag == "" or str(f.get("id", "")) != skip_flag):
			seen[roundi(float(f.get("timeMs", 0)))] = true
	for layer in tl.get("layers", []):
		for c in layer.get("clips", []):
			if skip_clip != "" and str(c.get("id", "")) == skip_clip:
				continue
			seen[roundi(float(c.get("startTime", 0)))] = true
			seen[roundi(float(c.get("startTime", 0)) + float(c.get("duration", 0)))] = true
	var out := seen.keys()
	out.sort()
	return out


## The last point more than 1 ms before `ms`, or null.
static func prev_point(points: Array, ms: float) -> Variant:
	var best: Variant = null
	for t in points:
		if t < ms - 1:
			best = t
		else:
			break
	return best


## The first point more than 1 ms after `ms`, or null.
static func next_point(points: Array, ms: float) -> Variant:
	for t in points:
		if t > ms + 1:
			return t
	return null


static func frame_ms(tl: Dictionary) -> float:
	return 1000.0 / float(tl.get("fps", 25) if float(tl.get("fps", 25)) > 0 else 25)


## #tl-trim: the end of the last clip (0 = no clips, the web leaves the duration alone then).
static func clips_end(tl: Dictionary) -> float:
	var end := 0.0
	for layer in tl.get("layers", []):
		for c in layer.get("clips", []):
			end = maxf(end, float(c.get("startTime", 0)) + float(c.get("duration", 0)))
	return end


## resolvePasteLayerIdx: the selected layer (the web's selectedLayer — the last layer or clip clicked), else the
## copied clip's layer clamped to the timeline, else the last layer.
static func paste_layer(tl: Dictionary, selected: int, board_li: int) -> int:
	var n := (tl.get("layers", []) as Array).size()
	if selected >= 0 and selected < n:
		return selected
	if board_li >= 0:
		return mini(board_li, n - 1)
	return maxi(0, n - 1)


## Ctrl+V of a clip (web paste + insertClipClone): a deep copy with a new id at `start_ms`, appended to the layer;
## the timeline grows to fit it (the web's start + dur + 2 s, then expandDurationToContent).
static func paste_clip(tl: Dictionary, li: int, clip: Dictionary, start_ms: float) -> Dictionary:
	var ls: Array = tl.get("layers", [])
	if li < 0 or li >= ls.size() or clip.is_empty():
		return {}
	var dur := float(clip.get("duration", 0)) if float(clip.get("duration", 0)) > 0 else 5000.0
	if start_ms + dur > float(tl.get("duration", 0)):
		tl["duration"] = start_ms + dur + TE.CONTENT_END_PADDING_MS
	var c: Dictionary = clip.duplicate(true)
	c["id"] = TM.uid()
	c["startTime"] = maxf(0.0, start_ms)
	(ls[li]["clips"] as Array).append(c)
	TE.expand_duration(tl)
	return c
