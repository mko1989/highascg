extends GridContainer
## WO-616 T3 — the floor grid fields of the tracking Calibrate page (tracking_page.gd; split out by WO-1091 for the
## 500-line limit): the measured rectangle on the stage floor, project.previs.tracking.grid.

const T := preload("res://features/previs/tracking/tracking_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

## [label, key, min, max, step]
const GRID := [["Width m", "width", 0.5, 200, 0.1], ["Depth m", "depth", 0.5, 200, 0.1], ["Spacing m", "spacing", 0.1, 50, 0.1],
	["Centre X m", "x_offset", -100, 100, 0.1], ["Centre Y m", "y_offset", -100, 100, 0.1], ["Floor Z m", "z_offset", -10, 50, 0.01]]

var page: Node  # tracking_page.gd: data, _persist(), _spin()
var _grid := {}


func _init(p: Node) -> void:
	page = p
	columns = 2


func _ready() -> void:
	for f in GRID:
		var l := Label.new()
		l.text = f[0]
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		add_child(l)
		var sb: SpinBox = page._spin(f[2], f[3], f[4])
		var key: String = f[1]
		sb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sb.value_changed.connect(func(v: float) -> void:
			page.data.grid[key] = v
			page.data.grid = T.normalize_grid(page.data.grid)
			page._persist())
		_grid[key] = sb
		add_child(sb)


## Fields ← data (no signals).
func refresh() -> void:
	for k in _grid:
		(_grid[k] as SpinBox).set_value_no_signal(float(page.data.grid[k]))
