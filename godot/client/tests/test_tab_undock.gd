extends RefCounted
## WO-891 — the second operator window: tab_undock_model.gd (which tabs move, strip order, screen pick, ui.cfg record)
## and tab_undock.gd + second_window.gd built headless (a tab moves as the same node, leaves the main strip, keeps its
## title, is hidden while it travels and shown on arrival; closing returns every tab; ui.cfg restores them).

const M := preload("res://app/tab_undock_model.gd")
const Undock := preload("res://app/tab_undock.gd")
const SecondWindow := preload("res://app/second_window.gd")
const CFG := "user://test_tab_undock.cfg"
var t


func test_movable() -> void:
	for n in ["Live", "Timeline", "Visuals", "Previs", "Audio", "Devices", "Settings"]:
		t.ok(M.movable(n), n)
	t.ok(not M.movable("Multiview"), "Multiview stays in the main window")
	t.ok(not M.movable("Sources"), "not a workspace tab")


func test_insert_index_keeps_shell_order() -> void:
	t.eq(M.insert_index("Previs", ["Live", "Timeline", "Audio"]), 2, "between Timeline and Audio")
	t.eq(M.insert_index("Live", ["Timeline", "Settings"]), 0)
	t.eq(M.insert_index("Settings", ["Live", "Multiview"]), 2, "last")
	t.eq(M.insert_index("Audio", []), 0, "empty strip")
	t.eq(M.insert_index("Live", ["Probe"]), 0, "unknown names sort last")


func test_restore_list() -> void:
	t.eq(M.restore_list(["Settings", "Live", "Live", "Multiview", "Nope"]), ["Live", "Settings"], "known, movable, once, ordered")
	t.eq(M.restore_list(PackedStringArray(["Audio"])), ["Audio"])
	t.eq(M.restore_list(null), [])
	t.eq(M.restore_list("Live"), [], "not a list")


func test_pick_screen_never_a_caspar_output() -> void:
	# the box 31.10: DP-4 (operator, 0,0) + DP-0 (LED PGM) — plus a third, free monitor
	var screens := [Rect2i(0, 0, 1920, 1080), Rect2i(1920, 0, 3840, 1792), Rect2i(5760, 0, 1920, 1080)]
	var outs := [{"name": "DP-4", "current": true}, {"name": "DP-0", "caspar": true}, {"name": "DP-2"}]
	t.eq(M.pick_screen(screens, outs, 0, -1), 2, "the free monitor, not the LED wall")
	t.eq(M.pick_screen(screens.slice(0, 2), outs.slice(0, 2), 0, -1), -1, "only the LED wall besides: a window on the main screen")
	t.eq(M.pick_screen(screens, outs, 0, 1), 2, "a saved pick that became a Caspar output is ignored")
	t.eq(M.pick_screen(screens, outs, 0, 0), 0, "the operator may pick the main screen (a window on it)")
	t.eq(M.pick_screen(screens, outs, 0, 7), 2, "a saved screen that is gone")
	t.eq(M.pick_screen([Rect2i(0, 0, 1920, 1080), Rect2i(1920, 0, 1920, 1080)], [], 0, -1), 1, "outputs unknown (off the box): any other screen")
	t.eq(M.pick_screen([Rect2i(0, 0, 1920, 1080)], [], 0, -1), -1, "one monitor")
	t.ok(M.fills_screen(2, 0) and not M.fills_screen(0, 0) and not M.fills_screen(-1, 0))


func test_busy_and_labels() -> void:
	var outs := [{"name": "DP-4", "current": true}, {"name": "DP-0", "caspar": true}, {}]
	t.ok(M.busy(outs, 0) and M.busy(outs, 1) and not M.busy(outs, 2) and not M.busy(outs, 9))
	t.eq(M.screen_label(1, outs[1], 0), "Screen 2 — DP-0 (Caspar output)")
	t.eq(M.screen_label(0, outs[0], 0), "Screen 1 — DP-4 (main window — a window on it)")
	t.eq(M.screen_label(2, {}, 0), "Screen 3")


func test_windowed_rect() -> void:
	var scr := Rect2i(0, 0, 1920, 1080)
	t.eq(M.windowed_rect(scr, null), Rect2i(320, 180, 1280, 720), "two thirds, centred")
	t.eq(M.windowed_rect(scr, Rect2i(100, 100, 800, 600)), Rect2i(100, 100, 800, 600), "the saved rect")
	t.eq(M.windowed_rect(scr, Rect2i(4000, 100, 800, 600)), Rect2i(320, 180, 1280, 720), "saved off this screen")
	t.eq(M.windowed_rect(scr, Rect2i(100, 100, 50, 50)), Rect2i(320, 180, 1280, 720), "saved too small")


func test_record_roundtrip_keeps_other_keys() -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
	var other := ConfigFile.new()
	other.set_value("window", "ui_scale", 1.5)
	other.save(CFG)
	M.save_record(CFG, ["Previs", "Audio"], 2, Rect2i(10, 20, 800, 600))
	M.save_record(CFG, ["Previs", "Audio"], 2, null)
	var rec := M.load_record(CFG)
	t.eq(rec.tabs, ["Previs", "Audio"])
	t.eq(rec.screen, 2)
	t.eq(rec.rect, Rect2i(10, 20, 800, 600), "a null rect keeps the saved one")
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	t.eq(cfg.get_value("window", "ui_scale"), 1.5, "other ui.cfg keys survive")
	t.eq(M.load_record("user://missing_tab_undock.cfg"), {"tabs": [], "screen": -1, "rect": null})


