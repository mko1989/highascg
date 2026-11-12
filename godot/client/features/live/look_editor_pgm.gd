extends RefCounted
## WO-1044 — PGM edit: a screen column's "PGM edit" button (deck_head.gd, between FTB and the timer) opens the look editor
## on the look that is on that screen's PGM, and its edits go to air (owner 12.11: "i need a button PGM-edit between the
## ftb and timer that will bring the look editor of the current pgm"). Edits → preview-push `target: 'pgm'`
## (src/api/routes-scene-pgm-edit-push.js: geometry = PGM MIXER nudge, content = a cut take of the same look, PRV left
## alone); the frame shows the PGM picture. The session ends when the editor closes or opens another look; while the look
## is no longer on that PGM (a take elsewhere) its edits go to PRV again, nothing is pushed by itself.

const DeckModel := preload("res://features/live/deck_model.gd")
const Backdrop := preload("res://features/live/look_editor_backdrop.gd")


## Pure rule (tested): edits of `scene_id` go to air in a PGM edit session while it IS the look on that PGM.
static func goes_to_pgm(scene_id: String, pgm_session: bool, pgm_look_id: String) -> bool:
	return pgm_session and scene_id != "" and scene_id == pgm_look_id


## Autoloads by node: the headless test runner compiles this file without them.
static func _store() -> Node:
	return (Engine.get_main_loop() as SceneTree).root.get_node_or_null("Store")


## The look on `main`'s PGM right now ("" = none), exactly as the deck column shows it.
static func pgm_look(main: int) -> String:
	var st := _store()
	if st == null:
		return ""
	var cm: Variant = st.get_value("channelMap", {})
	var live: Variant = st.get_value("scene.live", {})
	var ps: Variant = (st.get("project") as Dictionary).get("scenes", {})
	var known := {}
	for s in (ps as Dictionary).get("scenes", []) if ps is Dictionary else []:
		if s is Dictionary:
			known[str((s as Dictionary).get("id", ""))] = true
	return str(DeckModel.resolve_bus_look_ids(main, live if live is Dictionary else {}, cm if cm is Dictionary else {},
		known, ps if ps is Dictionary else {}, st.get_value("scene.remoteLive")).get("pgm", ""))


## `ed` = look_editor.gd: are its edits going to air right now?
static func live(ed: Control) -> bool:
	return goes_to_pgm(ed.scene_id, ed.pgm_session, pgm_look(ed.main) if ed.pgm_session else "")


## PGM changed under the open editor (`ed` = look_editor.gd): the frame and title follow; nothing is pushed.
static func refresh(ed: Control) -> void:
	if not ed.visible:
		return
	var now := live(ed)
	if now == ed._on_pgm:
		return
	ed._on_pgm = now
	ed._hold(false)
	ed.set_meta("backdrop_bus", "pgm" if now else "prv")
	ed._role = Backdrop.open(ed)
	ed._hold(true)
	ed._refresh_list()
	if not now:
		ed.show_status("No longer on PGM — edits go to PRV")
