extends Node
## WO-638 / WO-645 — the start-up questions (out of main.gd): the server says whether this boot asks.
## - launcher (startup.mode ask): "Start operator here / Run headless" on every screen while this window sits
##   minimized (Godot cannot hide its main window); Run headless quits the client, Caspar runs on.
## - boot question (startup.mode gui): WO-638's 120 s "which screen is the operator's".
## - a client the session autostart started (--autostart) quits at once when this boot runs headless.
## Otherwise a fresh multi-screen box with no operator monitor flagged gets the plain prompt (WO-290's, natively).

const ScreenPicker := preload("res://app/operator_screen_picker.gd")
const ScreenModel := preload("res://app/operator_screen_model.gd")

signal said(line: String)


func ask(fresh: bool) -> void:
	await DevicesTarget.wait()
	if not DevicesTarget.on_box():  # WO-686: the answers re-lay the BOX's screens (WO-735: also while following)
		return
	var api := DevicesTarget.box_api
	# WO-696: the session can start this client before the server listens; one failed GET used to skip the launcher
	# for good while the gate (no backstop) held Caspar. Keep asking until the server answers at all (status 0 = no
	# transport); an HTTP answer, also an error, is final.
	var r: Dictionary = await api.get_json("/api/system/operator-screen")
	var waited := false
	while int(r.get("status", 0)) == 0 and is_inside_tree():
		if not waited:
			said.emit("waiting for the server to ask the start-up question…")
			waited = true
		await get_tree().create_timer(2.0).timeout
		r = await api.get_json("/api/system/operator-screen")
	if not r.ok or not r.data is Dictionary:
		return
	var boot: Variant = r.data.get("boot")
	if ScreenModel.autostart_quits(boot, Config.args.has("autostart")):
		said.emit("this boot runs headless — the operator GUI is not started")
		get_tree().quit()
		return
	var asked := boot is Dictionary and bool((boot as Dictionary).get("pending", false))
	if not asked and not (fresh and r.data.get("port") == null):
		return
	var launcher := asked and bool((boot as Dictionary).get("launcher", false))
	var w := get_window()
	var mode := w.mode
	if launcher:
		w.mode = Window.MODE_MINIMIZED
	var picker := ScreenPicker.new()
	picker.api = api
	add_child(picker)
	picker.finished.connect(func(res: Dictionary) -> void:
		said.emit("operator screen: %s" % res.get("name", res.get("error", "")))
		if res.get("headless", false):
			said.emit("run headless — the operator GUI closes, CasparCG runs on")
			get_tree().quit()
		elif launcher:
			w.mode = mode)
	var shown: bool = await picker.open_boot(boot) if asked else await picker.open()
	if not shown and launcher:
		w.mode = mode  # the launcher could not open: show the GUI rather than nothing
