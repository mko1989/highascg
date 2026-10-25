extends RefCounted
## WO-762 — drag a look card onto another card of the same screen to move it there (left half: before it, right half:
## after it), or onto the screen's blank deck space / "+" to move it to the end. The order is the project's scenes
## array (web scene-state.js reorderScene, WO-563), saved like any deck edit.

const E := preload("res://features/live/look_edits.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const KIND := "look-reorder"


static func payload(id: String, main: int) -> Dictionary:
	return {"type": KIND, "lookId": id, "main": main}


## A look card dragged from this screen's deck (a look never moves to another screen's column by drag).
static func is_reorder(data: Variant, main: int) -> bool:
	return data is Dictionary and str((data as Dictionary).get("type", "")) == KIND and int((data as Dictionary).get("main", -1)) == main


## The card as drag source + drop target. `root` returns the scenes root, `commit` saves the deck.
static func wire(card: Control, id: String, main: int, label: String, root: Callable, commit: Callable) -> void:
	card.set_drag_forwarding(func(_at: Vector2) -> Variant:
		var p := Label.new()
		p.text = label
		p.add_theme_stylebox_override("normal", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.ACCENT, 1))
		card.set_drag_preview(p)
		return payload(id, main),
	func(_at: Vector2, data: Variant) -> bool:
		return is_reorder(data, main) and str(data.lookId) != id,
	func(at: Vector2, data: Variant) -> void:
		if E.move_look(root.call(), str(data.lookId), id, at.x > card.size.x / 2.0):
			commit.call())


static func to_end(data: Variant, root: Callable, commit: Callable) -> void:
	if E.move_look(root.call(), str((data as Dictionary).get("lookId", "")), ""):
		commit.call()
