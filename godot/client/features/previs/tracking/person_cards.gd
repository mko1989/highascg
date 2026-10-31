extends Node3D
## Tracked people in the 3D previs, at their fused floor position and measured height. The toolbar picker chooses:
## - WO-665 (research step 1) cut-outs: a card with the live picture from the camera that sees them best, background
##   removed by the sidecar's seg mask (yolo26n-seg), turned to face the viewer about the vertical only;
## - WO-666 (step 2) dummies: a mannequin painted by projective texturing from up to 3 solved cameras
##   (person_dummy.gdshader), its front turned toward the best camera; WO-667 (step 3) when the world person carries
##   body joints (a pose model runs), the mannequin is posed instead: ellipsoids between the joints
##   (person_pose_model.gd), every part painted by the same material.
## Maths in person_cards_model.gd / person_dummy_model.gd. Video comes from VideoSurfaces, held only while drawn.

const M := preload("res://features/previs/tracking/person_cards_model.gd")
const PD := preload("res://features/previs/tracking/person_dummy_model.gd")
const DummyMesh := preload("res://features/previs/tracking/person_dummy_mesh.gd")
const PP := preload("res://features/previs/tracking/person_pose_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const CARD_SHADER := preload("res://features/previs/tracking/person_card.gdshader")
const DUMMY_SHADER := preload("res://features/previs/tracking/person_dummy.gdshader")
const TrackingModel := preload("res://features/previs/tracking/tracking_model.gd")
const UI_CFG := "user://ui.cfg"
const STYLES := ["off", "cards", "dummies"]  # picker item index → style; ui.cfg [previs] people

var picker := OptionButton.new()  # the toolbar's "People" choice
var style := "off"
var _shown := false
var _on := false
var _cams: Array = []
var _pick := {}  # WO-701: world id → the cut-out's sticky camera memory (person_cards_model.sticky)
var _cards := {}  # world id → {node (cards: the quad; dummies: a body Node3D), mat, roles [], masks {cam_id: ImageTexture}}
var _unit_sphere := SphereMesh.new()  # posed parts: radius 0.5, stretched per part
var _held := {}  # role → true
var _probe_tex: Texture2D  # dev probe: stands in for every camera's video


func _ready() -> void:
	for label in ["People: off", "People: cut-outs", "People: dummies"]:
		picker.add_item(label)
	picker.tooltip_text = "Tracked people on the stage. Cut-outs: each one's live picture from the camera that sees them best. Dummies: a mannequin painted from every solved camera that sees them."
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	var saved: Variant = cfg.get_value("previs", "people", "cards" if cfg.get_value("previs", "cutouts", false) == true else "off")
	set_style(str(saved))
	picker.item_selected.connect(func(i: int) -> void:
		set_style(STYLES[i])
		var c := ConfigFile.new()
		c.load(UI_CFG)
		c.set_value("previs", "people", style)
		c.save(UI_CFG))
	Store.project_changed.connect(func(_p: Dictionary) -> void: _load_cams())
	_load_cams()
	if Config.args.has("probe-cutouts"):  # dev: --probe-cutouts=<dir>[:dummies] (WO-665 / WO-666)
		_probe(str(Config.args["probe-cutouts"]))


## "off" | "cards" | "dummies" (anything else → off).
func set_style(s: String) -> void:
	style = s if s in STYLES else "off"
	picker.select(STYLES.find(style))
	_clear()
	_apply()


## The 3D view is up (the tab is shown in 3D mode). People draw only while shown and not off; off releases video.
func set_shown(shown: bool) -> void:
	_shown = shown
	picker.visible = shown
	_apply()


func _apply() -> void:
	_on = _shown and style != "off"
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
	for c in M.cards(snap, _cams, _pick, Time.get_ticks_msec() / 1000.0):  # WO-701 sticky camera
		if style == "dummies" and c.views.is_empty():
			continue  # no solved camera sees them: nothing to paint with
		seen[c.id] = true
		var e: Dictionary = _cards.get(c.id, {})
		if e.is_empty():
			e = _new_entry()
			_cards[c.id] = e
		if style == "dummies":
			_place_dummy(e, c)
		else:
			_place_card(e, c)
	for id in _cards.keys():
		if not seen.has(id):
			(_cards[id].node as Node).queue_free()
			_cards.erase(id)
	for id in _pick.keys():
		if not seen.has(id):
			_pick.erase(id)
	_hold_roles()


func _new_entry() -> Dictionary:
	var mat := ShaderMaterial.new()
	if style == "dummies":
		mat.shader = DUMMY_SHADER
		var body := Node3D.new()  # identity: the static mannequin and the posed parts are placed in stage space
		body.add_child(_mesh_instance(DummyMesh.mesh(), mat))
		add_child(body)
		return {"node": body, "mat": mat, "roles": [], "masks": {}, "parts": []}
	mat.shader = CARD_SHADER
	var mi := _mesh_instance(QuadMesh.new(), mat)
	add_child(mi)
	return {"node": mi, "mat": mat, "roles": [], "masks": {}}


func _mesh_instance(mesh: Mesh, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


func _place_card(e: Dictionary, c: Dictionary) -> void:
	var mi: MeshInstance3D = e.node
	(mi.mesh as QuadMesh).size = Vector2(c.width, c.height)
	mi.position = C.psn_to_godot(c.feet) + Vector3(0, c.height / 2.0, 0)
	var mat: ShaderMaterial = e.mat
	var b: Array = c.box
	mat.set_shader_parameter("box", Vector4(b[0], b[1], b[2], b[3]))
	if e.roles != [c.role]:
		e.roles = [c.role]
		mat.set_shader_parameter("video", _video(c.role))
	var tex: Variant = _mask_tex(e, c.cam_id, c.mask, c.mask_size)
	mat.set_shader_parameter("mask", tex)
	mat.set_shader_parameter("has_mask", tex != null)


func _place_dummy(e: Dictionary, c: Dictionary) -> void:
	var body: Node3D = e.node
	var feet := C.psn_to_godot(c.feet)
	var us := []
	for v in c.views:
		us.append(PD.cam_uniforms(v.ce))
	var still: MeshInstance3D = body.get_child(0)
	var ps := PP.parts(c.joints, c.height) if PP.usable(c.joints) else []
	still.visible = ps.is_empty()
	still.transform = Transform3D(Basis(Vector3.UP, PD.face_yaw(feet, us[0].pos)).scaled(Vector3.ONE * c.height), feet)
	var parts: Array = e.parts
	while parts.size() < ps.size():
		var mi := _mesh_instance(_unit_sphere, e.mat)
		body.add_child(mi)
		parts.append(mi)
	for i in parts.size():
		(parts[i] as MeshInstance3D).visible = i < ps.size()
		if i < ps.size():
			(parts[i] as MeshInstance3D).transform = ps[i].xf
	var mat: ShaderMaterial = e.mat
	var roles := []
	var rot := []
	var pos := []
	var lens := []
	var raster := []
	var box := []
	var has_mask := []
	for i in PD.MAX_VIEWS:
		var on: bool = i < c.views.size()
		var v: Dictionary = c.views[i] if on else {}
		var u: Dictionary = us[i] if on else {}
		rot.append(u.get("rot", Basis()))
		pos.append(u.get("pos", Vector3.ZERO))
		lens.append(u.get("lens", Vector4(1, 1, 0, 0)))
		raster.append(u.get("raster", Vector2(1, 1)))
		var b: Array = v.get("box", [0, 0, 1, 1])
		box.append(Vector4(b[0], b[1], b[2], b[3]))
		var tex: Variant = _mask_tex(e, v.cam_id, v.mask, v.mask_size) if on else null
		mat.set_shader_parameter("mask%d" % i, tex)
		has_mask.append(tex != null)
		roles.append(v.get("role", ""))
	if e.roles != roles:
		e.roles = roles
		for i in PD.MAX_VIEWS:
			mat.set_shader_parameter("video%d" % i, _video(roles[i]) if roles[i] != "" else null)
	mat.set_shader_parameter("n_cams", c.views.size())
	mat.set_shader_parameter("rot", rot)
	mat.set_shader_parameter("pos", pos)
	mat.set_shader_parameter("lens", lens)
	mat.set_shader_parameter("raster", raster)
	mat.set_shader_parameter("box", box)
	mat.set_shader_parameter("has_mask", has_mask)


## This person's mask from one camera as a texture; a coasting track brings none, so the last one is kept.
func _mask_tex(e: Dictionary, cam_id: String, b64: String, size: Variant) -> Variant:
	var img := M.mask_image(b64, size)
	var tex: Variant = e.masks.get(cam_id)
	if img != null:
		if tex == null or (tex as ImageTexture).get_size() != Vector2(img.get_size()):
			tex = ImageTexture.create_from_image(img)
			e.masks[cam_id] = tex
		else:
			(tex as ImageTexture).update(img)
	return tex


func _video(role: String) -> Texture2D:
	return _probe_tex if _probe_tex != null else VideoSurfaces.texture(role)


func _process(_delta: float) -> void:
	if not _on or style != "cards" or _cards.is_empty():
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
		for r in e.roles:
			if r != "" and _probe_tex == null:
				want[r] = true
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
	_pick.clear()
	VideoSurfaces.release_all(self)
	_held.clear()


func _exit_tree() -> void:
	VideoSurfaces.release_all(self)
	_held.clear()  # WO-891: the Previs tab moves between windows — leased again when it re-enters


func _enter_tree() -> void:
	if is_node_ready():
		_hold_roles()


## Dev probe: <dir>/frame.png + persons.json ({raster, mask_size, persons [{box, mask}], joints?}, from a real run) as
## one solved camera 8 m downstage; the person stands where that camera's box puts them, as tall as it measures.
## Saves the 3D view from the camera's side (<dir>/render.png, 3 s) and from behind (render_back.png, 4 s).
func _probe(arg: String) -> void:
	var dir := arg.get_slice(":", 0)
	var inp: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir + "/persons.json"))
	_probe_tex = ImageTexture.create_from_image(Image.load_from_file(dir + "/frame.png"))
	var w := float(inp.raster[0])
	var h := float(inp.raster[1])
	var cam := C.camera(0.0, -8.0, 1.6, -4.0, 0.0, 0.0, 50.0)
	var b: Array = inp.persons[0].box
	var feet: Array = C.unproject(cam, [[(b[0] + b[2]) / 2.0 * w, b[3] * h]], w, h)[0]
	var ce := {"id": "p", "role": "probe", "raster": [w, h], "cam": cam}
	var height := M.estimate_height(ce, b, [feet[0], feet[1], 0.0])
	var snap := {"cameras": [{"id": "p", "role": "probe", "stale": false, "mask_size": inp.mask_size,
		"persons": [{"tid": 1, "box": b, "age_s": 0.0, "mask": inp.persons[0].mask}]}],
		"world": {"plane_z": 0.0, "persons": [{"id": 1, "x": feet[0], "y": feet[1], "height": height, "keys": ["p:1"],
			"joints": inp.get("joints")}]}}  # WO-667: persons.json may carry pose3d joints for the same camera
	print("[probe-cutouts] feet ", feet, " height ", height)
	set_style("dummies" if arg.ends_with(":dummies") else "cards")
	var tick := Timer.new()
	tick.wait_time = 0.2
	tick.timeout.connect(func() -> void:
		_cams = [ce]
		set_detections(snap))
	add_child(tick)
	tick.start()
	var g := C.psn_to_godot(feet)
	var stage: Variant = get_parent()
	var around := AABB(g - Vector3(0.6, 0, 0.6), Vector3(1.2, height, 1.2))
	get_tree().create_timer(2.0).timeout.connect(func() -> void:  # after the stage's own fit on model load
		if stage.has_method("frame_box"):
			stage.frame_box(around, 0.3))
	get_tree().create_timer(3.0).timeout.connect(func() -> void:
		get_viewport().get_texture().get_image().save_png(dir + "/render.png")
		if stage.has_method("frame_box"):
			stage.frame_box(around, 2.4))
	get_tree().create_timer(4.0).timeout.connect(func() -> void:
		get_viewport().get_texture().get_image().save_png(dir + "/render_back.png"))
