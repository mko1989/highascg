extends "res://e2e/scenarios/03_looks_layers.gd"
## WO-962 — the Trim section's clip transport on a look staged on PRV (needs --air: a throwaway Caspar). Drops a clip into a
## new look, stages it on PRV, opens the editor (cog) and the Trim section, presses jump to out / back a frame / jump to in /
## pause / play, and reads the PRV layer's position and paused state off the real Caspar (INFO).

var prv := 0
var _sec: Node = null


func _layer_info() -> String:
	var r: Dictionary = await post("/api/amcp/raw", {"cmd": "INFO %d-10" % prv})
	return JSON.stringify(r.get("data")).to_lower()


## The clip's position in seconds (foreground <time>, first value) or -1.
func _prv_time() -> float:
	var m := RegEx.create_from_string("<foreground>.*?<time>([0-9.]+)</time>").search((await _layer_info()).replace("\\n", "").replace("\\\"", "\""))
	return float(m.get_string(1)) if m != null else -1.0


func _paused() -> bool:
	return (await _layer_info()).contains("<paused>true</paused>")


func _wait_time(want: Callable, what: String) -> String:
	var until := Time.get_ticks_msec() + 6000
	var f := -1.0
	while Time.get_ticks_msec() < until:
		f = await _prv_time()
		if want.call(f):
			return ""
		await ui.sleep(0.25)
	return "%s: PRV time stayed at %.3f s" % [what, f]


func _tbtn(tip: String) -> Button:
	return ui.find("Button", tip) as Button


func run() -> void:
	if OS.get_environment("HIGHASCG_E2E_AIR") == "":
		await step("Not run (needs --air: a throwaway Caspar)", func() -> String: return "")
		return
	await step("PRV channel on the throwaway Caspar", func() -> String:
		var until := Time.get_ticks_msec() + 20000
		while Time.get_ticks_msec() < until and prv <= 0:
			prv = await _channel("previewChannels")
			await ui.sleep(0.3)
		if prv <= 0:
			return "no PRV channel"
		until = Time.get_ticks_msec() + 30000  # the server connects to the throwaway Caspar a beat later
		while Time.get_ticks_msec() < until:
			var r: Dictionary = await post("/api/amcp/raw", {"cmd": "INFO"})
			if JSON.stringify(r.get("data")).contains("720p2500"):
				return ""
			await ui.sleep(0.5)
		return "the server never connected to the throwaway Caspar"
	)
	await step("Drag the clip onto + makes a look", func() -> String:
		await ui.tab("Live")
		var why: String = await ui.pick_tab("Media")
		if why != "":
			return why
		if await ui.wait_for(_media_tree, 15.0) == null:
			return "no media tree"
		var tree := _media_tree()
		var plus: Control = await ui.await_control("BaseButton", "New look — or drop a media file here / on empty deck space")
		why = await ui.drag_from(ui.tree_item_point(tree, ui.tree_item(tree, CLIP)), plus)
		if why != "":
			return why
		return await await_api("/api/project", func(d: Variant) -> bool: return _looks(d).size() == 1, "no look")
	)
	await step("Close the editor, stage the look on PRV", func() -> String:
		if await ui.await_control("BaseButton", "Close") != null:
			await ui.click(ui.button("Close"))
		var why: String = await ui.click(ui.find("Control", "Click: stage on PRV · Double-click: TAKE to PGM · Right-click: rename / transition"))
		return why if why != "" else await _playing(prv, CLIP)
	)
	await step("Open the editor (cog), select the layer, open Trim", func() -> String:
		var why: String = await ui.click(ui.find("BaseButton", "Edit look"))
		if why != "":
			return why
		var ed: Node = ui.root.shell.tabs.get_node("Live").editor
		if not await ui.wait_for(func() -> bool: return ui.shown(ed._frame), 5.0):
			return "editor did not open"
		await ui.frames(4)
		var lst: ItemList = ed._list
		var rc := lst.get_item_rect(0)
		ui.click_at(lst.get_global_rect().position + rc.position + rc.size * 0.5)  # the layer row → its inspector
		await ui.frames(6)
		var hdr: Control = ui.find("Button", "▸ Trim", null, false)
		if hdr == null:
			return "no Trim header (layer not selected?)"
		why = await ui.click(hdr)
		await ui.frames(4)
		await ui.shot("trim_open")
		return why if why != "" else expect(_tbtn("Back one frame") != null, "no transport buttons in the open Trim section")
	)
	await step("Jump to the out point: PRV seeks near the end", func() -> String:
		var why: String = await ui.click(_tbtn("Jump to the out point"))
		if why != "":
			return why
		why = await _wait_time(func(t: float) -> bool: return t > 3.0, "jump out")
		await ui.shot("jump_out")
		return why
	)
	await step("Pause freezes PRV (the button turns into Play)", func() -> String:
		var why: String = await ui.click(_tbtn("Pause the clip on PRV"))
		if why != "":
			return why
		if not await ui.wait_for(func() -> bool: return _tbtn("Play the clip on PRV") != null, 3.0):
			return "the pause button did not turn into Play"
		return await _wait_paused(true)
	)
	var at := {"t": 0.0}
	await step("Jump to the in point: PRV is at the start", func() -> String:
		var why: String = await ui.click(_tbtn("Jump to the in point"))
		return why if why != "" else await _wait_time(func(t: float) -> bool: return t >= 0.0 and t < 0.1, "jump in")
	)
	await step("Forward x3 / back x1 move the paused PRV frame by frame", func() -> String:
		for i in 3:
			var why: String = await ui.click(_tbtn("Forward one frame"))
			if why != "":
				return why
			await ui.sleep(0.3)
		var why2 := await _wait_time(func(t: float) -> bool: return t > 0.05 and t < 0.2, "forward 3 frames")
		if why2 != "":
			return why2
		at.t = await _prv_time()
		await ui.shot("stepped")
		var why3: String = await ui.click(_tbtn("Back one frame"))
		if why3 != "":
			return why3
		return await _wait_time(func(t: float) -> bool: return t < at.t - 0.01, "back one frame")
	)
	await step("Play resumes PRV", func() -> String:
		var why: String = await ui.click(_tbtn("Play the clip on PRV"))
		if why != "":
			return why
		why = await _wait_paused(false)
		return why if why != "" else await _wait_time(func(t: float) -> bool: return t > 0.5, "play")
	)


func _wait_paused(want: bool) -> String:
	var until := Time.get_ticks_msec() + 5000
	while Time.get_ticks_msec() < until:
		if await _paused() == want:
			return ""
		await ui.sleep(0.25)
	return "PRV layer paused is not %s" % want
