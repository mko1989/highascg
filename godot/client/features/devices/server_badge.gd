extends RefCounted
## WO-1018 — the MASTER / FOLLOWER badge of a server (its rear panel header and its card in Servers): a filled pill for
## the master so it cannot be missed, an outlined muted one for a follower. The text comes from cluster_model.gd.

const ThemeBuilder := preload("res://app/theme_builder.gd")


static func make(text: String) -> Control:
	var master := text == "MASTER"
	var pc := PanelContainer.new()
	pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var bg := ThemeBuilder.ACCENT if master else Color(0, 0, 0, 0)
	var sb := ThemeBuilder.box(bg, ThemeBuilder.ACCENT if master else ThemeBuilder.BORDER, 1, 9)
	sb.content_margin_left = 8.0
	sb.content_margin_right = 8.0
	sb.content_margin_top = 1.0
	sb.content_margin_bottom = 1.0
	pc.add_theme_stylebox_override("panel", sb)
	var l := Label.new()
	l.text = text
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", Color("#0d1117") if master else ThemeBuilder.TEXT_MUTED)
	pc.add_child(l)
	pc.visible = text != ""
	return pc
