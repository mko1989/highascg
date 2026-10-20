extends VBoxContainer
## WO-608 — Settings → DeckLink (web settings-modal-templates.js decklink pane + settings-modal-mount-hardware.js):
## discovered cards, Desktop Video Setup / Updater on :0, driver package upload (streamed, WO-427) and install
## (confirm + nuclear gate). Upload only stages the package; installing is a separate, confirmed step.

const NuclearGate := preload("res://app/nuclear_gate.gd")
const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const K := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/system_model.gd")

var _summary: Label
var _status: Label
var _install: Button
var _upload: Button
var _result: Label


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	K.heading(self, "Blackmagic DeckLink")
	K.note(self, "Discovery uses the ffmpeg DeckLink list and the recent Caspar log. Buttons open the Blackmagic tools on "
		+ "the box display (:0).")
	_summary = Label.new()
	_summary.text = "Loading…"
	add_child(_summary)
	var r := K.row(self)
	K.button(r, "Refresh", refresh)
	K.button(r, "Desktop Video Setup", func() -> void: _launch("desktopvideo_setup"))
	K.button(r, "Desktop Video Updater", func() -> void: _launch("desktop_video_updater"))
	_status = K.note(self, "")
	K.heading(self, "Driver install / update")
	K.note(self, "Blackmagic's license does not allow shipping the DeckLink driver with HighAsCG — you supply it once: "
		+ "download \"Desktop Video\" for Linux from blackmagicdesign.com/support, then upload the "
		+ "Blackmagic_Desktop_Video_Linux_*.tar.gz here — or copy it to a USB stick's decklink/ folder and plug it in.")
	var r2 := K.row(self)
	_upload = K.button(r2, "Upload driver package…", _on_upload)
	_install = K.button(r2, "Install driver", _on_install)
	_install.disabled = true
	_result = K.note(self, "")
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func refresh() -> void:
	var r: Dictionary = await Api.get_json("/api/system/decklink")
	if not r.ok or not (r.data is Dictionary):
		_summary.text = str(r.error)
		return
	_summary.text = M.decklink_lines(r.data)
	var avail: bool = r.data.get("vendorAvailable") == true
	_install.disabled = not avail
	_install.tooltip_text = ("Install the staged Desktop Video package" if avail else "No Desktop Video package found — "
		+ "put the Blackmagic tar.gz in Downloads on this machine, or upload it here")


func _launch(action: String) -> void:
	_status.text = "Launching…"
	var res: Dictionary = await NuclearGate.post(self, "/api/system/gui-launch", {"action": action})
	var d: Dictionary = res.data if res.data is Dictionary else {}
	_status.text = M.launch_note(d) if res.ok else str(d.get("error", res.error))


func _on_upload() -> void:
	var path: String = await FilePick.open_path(self, "Desktop Video package", ["*.tar.gz, *.gz, *.deb ; Desktop Video"])
	if path == "":
		return
	_upload.disabled = true
	_result.text = "Uploading %s…" % path.get_file()
	var res: Dictionary = await Upload.upload(Config.origin, "/api/system/decklink/upload", path,
		func(sent: int, total: int) -> void:
			_result.text = "Uploading %s — %d / %d MB" % [path.get_file(), sent >> 20, total >> 20])
	var d: Dictionary = res.data if res.data is Dictionary else {}
	_result.text = ("Uploaded %s — now press Install driver." % str(d.get("savedAs", path.get_file()))
		if res.ok and d.get("ok") == true else "Upload failed: %s" % str(d.get("error", res.error)))
	_upload.disabled = false
	refresh()


func _on_install() -> void:
	K.confirm(self, "Install / update the DeckLink driver now? Capture may restart.", func() -> void:
		_install.disabled = true
		_result.text = "Installing…"
		var res: Dictionary = await NuclearGate.post(self, "/api/system/decklink/install", {})
		var d: Dictionary = res.data if res.data is Dictionary else {}
		if res.ok and d.get("ok") == true:
			_result.text = ("%s: %s" % [str(d.get("action", "")), str(d.reason)] if d.get("reason")
				else str(d.get("action", "Done.")))
		else:
			_result.text = "Error: %s" % str(d.get("error", res.error))
		refresh())
