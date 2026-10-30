extends RefCounted
## WO-860 — what the look editor's frame shows under the layer boxes: the main's PRV channel itself (its shm surface),
## or, on a main without a PRV bus, the look composited from HQ source thumbnails (look_thumb.gd, the deck card's
## renderer) — owner 30.10: "this space should always show the prv channel directly (unless there is no, then use
## thumbnails hq)".

const DeckModel := preload("res://features/live/deck_model.gd")
const LOOK_THUMB := "res://features/live/look_thumb.gd"  # loaded on use: it calls the Api autoload


## Autoloads by node: the headless test runner compiles this file without them.
static func _autoload(name: String) -> Node:
	return (Engine.get_main_loop() as SceneTree).root.get_node_or_null(name)


static func _cm() -> Dictionary:
	var cm: Variant = _autoload("Store").get_value("channelMap", {})
	return cm if cm is Dictionary else {}


## Sets the editor up for its main; returns the video role to hold ("" = thumbnails, nothing to hold).
static func open(ed: Control) -> String:
	return open_with(ed, _cm())


## `make_thumb` builds the thumbnail control (tests pass a stand-in; look_thumb.gd needs the Api autoload).
static func open_with(ed: Control, cm: Dictionary, make_thumb := Callable()) -> String:
	if ed._thumb != null:
		ed._thumb.queue_free()
		ed._thumb = null
	var prv := DeckModel.preview_bus_available(cm, ed.main)
	ed._video.visible = prv
	if prv:
		var role := "prv%d" % (ed.main + 1)
		ed._video.texture = _autoload("VideoSurfaces").texture(role)
		return role
	ed._thumb = make_thumb.call() if make_thumb.is_valid() else load(LOOK_THUMB).new()
	ed._thumb.setup(ed.look(), ed._canvas(), cm)
	ed._frame.add_child(ed._thumb)
	ed._frame.move_child(ed._thumb, ed._video.get_index() + 1)  # under the boxes
	return ""


static func place(ed: Control, b: Rect2) -> void:
	ed._video.position = b.position
	ed._video.size = b.size
	if ed._thumb != null:
		ed._thumb.position = b.position
		ed._thumb.size = b.size


## The thumbnail backdrop follows the edits (the PRV surface follows by itself — the pushes restage PRV).
static func refresh(ed: Control) -> void:
	if ed._thumb != null:
		ed._thumb.refresh(ed.look())
