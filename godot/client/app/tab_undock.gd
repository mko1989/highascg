extends Node
## WO-891 — two operator monitors: moves workspace tabs between the main window's strip and the second operator window
## (app/second_window.gd). One button in the top-right corner of the main workspace (arrow + "2", owner 31.10: shown only
## while the current tab can move) moves THAT tab instance there — same node, so its state, signals and Inspector pages
## (InspectorPanel.current, the main window's) stay as they were — and it is gone from the main strip. The second
## window's corner button (arrow + "1") sends its current tab back; closing the window sends all back. Which tabs live there, the screen pick and the plain window's rect persist in ui.cfg [second_window].
## A tab is hidden before it leaves its strip and shown once it is in the other one, so views that read a video surface
## only while visible (WO-617) let go and take it again; tabs' teardown runs at PREDELETE, not _exit_tree (a move leaves
## the tree and enters it again).

const M := preload("res://app/tab_undock_model.gd")
const SecondWindow := preload("res://app/second_window.gd")
const UiIcons := preload("res://app/ui_icons.gd")
const UiCfg := preload("res://core/ui_cfg.gd")
const Placement := preload("res://app/window_placement.gd")
const ScreenModel := preload("res://app/operator_screen_model.gd")

const POLL_S := 2.0
const SAVE_DELAY_S := 0.6
const ICON_PX := 20  # the arrow + digit drawing reads at 20 px, not at the 16 px default

signal moved(page: Control, on_second: bool)

var main_tabs: TabContainer
var pages := {}  # tab name → its Control, wherever it lives
var titles := {}  # tab name → the title set through set_title (a strip forgets it when the tab leaves)
var win: SecondWindow
var cfg_path := UiCfg.PATH
var on_box := false  # the main window fills the box's operator monitor (shell: Platform.is_local_origin)
var api: Object = null  # Api autoload (GET /api/system/operator-screen); null off the box and in tests
var forward_to: Array[Callable] = []  # main-window key handlers (F3, undo) that get the second window's spare keys
var _outputs := []  # per screen, the server output at the last placement ({} unknown)
var _screen := -1  # the operator's screen pick (ui.cfg), -1 automatic
var _sig := ""
var _save_t: Timer
var _poll_t: Timer
var _main_btn: Button  # the main workspace's corner: send the current tab to the second monitor
var _win_btn: Button  # the second window's corner: send its current tab back


func _ready() -> void:
	_save_t = Timer.new()
	_save_t.one_shot = true
	_save_t.wait_time = SAVE_DELAY_S
	_save_t.timeout.connect(save)
	add_child(_save_t)
	_poll_t = Timer.new()
	_poll_t.wait_time = POLL_S
	_poll_t.timeout.connect(_poll_screens)
	add_child(_poll_t)


func setup(tabs: TabContainer) -> void:
	main_tabs = tabs
	for c in tabs.get_children():
		pages[str(c.name)] = c
	_main_btn = _corner(tabs, "send_to_2", "Send this tab to the second operator monitor", func() -> void:
		var c := tabs.get_current_tab_control()
		if c != null:
			move_to_second(str(c.name)))
	tabs.tab_changed.connect(func(_i: int) -> void: _refresh_buttons())
	_refresh_buttons()


## ui.cfg → the tabs that were on the second monitor go back there (no saved tabs: the window stays closed).
func restore() -> void:
	var rec := M.load_record(cfg_path)
	_screen = int(rec.screen)
	for n in rec.tabs:
		move_to_second(n, false, false)


func page(name: String) -> Control:
	return pages.get(name)


func on_second(p: Control) -> bool:
	return win != null and p != null and p.get_parent() == win.tabs


## Make a tab the current one in whichever window holds it (the second window is not raised: the operator keeps
## working where they are).
func select(p: Control) -> void:
	var tc := p.get_parent() as TabContainer if p != null else null
	if tc != null:
		tc.current_tab = tc.get_tab_idx_from_control(p)


func set_title(p: Control, title: String) -> void:
	titles[str(p.name)] = title
	var tc := p.get_parent() as TabContainer
	if tc != null:
		tc.set_tab_title(tc.get_tab_idx_from_control(p), title)


func move_to_second(name: String, pick := true, persist := true) -> void:
	var p := page(name)
	if p == null or not M.movable(name) or on_second(p):
		return
	_open_window()
	_move(p, win.tabs, pick)
	if persist:
		save()


func move_to_main(name: String, pick := true, persist := true) -> void:
	var p := page(name)
	if p == null or not on_second(p):
		return
	_move(p, main_tabs, pick)
	if persist:
		save()


## The window's close button / "Close": every tab goes back, the window goes away.
func close_window() -> void:
	if win == null:
		return
	for n in win.tab_names():
		move_to_main(n, false, false)
	save()  # no tabs left there; the plain window's rect is kept for next time
	win.queue_free()
	win = null
	_poll_t.stop()


func _move(p: Control, to: TabContainer, pick: bool) -> void:
	var name := str(p.name)
	var from := p.get_parent() as TabContainer
	var f := p.get_viewport().gui_get_focus_owner() if p.is_inside_tree() else null
	if f != null and p.is_ancestor_of(f):
		f.release_focus()
	from.deselect_enabled = from.get_tab_count() == 1  # an only tab is re-shown by its strip when hidden
	p.hide()  # WO-617: views reading a surface only while shown let go now, and lease again when shown below
	from.remove_child(p)
	from.deselect_enabled = false
	var at := M.insert_index(name, to.get_children().map(func(c: Node) -> String: return str(c.name)))
	var cur := to.get_current_tab_control()
	to.add_child(p)
	to.move_child(p, at)
	to.set_tab_title(at, str(titles.get(name, name)))
	to.current_tab = at if pick or cur == null else to.get_tab_idx_from_control(cur)
	if to.get_current_tab_control() == p:
		p.show()
	_refresh_buttons()
	moved.emit(p, to != main_tabs)


