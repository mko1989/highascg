extends RefCounted
## WO-1106 D1 — previs number fields that write the project / a camera / the DMX patch commit a typed value on Enter or
## focus-out (RULES.md "Input fields"), never per keystroke: typing "200" sent 2, then 20, then 200 (a PTZ camera
## pose, a follow head's universe, the stage raster…). Arrows / wheel still step at once (a SpinBox's value_changed).
## The section scripts name autoloads (Store, Ws, Api), so they are loaded only after the runner's first frame.

var t
var _mounted: Array[Node] = []


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for n in _mounted:
			if is_instance_valid(n) and not n.is_queued_for_deletion():
				n.free()


## The B16 check (tests/test_desk_feed_wo1097.gd): no value per keystroke, one value on Enter, the whole number.
func _typed_commits_once(sb: SpinBox, typed: Array, what: String) -> void:
	t.eq(sb.update_on_text_changed, false, what + ": no value per keystroke")
	_mounted.append(sb)
	t.root.add_child(sb)  # a Range emits value_changed only inside the tree
	await t.process_frame
	var got := []
	sb.value_changed.connect(func(v: float) -> void: got.append(v))
	var le := sb.get_line_edit()
	for s in typed:
		le.text = s
		le.text_changed.emit(s)  # each keystroke
	t.eq(got.size(), 0, what + ": typing alone sends nothing")
	sb.apply()  # what Enter / focus-out do
	t.eq(got.size(), 1, what + ": Enter applies once")
	if not got.is_empty():
		t.eq(float(got[-1]), float(typed[-1]), what + ": the whole typed number")
	sb.value = sb.value + sb.step  # an arrow / wheel step still applies at once
	t.eq(got.size(), 2, what + ": a step applies at once")
	sb.free()


func test_previs_spins_commit_on_enter() -> void:
	await t.process_frame  # autoloads exist from here on
	var stage: GDScript = load("res://features/previs/stage_panel.gd")
	await _typed_commits_once(stage.call("_spin", 0, 16384, 1, 0), ["1", "19", "192", "1920"], "stage object field")
	var page: GDScript = load("res://features/previs/tracking/tracking_page.gd")
	await _typed_commits_once(page.call("_spin", 16, 16384, 1), ["3", "38", "384", "3840"], "tracking raster")
	var zones: GDScript = load("res://features/previs/tracking/zones_section.gd")
	await _typed_commits_once(zones.call("_spin", 0, 60000, 10, "ms"), ["2", "25", "250"], "zone debounce")
	var detect: GDScript = load("res://features/previs/tracking/detect_section.gd")
	await _typed_commits_once(detect.call("num_spin", "interval_ms", 1, "ms"), ["1", "12", "120"], "detection interval")
	var ptz: GDScript = load("res://features/previs/tracking/ptz_section.gd")
	await _typed_commits_once(ptz.call("field_spin", ["Yaw", "pose.yaw", -360, 360, 1]), ["4", "45"], "PTZ yaw (moves the camera)")
	var follow: GDScript = load("res://features/previs/tracking/follow_section.gd")
	await _typed_commits_once(follow.call("field_spin", ["Universe", "universe", 0, 32767, 1]), ["2", "20", "200"], "follow head universe")


func test_no_previs_spin_applies_per_keystroke() -> void:
	var hits := []
	_scan("res://features", hits)
	t.eq(hits, [], "no SpinBox under features/ applies a half-typed value")


func _scan(dir: String, hits: Array) -> void:
	for d in DirAccess.get_directories_at(dir):
		_scan(dir + "/" + d, hits)
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".gd") and FileAccess.get_file_as_string(dir + "/" + f).contains("update_on_text_changed = true"):
			hits.append(dir + "/" + f)
