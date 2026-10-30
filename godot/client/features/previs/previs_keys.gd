extends RefCounted
## WO-843 — which previs keys act on the stage selection (pure; previs_tab.gd `_unhandled_key_input`).


## Delete / Backspace, Ctrl+D and the nudge keys (arrows, Page Up / Down, Q / E) act on the selected stage object or
## heads. In Camera mode that selection is not on screen (the 3D scene is hidden behind the camera views), so a Delete
## aimed at the markers list removed a wall nobody could see, and the arrows moved it. Only the 3D view takes them.
static func stage_keys(mode: String) -> bool:
	return mode == "3d"
