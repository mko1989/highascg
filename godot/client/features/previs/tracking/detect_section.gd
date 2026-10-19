extends VBoxContainer
## WO-616 T9b — Detect section of the tracking Inspector page (Detect mode): person detection on the tracking cameras
## (server sidecar, src/tracking/detect-service.js — OpenFollow's YOLO + ByteTrack port) and how detections pin
## markers (src/tracking/detect-pin.js). Writes project.previs.tracking.detection through `edit` (tracking_page
## persists it); the boxes and the live status come from `tracking:detections` via the marker driver.
## The master starts off and asks before it arms: in Replace a marker — and every fixture following it — chases a
## detected person.

const D := preload("res://features/previs/tracking/detect_model.gd")

signal edit(detection: Dictionary)  # new detection slice → persist

var driver: Node  # marker_driver.gd: marker defs (pin target) + the last tracking:detections
var data := D.normalize({})
var cam_id := ""
var _models: Array = ["yolo26n.onnx", "yolo26s.onnx"]
var _master: CheckButton
var _cam: CheckBox
var _state: Label
var _model: OptionButton
var _pin: OptionButton
var _target: OptionButton
var _point: OptionButton
var _spins := {}
var _assist_rows: Array = []
var _replace_rows: Array = []
var _confirm_on: ConfirmationDialog


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_master = CheckButton.new()
	_master.text = "Person detection"
	_master.toggled.connect(func(on: bool) -> void:
		_master.set_pressed_no_signal(data.enabled)
		if on:
			_confirm_on.popup_centered()
		else:
			_set_key("enabled", false))
	add_child(_master)
	_confirm_on = ConfirmationDialog.new()
	_confirm_on.dialog_text = "Start person detection? In Replace mode the pinned marker — and every fixture following it — chases a detected person."
	_confirm_on.confirmed.connect(func() -> void: _set_key("enabled", true))
	add_child(_confirm_on)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_state)
	_cam = CheckBox.new()
	_cam.toggled.connect(func(on: bool) -> void:
		data = D.with_camera(data, cam_id, on)
		_persist())
	add_child(_cam)
	var g := GridContainer.new()
	g.columns = 2
	_model = OptionButton.new()
	_model.item_selected.connect(func(i: int) -> void: _set_key("model", _model.get_item_text(i)))
	_pair(g, "Model", _model)
	_num(g, "Confidence", "confidence", 0.05, "")
	_num(g, "Every", "interval_ms", 1, "ms")
	_num(g, "Max persons", "max_persons", 1, "")
	_num(g, "Keep lost", "grace_ms", 50, "ms")
	_pin = OptionButton.new()
	for m in D.PIN_MODES:
		_pin.add_item(str(D.PIN_LABELS[m]).get_slice(" — ", 0))
	_pin.item_selected.connect(func(i: int) -> void: _set_key("pin_mode", D.PIN_MODES[i]))
	_pair(g, "Pin", _pin)
	_target = OptionButton.new()
	_target.item_selected.connect(func(i: int) -> void: _set_key("pin_marker_id", _target.get_item_id(i)))
	_replace_rows = _pair(g, "Marker", _target)
	_point = OptionButton.new()
	_point.add_item("Head (marker height)")
	_point.add_item("Feet (floor)")
	_point.item_selected.connect(func(i: int) -> void: _set_key("pin_point", "bottom" if i == 1 else "top"))
	_pair(g, "Pin point", _point)
	_num(g, "Smoothing", "smoothing", 0.01, "")
	_num(g, "Lookahead", "prediction", 1, "fr")
	_assist_rows = _num(g, "Assist radius", "assist_radius_m", 0.1, "m") + _num(g, "Assist strength", "assist_strength", 0.05, "")
	add_child(g)
	_load_models()
	refresh()


## The page hands over the slice and the camera on screen.
func set_detection(src: Variant, camera_id: String) -> void:
	data = D.normalize(src)
	cam_id = camera_id
	refresh()


func refresh() -> void:
	if _master == null:
		return
	_master.set_pressed_no_signal(data.enabled)
	refresh_status()
	_cam.visible = not cam_id.is_empty()
	_cam.text = "Detect on %s" % cam_id
	_cam.set_pressed_no_signal(D.camera_on(data, cam_id))
	_model.clear()
	var models := _models.duplicate()
	if not models.has(data.model):
		models.append(data.model)
	for m in models:
		_model.add_item(m)
	_model.select(models.find(data.model))
	_pin.select(D.PIN_MODES.find(data.pin_mode))
	_target.clear()
	var defs: Array = driver.defs if driver != null else []
	for d in defs:
		_target.add_item(str(d.name), int(d.id))
	if _target.get_item_index(data.pin_marker_id) < 0:
		_target.add_item("Marker %d (not in project)" % data.pin_marker_id, data.pin_marker_id)
	_target.select(_target.get_item_index(data.pin_marker_id))
	_point.select(1 if data.pin_point == "bottom" else 0)
	for k in _spins:
		(_spins[k] as SpinBox).set_value_no_signal(float(data[k]))
	for c in _replace_rows:
		c.visible = data.pin_mode == "replace"
	for c in _assist_rows:
		c.visible = data.pin_mode == "assist"


## The live line only (every tracking:detections — never rebuilds the option lists under an open popup).
func refresh_status() -> void:
	if _state == null:
		return
	var snap: Dictionary = driver.detections if driver != null else {}
	_state.text = D.status_line(snap, cam_id) + "\n" + str(D.PIN_LABELS[data.pin_mode])


## Models actually installed on the box (GET /api/tracking/detections → models).
func _load_models() -> void:
	var res: Dictionary = await Api.get_json("/api/tracking/detections")
	if res.ok and res.data is Dictionary and (res.data.get("models") as Variant) is Array and not (res.data.models as Array).is_empty():
		_models = res.data.models
		refresh()


func _set_key(key: String, v: Variant) -> void:
	data[key] = v
	data = D.normalize(data)
	_persist()


func _persist() -> void:
	refresh()
	edit.emit(data.duplicate(true))


func _num(g: GridContainer, text: String, key: String, step: float, suffix: String) -> Array:
	var lim: Array = D.LIMITS[key]
	var sb := SpinBox.new()
	sb.min_value = lim[0]
	sb.max_value = lim[1]
	sb.step = step
	sb.suffix = suffix
	sb.update_on_text_changed = true
	sb.value_changed.connect(func(v: float) -> void: _set_key(key, v))
	_spins[key] = sb
	return _pair(g, text, sb)


func _pair(g: GridContainer, text: String, c: Control) -> Array:
	var l := Label.new()
	l.text = text
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)
	return [l, c]
