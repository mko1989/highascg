extends RefCounted
## WO-602 slice 5 — timeline flags, pure (web lib/timeline-state.js addFlag / updateFlag / removeFlag,
## timeline-state-clips.js duplicateFlag, timeline-canvas-render.js hitFlag / flagTypeColor, timeline-canvas-utils.js
## parseHmsInput, lib/companion-location-parse.js). A flag is {id, timeMs, type, label, jumpTimeMs?, jumpFlagId?,
## companionPage?, companionRow?, companionColumn?}; the engine (timeline-playback.js) pauses / resumes / jumps
## (jumpTimeMs wins over jumpFlagId) / presses the Companion button when the playhead crosses it.

const TE := preload("res://features/timeline/timeline_edit.gd")
const TM := preload("res://features/timeline/timeline_math.gd")
const TYPES := ["pause", "play", "jump", "companion_press"]
const TYPE_LABELS := ["Pause", "Play (resume)", "Jump to", "Companion button press"]
const COLORS := {"pause": "#f85149", "play": "#3fb950", "jump": "#a371f7", "companion_press": "#f0a030"}
const HIT_PX := 10.0
const MAX_COORD := 9999


static func flags(tl: Dictionary) -> Array:
	if not (tl.get("flags") is Array):
		tl["flags"] = []
	return tl.flags


static func color(type: Variant) -> Color:
	return Color(COLORS.get(str(type), COLORS.pause))


## flagUid: "f" + base-36 ms + 4 random
static func uid() -> String:
	return "f" + TM.uid().substr(1) + "abcdefghijklmnopqrstuvwxyz0123456789"[randi() % 36]


static func find(tl: Dictionary, id: String) -> Dictionary:
	for f in flags(tl):
		if f is Dictionary and str(f.get("id", "")) == id:
			return f
	return {}


## Stable by time (JS Array.sort is stable; Godot's sort_custom is not).
static func _sort(tl: Dictionary) -> void:
	var a := flags(tl)
	for i in range(1, a.size()):
		var f: Variant = a[i]
		var j := i - 1
		while j >= 0 and float(a[j].get("timeMs", 0)) > float(f.get("timeMs", 0)):
			a[j + 1] = a[j]
			j -= 1
		a[j + 1] = f


static func add(tl: Dictionary, time_ms: float, type := "pause") -> Dictionary:
	var f := {"id": uid(), "timeMs": maxf(0.0, time_ms), "type": type if type in TYPES else "pause", "label": ""}
	flags(tl).append(f)
	_sort(tl)
	TE.expand_duration(tl)
	return f


## Object.assign + the type guard; a null value drops the key (the web's `undefined`, omitted from the JSON).
static func update(tl: Dictionary, f: Dictionary, changes: Dictionary) -> void:
	for k in changes:
		if changes[k] == null:
			f.erase(k)
		else:
			f[k] = changes[k]
	if f.has("type") and not str(f.type) in TYPES:
		f["type"] = "pause"
	_sort(tl)
	TE.expand_duration(tl)


static func remove(tl: Dictionary, id: String) -> void:
	tl["flags"] = flags(tl).filter(func(f: Variant) -> bool: return not (f is Dictionary and str(f.get("id", "")) == id))


## duplicateFlag (paste): a deep copy at `time_ms` with a new id and no jump-to-flag reference.
static func duplicate_at(tl: Dictionary, f: Dictionary, time_ms: float) -> Dictionary:
	var n: Dictionary = f.duplicate(true)
	n["id"] = uid()
	n["timeMs"] = maxf(0.0, time_ms)
	n.erase("jumpFlagId")
	flags(tl).append(n)
	_sort(tl)
	TE.expand_duration(tl)
	return n


## hitFlag: in the ruler, the first flag within ±10 px (right of the layer headers).
static func hit(tl: Dictionary, p: Vector2, x_at: Callable) -> Dictionary:
	if p.y >= TM.RULER_H or p.x < TM.HEADER_W:
		return {}
	for f in flags(tl):
		if f is Dictionary and absf(p.x - float(x_at.call(float(f.get("timeMs", 0))))) <= HIT_PX:
			return f
	return {}


## The "Or jump to flag" entry: label, else type, else "flag" — then the time.
static func option_text(f: Dictionary) -> String:
	var l := str(f.get("label", ""))
	if l == "":
		l = str(f.get("type", "")) if str(f.get("type", "")) != "" else "flag"
	return "%s - %s" % [l, TM.fmt_hms(float(f.get("timeMs", 0)))]


## parseHmsInput: HH:MM:SS:mmm (or M:SS:mmm / SS:mmm), ++N / --N offsets, plain ms; null when invalid.
static func parse_hms(s: String, current_ms: float, total_ms: Variant) -> Variant:
	var t := s.strip_edges()
	if t == "":
		return null
	var cap: float = float(total_ms) if total_ms != null else 999999999.0
	var off := RegEx.create_from_string("^([+-]{2})\\s*(\\d+)(?:ms)?$").search(t)
	if off != null:
		return clampf(current_ms + (1.0 if off.get_string(1) == "++" else -1.0) * off.get_string(2).to_int(), 0.0, cap)
	var n: Array = []
	for q in t.split(":"):
		if not TM.is_digits(q):  # WO-839: digits only per group
			return null
		n.append(q.strip_edges().to_int())
	var ms: Variant = null
	match n.size():
		4:
			ms = (n[0] * 3600 + n[1] * 60 + n[2]) * 1000 + n[3]
		3:
			ms = (n[0] * 60 + n[1]) * 1000 + n[2]
		2:
			ms = n[0] * 1000 + n[1]
		1:
			ms = n[0] if n[0] >= 0 else null
	return null if ms == null else clampf(float(ms), 0.0, cap)


static func coords(f: Dictionary) -> Vector3i:
	return Vector3i(int(f.get("companionPage", 1)), int(f.get("companionRow", 0)), int(f.get("companionColumn", 0)))


static func fmt_location(c: Vector3i) -> String:
	return "%d %d %d" % [c.x, c.y, c.z]


## parseCompanionLocationInput: "1 2 1", "1/2/1", "12-0-15" → page ≥ 1, row / column ±9999; null when invalid.
static func parse_location(s: String) -> Variant:
	var parts: Array = Array(RegEx.create_from_string("[\\s/,-]+").sub(s.strip_edges(), " ", true).split(" ", false))
	if parts.size() != 3:
		return null
	for q in parts:
		if not str(q).is_valid_int():
			return null
	var c := Vector3i(int(parts[0]), int(parts[1]), int(parts[2]))
	if c.x < 1 or c.x > MAX_COORD or absi(c.y) > MAX_COORD or absi(c.z) > MAX_COORD:
		return null
	return c
