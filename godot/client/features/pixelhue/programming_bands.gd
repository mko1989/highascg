extends VBoxContainer
## WO-1039 — the PGM band above the PVW band: one cell per shown screen (cells share one scale: each stretches by
## its canvas width), a head line with the screen's name and size, the BKG on / off chip (when a background picture
## is set) and, on PGM, the PGM lock toggle; under it the screen's programming_stage.gd. Every stage signal goes to
## `host` (programming_panel.gd).

const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
const Stage := preload("res://features/pixelhue/programming_stage.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var host: Object
var stages: Array = []


func _init() -> void:
	size_flags_vertical = Control.SIZE_EXPAND_FILL


func render(state: Dictionary, shown: Array, selected_id: Variant) -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	stages = []
	for scene in [M.PGM, M.PVW]:
		var title := Label.new()
		title.text = M.scene_name(scene)
		title.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
		add_child(title)
		var row := HBoxContainer.new()
		row.size_flags_vertical = Control.SIZE_EXPAND_FILL
		row.add_theme_constant_override("separation", 8)
		add_child(row)
		for id in shown:
			var scr := M.screen_by_id(state, id)
			if not scr.is_empty():
				row.add_child(_cell(state, scr, scene, selected_id))


func repaint(selected_id: Variant, busy: bool) -> void:
	for st in stages:
		st.selected_id = selected_id
		st.busy = busy
		st.queue_redraw()


func dragging() -> bool:
	return stages.any(func(st: Stage) -> bool: return is_instance_valid(st) and st.dragging())


func _cell(state: Dictionary, scr: Dictionary, scene: int, selected_id: Variant) -> Control:
	var cell := VBoxContainer.new()
	cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cell.size_flags_stretch_ratio = maxf(1.0, float(G.canvas_of(scr).width))
	var head := HBoxContainer.new()
	var title := Label.new()
	title.text = "%s · %d × %d" % [str(scr.get("name", "")), int(scr.width), int(scr.height)]
	title.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	title.clip_text = true
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var bkg := M.background_of(state, scr.id, scene)
	if bkg.get("pictureId") != null:
		var chip := Button.new()
		chip.text = "BKG on" if bkg.get("enabled") == true else "BKG off"
		chip.tooltip_text = "Background: %s" % (str(bkg.get("name", "")) if str(bkg.get("name", "")) != "" else "picture %s" % str(bkg.pictureId))
		chip.pressed.connect(func() -> void:
			var r := M.bkg_toggle_request(scr, scene, bkg)
			host.call("command", r.body, r.message))
		head.add_child(chip)
	var lk: bool = scr.get("pgmLocked") == true
	if scene == M.PGM:
		var lock := Button.new()
		lock.text = "PGM locked" if lk else "PGM unlocked"
		lock.tooltip_text = "PGM editing is locked. Click to allow editing PGM layers." if lk else "PGM layers can be edited. Click to lock."
		if lk:
			lock.add_theme_color_override("font_color", ThemeBuilder.ERROR)
		lock.pressed.connect(func() -> void:
			var r := M.pgm_lock_request(scr)
			host.call("command", r.body, r.message))
		head.add_child(lock)
	cell.add_child(head)
	var st := Stage.new()
	st.setup(scr, scene, M.layers_of(state, scr.id, scene), selected_id, scene == M.PGM and lk, state.get("roam") != false)
	st.select_layer.connect(func(id: int) -> void: host.call("select", id))
	st.preview.connect(func(l: Dictionary, w: Dictionary, _g: bool) -> void: host.call("live_geometry", M.window_change(state, l, w)))
	st.commit.connect(func(l: Dictionary, w: Dictionary, g: bool) -> void:
		host.call("command", M.window_change(state, l, w), "Group position saved." if g else "Layer position saved."))
	st.dropped.connect(func(key: String, point: Dictionary, l: Dictionary) -> void: host.call("drop", key, scr, scene, point, l))
	st.locked_hit.connect(func() -> void: host.call("notice", "PGM of %s is locked. Unlock it to edit." % str(scr.get("name", ""))))
	st.nudge.connect(func(dx: int, dy: int, step: int) -> void: host.call("nudge_selected", dx, dy, step))
	st.clear_pressed.connect(func() -> void: host.call("clear_selected"))
	if bkg.get("enabled") == true and bkg.get("pictureId") != null:
		host.call("thumb", int(bkg.pictureId), func(tex: Texture2D) -> void:
			if is_instance_valid(st):
				st.bkg_texture = tex
				st.queue_redraw())
	stages.append(st)
	cell.add_child(st)
	return cell


## The shown screens survive a restart (Studio keeps them in localStorage).
static func saved_shown(path: String) -> Array:
	var cf := ConfigFile.new()
	if cf.load(path) != OK:
		return []
	var v: Variant = cf.get_value("programming", "shown", [])
	return (v as Array).map(func(x: Variant) -> int: return int(x)) if v is Array else []


static func save_shown(path: String, shown: Array) -> void:
	var cf := ConfigFile.new()
	cf.load(path)
	cf.set_value("programming", "shown", shown)
	cf.save(path)
