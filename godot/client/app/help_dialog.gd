extends RefCounted
## WO-740 — help pages (res://help/<topic>.md) in a modal. `HelpDialog.button("psn-output")` gives the small "?" that
## opens one; links between pages (`[text](other-topic.md)`) switch the page in place, and the page title is the
## window's. Outside links are shown, not opened: the kiosk has no browser.

const MD := preload("res://app/markdown_bbcode.gd")
const DIR := "res://help/"


static func path_of(topic: String) -> String:
	return DIR + topic.trim_suffix(".md").get_file() + ".md"


## The page's Markdown ("" when there is no such page).
static func load_md(topic: String) -> String:
	var f := FileAccess.open(path_of(topic), FileAccess.READ)
	return f.get_as_text() if f != null else ""


## A flat "?" that opens `topic` (its tooltip names the page).
static func button(topic: String) -> Button:
	var b := Button.new()
	b.text = "?"
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	var t := MD.title(load_md(topic))
	b.tooltip_text = "Help: " + (t if t != "" else topic)
	b.pressed.connect(func() -> void: open(b, topic))
	return b


## `c` (stretched) with the "?" for `topic` at its right — for a heading or a control row.
static func beside(c: Control, topic: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(c)
	row.add_child(button(topic))
	return row


static func open(from: Node, topic: String) -> void:
	var dlg := AcceptDialog.new()
	dlg.ok_button_text = "Close"
	var text := RichTextLabel.new()
	text.bbcode_enabled = true
	text.selection_enabled = true
	text.custom_minimum_size = Vector2(640, 420)
	text.size_flags_vertical = Control.SIZE_EXPAND_FILL
	text.meta_clicked.connect(func(meta: Variant) -> void:
		var m := str(meta)
		if m.ends_with(".md") and not m.contains("://"):
			_show(dlg, text, m))
	dlg.add_child(text)
	from.get_tree().root.add_child(dlg)
	dlg.visibility_changed.connect(func() -> void:
		if not dlg.visible:
			dlg.queue_free())
	_show(dlg, text, topic)
	var win := from.get_tree().root.size
	dlg.popup_centered(Vector2i(mini(900, int(win.x * 0.8)), mini(760, int(win.y * 0.85))))


static func _show(dlg: AcceptDialog, text: RichTextLabel, topic: String) -> void:
	var md := load_md(topic)
	if md == "":
		md = "# Help\n\nNo help page \"%s\" on this client." % topic
	dlg.title = MD.title(md)
	text.text = MD.convert(md)
	text.scroll_to_line(0)
