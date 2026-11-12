extends RefCounted
## WO-1044 — the look editor's per-screen PGM edit lock (owner 12.11: "the lock is for looks programming in the live tab,
## so i can edit the look that is currently on pgm" — PixelHue's per-screen pgmEdit, done HighAsCG's way).
## Locked (the default): every edit goes to PRV, as always. Unlocked on a screen while the open look is the one on that
## screen's PGM: every edit goes to air — preview-push `target: 'pgm'` (src/api/routes-scene-pgm-edit-push.js: geometry =
## PGM MIXER nudge, content = a cut take of the same look with PRV left alone) and the frame shows the PGM picture.
## Session-only on purpose: the client never starts up editing air.

const DeckModel := preload("res://features/live/deck_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Backdrop := preload("res://features/live/look_editor_backdrop.gd")

static var _unlocked := {}  # main index → true


static func is_unlocked(main: int) -> bool:
	return _unlocked.get(main, false) == true


static func set_unlocked(main: int, on: bool) -> void:
	if on:
		_unlocked[main] = true
	else:
		_unlocked.erase(main)


## Pure rule (tested): edits of `scene_id` go to PGM when its screen is unlocked and it IS the look on that PGM.
static func goes_to_pgm(scene_id: String, unlocked: bool, pgm_look_id: String) -> bool:
	return unlocked and scene_id != "" and scene_id == pgm_look_id


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


static func live(scene_id: String, main: int) -> bool:
	return goes_to_pgm(scene_id, is_unlocked(main), pgm_look(main) if is_unlocked(main) else "")


## The header's lock button for `main` (text, colour, tooltip).
static func style_button(b: Button, main: int, on_air: bool) -> void:
	var open := is_unlocked(main)
	b.set_pressed_no_signal(open)
	b.text = "PGM unlocked" if open else "PGM locked"
	if open:
		b.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	else:
		b.remove_theme_color_override("font_color")
	b.tooltip_text = ("Screen %d: edits of the look on PGM go straight to air. Click to lock." if open else
		"Screen %d: edits go to PRV. Click to unlock, so editing the look that is on PGM changes PGM.") % (main + 1)
	if open and not on_air:
		b.tooltip_text += "\nThis look is not on PGM — its edits still go to PRV."


## The lock was flipped or PGM changed under the open editor (`ed` = look_editor.gd): edits follow (air ↔ PRV) and the
## frame shows that bus.
static func refresh(ed: Control) -> void:
	if not ed.visible:
		return
	style_button(ed._lock, ed.main, pgm_look(ed.main) == ed.scene_id)
	var now := live(ed.scene_id, ed.main)
	if now == ed._on_pgm:
		return
	ed._on_pgm = now
	ed._hold(false)
	ed.set_meta("backdrop_bus", "pgm" if now else "prv")
	ed._role = Backdrop.open(ed)
	ed._hold(true)
	ed._refresh_list()
	if not now:  # back to PRV editing: stage the look there, as opening the editor does
		ed.pusher.schedule(ed.scene_id, ed.main)