## The corner buttons follow the current tab: arrow + "2" while the main window shows a movable tab, arrow + "1" while
## the second window shows any.
func _refresh_buttons() -> void:
	var c := main_tabs.get_current_tab_control()
	_main_btn.visible = c != null and M.movable(str(c.name))
	if win != null:
		_win_btn.visible = win.tabs.get_current_tab_control() != null


## An icon button over the right end of a tab container's strip — a child of its TabBar (spans the full width): a child
## of the container itself would count as a tab, and its visibility would switch tabs.
static func _corner(tc: TabContainer, icon: String, tip: String, on_press: Callable) -> Button:
	var b := UiIcons.button(icon, tip, ICON_PX)
	b.flat = true
	b.pressed.connect(on_press)
	tc.get_tab_bar().add_child(b)
	b.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	b.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	return b


func _open_window() -> void:
	if win != null:
		return
	win = SecondWindow.new()
	win.send_back.connect(func(p: Control) -> void: move_to_main(str(p.name)))
	_win_btn = _corner(win.tabs, "send_to_1", "Send this tab back to the main operator monitor", func() -> void:
		var c := win.tabs.get_current_tab_control()
		if c != null:
			win.send_back.emit(c))
	win.tabs.tab_changed.connect(func(_i: int) -> void: _refresh_buttons())
	win.close_requested.connect(close_window)
	win.menu_opening.connect(_fill_menu)
	win.menu_chosen.connect(_on_menu)
	win.key_unhandled.connect(_forward_key)
	win.key_seen.connect(func(e: InputEvent) -> void:  # the lock / unlock chord typed on the second monitor (WO-838)
		var ov := _lock_overlay()
		if ov != null:
			ov.call("_input", e))
	win.geometry_changed.connect(func() -> void: if win.visible: _save_t.start())
	add_child(win)
	_sig = str(_screens())
	_poll_t.start()
	place()


## Put the window on its screen (M.pick_screen): a screen of its own → filled (borderless on the box, like the main
## window, WO-714); none → a plain window over the main one on the main screen. Never a Caspar output by default.
func place() -> void:
	if win == null:
		return
	var screens := _screens()
	if api != null:
		var r: Dictionary = await api.get_json("/api/system/operator-screen")
		if win == null:
			return
		if r.ok and r.data is Dictionary:
			_outputs = ScreenModel.match_outputs((r.data as Dictionary).get("outputs", []), screens)
	var main := get_window().current_screen
	var s := M.pick_screen(screens, _outputs, main, _screen)
	var fill := M.fills_screen(s, main)
	var main_rect := Rect2i(screens[main]) if main >= 0 and main < screens.size() else Rect2i(0, 0, 1920, 1080)
	var rect := Rect2i(screens[s]) if fill else M.windowed_rect(main_rect, M.load_record(cfg_path).rect)
	win.hide()
	win.mode = Window.MODE_WINDOWED
	win.transient = not fill  # sharing the main window's screen: it stays above it
	win.borderless = fill and on_box
	win.position = rect.position
	win.size = rect.size
	win.show()
	if fill:
		win.mode = Window.MODE_MAXIMIZED
	Placement.fit(win, on_box, Placement.saved_scale())
	if not win.tabs.get_children().is_empty() and win.tabs.current_tab < 0:
		win.tabs.current_tab = 0


static func _screens() -> Array:
	var out := []
	for i in DisplayServer.get_screen_count():
		out.append(Rect2i(DisplayServer.screen_get_position(i), DisplayServer.screen_get_size(i)))
	return out


## X layout changed (a monitor plugged, "Operator GUI first" moved them): place the window again.
func _poll_screens() -> void:
	var sig := str(_screens())
	if sig != _sig:
		_sig = sig
		place()


func _fill_menu(pm: PopupMenu) -> void:
	var screens := _screens()
	var main := get_window().current_screen
	var rows := []
	for i in screens.size():
		var o: Dictionary = _outputs[i] if i < _outputs.size() and _outputs[i] is Dictionary else {}
		rows.append([M.screen_label(i, o, main), i == main or not M.busy(_outputs, i)])
	SecondWindow.fill_menu(pm, rows, _screen)


func _on_menu(id: int) -> void:
	if id == SecondWindow.CLOSE_ID:
		close_window.call_deferred()  # not from inside the window's own menu signal
		return
	_screen = -1 if id == SecondWindow.AUTO_ID else id
	save()
	place()


## Undo / redo and F3 live on the main window's nodes; a key nothing in the second window used goes to them.
func _forward_key(e: InputEvent) -> void:
	for fn in forward_to:
		if fn.is_valid():
			fn.call(e)


func _process(_d: float) -> void:
	if win == null or not win.visible:
		return
	var ov := _lock_overlay()
	var locked: bool = ov != null and ov.is_locked()
	win.set_locked(locked, ov.prefs.bg if locked else Color.BLACK)


func _lock_overlay() -> Object:
	var lk := get_tree().root.get_node_or_null("Lockscreen")
	return lk.get("overlay") if lk != null else null


func save() -> void:
	var rect: Variant = null
	if win != null and win.visible and win.mode == Window.MODE_WINDOWED and win.transient:  # a plain window (not filling a screen)
		rect = Rect2i(win.position, win.size)
	M.save_record(cfg_path, win.tab_names() if win != null else [], _screen, rect)
