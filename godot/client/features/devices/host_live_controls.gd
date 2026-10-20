extends "res://features/devices/host_controls_base.gd"
## WO-605 slice 3c — the per-role live-source controls of a host-channel page: webpage host (template / URL +
## Reload), NDI host (name, Discover, Apply, Reload), browser display (URL, size, fps, Apply, operator-monitor
## toggle), DeckLink input (device switcher + shared source label) and each role's Remove. Web:
## inspector-webpage-host.js, inspector-ndi-host.js, inspector-browser-display.js, inspector-decklink-host.js,
## inspector-source-label.js, device-view-destinations-inspector-host-channel.js. All request shapes come from
## host_source_model.gd (golden-tested); this file only wires widgets to them.

const DEFAULT_ORIGIN := "http://127.0.0.1:4200"  # the web hard-codes this template prefix (WO-601 scope note)


## {top: [Control], bottom: [Control]} for the role, or {} when the role has no live-source controls.
func build(role: String, src: Dictionary, dest: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	match role:
		"webpage_host":
			return {"top": [_webpage(src)], "bottom": [_remove_live(src, dest, "Remove webpage source", "Webpage")]} if not src.is_empty() else {}
		"ndi_host":
			return {"top": [_ndi(src)], "bottom": [_remove_live(src, dest, "Remove NDI source",
				str(src.ndiName) if H.truthy(src.get("ndiName")) else "NDI source")]} if not src.is_empty() else {}
		"browser_display":
			return {"top": [_browser(src)], "bottom": [_remove_live(src, dest, "Remove browser source", "Browser source")]} if not src.is_empty() else {}
		"decklink_input":
			var slot: Variant = HS.decklink_slot(dest)
			if slot == null:
				return {}
			return {"top": [_decklink(src, payload, settings, slot)], "bottom": [_remove_decklink(src, dest, payload, slot)]}
	return {}


# ---------------------------------------------------------------- webpage host

func _webpage(src: Dictionary) -> Control:
	var box := _section()
	box.add_child(_title("Page"))
	var saved := HS.saved_page(src)
	var origin := _origin_for(saved)
	var use_tpl := _check("Template", HS.is_template_url(saved, origin), "Play a template from this box instead of a URL")
	box.add_child(use_tpl)
	var url := _line(saved, "https://example.com/")  # prefilled with the saved page even under Template, as the web
	var tpl := _select(HS.template_options(Store.get_value("templates")), HS.template_name(saved, origin))
	url.visible = not use_tpl.button_pressed
	tpl.visible = use_tpl.button_pressed
	use_tpl.toggled.connect(func(on: bool) -> void:
		url.visible = not on
		tpl.visible = on)
	box.add_child(url)
	box.add_child(tpl)
	var send := func() -> void:
		if _busy:
			return
		var r := HS.webpage_request(src, use_tpl.button_pressed, str(tpl.get_selected_metadata()) if tpl.selected >= 0 else "",
			url.text, Config.origin)
		if r.has("error"):
			status.emit(r.error, false)
			return
		_busy = true
		var res: Dictionary = await Api.post_json("/api/host-live/webpage", r.body)
		_busy = false
		var err := _reply_error(res)
		if err != "":
			status.emit(err, false)
			return
		HS.adopt(src, res.data, ["playArg", "templateOrUrl", "cefNeedle"])
		var msg: Variant = H.R.d(res.data).get("message")
		status.emit(str(msg) if H.truthy(msg) else "Webpage reloaded", true)
		reload.emit(false)
	url.text_submitted.connect(func(_t: String) -> void: send.call())
	tpl.item_selected.connect(func(_i: int) -> void: send.call())
	var row := _row()
	row.add_child(_button("Reload", send, "Apply the page above and replay LOOP on the host channel"))
	box.add_child(row)
	box.add_child(_note("Updates the URL on host ch %s and replays LOOP. Route and channel stay the same."
		% (H.R.s(src.hostChannel) if src.get("hostChannel") != null else "?")))
	return box


## Sources saved by the web carry the literal 127.0.0.1 prefix even when this client reaches the box by another origin.
static func _origin_for(saved: String) -> String:
	if HS.is_template_url(saved, Config.origin):
		return Config.origin
	return DEFAULT_ORIGIN if HS.is_template_url(saved, DEFAULT_ORIGIN) else Config.origin


# ---------------------------------------------------------------- NDI host

func _ndi(src: Dictionary) -> Control:
	var box := _section()
	box.add_child(_title("NDI source"))
	var name := _line(str(src.get("ndiName", "")) if src.get("ndiName") != null else "", "NDI source name")
	box.add_child(name)
	var pick := _select([], "")
	pick.visible = false
	pick.item_selected.connect(func(i: int) -> void: name.text = str(pick.get_item_metadata(i)))
	box.add_child(pick)
	var send := func(action: String) -> void:
		if _busy:
			return
		var r := HS.ndi_request(src, action, name.text)
		if r.has("error"):
			status.emit(r.error, false)
			return
		_busy = true
		var res: Dictionary = await Api.post_json("/api/host-live/ndi", r.body)
		_busy = false
		var err := _reply_error(res)
		if err != "":
			status.emit(err, false)
			return
		HS.adopt(src, res.data, ["ndiName", "label"])
		status.emit(HS.ndi_message(res.data, action), true)
		reload.emit(false)
	name.text_submitted.connect(func(_t: String) -> void: send.call("update"))
	var discover := func() -> void:
		var res: Dictionary = await Api.get_json("/api/ndi/list")
		var err := _reply_error(res)
		if err != "":
			status.emit(err, false)
			return
		var names := HS.ndi_names(res.data)
		if names.is_empty():
			pick.visible = false
			status.emit("No NDI sources found", false)
			return
		_fill(pick, names.map(func(n: String) -> Array: return [n, n]), "__none__")
		pick.select(-1)
		pick.visible = true
	var row := _row()
	row.add_child(_button("Discover", discover, "List the NDI sources visible on the network"))
	row.add_child(_button("Apply source", func() -> void: send.call("update")))
	row.add_child(_button("Reload", func() -> void: send.call("reload")))
	box.add_child(row)
	return box


# ---------------------------------------------------------------- browser display

func _browser(src: Dictionary) -> Control:
	var box := _section()
	box.add_child(_title("Browser source"))
	var f := HS.browser_fields(src)
	var url := _line(f.url, "https://example.com/")
	box.add_child(_field("URL", url))
	var dims := _row()
	var w := _line(f.width, "1152")
	var h := _line(f.height, "648")
	var fps := _line(f.fps, "25")
	for spec in [["Width (px)", w], ["Height (px)", h], ["FPS", fps]]:
		var fld := _field(spec[0], spec[1])
		fld.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		dims.add_child(fld)
	box.add_child(dims)
	var apply := func() -> void:
		if _busy:
			return
		var r := HS.browser_request(src, url.text, w.text, h.text, fps.text)
		if r.has("error"):
			status.emit(r.error, false)
			return
		_busy = true
		var res: Dictionary = await Api.post_json("/api/host-live/browser", r.body)
		_busy = false
		var err := _reply_error(res)
		if err != "":
			status.emit(err, false)
			return
		HS.adopt(src, res.data, ["url", "width", "height", "fps"])
		var msg := HS.browser_message(res.data)
		status.emit(msg, not msg.begins_with("Applied, but"))
		reload.emit(false)
	for le in [url, w, h, fps]:
		le.text_submitted.connect(func(_t: String) -> void: apply.call())
	var row := _row()
	row.add_child(_button("Apply", apply))
	var toggle := Button.new()
	toggle.text = "Move to operator monitor"
	toggle.tooltip_text = "Show this browser fullscreen on the operator monitor for interaction, or send it back off-screen"
	toggle.pressed.connect(func() -> void:
		if _busy:
			return
		_busy = true
		var res: Dictionary = await Api.post_json("/api/host-live/browser/interact", HS.interact_body(src))
		_busy = false
		if not res.ok:
			status.emit(_error(res), false)
			return
		var out := HS.interact_outcome(res.data)
		if out.ok:
			toggle.text = out.text
			status.emit(out.message, true)
		else:
			status.emit(out.error if out.error != "" else "Toggle failed", false))
	row.add_child(toggle)
	box.add_child(row)
	return box


# ---------------------------------------------------------------- DeckLink input

func _decklink(src: Dictionary, payload: Dictionary, settings: Variant, slot: int) -> Control:
	var box := _section()
	var cid := H.R.s(src.get("connectorId")).strip_edges()
	if cid != "":  # WO-525: the shared source label, before the title, only with a stable connector key
		box.add_child(_label_control(payload, cid, "DeckLink %d" % slot))
	box.add_child(_title("DeckLink device"))
	var active := HS.decklink_active_device(src, settings, slot)
	var sel := _select(HS.decklink_options(payload, slot, active), active, "Which DeckLink device feeds this input slot")
	box.add_child(sel)
	var post := func(body: Dictionary, done: String) -> void:
		if body.is_empty() or _busy:
			return
		_busy = true
		var res: Dictionary = await Api.post_json("/api/host-live/decklink", body)
		_busy = false
		var err := _reply_error(res)
		if err != "":
			status.emit(err, false)
			return
		var msg: Variant = H.R.d(res.data).get("message")
		status.emit(str(msg) if H.truthy(msg) else done, true)
		reload.emit(false)
	var row := _row()
	row.add_child(_button("Apply source", func() -> void:
		post.call(HS.decklink_update_body(slot, sel.get_selected_metadata(), src.get("connectorId"), src.get("value")), "DeckLink source updated")))
	row.add_child(_button("Reload", func() -> void:
		post.call(HS.decklink_reload_body(slot, src.get("connectorId"), src.get("value")), "DeckLink reloaded")))
	box.add_child(row)
	return box


## mountSourceLabelControl: the operator's override of the generated source name (blank = generated).
func _label_control(payload: Dictionary, cid: String, fallback: String) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.add_child(_caption("Label"))
	var st := HS.label_state(payload.get("extraLiveSources"), cid, fallback)
	var le := _line(st.custom, st.generated if st.generated != "" else cid,
		"Shown wherever this source appears. Leave empty to use the generated name.")
	le.max_length = 64
	v.add_child(le)
	var hint := _caption(HS.label_hint(st.custom, st.generated))
	v.add_child(hint)
	var save := func() -> void:
		if _busy:
			return
		var label := le.text.strip_edges()
		if label == st.custom:
			return
		_busy = true
		var res: Dictionary = await Api.post_json("/api/sources/label", {"sourceId": cid, "label": label})
		_busy = false
		var err := _reply_error(res)
		if err != "":
			hint.text = "Save failed: " + err
			return
		HS.apply_saved_label(payload.get("extraLiveSources"), cid, label)
		var next := HS.label_state(payload.get("extraLiveSources"), cid, fallback)
		st.custom = next.custom
		le.text = next.custom
		le.placeholder_text = next.generated if next.generated != "" else cid
		hint.text = HS.label_hint(next.custom, next.generated)
		reload.emit(false)
	le.text_submitted.connect(func(_t: String) -> void: save.call())
	le.focus_exited.connect(save)
	return v


# ---------------------------------------------------------------- removes

func _remove_live(src: Dictionary, dest: Dictionary, text: String, fallback: String) -> Control:
	return _button(text, func() -> void:
		if _busy:
			return
		var yes: bool = await _confirm("Remove \"%s\" from Live sources?" % _label_of(src, dest, fallback))
		if not yes:
			return
		var plan := HS.remove_live_plan(src, Store.get_value("hostOperatorFullscreen"))
		if plan.has("error"):
			status.emit(plan.error, false)
			return
		_busy = true
		var r: Dictionary = await _run(plan.requests)
		_busy = false
		if not r.ok:
			status.emit("Remove failed: " + r.error, false)
			return
		removed.emit())


## removeDecklinkInputSlot: edges off, STOP, live source gone, port unassigned, count re-read (shrunk → dirty),
## destination removed. The web then reloads the device view — here `removed` makes the tab do that.
func _remove_decklink(src: Dictionary, dest: Dictionary, payload: Dictionary, slot: int) -> Control:
	return _button("Remove DeckLink input", func() -> void:
		var label: String = str(dest.label) if H.truthy(dest.get("label")) else "DeckLink input %d" % slot
		if _busy:
			return
		var yes: bool = await _confirm("Remove \"%s\"?\n\nStops SDI capture, removes the live source, clears cables from this host channel, and frees the DeckLink port." % label)
		if not yes:
			return
		_busy = true
		await Settings.load_from_server()
		var prev := HS.decklink_count(Settings.settings)
		var dvr: Dictionary = await Api.get_json("/api/device-view")
		var dv: Dictionary = dvr.data if dvr.ok and dvr.data is Dictionary else payload
		var cm := H.channel_map(dv, Store.get_value("channelMap"))
		var plan := HS.decklink_remove_plan(dv, slot, H.R.s(src.get("connectorId")), H.R.s(src.get("value")), str(dest.get("id", "")), cm)
		var r: Dictionary = await _run(plan.requests)
		if not r.ok:
			_busy = false
			status.emit("Remove failed: " + r.error, false)
			return
		await Settings.load_from_server()
		await _run(HS.decklink_remove_tail(prev, HS.decklink_count(Settings.settings), plan.dest_id))
		_busy = false
		removed.emit())
