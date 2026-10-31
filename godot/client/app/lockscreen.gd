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
	if Config.args.has("probe-lock"):  # dev (WO-901): --probe-lock=plain|bounce locks 4 s after boot. Stores the style in
		# ui.cfg [lockscreen] — run it with its own XDG_DATA_HOME, never on the owner's.
		var LockModel := preload("res://core/lock_model.gd")
		LockModel.save_pref("style", "bounce" if str(Config.args["probe-lock"]) == "bounce" else "plain")
		overlay.reload()
		await get_tree().create_timer(4.0).timeout
		overlay.lock()


func is_locked() -> bool:
	return overlay != null and overlay.is_locked()
