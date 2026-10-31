extends RefCounted
## WO-895 — the visual playlists at run time: between the Visuals' show control (visuals_show_ctl.gd: Auto, looks) and the
## editor (visuals_playlist_panel.gd). Auto stays the one switch: `auto.playlist` names the playlist it runs — then each
## entry plays for its hold (visuals_playlist.gd hold_done) and the next one crossfades in like a look; with none, Auto
## cycles the looks as before (WO-878). Switched on (Run, or Auto ▸ "Visual playlist · …"), it shows the entry it is on
## and that entry's hold starts from the beginning — so Auto off and on again replays the current entry. The position
## (`order`, `at`) is stored in the slice on every change; a reload (a restart, WO-880) keeps it and only restarts the hold.

const P := preload("res://features/visuals/visuals_playlist.gd")
const EditorPanel := preload("res://features/visuals/visuals_playlist_panel.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const HINT := "Visual playlist: drag looks (Show) or visuals (Sources ▸ Visuals) in · Run plays it with Auto · double-click shows an entry"

var ctl: Node  # visuals_show_ctl.gd
var panel: EditorPanel
var playlists := []
var rng := RandomNumberGenerator.new()
var hold := P.new_hold()
var _known := ""  # "<running id>/<at>": a reload that changes it restarts the hold
var _ran := ""  # the playlist Auto ran at the last switch


func _init(c: Node) -> void:
	ctl = c
	panel = EditorPanel.new()
	panel.changed.connect(_edited)
	panel.run.connect(run)
	panel.jump.connect(jump)


func active_id() -> String:
	return str(ctl.tab.slice.get("auto", {}).get("playlist", ""))


## The playlist Auto runs, or null.
func running() -> Variant:
	var i := P.find(playlists, active_id())
	return playlists[i] if i >= 0 else null


## The slice was (re)loaded: its playlists made safe, a running one whose position moved restarts its hold (no recall —
## the slice already holds its picture).
func from_slice() -> void:
	playlists = P.normalize(ctl.tab.slice.get("playlists"))
	ctl.tab.slice.playlists = playlists
	if running() == null:
		ctl.tab.slice.auto.playlist = ""
	_ran = active_id()
	_mark(false)
	_show_ui()


## Auto's settings as the look cycling sees them: no bar or drop changes of its own while a playlist runs.
func auto_cfg(cfg: Dictionary) -> Dictionary:
	if running() == null:
		return cfg
	var c := cfg.duplicate()
	c.bars = 0
	c.drops = false
	return c


## Auto was switched (Show block or Run): a playlist that starts shows the entry it is on, its hold from the start.
func auto_changed() -> void:
	var id := active_id()
	if id != _ran:
		_ran = id
		var pl: Variant = running()
		if pl != null and P.current(pl) != null:
			_show(P.current(pl))
		_mark(true)
	_show_ui()


## Run (the editor's button): Auto runs `id`, or is off ("").
func run(id: String) -> void:
	ctl.tab.slice.auto.playlist = id if P.find(playlists, id) >= 0 else ""
	ctl.tab.slice.auto.bars = 0
	auto_changed()
	ctl.status()
	ctl.tab._store()


## One frame: the running entry's hold; when it ends, the next entry.
func step(beat: Variant, drop_n: int, dt_ms: float) -> void:
	var pl: Variant = running()
	if pl == null or pl.entries.is_empty():
		return
	if P.hold_done(hold, P.current(pl), beat, drop_n, dt_ms):
		_put(P.next(pl, rng))
		_show(P.current(running()))
		_mark(true)
		_show_ui()


## A double-click in the editor: entry `i` of playlist `id` on stage now (and the position there).
func jump(id: String, i: int) -> void:
	var k := P.find(playlists, id)
	if k < 0 or i < 0 or i >= playlists[k].entries.size():
		return
	_put(P.jump(playlists[k], i))
	_show(playlists[k].entries[i])
	_mark(true)
	_show_ui()


## The status line's part: "Visual playlist Set A 2/3 Tunnel · next in 4 bars".
func status_parts(beat: Variant) -> Array:
	var pl: Variant = running()
	if pl == null:
		return []
	if pl.entries.is_empty():
		return ["Visual playlist %s is empty — drag looks into it" % pl.name]
	var e: Dictionary = P.current(pl)
	return ["Visual playlist %s %d/%d %s · %s" % [pl.name, pl.at + 1, pl.order.size(), e.name, P.left(hold, e, beat)]]


func _edited(pls: Array) -> void:
	playlists = P.normalize(pls)
	ctl.tab.slice.playlists = playlists
	if running() == null:
		ctl.tab.slice.auto.playlist = ""
		_ran = ""
	var keep := hold  # an edit never restarts the running entry's hold
	_mark(false)
	hold = keep
	ctl.tab._store()
	_show_ui()
	ctl.status()


func _put(pl: Dictionary) -> void:
	playlists[P.find(playlists, pl.id)] = pl
	ctl.tab.slice.playlists = playlists


## An entry's picture on stage with the fade, like a look recall (the stored look it equals lights up).
func _show(e: Dictionary) -> void:
	var tab: Node = ctl.tab
	tab.slice = P.apply(tab.slice, e)
	tab.slice.playlists = playlists
	ctl.showing = Looks.showing(Looks.normalize(ctl.looks), tab.slice)  # entries are normalized; a just-saved look is raw
	tab.flow.set_graph(tab.slice.graph)
	tab.page.set_state(tab.slice, tab._cm())
	tab.page.show_panel.set_looks(ctl.looks, ctl.showing)
	tab._store()
	tab._go(true)


## The running position is known now; `restart` (or a position that moved) starts the hold over.
func _mark(restart: bool) -> void:
	var pl: Variant = running()
	var k := "%s/%d" % [pl.id, pl.at] if pl != null else ""
	if restart or k != _known:
		hold = P.new_hold()
	_known = k


func _show_ui() -> void:
	panel.set_state(playlists, active_id())
	var sp: Node = ctl.tab.page.show_panel
	sp.set_playlists(playlists)
	sp.set_state(ctl.tab.slice.fade, ctl.tab.mixer.level, ctl.tab.mixer.blackout, ctl.tab.slice.auto)
