extends VBoxContainer
## WO-1002 — "Tracking stage" in the Previs 3D Inspector: the tracking floor grid (project.previs.tracking.grid,
## OpenFollow's measured rectangle — tracking cameras calibrate on it; follow, zones and walk-the-lines use its frame).
## The Camera page shows its Floor grid only once a tracking camera exists, so before this nothing in the GUI could put
## the grid on an MVR's stage: it sat at the default 10 × 6 m around the origin, out among a venue's tables.
## "Fit to selection": the grid takes the footprint of the selected MVR objects (click the stage deck in the 3D view, or
## its layer in Layers, WO-1001) and their top as its floor. Writes the project like the Camera page (previs slice,
## client-owned) and announces it — the coverage view and an adopted Camera page reload from the project. It never goes
## through the Camera page: until the Inspector adopts it, that page holds no project data.

const T := preload("res://features/previs/tracking/tracking_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Fold := preload("res://features/previs/fold_section.gd")

## [label, grid key, min, max, step] (tracking_model.GRID_DEFAULT's keys)
const FIELDS := [["Width m", "width", 0.5, 200, 0.1], ["Depth m", "depth", 0.5, 200, 0.1],
	["Centre X m (stage left +)", "x_offset", -200, 200, 0.01], ["Centre Y m (upstage +)", "y_offset", -200, 200, 0.01],
	["Floor Z m", "z_offset", -10, 50, 0.01], ["Grid spacing m", "spacing", 0.1, 50, 0.1]]
const HINT := "Select the stage deck (click it in the 3D view, or its layer under MVR scene ▸ Layers), then Fit to selection. Tick Tracking cameras above the view to see the grid."

var mvr: Node  # mvr_section.gd: selected_uuids(), scene (mvr_scene.gd wall_boxes)
var _spins := {}
var _note: Label


static func fold(mvr_section: Node) -> Control:
	var s := new()
	s.mvr = mvr_section
	return Fold.new("Tracking stage", [s])


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var g := GridContainer.new()
	g.columns = 2
	for f in FIELDS:
		var l := Label.new()
		l.text = f[0]
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		g.add_child(l)
		var sb := SpinBox.new()
		sb.min_value = f[2]
		sb.max_value = f[3]
		sb.step = f[4]
		sb.select_all_on_focus = true
		sb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var key: String = f[1]
		sb.value_changed.connect(func(v: float) -> void: _edit({key: v}))
		g.add_child(sb)
		_spins[key] = sb
	add_child(g)
	var fit := Button.new()
	fit.text = "Fit to selection"
	fit.tooltip_text = "The tracking grid covers the selected MVR objects; its floor is their top"
	fit.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	fit.pressed.connect(_fit_selection)
	add_child(fit)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_note.text = HINT
	add_child(_note)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _sync())
	_sync()


## The project's grid (defaults filled in).
func grid() -> Dictionary:
	var pv: Variant = Store.project.get("previs")
	var tr: Variant = (pv as Dictionary).get("tracking") if pv is Dictionary else null
	return T.normalize_grid((tr as Dictionary).get("grid") if tr is Dictionary else null)


func _sync() -> void:
	var g := grid()
	for k in _spins:
		(_spins[k] as SpinBox).set_value_no_signal(float(g[k]))


## Merge `change` into the project's grid; the rest of project.previs.tracking is left as it is.
func _edit(change: Dictionary) -> void:
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	var t: Dictionary = (previs.get("tracking") as Dictionary).duplicate(true) if previs.get("tracking") is Dictionary else {}
	var g := grid()
	g.merge(change, true)
	t["grid"] = T.normalize_grid(g)
	if JSON.stringify(t.grid) == JSON.stringify(grid()):
		return
	previs["tracking"] = t
	Store.project["previs"] = previs
	ProjectSync.mark_dirty()
	Store.project_changed.emit(Store.project)


func _fit_selection() -> void:
	var uuids: Array = mvr.selected_uuids() if mvr != null else []
	var boxes: Array = mvr.scene.wall_boxes(uuids) if not uuids.is_empty() and mvr.scene != null else []
	var g := T.grid_for(boxes)
	if g.is_empty():
		_note.text = "Nothing selected. " + HINT
		return
	_edit(g)
	_note.text = "Tracking stage = the selection: %.2f × %.2f m, centre X %.2f / Y %.2f m, floor %.2f m (the grid is square to the stage — a turned deck gets its bounding rectangle)." % [
		g.width, g.depth, g.x_offset, g.y_offset, g.z_offset]
