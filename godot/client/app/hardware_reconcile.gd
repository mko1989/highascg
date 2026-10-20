extends Node
## WO-608 — project hardware reconcile (web project-import-flow.js boot / reconnect branch +
## project-hardware-reconcile-modal.js). After the project is pulled, GET /api/project/hardware-check (the node
## compares the saved hardwareConfig with the live machine and applies the web's ask rule); the remembered policy
## (ui.cfg [project] hardware_policy — the web's localStorage key) may answer without asking. Apply = POST
## /api/project/hardware-apply (Device View + routing, OS layout, Caspar config — server-side). Keep = a sticky header
## notice (the web banner). Header Load needs none of this: POST /api/project/load {applyHardware} restores it.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://app/hardware_reconcile_model.gd")
const UI_CFG := "user://ui.cfg"

var shell: Node  # app/shell.gd: header_project.say, tabs, Devices.snapshots
var _dlg: AcceptDialog
var _busy := false


static func policy() -> String:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	return M.policy_of(cfg.get_value("project", "hardware_policy", "ask"))


static func set_policy(p: String) -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("project", "hardware_policy", M.policy_of(p))
	cfg.save(UI_CFG)


func check() -> void:
	if _busy:
		return
	_busy = true
	var r: Dictionary = await Api.get_json("/api/project/hardware-check")
	_busy = false
	if r.ok and r.data is Dictionary:
		run(r.data)


## Also the dev entry (--probe-hw-reconcile shows a fake report).
func run(report: Dictionary) -> void:
	match M.decide(report, policy()):
		"apply":
			_apply()
		"keep":
			_keep()
		"ask":
			_ask(report)


func _say(n: Dictionary) -> void:
	shell.header_project.say(n)


func _keep() -> void:
	_say({"text": M.KEEP_NOTICE, "tone": "warn", "sticky": true})


func _apply() -> void:
	_say({"text": "Applying project hardware…", "tone": "muted", "sticky": true})
	var r: Dictionary = await Api.post_json("/api/project/hardware-apply", {})
	_say(M.apply_notice(r.ok, r.data))


func _ask(report: Dictionary) -> void:
	if _dlg != null and is_instance_valid(_dlg):
		return  # web: one modal at a time
	_dlg = AcceptDialog.new()
	_dlg.title = M.TITLE
	_dlg.ok_button_text = "Keep live hardware"
	_dlg.exclusive = false
	var v := VBoxContainer.new()
	v.custom_minimum_size.x = 640
	v.add_theme_constant_override("separation", 8)
	v.add_child(_wrap(M.lead(report), ThemeBuilder.TEXT))
	for line in M.diff_lines(report.get("items", [])):
		v.add_child(_wrap("• " + str(line[0]), ThemeBuilder.ERROR if line[1] == "hard" else ThemeBuilder.WARN))
	var remember := CheckBox.new()
	remember.text = "Remember my choice for future loads"
	v.add_child(remember)
	var pick := OptionButton.new()
	for l in M.POLICY_LABELS:
		pick.add_item(l)
	pick.visible = false
	pick.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	remember.toggled.connect(func(on: bool) -> void:
		pick.visible = on
		_dlg.reset_size())
	v.add_child(pick)
	v.add_child(_wrap(M.FOOTER, ThemeBuilder.TEXT_MUTED))
	_dlg.add_child(v)
	_dlg.add_button("Open Device View", false, "device_view")
	_dlg.add_button("Load device snapshot…", false, "load_snapshot")
	_dlg.add_button("Apply project hardware", report.get("sameMachine", false) != true, "apply_saved")
	var done := func(choice: String) -> void:
		if remember.button_pressed:
			var p := M.remembered(choice, M.POLICIES[pick.selected])
			if p != "":
				set_policy(p)
		_dlg.hide()
		_dlg.queue_free()
		_act(choice)
	_dlg.confirmed.connect(func() -> void: done.call("keep_live"))
	_dlg.canceled.connect(func() -> void: done.call("cancel"))
	_dlg.custom_action.connect(func(a: StringName) -> void: done.call(str(a)))
	shell.add_child(_dlg)
	_dlg.popup_centered()


func _act(choice: String) -> void:
	match choice:
		"apply_saved":
			_apply()
		"keep_live":
			_keep()
		"device_view", "load_snapshot":
			_say({"text": M.KEEP_NOTICE, "tone": "warn", "sticky": true})
			var devices: Node = shell.tabs.get_node("Devices")
			shell.tabs.current_tab = devices.get_index()
			if choice == "load_snapshot":
				devices.snapshots.open_load()


func _wrap(text: String, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 620  # autowrap measures at 1 px otherwise
	l.add_theme_color_override("font_color", color)
	return l
