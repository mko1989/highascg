extends VBoxContainer
## WO-608 — Settings → System → System time (web settings-modal-mount-hardware.js, WO-193): live clock, NTP toggle,
## manual set behind a confirm; POSTs go through the nuclear gate. WO-1093: the hardware summary is hardware_pane.gd,
## the operator display line moved to This screen, and the kiosk-era "Open browser" / "Open file manager" buttons left
## the Godot client (POST /api/system/gui-launch stays for the web UI).

const NuclearGate := preload("res://app/nuclear_gate.gd")
const K := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/system_model.gd")

var _clock: Label
var _ntp: CheckBox
var _date: LineEdit
var _time: LineEdit
var _set: Button
var _result: Label
var _time_info := {}
var _base_unix := 0.0
var _base_ticks := 0


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	K.heading(self, "System time")
	_clock = Label.new()
	_clock.text = "Current time: loading…"
	add_child(_clock)
	_ntp = CheckBox.new()
	_ntp.text = "NTP enabled"
	_ntp.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_ntp.toggled.connect(_on_ntp)
	add_child(_ntp)
	var tr := K.row(self)
	_date = _field(tr, "Date (YYYY-MM-DD)", 140)
	_time = _field(tr, "Time (HH:MM:SS, 24h)", 110)
	_time.placeholder_text = "14:30:00"
	_set = K.button(tr, "Set time", _on_set)
	_result = K.note(self, "")
	var t := Timer.new()
	t.wait_time = 0.5
	t.timeout.connect(_tick)
	add_child(t)
	t.start()
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			_refresh_time())


func _refresh_time() -> void:
	var r: Dictionary = await Api.get_json("/api/system/time")
	var d: Dictionary = r.data if r.data is Dictionary else {}
	if not r.ok or d.get("ok") != true:
		_clock.text = "Current time: error — %s" % str(d.get("error", r.error))
		return
	_time_info = d
	_ntp.set_pressed_no_signal(d.get("ntp") == true)
	_set.disabled = _ntp.button_pressed
	_set.tooltip_text = "Disable NTP to set manual time" if _ntp.button_pressed else "Set system time"
	var now := M.parse_now(d.get("now"))
	if now.is_empty():
		_clock.text = "Current time: %s" % str(d.get("now", "?"))
		return
	if not _date.has_focus():
		_date.text = now.date
	if not _time.has_focus():
		_time.text = now.time
	_base_unix = Time.get_unix_time_from_datetime_string("%sT%s" % [now.date, now.time])
	_base_ticks = Time.get_ticks_msec()
	_tick()


## The server clock advanced locally between reads (web updateClock); shown in UTC like the server string.
func _tick() -> void:
	if _base_ticks == 0 or not is_visible_in_tree():
		return
	var t := _base_unix + (Time.get_ticks_msec() - _base_ticks) / 1000.0
	_clock.text = "Current time: %s %s (%s)" % [Time.get_datetime_string_from_unix_time(int(t), true),
		str(_time_info.get("timezone", "UTC")), "sync" if _time_info.get("synchronized") == true else "unsynced"]


func _on_ntp(on: bool) -> void:
	_result.text = "Updating NTP…"
	var res: Dictionary = await NuclearGate.post(self, "/api/system/time", {"ntp": on})
	var d: Dictionary = res.data if res.data is Dictionary else {}
	_result.text = ("NTP: %s" % ("enabled" if d.get("ntp") == true else "disabled") if res.ok and d.get("ok") == true
		else "Error: %s" % str(d.get("error", res.error)))
	await _refresh_time()


func _on_set() -> void:
	var date := _date.text.strip_edges()
	var time := M.normalize_time(_time.text)
	if not M.valid_date(date):
		_result.text = "Error: date must be YYYY-MM-DD"
		return
	if time == "":
		_result.text = "Error: time must be HH:MM[:SS] (24h, 00-23 hours)"
		return
	_result.text = ""
	K.confirm(self, "Set the system clock to %s %s?\n\nChanging system time while recording or streaming can disturb "
		% [date, time] + "timestamps.", func() -> void:
			_result.text = "Setting time…"
			var res: Dictionary = await NuclearGate.post(self, "/api/system/time", {"set": "%s %s" % [date, time]})
			var d: Dictionary = res.data if res.data is Dictionary else {}
			_result.text = ("Time set: %s" % str(d.get("now", date)) if res.ok and d.get("ok") == true
				else "Error: %s" % str(d.get("error", res.error)))
			await _refresh_time())


func _field(parent: Node, label: String, width: int) -> LineEdit:
	var v := VBoxContainer.new()
	var l := Label.new()
	l.text = label
	v.add_child(l)
	var le := LineEdit.new()
	le.custom_minimum_size.x = width
	v.add_child(le)
	parent.add_child(v)
	return le
