extends VBoxContainer
## WO-608 — Settings → Nuclear actions (web settings-modal.js postNuclear*): restart the window manager, reboot, shut
## down, install to disk (Calamares), stop / start / restart CasparCG — each behind a confirm and the nuclear password
## (nuclear_gate.gd). Caspar service state + Calamares availability from GET /api/system/setup.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const NuclearGate := preload("res://app/nuclear_gate.gd")
const OsPw := preload("res://features/settings/os_password_model.gd")

## [label, path, confirm text ("" = none), refresh Caspar status after]
const HOST := [
	["Restart window manager (nodm)", "/api/system/setup/restart-window-manager",
		"Restart the window manager? Every window on this box closes and reopens, this one included.", false],
	["Reboot host", "/api/system/setup/reboot", "Reboot host now? This will interrupt all outputs.", false],
	["Shut down host", "/api/system/setup/shutdown",
		"Shut down host now? Outputs stop and the machine powers off — it cannot be restarted from this UI.", false],
]
const INSTALL := ["Install to disk (Calamares)", "/api/system/setup/install",
	"Open the Calamares disk installer on the local display (:0)?\n\nCasparCG and the HighAsCG GUI will CLOSE so only the "
	+ "installer is on screen. They restart when the installer exits.", false]
const CASPAR := [
	["Stop CasparCG", "/api/system/setup/caspar/stop", "Stop CasparCG now? Output stops until you start it again.", true],
	["Start CasparCG", "/api/system/setup/caspar/start", "", true],
	["Restart CasparCG", "/api/system/setup/caspar/restart", "Restart CasparCG now? Brief output interruption.", true],
]

var _status: Label
var _caspar: Label
var _install: Button
var _install_why: Label
var _confirm: ConfirmationDialog
var _pending: Array = []
var _os_pw: Button
var _os_pw_status: Label


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	add_child(_buttons(HOST))
	_os_password_row()
	_heading("Install to disk")
	_note("Launch the Calamares graphical installer on :0 (needs a connected screen). Use after booting the live USB to "
		+ "copy HighAsCG onto internal storage.")
	var row := _buttons([INSTALL])
	_install = row.get_child(0)
	_install.disabled = true
	add_child(row)
	_install_why = _note("")
	_heading("CasparCG playout")
	_caspar = _note("Caspar status: unknown")
	add_child(_buttons(CASPAR))
	_note("Stop shuts down playout without autorestart until you start again (systemd units).")
	_status = _note("")
	_confirm = ConfirmationDialog.new()
	_confirm.confirmed.connect(func() -> void: _run(_pending))
	add_child(_confirm)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func refresh() -> void:
	var r: Dictionary = await Api.get_json("/api/system/setup")
	if not r.ok or not (r.data is Dictionary):
		_caspar.text = "Caspar status: unavailable"
		# WO-721: an unanswered status check must not lock the installer — the launch route re-checks every
		# precondition and answers with the reason.
		_install.disabled = false
		_install_why.text = "Couldn't check the installer (%s) — you can still try." % str(r.error if r.error != "" else r.status)
		return
	var cs: Dictionary = r.data.get("casparService", {}) if r.data.get("casparService") is Dictionary else {}
	_caspar.text = "Caspar scanner: %s · server: %s%s" % [str(cs.get("scanner", "?")), str(cs.get("server", "?")),
		" (stopped — autorestart off)" if cs.get("inhibited") == true else ""]
	var cal: Dictionary = r.data.get("calamares", {}) if r.data.get("calamares") is Dictionary else {}
	_install.disabled = not (cal.get("installed") == true and cal.get("sudoLaunchAvailable") != false)
	# WO-721: the reason is on screen, not only in a tooltip a kiosk operator has to hover to find.
	_install_why.text = ("Calamares not installed on this system" if cal.get("installed") != true
		else ("Passwordless sudo for Calamares not configured — run: sudo bash scripts/setup/12-passwordless-sudo.sh"
			if cal.get("sudoLaunchAvailable") == false else ""))
	_install.tooltip_text = _install_why.text


func _buttons(specs: Array) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	for spec in specs:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(func() -> void: _ask(spec))
		row.add_child(b)
	return row


func _ask(spec: Array) -> void:
	if spec[2] == "":
		_run(spec)
		return
	_pending = spec
	_confirm.dialog_text = spec[2]
	_confirm.popup_centered()
	_confirm.get_cancel_button().grab_focus.call_deferred()  # a stray Enter must not reboot the box


func _run(spec: Array) -> void:
	_status.text = "Running…"
	var res: Dictionary = await NuclearGate.post(self, spec[1], {})
	var d: Dictionary = res.data if res.data is Dictionary else {}
	_status.text = (str(d.get("note", "Done.")) if res.ok else "%s failed: %s" % [spec[0], str(d.get("error", res.error))])
	if spec[3]:
		refresh()
		for s in [3.0, 30.0]:
			get_tree().create_timer(s).timeout.connect(func() -> void:
				if is_inside_tree():
					refresh())


## WO-811 phase 3: the OS-password terminal on :0 (os_password_model.gd), only from the box's own screen (owner 29.10).
func _os_password_row() -> void:
	_heading("Login password")
	_note(OsPw.NOTE)
	var row := HBoxContainer.new()
	_os_pw = Button.new()
	_os_pw.text = OsPw.LABEL
	_os_pw.disabled = not OsPw.available(Config.origin)
	_os_pw.pressed.connect(_change_os_password)
	row.add_child(_os_pw)
	add_child(row)
	_os_pw_status = _note(OsPw.OFF_BOX if _os_pw.disabled else "")


func _change_os_password() -> void:
	_os_pw_status.text = "Opening the terminal on the box screen…"
	var res: Dictionary = await NuclearGate.post(self, OsPw.PATH, OsPw.request_body())
	_os_pw_status.text = OsPw.result_text(res)


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
