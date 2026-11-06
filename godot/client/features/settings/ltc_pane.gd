extends RefCounted
## WO-974 — Settings → Timecode: LTC in (reader, timeline chase) and LTC out (generator). Rows bind `ltc.*`
## (POST /api/settings restarts the LTC service); the status line polls GET /api/ltc while the pane is shown.

const Form := preload("res://features/settings/settings_form.gd")
const LM := preload("res://features/settings/ltc_model.gd")


static func build(f: Form) -> void:
	var status := f.heading("LTC —")
	f.option("Frame rate", "ltc.fps", LM.FPS, "25")
	f.heading("LTC in")
	f.check("Read LTC", "ltc.input.enabled", false)
	var src := f.option("From", "ltc.input.source", [["alsa", "Audio input device"], ["bridge", "Live-audio input slot"]], "alsa")
	var dev := f.group()
	f.target = dev
	f.text("Device", "ltc.input.device", "plughw:2,0")
	f.number("Channels on the device", "ltc.input.channels", 1, 64, 2)
	f.target = f
	var slot := f.group()
	f.target = slot
	f.number("Live-audio slot", "ltc.input.slot", 1, 8, 1)
	f.target = f
	f.number("LTC on channel", "ltc.input.channel", 1, 64, 1)
	f.note("A device is opened by LTC alone — a card the live-audio inputs already use (the DM3) is read through its slot.")
	f.check("Timeline follows LTC (chase)", "ltc.input.chase.enabled", false)
	f.text("Timeline 0 is at", "ltc.input.chase.offset", "00:00:00:00")
	f.heading("LTC out")
	f.check("Generate LTC", "ltc.output.enabled", false)
	f.option("Time", "ltc.output.source", [["timeline", "Timeline playhead"], ["clock", "Time of day"]], "timeline")
	f.text("Device", "ltc.output.device", "plughw:3,0")
	f.number("Channels on the device", "ltc.output.channels", 1, 64, 2)
	f.number("LTC on channel", "ltc.output.channel", 1, 64, 1)
	f.text("Timeline 0 is at", "ltc.output.offset", "00:00:00:00")
	var sync := func() -> void:
		var bridge := str(Settings.get_setting("ltc.input.source", "alsa")) == "bridge"
		dev.visible = not bridge
		slot.visible = bridge
	src.item_selected.connect(func(_i: int) -> void: sync.call())
	f.on_hydrate(sync)
	var poll := func() -> void:
		if not f.is_visible_in_tree():
			return
		var r: Dictionary = await Api.get_json("/api/ltc")
		status.text = "LTC — " + LM.status_line(r.data if r.ok else null)
	var t := Timer.new()
	t.wait_time = 0.25
	t.autostart = true
	t.timeout.connect(poll)
	f.add_child(t)
