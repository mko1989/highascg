extends RefCounted
## WO-953 — screens whose deck column this client hides (owner 05.11: "an option to hide a screen destination with all
## its looks in the live tab … the bottom looks cards not the preview"). A view setting of this client, like the
## toolbar's "Looks" toggle: `user://ui.cfg [live] hidden_screens`. Hiding never changes the show — the screen keeps its
## looks, its PGM / PRV and Companion — but it drops out of the highlighted look-preset destinations, so a preset saved
## afterwards never silently covers a screen nobody can see. Changes are announced as Store.changed("ui.deck_hidden").

const Destinations := preload("res://features/live/destinations.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const PATH := "ui.deck_hidden"

static var cfg_path := "user://ui.cfg"  # tests point it elsewhere
static var _hidden := {}
static var _loaded := false


static func _load() -> void:
	if _loaded:
		return
	_loaded = true
	var cfg := ConfigFile.new()
	cfg.load(cfg_path)
	var v: Variant = cfg.get_value("live", "hidden_screens", [])
	for m in (v if v is Array else []):
		_hidden[int(m)] = true


## Tests: forget the cached state (the next call reads cfg_path again).
static func reset() -> void:
	_hidden.clear()
	_loaded = false


static func is_hidden(main: int) -> bool:
	_load()
	return _hidden.has(main)


static func hidden() -> Array:
	_load()
	var out := _hidden.keys()
	out.sort()
	return out


## The screens of `count` whose column shows, in order.
static func visible_mains(count: int) -> Array:
	var out := []
	for m in count:
		if not is_hidden(m):
			out.append(m)
	return out


## What the deck shows when every column is hidden (it would otherwise be blank, with no way back in sight).
static func note(count: int) -> Label:
	var l := Label.new()
	l.text = "All %d screens are hidden in this deck — show them again with “Screens” in the toolbar above." % count
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.size_flags_vertical = Control.SIZE_SHRINK_BEGIN  # at the top of the deck, under the toolbar
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


static func set_hidden(main: int, on: bool) -> void:
	_load()
	if on == _hidden.has(main):
		return
	if on:
		_hidden[main] = true
		if Destinations.is_on(main):
			Destinations.toggle(main)
	else:
		_hidden.erase(main)
	var cfg := ConfigFile.new()
	cfg.load(cfg_path)
	cfg.set_value("live", "hidden_screens", hidden())
	cfg.save(cfg_path)
	var tree := Engine.get_main_loop() as SceneTree
	var store: Node = tree.root.get_node_or_null("Store") if tree != null else null
	if store != null:
		store.changed.emit(PATH, hidden())


static func show_all() -> void:
	for m in hidden():
		set_hidden(int(m), false)