## A stand-in for a view that leases a surface only while shown (WO-617): counts its shown/hidden flips.
class _Probe:
	extends Control
	var flips := []

	func _ready() -> void:
		visibility_changed.connect(func() -> void: flips.append(is_visible_in_tree()))


func _rig() -> Dictionary:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))
	var tabs := TabContainer.new()
	t.root.add_child(tabs)
	for n in M.ORDER:
		var c := Control.new()
		c.name = n
		tabs.add_child(c)
	var probe := _Probe.new()
	tabs.get_node("Previs").add_child(probe)
	var u: Undock = Undock.new()
	u.cfg_path = CFG
	t.root.add_child(u)
	u.setup(tabs)
	return {"tabs": tabs, "u": u, "probe": probe}


func _done(r: Dictionary) -> void:
	(r.u as Node).free()
	(r.tabs as Node).free()
	DirAccess.remove_absolute(ProjectSettings.globalize_path(CFG))


func test_move_to_second_and_back() -> void:
	var r := _rig()
	var tabs: TabContainer = r.tabs
	var u: Undock = r.u
	var previs: Control = u.page("Previs")
	tabs.current_tab = tabs.get_tab_idx_from_control(previs)
	await t.process_frame
	r.probe.flips.clear()
	t.ok(u._main_btn.visible, "the corner arrow-2 shows on a movable tab")
	t.eq(tabs.get_tab_button_icon(0), null, "no per-tab strip buttons (owner 31.10: one corner button)")
	t.eq(tabs.get_tab_count(), tabs.get_children().size(), "the corner button is not a tab")
	tabs.current_tab = tabs.get_tab_idx_from_control(u.page("Multiview"))
	t.ok(not u._main_btn.visible, "hidden on Multiview (it never moves)")
	tabs.current_tab = tabs.get_tab_idx_from_control(previs)
	u.set_title(u.page("Devices"), "Devices (1)")
	u._main_btn.pressed.emit()  # the current tab (Previs)
	t.ok(u.win != null and u.win is SecondWindow, "the second window opened")
	t.eq(previs.get_parent(), u.win.tabs, "the same node now lives in the second window")
	t.ok(previs.get_parent() != tabs, "gone from the main strip")
	t.ok(tabs.current_tab >= 0, "the main window shows another tab")
	t.eq(u.win.tabs.get_current_tab_control(), previs, "shown there")
	t.ok(previs.is_visible_in_tree())
	t.eq(r.probe.flips, [false, true], "hidden while it travelled, shown on arrival (leases let go and taken again)")
	t.ok(u._win_btn.visible, "arrow-1 corner button in the second window")
	u.move_to_second("Devices")
	u.move_to_second("Live", false)
	t.eq(u.win.tab_names(), ["Live", "Previs", "Devices"], "the shell's order there too")
	t.eq(u.win.tabs.get_current_tab_control(), u.page("Devices"), "a restore-style move keeps the current tab")
	t.eq(u.win.tabs.get_tab_title(2), "Devices (1)", "a set title survives the move")
	u.select(u.page("Live"))
	t.eq(u.win.tabs.get_current_tab_control(), u.page("Live"), "select() works where the tab lives")
	t.ok(u.on_second(u.page("Live")) and not u.on_second(u.page("Audio")))
	t.eq(M.load_record(CFG).tabs, ["Live", "Previs", "Devices"], "saved to ui.cfg")
	u.select(previs)
	u._win_btn.pressed.emit()
	t.eq(previs.get_parent(), tabs, "the arrow-1 button sends the current tab back")
	t.eq(tabs.get_tab_idx_from_control(previs), 2, "into its old place (Live is still on the second monitor)")
	t.eq(tabs.get_current_tab_control(), previs, "and shows it")
	u.move_to_main("Live")
	u.move_to_main("Devices")
	t.eq(u.win.tab_names(), [], "the window stays open, empty")
	t.eq(tabs.get_tab_title(tabs.get_tab_idx_from_control(u.page("Devices"))), "Devices (1)")
	_done(r)


func test_close_returns_all_and_restore_reopens() -> void:
	var r := _rig()
	var tabs: TabContainer = r.tabs
	var u: Undock = r.u
	u.move_to_second("Audio")
	u.move_to_second("Settings")
	u.close_window()
	t.eq(u.win, null, "closed")
	t.eq(tabs.get_children().map(func(c: Node) -> String: return str(c.name)), M.ORDER, "every tab back, in order")
	t.eq(M.load_record(CFG).tabs, [], "nothing left to restore")
	M.save_record(CFG, ["Settings", "Timeline"], -1, null)
	u.restore()
	t.eq(u.win.tab_names(), ["Timeline", "Settings"], "ui.cfg puts them back on the second monitor")
	t.ok(u.page("Timeline").get_parent() != tabs)
	u.move_to_second("Multiview")
	t.eq(u.page("Multiview").get_parent(), tabs, "Multiview never moves")
	_done(r)


func test_screen_menu_rows() -> void:
	var pm := PopupMenu.new()
	SecondWindow.fill_menu(pm, [["Screen 1 — DP-4 (main window — a window on it)", true], ["Screen 2 — DP-0 (Caspar output)", false]], -1)
	t.eq(pm.item_count, 5, "two screens, Automatic, separator, Close")
	t.ok(pm.is_item_disabled(1), "a Caspar output cannot be picked")
	t.ok(pm.is_item_checked(pm.get_item_index(SecondWindow.AUTO_ID)), "automatic is the default")
	t.eq(pm.get_item_id(4), SecondWindow.CLOSE_ID)
	pm.free()
