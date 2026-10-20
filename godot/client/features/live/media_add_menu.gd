extends MenuButton
## WO-603 slice 8 — the web Sources "+" dropup (sources-panel-shell.js ingest-dropup-menu): Select file(s)… ·
## New folder… · Download from URL…. The menu only asks; the media panel ingests the chosen files (local-path
## ingest on the box, HTTP upload off it) and the server downloads the URL (POST /api/ingest/download).

signal files_chosen(paths: PackedStringArray)
signal new_folder_requested
signal url_chosen(url: String)

enum { FILES, FOLDER, URL }


func _ready() -> void:
	text = "+"
	tooltip_text = "Add media: files from this computer, a new folder, or a download from a URL"
	flat = false
	var p := get_popup()
	p.add_item("Select file(s)…", FILES)
	p.add_item("New folder…", FOLDER)
	p.add_item("Download from URL…", URL)
	p.id_pressed.connect(_on_item)


func _on_item(id: int) -> void:
	match id:
		FILES:
			_pick_files()
		FOLDER:
			new_folder_requested.emit()
		URL:
			_ask_url()


func _pick_files() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILES
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.title = "Add media files"
	var home := OS.get_environment("HOME")
	dlg.current_dir = home.path_join("Downloads") if DirAccess.dir_exists_absolute(home.path_join("Downloads")) else home
	dlg.files_selected.connect(func(paths: PackedStringArray) -> void:
		dlg.queue_free()
		files_chosen.emit(paths))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered_ratio(0.6)


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
