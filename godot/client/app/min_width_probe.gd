extends Node
## dev: --probe-min-width=<tab> — which control pins a column's minimum width. Opens the tab, waits for its pages to
## settle, then prints the workspace tabs' and the Inspector's combined minimum width and, from each, the chain of the
## widest-minimum child down to the leaf that sets it (a Label without clip / autowrap, a long row …).


func _ready() -> void:
	await get_tree().create_timer(4.0).timeout
	var shell: Node = get_parent().shell  # added by main.gd
	var tab := str(Config.args.get("probe-min-width", ""))
	if tab != "" and shell.tab_node(tab) != null:
		shell.show_tab(shell.tab_node(tab))
	await get_tree().create_timer(2.0).timeout
	_report(shell, "start")
	for mode in str(Config.args.get("probe-min-width-modes", "")).split(",", false):  # e.g. Controller,Shader: mode buttons
		for b: Button in shell.tabs.get_current_tab_control().find_children("*", "Button", true, false):
			if b.text == mode and b.is_visible_in_tree():
				b.pressed.emit()
				b.button_pressed = true if b.toggle_mode else b.button_pressed
				break
		await get_tree().create_timer(1.5).timeout
		_report(shell, mode)


func _report(shell: Node, label: String) -> void:
	for root: Control in [shell.tabs, shell.inspector]:
		print("[minw] -- %s: %s min %d size %d" % [label, root.get_class(), root.get_combined_minimum_size().x, root.size.x])
		_chain(root, 0)


func _chain(c: Control, depth: int) -> void:
	var widest: Control = null
	for ch in c.get_children():
		if ch is Control and ch.visible and (widest == null or ch.get_combined_minimum_size().x > widest.get_combined_minimum_size().x):
			widest = ch
	if widest == null or depth > 40:
		return
	var txt := ""
	if widest is Label or widest is Button:
		txt = " \"%s\"" % str(widest.text).left(60)
	print("[minw] %s%s %s min %d%s" % ["  ".repeat(depth), widest.get_class(), widest.name, widest.get_combined_minimum_size().x, txt])
	_chain(widest, depth + 1)
