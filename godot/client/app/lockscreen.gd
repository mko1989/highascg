extends Node
## WO-838 — autoload "Lockscreen": owns the overlay (app/lock_overlay.gd) and keeps it the LAST child of the root so
## its `_input` runs before every other node's. The locked state is never persisted: a launch is always unlocked.

const Overlay := preload("res://app/lock_overlay.gd")

var overlay: Overlay = null


func _ready() -> void:
	_attach.call_deferred()  # after the main scene joined the root, so the overlay is behind it in tree order


func _attach() -> void:
	overlay = Overlay.new()
	get_tree().root.add_child(overlay)


func is_locked() -> bool:
	return overlay != null and overlay.is_locked()
