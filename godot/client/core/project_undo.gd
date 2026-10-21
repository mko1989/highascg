extends Node
## WO-642 — Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) for the show document on every tab. Every edit already ends in
## ProjectSync.mark_dirty() / deck_changed() (`edited`), so this keeps whole-document snapshots
## (project_undo_model.gd) instead of per-feature undo code. A restore goes through Store.set_project (every view
## reloads on project_changed) and is saved like an edit, looks included (deck_changed). Loading another project
## clears the history; a remote sync of the same project re-bases it. Text fields keep their own Ctrl+Z while they have
## typing to undo, and a tab with its own undo (Devices cables) answers first while it has steps.

const Model := preload("res://core/project_undo_model.gd")

signal applied(what: String)  # "undo" | "redo"

var history := Model.new()
var _doc: Dictionary = {}  # the Store.project instance history.cur describes (set_project swaps the instance)
var _restoring := false


func _ready() -> void:
	Store.project_changed.connect(func(_p: Dictionary) -> void: _on_project())
	ProjectSync.edited.connect(_on_edit)
	_doc = Store.project
	history.rebase(Model.snapshot(Store.project))


## A new document instance: a load, a remote sync, or our own restore.
func _on_project() -> void:
	if is_same(Store.project, _doc):
		return  # a local edit announcing itself; `edited` records it
	if str(Store.project.get("slug", "")) != str(_doc.get("slug", "")):
		history.clear()
	_doc = Store.project
	if not _restoring:
		history.rebase(Model.snapshot(Store.project))


func _on_edit() -> void:
	if _restoring:
		return
	if not is_same(Store.project, _doc):
		_on_project()
	history.record(Model.snapshot(Store.project), Time.get_ticks_msec())


func undo() -> bool:
	_on_edit()  # an edit not yet marked still counts
	return _restore(history.undo(), "undo")


func redo() -> bool:
	return _restore(history.redo(), "redo")


func _restore(s: String, what: String) -> bool:
	if s == "":
		print("[undo] nothing to %s" % what)
		return false
	var p: Variant = Model.document(s, Store.project)
	if p == null:
		return false
	var keys := (p as Dictionary).keys().filter(func(k: Variant) -> bool:
		return not k in Model.BOOKKEEPING and Model.canon(p[k]) != Model.canon(Store.project.get(k)))
	print("[undo] %s: %s" % [what, ", ".join(keys)])  # which parts of the show went back (client log)
	_restoring = true
	Store.set_project(p)  # → every view reloads
	ProjectSync.deck_changed()
	ProjectSync.mark_dirty()
	_restoring = false
	applied.emit(what)
	return true


## A focused text field would swallow Ctrl+Z even with nothing of its own to undo (a spin box after its arrows, a
## field just clicked), so this answers before the GUI does unless the field has typing to undo (_own_undo).
func _input(event: InputEvent) -> void:
	var f := get_viewport().gui_get_focus_owner()
	var dir := _key(event)
	if dir == "" or not (f is LineEdit or f is TextEdit):
		return
	if _own_undo(f, dir):
		return
	_apply(dir)


## Whether a text field answers Ctrl+Z itself: a spin box's field only while a typed number is pending (its arrows
## leave text steps behind that only repaint the number); any other field while it has steps.
static func _own_undo(f: Control, dir: String) -> bool:
	if f.get_parent() is SpinBox:
		return not is_equal_approx((f as LineEdit).text.to_float(), (f.get_parent() as SpinBox).value)
	return f.has_undo() if dir == "undo" else f.has_redo()


func _unhandled_key_input(event: InputEvent) -> void:
	var dir := _key(event)
	if dir != "":
		_apply(dir)


## → "undo" | "redo" | "" for a key event.
static func _key(event: InputEvent) -> String:
	var k := event as InputEventKey
	if k == null or not k.pressed or not k.is_command_or_control_pressed():
		return ""
	if k.keycode == KEY_Z:
		return "redo" if k.shift_pressed else "undo"
	return "redo" if k.keycode == KEY_Y else ""


func _apply(dir: String) -> void:
	get_viewport().set_input_as_handled()
	if dir == "undo":
		undo()
	else:
		redo()
