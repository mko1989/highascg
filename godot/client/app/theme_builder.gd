extends RefCounted
## WO-599 T5 — the Godot Theme generated from the web client's design tokens
## (client/styles/01a1-base-theme-tokens.css:17-36) so both clients look like one product.

const BG_DARK := Color("#0d1117")
const BG_PANEL := Color("#161b22")
const BG_ELEVATED := Color("#21262d")
const BORDER := Color("#30363d")
const TEXT := Color("#e6edf3")
const TEXT_MUTED := Color("#8b949e")
const ACCENT := Color("#58a6ff")
const ACCENT_HOVER := Color("#79b8ff")
const ACCENT_GREEN := Color("#2ecc71")
const ACCENT_RED := Color("#e74c3c")
const SUCCESS := Color("#3fb950")
const WARN := Color("#d29922")
const ORANGE := Color("#f0883e")  # audio SOLO (owner 30.10: red mute, orange solo)
const ERROR := Color("#f85149")
const RADIUS := 6
const HEADER_H := 48
const PANEL_W := 260
const FONT_PATH := "res://assets/fonts/Rewir-Light.ttf"
## WO-826: arrows, ▸ ▾, ✓ ✕, ⚠ … that Rewir lacks. The Web export has no system fonts to fall back on (boxes there).
const SYMBOL_FALLBACK_PATH := "res://assets/fonts/DejaVuSans-ui-symbols.ttf"


static func build() -> Theme:
	var t := Theme.new()
	var font := load_font()
	if font != null:
		t.default_font = font
	t.default_font_size = 15
	for type in ["Label", "Button", "LineEdit", "TabBar", "ItemList", "Tree", "OptionButton", "CheckBox"]:
		t.set_color("font_color", type, TEXT)
	t.set_color("font_color", "TabBar", TEXT_MUTED)
	t.set_color("font_selected_color", "TabBar", TEXT)
	t.set_color("font_hover_color", "TabBar", TEXT)
	t.set_stylebox("panel", "PanelContainer", box(BG_PANEL, BORDER, 0))
	t.set_stylebox("panel", "Panel", box(BG_PANEL, BORDER, 0))
	t.set_stylebox("panel", "TabContainer", box(BG_DARK, BORDER, 0))
	t.set_stylebox("normal", "Button", box(BG_ELEVATED, BORDER, 1))
	t.set_stylebox("hover", "Button", box(BG_ELEVATED.lightened(0.08), ACCENT, 1))
	t.set_stylebox("pressed", "Button", box(BG_ELEVATED.darkened(0.15), ACCENT, 1))
	t.set_stylebox("focus", "Button", box(Color(0, 0, 0, 0), ACCENT, 1))
	t.set_stylebox("tab_selected", "TabBar", tab_box(BG_PANEL, ACCENT))
	t.set_stylebox("tab_unselected", "TabBar", tab_box(BG_DARK, BG_DARK))
	t.set_stylebox("tab_hovered", "TabBar", tab_box(BG_ELEVATED, BORDER))
	return t


static func load_font() -> Font:
	# Runtime load from the raw file (no editor import step needed; .ttf is read directly).
	var bytes := FileAccess.get_file_as_bytes(FONT_PATH)
	if bytes.is_empty():
		return null
	var f := FontFile.new()
	f.data = bytes
	var sym := FileAccess.get_file_as_bytes(SYMBOL_FALLBACK_PATH)
	if not sym.is_empty():
		var fb := FontFile.new()
		fb.data = sym
		f.fallbacks = [fb]
	return f


static func box(bg: Color, border: Color, border_w: int, radius := RADIUS) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(border_w)
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(8)
	return sb


static func tab_box(bg: Color, underline: Color) -> StyleBoxFlat:
	var sb := box(bg, underline, 0, 0)
	sb.border_width_bottom = 2
	sb.content_margin_left = 16
	sb.content_margin_right = 16
	return sb


## A full-height divider line between side-by-side groups (2 px, BORDER colour: visible on BG_DARK).
static func vline() -> ColorRect:
	var r := ColorRect.new()
	r.color = BORDER
	r.custom_minimum_size.x = 2
	r.size_flags_vertical = Control.SIZE_FILL
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return r
