extends MenuButton
## WO-603 slice 8 — the web Sources "+" dropup (sources-panel-shell.js ingest-dropup-menu): Select file(s)… ·
## New folder… · Download from URL… · Import from USB… (WO-608). Shader FX… (WO-606) left with WO-883: shaders live in Visuals. The menu only asks; the media panel ingests the chosen files (local-path
## ingest on the box, HTTP upload off it) and the server downloads the URL (POST /api/ingest/download).

signal files_chosen(paths: PackedStringArray)
signal new_folder_requested
signal url_chosen(url: String)
signal usb_requested
signal gtzip_imported(result: Dictionary)  # WO-951: {ok, id, casparPath, fields, warnings} or {ok: false, error}

enum { FILES, FOLDER, URL, FX, USB, GTZIP }


func _ready() -> void:
	text = "+"
	tooltip_text = "Add media: files from this computer, a new folder, a download from a URL, or a lower third template (.gtzip)"
	flat = false
	var p := get_popup()
	p.add_item("Select file(s)…", FILES)
	p.add_item("New folder…", FOLDER)
	p.add_item("Download from URL…", URL)
	p.add_item("Import from USB…", USB)
	p.add_item("Lower third template (.gtzip)…", GTZIP)  # WO-951
	p.id_pressed.connect(_on_item)
	about_to_popup.connect(_count_usb)


## The web USB button's badge: the item carries the server's drive count.
func _count_usb() -> void:
	var p := get_popup()
	var r: Dictionary = await Api.get_json("/api/usb/drives")
	var n: int = (r.data.get("drives", []) as Array).size() if r.ok and r.data is Dictionary and r.data.get("drives") is Array else 0
	p.set_item_text(p.get_item_index(USB), "Import from USB (%d)…" % n if n > 0 else "Import from USB…")


func _on_item(id: int) -> void:
	match id:
		FILES:
			_pick_files()
		FOLDER:
			new_folder_requested.emit()
		URL:
			_ask_url()
		USB:
			usb_requested.emit()
		GTZIP:
			_pick_gtzip()


func _pick_files() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILES
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.title = "Add media files"
	dlg.current_dir = preload("res://core/platform.gd").start_dir()  # WO-686: Windows has no $HOME
	dlg.files_selected.connect(func(paths: PackedStringArray) -> void:
		dlg.queue_free()
		files_chosen.emit(paths))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


## WO-951: a NewTek LiveGraphics-style .gtzip → a CG Studio lower third on the server (POST /api/lower-thirds/import-gtzip;
## the file is read here, so a client on another machine imports its own files too).
func _pick_gtzip() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.title = "Import a lower third template (.gtzip)"
	dlg.filters = PackedStringArray(["*.gtzip ; Lower third templates (NewTek LiveGraphics)"])
	dlg.current_dir = preload("res://core/platform.gd").start_dir()
	dlg.file_selected.connect(func(path: String) -> void:
		dlg.queue_free()
		import_gtzip(path))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


func import_gtzip(path: String) -> void:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		gtzip_imported.emit({"ok": false, "error": "could not read %s" % path.get_file()})
		return
	var r: Dictionary = await Api.post_json("/api/lower-thirds/import-gtzip", {"name": path.get_file(), "data": Marshalls.raw_to_base64(bytes)})
	var d: Dictionary = r.data if r.data is Dictionary else {}
	gtzip_imported.emit(d if r.ok and d.get("ok") == true else {"ok": false, "error": str(d.get("error", r.error))})


## The line the Sources panel shows after an import.
static func gtzip_line(res: Dictionary) -> String:
	if res.get("ok") != true:
		return "Import failed: %s" % str(res.get("error", "?"))
	var f: Dictionary = res.get("fields", {}) if res.get("fields") is Dictionary else {}
	var w: Array = res.get("warnings", []) if res.get("warnings") is Array else []
	return "Imported %s — title: %s, subtitle: %s%s" % [str(res.get("casparPath", "")), str(f.get("title", "—")),
		str(f.get("subtitle", "—")), (" · not imported: " + "; ".join(w)) if not w.is_empty() else ""]


func _ask_url() -> void:
	var dlg := ConfirmationDialog.new()
	dlg.title = "Download from URL"
	dlg.ok_button_text = "Download"
	var field := LineEdit.new()
	field.placeholder_text = "Paste URL… (http(s) file or WeTransfer link)"
	field.custom_minimum_size.x = 480
	dlg.add_child(field)
	dlg.register_text_enter(field)
	dlg.confirmed.connect(func() -> void:
		var u := field.text.strip_edges()
		dlg.queue_free()
		if u != "":
			url_chosen.emit(u))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()
	field.grab_focus()
