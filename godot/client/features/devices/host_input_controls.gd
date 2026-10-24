extends "res://features/devices/host_controls_base.gd"
## WO-605 slice 3c — the live-audio and USB-video (V4L2) slot blocks of a host-channel page (web
## mountLiveAudioSlotControls in inspector-live-audio-input.js + the removes in
## device-view-destinations-inspector-host-channel.js, live-audio-remove-input.js, v4l2-remove-input.js). Request
## bodies and plans come from input_slots_model.gd (golden-tested). Not ported: the web's browser-stored PGM play
## targets, so Start restarts the capture only and restores no routes.

const IS := preload("res://features/devices/input_slots_model.gd")


## {bottom: [Control]} for live_audio_input / v4l2_input, else {}. `ch`/`entry` = the host channel and its
## channelMap inputChannels row (layer, route) that the page already resolved.
func build(role: String, dest: Dictionary, ch: Variant, entry: Dictionary) -> Dictionary:
	match role:
		"live_audio_input":
			var slot: Variant = HS.live_audio_slot(dest)
			if slot == null:
				return {}
			return {"bottom": [_live_audio(int(slot), ch, entry.get("layer")), _remove_input(int(slot), "live_audio")]}
		"v4l2_input":
			var slot: Variant = HS.v4l2_slot(dest)
			if slot == null:
				return {}
			return {"bottom": [_remove_input(int(slot), "v4l2")]}
	return {}


func _live_audio(slot: int, ch: Variant, layer: Variant) -> Control:
	var box := _section()
	var cs := H.R.d(H.R.d(DevicesTarget.settings.settings).get("casparServer"))
	var ui := IS.read_live_audio(cs)
	var cur := {"device": ui.slots[slot - 1]}  # lambdas copy captured values; a Dictionary stays shared
	var fft_slot: int = IS._int(cs.get("audio_fft_source_slot"), 0)
	var st := _caption("")
	st.visible = false
	box.add_child(_field("Status", st))
	var sel := _select([[cur.device, cur.device if cur.device != "" else "— loading —"]], cur.device, "ALSA capture device for this slot")
	box.add_child(_field("Capture device", sel))
	var fft := _check("Feed audio-reactive shaders" + (" (now: slot %d)" % fft_slot if fft_slot > 0 and fft_slot != slot else ""),
		fft_slot == slot, "Route this slot's capture to the shader FFT tee (one slot at a time)")
	box.add_child(_field("Shader FFT source", fft))
	var row := _row()
	var refresh := _button("Refresh devices", func() -> void: pass)
	var start := _button("Start", func() -> void: pass, "Restart this input's capture on its dedicated channel")
	var stop := _button("Stop", func() -> void: pass, "STOP + MIXER CLEAR on the dedicated channel")
	start.disabled = ch == null or layer == null
	stop.disabled = start.disabled
	for b in [refresh, start, stop]:
		row.add_child(b)
	box.add_child(row)
	box.add_child(_note("Change the device above and it is applied immediately. Start restarts this input's capture only; Stop kills it. Remove clears the slot and stops PGM routes. Use the Audio Mixer + dialog to add inputs."))

	var show_status := func(status: Variant) -> void:
		var msg := IS.status_message(status, slot, {"channel": ch, "layer": layer})
		if msg == "":
			return
		st.text = msg
		st.add_theme_color_override("font_color", ThemeBuilder.WARN if IS.status_is_warn(msg) else ThemeBuilder.SUCCESS)
		st.visible = true
	var fill := func(devices: Variant) -> void:
		var opts := IS.alsa_options(devices)
		if cur.device != "" and opts.filter(func(o: Array) -> bool: return o[0] == cur.device).is_empty():
			opts.append([cur.device, cur.device + " (saved)"])
		_fill(sel, opts, cur.device)
	var settle := func(ok: bool, msg: String, revert: Callable) -> void:
		if ok:
			status.emit(msg, true)
			await DevicesTarget.settings.load_from_server()
		else:
			status.emit(msg, false)
			revert.call()

	fft.toggled.connect(func(on: bool) -> void:
		if _busy:
			return
		_busy = true
		fft.disabled = true
		var r: Dictionary = await _run(IS.fft_requests(slot, on))
		fft.disabled = false
		_busy = false
		settle.call(r.ok, IS.fft_message(slot, on) if r.ok else r.error, func() -> void: fft.set_pressed_no_signal(not on)))
	sel.item_selected.connect(func(i: int) -> void:
		if _busy:
			return
		var next := str(sel.get_item_metadata(i))
		_busy = true
		sel.disabled = true
		var r: Dictionary = await _run(IS.device_requests(ui, slot, next))
		sel.disabled = false
		_busy = false
		if r.ok:
			cur.device = next
			ui.slots[slot - 1] = next
		settle.call(r.ok, "Capture re-applied on host channel." if r.ok else r.error, func() -> void:
			for k in sel.item_count:
				if str(sel.get_item_metadata(k)) == cur.device:
					sel.select(k)))
	refresh.pressed.connect(func() -> void:
		refresh.disabled = true
		var r: Dictionary = await DevicesTarget.api.get_json("/api/audio/devices?refresh=1")
		refresh.disabled = false
		if r.ok:
			fill.call(H.R.d(r.data).get("devices"))
			status.emit("Device list updated.", true)
		else:
			status.emit(_error(r), false))
	start.pressed.connect(func() -> void:
		if _busy:
			return
		_busy = true
		start.disabled = true
		var r: Dictionary = await DevicesTarget.api.post_json("/api/audio/inputs/start", IS.start_body("live_audio", slot))
		start.disabled = false
		_busy = false
		var err := _error(r) if not r.ok else IS.start_error(r.data)
		status.emit("Capture started on the dedicated channel." if err == "" else err, err == ""))
	stop.pressed.connect(func() -> void:
		stop.disabled = true
		await _run(IS._stop(ch, layer))
		stop.disabled = false)

	_boot.call_deferred(show_status, fill)
	return box


## The two initial GETs (status, devices) once the block is in the tree.
func _boot(show_status: Callable, fill: Callable) -> void:
	var s: Dictionary = await DevicesTarget.api.get_json("/api/audio/live-inputs")
	if s.ok:
		show_status.call(H.R.d(s.data).get("status"))
	var d: Dictionary = await DevicesTarget.api.get_json("/api/audio/devices")
	if d.ok:
		fill.call(H.R.d(d.data).get("devices"))


## Remove live audio / USB video slot N: settings re-read, plan, post, settings re-read, dirty when the count shrank.
func _remove_input(slot: int, kind: String) -> Control:
	var audio := kind == "live_audio"
	return _button("Remove live audio input" if audio else "Remove USB video input", func() -> void:
		if _busy:
			return
		var yes: bool = await _confirm("Remove %s slot %d?" % ["live audio" if audio else "USB video", slot])
		if not yes:
			return
		_busy = true
		await DevicesTarget.settings.load_from_server()
		var cs: Variant = H.R.d(DevicesTarget.settings.settings).get("casparServer")
		var cm: Dictionary = H.R.d(DevicesTarget.value("channelMap"))
		var plan := IS.live_audio_remove_plan(cs, cm, slot) if audio else IS.v4l2_remove_plan(cs, cm, slot)
		var r: Dictionary = await _run(plan.requests)
		if not r.ok:
			_busy = false
			status.emit("Remove failed: " + r.error, false)
			return
		await DevicesTarget.settings.load_from_server()
		_busy = false
		if not audio:
			status.emit("USB video slot %d removed." % slot, true)
		removed.emit())
