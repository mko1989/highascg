extends VBoxContainer
## WO-682 — the Inspector's Position card: where the selected head(s), MVR object(s) or stage object stands and its yaw,
## on the Stage panel's axes (X across, Y height, Z toward the audience; metres). An edit moves it (move_targets.gd);
## a group moves together. Its Fold hides while nothing is selected.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const FIELDS := [["X m", "x", -500.0, 500.0, 0.01], ["Y m (height)", "y", -50.0, 200.0, 0.01],
	["Z m", "z", -500.0, 500.0, 0.01], ["Yaw °", "yaw", -180.0, 180.0, 0.5]]

var targets: RefCounted
var fold: Control  ## shown / hidden with the selection
var _what := Label.new()
var _spins := {}


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_what.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_what.autowrap_mode = TextServer.AUTOWRAP_WORD
	add_child(_what)
	var grid := GridContainer.new()
	grid.columns = 4
	add_child(grid)
	for f in FIELDS:
		var l := Label.new()
		l.text = f[0]
		grid.add_child(l)
		var sb := SpinBox.new()
		sb.min_value = f[2]
		sb.max_value = f[3]
		sb.step = f[4]
		sb.custom_arrow_step = f[4]
		sb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sb.value_changed.connect(func(_v: float) -> void: _apply())
		grid.add_child(sb)
		_spins[f[1]] = sb
	var hint := Label.new()
	hint.text = "Drag the selection in 3D (shift: up / down) · arrows, Page Up / Down, Q / E nudge"
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(hint)


func bind(t: RefCounted) -> void:
	targets = t
	targets.changed.connect(refresh)
	refresh()


func refresh() -> void:
	var c: Dictionary = targets.current() if targets != null else {}
	if fold != null:
		fold.visible = not c.is_empty()
	if c.is_empty() or _spins.is_empty():
		return
	_what.text = c.label
	var p: Vector3 = c.pos
	for k in _spins:
		var v: float = c.yaw if k == "yaw" else p[["x", "y", "z"].find(k)]
		(_spins[k] as SpinBox).set_value_no_signal(v)


func _apply() -> void:
	targets.set_from_card(Vector3(_spins.x.value, _spins.y.value, _spins.z.value), _spins.yaw.value)
