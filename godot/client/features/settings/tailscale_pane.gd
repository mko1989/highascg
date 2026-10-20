extends VBoxContainer
## WO-608 — Settings → Tailscale (web settings-modal-tailscale.js, WO-91): status, service on/off, login (here, on
## the operator monitor, or copy the URL), log out, admin console, advanced prefs. Every POST goes through the
## nuclear gate. Turning the service off or logging out asks first — remote access to the box may run over it.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const NuclearGate := preload("res://app/nuclear_gate.gd")
const M := preload("res://features/settings/tailscale_model.gd")
const STATUS := "/api/network/tailscale/status"

var _status: Label
var _kv: GridContainer
var _enabled: CheckBox
var _copy: Button
var _auto: CheckBox
var _assist: CheckBox
var _routes: CheckBox
var _host: LineEdit
var _admin_url := "https://login.tailscale.com/admin/machines"
var _url := ""
var _poll_until := 0
var _confirm: ConfirmationDialog
var _on_confirm := Callable()


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	_heading("Tailscale")
	_note("Reach this playout box over your tailnet. If the nuclear password is on, actions ask for it.")
	_status = _note("Loading…")
	_kv = GridContainer.new()
	_kv.columns = 2
	_kv.add_theme_constant_override("h_separation", 24)
	add_child(_kv)
	_enabled = CheckBox.new()
	_enabled.text = "Enable Tailscale service"
	_enabled.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_enabled.toggled.connect(_on_enabled)
	add_child(_enabled)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	add_child(row)
	_button(row, "Log in", func() -> void: _login("/api/network/tailscale/login", "Starting Tailscale login…"))
	_button(row, "Open on operator monitor", func() -> void:
		_login("/api/network/tailscale/login-operator-ui", "Opening on operator monitor…"))
	_copy = _button(row, "Copy login URL", func() -> void:
		DisplayServer.clipboard_set(_url)
		_status.text = "Auth URL copied.")
	_button(row, "Log out", func() -> void:
		_ask("Log out of Tailscale on this machine? Remote access over the tailnet stops until you log in again.",
			func() -> void: _post("/api/network/tailscale/logout", {}, "Logging out…")))
	_button(row, "Admin console", func() -> void: OS.shell_open(_admin_url))
	_heading("Advanced")
	_auto = _check("Auto-login on boot when needed")
	_assist = _check("Open login page on operator monitor when available")
	_routes = _check("Accept subnet routes")
	var hr := HBoxContainer.new()
	var hl := Label.new()
	hl.text = "Hostname (optional)"
	hl.custom_minimum_size.x = 280
	hr.add_child(hl)
	_host = LineEdit.new()
	_host.placeholder_text = "leave empty for default"
	_host.custom_minimum_size.x = 320
	hr.add_child(_host)
	add_child(hr)
	_button(self, "Save preferences", func() -> void:
		_post("/api/network/tailscale/prefs", {"autoLoginOnBoot": _auto.button_pressed,
			"acceptRoutes": _routes.button_pressed, "operatorLoginAssist": _assist.button_pressed,
			"hostname": _host.text.strip_edges()}, "Saving preferences…", "Preferences saved."))
	_confirm = ConfirmationDialog.new()
	_confirm.confirmed.connect(func() -> void: _on_confirm.call())
	_confirm.canceled.connect(refresh)  # puts the checkbox back when "turn off" is cancelled
	add_child(_confirm)
	var t := Timer.new()
	t.wait_time = 3.0
	t.timeout.connect(func() -> void:
		if is_visible_in_tree() and Time.get_ticks_msec() < _poll_until:
			refresh())
	add_child(t)
	t.start()
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func refresh() -> void:
	var r: Dictionary = await Api.get_json(STATUS)
	if not r.ok or not (r.data is Dictionary):
		_status.text = "Status unavailable: %s" % str(r.error)
		return
	_render(r.data)


func _render(st: Dictionary) -> void:
	_status.text = M.summary(st)
	for c in _kv.get_children():
		c.queue_free()
	for kv in M.rows(st):
		for i in 2:
			var l := Label.new()
			l.text = kv[i]
			if i == 0:
				l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
			_kv.add_child(l)
	var cfg: Dictionary = st.get("config", {}) if st.get("config") is Dictionary else {}
	_enabled.set_pressed_no_signal(cfg.get("enabled") != false)
	_auto.button_pressed = cfg.get("autoLoginOnBoot") == true
	_routes.button_pressed = cfg.get("acceptRoutes") == true
	_assist.button_pressed = cfg.get("operatorLoginAssist") != false
	if not _host.has_focus():
		_host.text = str(cfg.get("hostname", "")) if cfg.get("hostname") != null else ""
	_url = M.auth_url(st)
	_copy.disabled = _url == ""
	_copy.tooltip_text = "Copy login URL to clipboard" if _url != "" else "No login URL while connected"
	if st.get("adminUrl") is String and st.adminUrl != "":
		_admin_url = st.adminUrl
	if st.get("connected") == true:
		_poll_until = 0


func _on_enabled(on: bool) -> void:
	var go := func() -> void: _post("/api/network/tailscale/enable", {"enabled": on}, "Updating Tailscale service…")
	if on:
		go.call()
	else:
		_ask("Turn the Tailscale service off? Remote access over the tailnet stops.", go)


func _login(path: String, busy: String) -> void:
	var res := await _post(path, {}, busy)
	var d: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	if res.ok:
		_poll_until = Time.get_ticks_msec() + 120000
		if d.has("note"):
			_status.text = str(d.note)


func _post(path: String, body: Dictionary, busy: String, done := "") -> Dictionary:
	_status.text = busy
	var res: Dictionary = await NuclearGate.post(self, path, body)
	await refresh()
	if not res.ok:
		var d: Dictionary = res.data if res.data is Dictionary else {}
		_status.text = str(d.get("error", res.error))
	elif done != "":
		_status.text = done
	return res


func _ask(text: String, then: Callable) -> void:
	_on_confirm = then
	_confirm.dialog_text = text
	_confirm.popup_centered()
	_confirm.get_cancel_button().grab_focus.call_deferred()


func _button(parent: Node, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


func _check(text: String) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	add_child(c)
	return c


func _heading(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	l.add_theme_font_size_override("font_size", 18)
	add_child(l)


func _note(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(l)
	return l
