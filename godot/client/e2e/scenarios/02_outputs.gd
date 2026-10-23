extends "res://e2e/e2e_scenario.gd"
## WO-719 — screen outputs from the Devices tab: add a PGM/PRV screen and a PGM-only screen, give them different
## standard modes and a custom size, then remove one. Each edit is checked on the server's device view, which is what
## the Caspar config is generated from.

var _ids_before: Array = []


static func _dests(d: Variant) -> Array:
	return (d.get("screenDestinations", {}) as Dictionary).get("destinations", []) if d is Dictionary else []


func _dest(d: Variant, id: String) -> Dictionary:
	for x in _dests(d):
		if str(x.get("id")) == id:
			return x
	return {}


func _new_id(d: Variant) -> String:
	for x in _dests(d):
		if not (str(x.get("id")) in _ids_before):
			return str(x.get("id"))
	return ""


## Add a destination of `type_label` with the header select + "+", return its id ("" = failed; reason in _why).
var _why := ""
var _found := ""
func _add(type_label: String, mode: String) -> String:
	_ids_before = _dests((await api("/api/device-view")).get("data")).map(func(x: Dictionary) -> String: return str(x.id))
	_why = await ui.choose(ui.find("OptionButton", "Destination type to add"), type_label)
	if _why == "":
		_why = await ui.click(ui.button("Add destination"))
	if _why != "":
		return ""
	_found = ""
	_why = await await_api("/api/device-view", func(d: Variant) -> bool:
		_found = _new_id(d)
		return _found != "" and str(_dest(d, _found).get("mode")) == mode, "no new %s destination on the server" % mode)
	return _found


## Click the destination's card (destinations_panel tags each card's wrapper with its id) so its page opens.
func _open(id: String) -> String:
	var card: Control = await ui.wait_for(func() -> Variant:
		for w in ui.root.shell.tabs.get_node("Devices").find_children("*", "VBoxContainer", true, false):
			if w.has_meta("dest_id") and str(w.get_meta("dest_id")) == id and ui.shown(w):
				return w.get_child(0)
		return null, 6.0)
	if card == null:
		return "no card for destination %s in Devices" % id
	var why: String = await ui.click(card)
	if why != "":
		return why
	return expect(await _settled(), "Inspector never showed a settled destination page")


## Every device-view reload rebuilds the page (destinations_panel.show_model → show_destination), and an add keeps
## going after the server has the destination (settings seed → reload → changed → reload). Wait until the panel is
## not busy, no reload is in flight and the Video mode select has been the same node for 0.8 s.
var _vm: Object = null
var _since := 0
func _settled() -> bool:
	_vm = null
	var tab: Node = ui.root.shell.tabs.get_node("Devices")
	return bool(await ui.wait_for(func() -> bool:
		var f: Object = ui.field("Video mode", "OptionButton")
		if f != _vm or tab.get("_loading") == true or tab.get("_dests").get("_busy") == true:
			_vm = f
			_since = Time.get_ticks_msec()
		return f != null and Time.get_ticks_msec() - _since > 800, 10.0))


var pgm := ""  # members, not locals: step lambdas capture locals by value
var only := ""


func run() -> void:
	await step("Open Devices", func() -> String:
		await ui.tab("Devices")
		return expect(await ui.await_control("OptionButton", "Destination type to add") != null, "no destination type select")
	)
	await step("Add PGM/PRV screen", func() -> String:
		pgm = await _add("PGM/PRV", "pgm_prv")
		return _why
	)
	await step("Set it to 1080p5000", func() -> String:
		var why: String = await _open(pgm)
		if why == "":
			why = await ui.choose(ui.field("Video mode", "OptionButton"), "1080p5000")
		if why != "":
			return why
		why = await await_api("/api/device-view", func(d: Variant) -> bool:
			var x := _dest(d, pgm)
			return str(x.get("videoMode")) == "1080p5000" and int(x.get("width", 0)) == 1920 and int(x.get("height", 0)) == 1080,
			"1080p5000 not stored")
		if why != "":
			return "%s — stored: %s; select shows %s" % [why.left(40), JSON.stringify(_dest((await api("/api/device-view")).data, pgm)),
				(ui.field("Video mode", "OptionButton") as OptionButton).text if ui.field("Video mode", "OptionButton") else "?"]
		return ""
	)
	await step("Add PGM-only screen", func() -> String:
		only = await _add("PGM only", "pgm_only")
		return _why
	)
	await step("Give it a custom 1280x720 @ 25", func() -> String:
		var why: String = await _open(only)
		if why == "":
			why = await ui.choose(ui.field("Video mode", "OptionButton"), "Custom")
		for kv in [["Width", "1280"], ["Height", "720"], ["Frame rate", "25"]]:
			if why == "":
				# each commit reloads (= rebuilds) the page: type into the settled one
				var le: Control = null
				if await _settled():
					le = ui.field(kv[0], "LineEdit")
				why = await ui.type_into(le, kv[1]) if le != null and (le as LineEdit).editable else "%s field not editable after Custom" % kv[0]
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool:
			var x := _dest(d, only)
			return int(x.get("width", 0)) == 1280 and int(x.get("height", 0)) == 720 and absf(float(x.get("fps", 0)) - 25.0) < 0.01,
			"custom size not stored")
	)
	await step("The generated Caspar config has both screens", func() -> String:
		var r: Dictionary = await api("/api/caspar-config/generate")
		var xml := str(r.get("data", ""))
		if r.get("data") is Dictionary:
			xml = JSON.stringify(r.data)
		return expect(xml.contains("1080p5000") and xml.contains("720"), "generated config lacks the modes: " + xml.left(300))
	)
	await step("Remove the PGM-only screen", func() -> String:
		var why: String = await _open(only)
		if why == "":
			why = await ui.click(ui.button("Remove destination"))
		if why != "":
			return why
		return await await_api("/api/device-view", func(d: Variant) -> bool: return _dest(d, only).is_empty(), "destination still there")
	)
