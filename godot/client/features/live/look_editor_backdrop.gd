extends RefCounted
## WO-860 — what the look editor's frame shows under the layer boxes: the main's PRV channel itself (its shm surface),
## or, on a main without a PRV bus, the look composited from HQ source thumbnails (look_thumb.gd, the deck card's
## renderer) — owner 30.10: "this space should always show the prv channel directly (unless there is no, then use
## thumbnails hq)".
const SC := preload("res://core/screen_channels.gd")

const DeckModel := preload("res://features/live/deck_model.gd")
const LOOK_THUMB := "res://features/live/look_thumb.gd"  # loaded on use: it calls the Api autoload


## Autoloads by node: the headless test runner compiles this file without them.
static func _autoload(name: String) -> Node:
	return (Engine.get_main_loop() as SceneTree).root.get_node_or_null(name)


## WO-1029 C9: does this client's node relay `role` from the screen's owner (VideoSurfaces descriptor)?
static func _relayed(role: String) -> bool:
	var vs := _autoload("VideoSurfaces")
	return vs != null and vs.has_method("relayed") and bool(vs.call("relayed", role))


static func _cm() -> Dictionary:
	var cm: Variant = _autoload("Store").get_value("channelMap", {})
	return cm if cm is Dictionary else {}


## Sets the editor up for its main; returns the video role to hold ("" = thumbnails, nothing to hold).
static func open(ed: Control) -> String:
	ed.set_meta("sources_key", sources_key(ed.scene_id, ed.look()))
	return open_with(ed, _cm())


## `make_thumb` builds the thumbnail control (tests pass a stand-in; look_thumb.gd needs the Api autoload).
static func open_with(ed: Control, cm: Dictionary, make_thumb := Callable()) -> String:
	if ed._thumb != null:
		ed._thumb.queue_free()
		ed._thumb = null
	# WO-1029 C9: a remote screen's PRV when its owner's picture is relayed (small, ~10 fps); otherwise thumbnails.
	# WO-1044: editing the look on air (PGM edit unlocked) shows the PGM picture — what the edits change.
	var bus := "pgm" if str(ed.get_meta("backdrop_bus", "prv")) == "pgm" else "prv"
	var has_bus := bus == "pgm" or DeckModel.preview_bus_available(cm, ed.main)
	var prv := has_bus and (SC.is_here(cm, ed.main) or _relayed("%s%d" % [bus, ed.main + 1]))
	ed._video.visible = prv
	if prv:
		var role := "%s%d" % [bus, ed.main + 1]
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


## The thumbnail backdrop follows the edits (the PRV surface follows by itself — the pushes restage PRV; a server-side
## media move does not push, see follow_media).
static func refresh(ed: Control) -> void:
	if ed._thumb != null:
		ed._thumb.refresh(ed.look())


## The open look's media, keyed with its id: a change of it (not of position or size) needs a fresh PRV stage.
static func sources_key(scene_id: String, look: Dictionary) -> String:
	var vals := PackedStringArray([scene_id])
	for l in look.get("layers", []):
		if l is Dictionary and (l as Dictionary).get("source") is Dictionary:
			vals.append(str((l as Dictionary).source.get("value", "")))
	return "|".join(vals)


## WO-921: a project sync that moved the open look's media (a new version under its own name, a rename) restages PRV.
## Local edits push by themselves; a server-side rewrite does not, and Caspar's PRV kept playing the old file.
static func follow_media(ed: Control) -> void:
	var key := sources_key(ed.scene_id, ed.look())
	if str(ed.get_meta("sources_key", key)) != key:
		ed.pusher.schedule(ed.scene_id, ed.main)
	ed.set_meta("sources_key", key)
