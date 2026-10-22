extends Node3D
## WO-665 — research step 1, cut-out cards: each tracked person stands in the 3D previs as a card showing their live
## picture from the camera that sees them best, background removed by the sidecar's seg mask (yolo26n-seg), at
## their fused floor position, as tall as they measure, turned to face the viewer (about the vertical only, so they
## stay upright). Maths in person_cards_model.gd. Video comes from VideoSurfaces, held only while cards are shown.

const M := preload("res://features/previs/tracking/person_cards_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const SHADER := preload("res://features/previs/tracking/person_card.gdshader")
const TrackingModel := preload("res://features/previs/tracking/tracking_model.gd")
const UI_CFG := "user://ui.cfg"

var toggle := CheckBox.new()  # the toolbar's "Cut-outs"; persisted in ui.cfg [previs] cutouts
var _shown := false
var _on := false
var _cams: Array = []
var _cards := {}  # world id → {node: MeshInstance3D, mat, mask_tex, role}
var _held := {}  # role → true


func _ready() -> void:
	toggle.text = "Cut-outs"
	toggle.tooltip_text = "Tracked people as cut-out cards on the stage: each one's live picture from the camera that sees them best."
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	toggle.set_pressed_no_signal(cfg.get_value("previs", "cutouts", false) == true)
	toggle.toggled.connect(func(on: bool) -> void:
		var c := ConfigFile.new()
		c.load(UI_CFG)
		c.set_value("previs", "cutouts", on)
		c.save(UI_CFG)
		_apply())
	Store.project_changed.connect(func(_p: Dictionary) -> void: _load_cams())
	_load_cams()
	if Config.args.has("probe-cutouts"):  # dev: --probe-cutouts=<dir> (WO-665)
		_probe(str(Config.args["probe-cutouts"]))


## Dev probe: <dir>/frame.png + persons.json ({raster, mask_size, persons [{box, mask}]}, from a real seg run) drawn
## as one camera's view of a 1.8 m person at the stage origin; saves the 3D view to <dir>/render.png after 2 s.
func _probe(dir: String) -> void:
	var inp: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir + "/persons.json"))
	var tex := ImageTexture.create_from_image(Image.load_from_file(dir + "/frame.png"))
	toggle.set_pressed_no_signal(true)
	var ps := []
	for i in inp.persons.size():
		ps.append({"tid": i + 1, "box": inp.persons[i].box, "age_s": 0.0, "mask": inp.persons[i].mask})
	var snap := {"cameras": [{"id": "p", "role": "probe", "stale": false, "mask_size": inp.mask_size, "persons": ps}],
		"world": {"plane_z": 0.0, "persons": [{"id": 1, "x": 0.0, "y": 0.0, "height": 1.8, "keys": ["p:1"]}]}}
	var tick := Timer.new()
	tick.wait_time = 0.2
	tick.timeout.connect(func() -> void:
		_apply()
		_cams = [{"id": "p", "role": "probe", "raster": inp.raster, "cam": {}}]
		set_detections(snap)
		for e in _cards.values():
			e.mat.set_shader_parameter("video", tex))
	add_child(tick)
	tick.start()
	get_tree().create_timer(2.0).timeout.connect(func() -> void:
		get_viewport().get_texture().get_image().save_png(dir + "/render.png"))


## The 3D view is up (the tab is shown in 3D mode). Cards draw only while shown AND toggled on; off releases video.
func set_shown(shown: bool) -> void:
	_shown = shown
	toggle.visible = shown
	_apply()


func _apply() -> void:
	_on = _shown and toggle.button_pressed
	visible = _on
	if not _on:
		_clear()


func _load_cams() -> void:
	var pv: Variant = Store.project.get("previs")
	_cams = TrackingModel.normalize((pv as Dictionary).get("tracking") if pv is Dictionary else null).cameras


## One WS tracking:detections snapshot.
func set_detections(snap: Variant) -> void:
	if not _on:
		return
	var seen := {}
	for c in M.cards(snap, _cams):
		seen[c.id] = true
		_place(c)
	for id in _cards.keys():
		if not seen.has(id):
			(_cards[id].node as Node).queue_free()
			_cards.erase(id)
	_hold_roles()


func _place(c: Dictionary) -> void:
	var e: Dictionary = _cards.get(c.id, {})
	if e.is_empty():
		var mi := MeshInstance3D.new()
		mi.mesh = QuadMesh.new()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var mat := ShaderMaterial.new()
		mat.shader = SHADER
		mi.material_override = mat
		add_child(mi)
		e = {"node": mi, "mat": mat, "mask_tex": null, "role": ""}
		_cards[c.id] = e
	var mi: MeshInstance3D = e.node
	(mi.mesh as QuadMesh).size = Vector2(c.width, c.height)
	var feet := C.psn_to_godot(c.feet)
	mi.position = feet + Vector3(0, c.height / 2.0, 0)
	var mat: ShaderMaterial = e.mat
	var b: Array = c.box
	mat.set_shader_parameter("box", Vector4(b[0], b[1], b[2], b[3]))
	if e.role != c.role:
		e.role = c.role
		mat.set_shader_parameter("video", VideoSurfaces.texture(c.role))
	var img := M.mask_image(c.mask, c.mask_size)
	if img != null:  # a coasting track brings none: keep the last mask
		if e.mask_tex == null or (e.mask_tex as ImageTexture).get_size() != Vector2(img.get_size()):
			e.mask_tex = ImageTexture.create_from_image(img)
			mat.set_shader_parameter("mask", e.mask_tex)
		else:
			(e.mask_tex as ImageTexture).update(img)
	mat.set_shader_parameter("has_mask", e.mask_tex != null)


func _process(_delta: float) -> void:
	if not _on or _cards.is_empty():
		return
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var eye := cam.global_position
	for e in _cards.values():
		var mi: MeshInstance3D = e.node
		var to := Vector3(eye.x - mi.global_position.x, 0, eye.z - mi.global_position.z)
		if to.length_squared() > 1e-6:
			mi.global_basis = Basis(Vector3.UP, atan2(to.x, to.z))  # QuadMesh faces +Z: turn it toward the eye


func _hold_roles() -> void:
	var want := {}
	for e in _cards.values():
		if e.role != "":
			want[e.role] = true
	for r in want:
		if not _held.has(r):
			VideoSurfaces.acquire(r, self)
	for r in _held:
		if not want.has(r):
			VideoSurfaces.release(r, self)
	_held = want


func _clear() -> void:
	for e in _cards.values():
		(e.node as Node).queue_free()
	_cards.clear()
	VideoSurfaces.release_all(self)
	_held.clear()


func _exit_tree() -> void:
	VideoSurfaces.release_all(self)
