extends VBoxContainer
## WO-1039 — Device tab "Self-test" block (Studio self-test-ui.js): last result, abnormal items first, run on demand.
## `show_state(st)` fills it from GET self-test; "Run" asks first, then emits send("self-test", {action: run}, "").

signal send(resource: String, body: Dictionary, done: String)

const M := preload("res://features/pixelhue/device_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


func show_state(st: Dictionary) -> void:
	for c in get_children():
		c.queue_free()
	visible = st.get("supported") == true
	if not visible:
		return
	Kit.heading(self, "Self-test")
	var sum := Label.new()
	sum.text = M.self_test_summary(st)
	if int(st.get("abnormal", 0)) > 0:
		sum.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	add_child(sum)
	Kit.button(self, "Run self-test", func() -> void:
		Kit.confirm(self, "Run the device self-test now? The device must be idle.",
			func() -> void: send.emit("self-test", {"action": "run"}, "")))
	if int(st.get("total", 0)) == 0:
		return
	for part in st.get("parts", []):
		Kit.note(self, "Slot %s · model %s" % [str(part.get("slotId", "")), str(int(part.get("modelId", 0)))])
		var g := Kit.grid(self)
		var rows: Array = []
		for r in M.self_test_rows(part):
			rows.append([r[0], r[1]])
		Kit.fill_grid(g, rows)
