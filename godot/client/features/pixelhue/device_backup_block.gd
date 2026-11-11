extends VBoxContainer
## WO-1039 — Device tab "Source backup" block (Studio source-backup-ui.js). Every action applies at once:
## it emits send("source-backup", body, doneText) and the panel writes it and re-shows the answer.

signal send(resource: String, body: Dictionary, done: String)
signal problem(text: String)

const M := preload("res://features/pixelhue/device_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

var _state: Dictionary = {}
var _new_primary: OptionButton
var _new_backup: OptionButton
var _free: Array = []
var _cands: Array = []


func _emit(body: Dictionary, done: String) -> void:
	send.emit("source-backup", body, done)


func show_state(st: Dictionary) -> void:
	_state = st
	for c in get_children():
		c.queue_free()
	visible = st.get("supported") == true
	if not visible:
		return
	Kit.heading(self, "Source backup")
	var top := Kit.row(self)
	var on := int(st.get("enable", 0))
	var en := OptionButton.new()
	en.add_item("Backup off", 0)
	en.add_item("Backup on", 1)
	en.select(on)
	en.item_selected.connect(func(i: int) -> void:
		_emit(M.backup_enable(i), "Source backup on." if i == 1 else "Source backup off."))
	top.add_child(en)
	var pf := CheckBox.new()
	pf.text = "Primary preferred"
	pf.tooltip_text = "Return to the primary whenever its signal is back"
	pf.button_pressed = int(st.get("primaryFirst", 0)) == 1
	pf.toggled.connect(func(b: bool) -> void: _emit(M.backup_primary_first(b), "Primary preference saved."))
	top.add_child(pf)
	if on == 0:
		Kit.note(self, M.backup_idle_note(st))
		return
	for pair in st.get("pairs", []):
		_pair_row(pair)
	_free = M.backup_free(st)
	var add := Kit.row(self)
	_new_primary = OptionButton.new()
	_new_primary.add_item("Primary input", -1)
	for i in _free:
		_new_primary.add_item(M.backup_input_label(i), int(i.id))
	_new_primary.item_selected.connect(_on_primary)
	add.add_child(_new_primary)
	_new_backup = OptionButton.new()
	_new_backup.add_item("Same capacity only" if st.get("sameCapacity") == true else "Backup input", -1)
	add.add_child(_new_backup)
	Kit.button(add, "Add", _on_add)
	if (st.get("pairs", []) as Array).size() > 1:
		Kit.button(self, "Remove all", func() -> void:
			Kit.confirm(self, "Remove every backup pair?", func() -> void: _emit({"action": "clear"}, "Backup pairs removed.")))


func _pair_row(pair: Dictionary) -> void:
	var id := int(pair.get("id", 0))
	var row := Kit.row(self)
	var names := Label.new()
	names.text = "%s -> %s" % [str(pair.get("primaryName", "")), str(pair.get("backupName", ""))]
	names.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(names)
	var editable: bool = pair.get("editable", true) != false
	var auto := OptionButton.new()
	auto.add_item("Auto", 1)
	auto.add_item("Manual", 0)
	auto.select(0 if pair.get("auto") == true or pair.get("auto") == 1 else 1)
	auto.disabled = not editable
	auto.item_selected.connect(func(i: int) -> void: _emit(M.backup_update_auto(id, i == 0), "Switch mode saved."))
	row.add_child(auto)
	var using := OptionButton.new()
	var opts := M.backup_using_options(pair)
	for k in opts.size():
		using.add_item(str(opts[k][1]), k)
		if opts[k][0] == str(pair.get("using", "")):
			using.select(k)
	using.disabled = not editable or pair.get("auto") == true or pair.get("auto") == 1
	using.item_selected.connect(func(k: int) -> void: _emit(M.backup_update_using(id, str(opts[k][0])), "Source in use saved."))
	row.add_child(using)
	Kit.button(row, "Remove", func() -> void: _emit(M.backup_remove(id), "Backup pair removed."))


func _on_primary(_i: int) -> void:
	_new_backup.clear()
	_new_backup.add_item("Backup input", -1)
	_cands = M.backup_candidates(_state, _new_primary.get_selected_id())
	for i in _cands:
		_new_backup.add_item(M.backup_input_label(i), int(i.id))


func _on_add() -> void:
	var p := _new_primary.get_selected_id()
	var b := _new_backup.get_selected_id()
	if p < 0 or b < 0:
		problem.emit("Choose a primary and a backup input.")
		return
	_emit(M.backup_add(p, b), "Backup pair added.")
