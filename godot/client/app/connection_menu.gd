extends RefCounted
## WO-608 — right-click on the connection eyes. WO-1029 (owner 10.11: no A/B hosts in the client): ONE editable server
## address (ui.cfg [server], core/config.gd; a change restarts onto it) and, after a handover, "‹box› is back — return?"
## (app/handover_watch.gd). Which other boxes exist is the connected box's business, not a client setting.

const ServerAddress := preload("res://core/server_address_model.gd")
const Platform := preload("res://core/platform.gd")
const Kit := preload("res://features/settings/pane_kit.gd")


static func show_menu(host: Control, watch: Node = null) -> void:
	var menu := PopupMenu.new()
	var back: Dictionary = watch.return_target() if watch != null else {}
	if not back.is_empty():  # WO-1029 rule 6: the first box answers again — nothing moves by itself
		menu.add_item("%s is back — return?" % (str(back.name) if str(back.get("name", "")) != "" else Platform.host_of(str(back.origin))), 1)
		menu.add_separator()
	menu.add_item("Server address…  (%s)" % Config.origin, 0)
	menu.id_pressed.connect(func(i: int) -> void:
		if i == 1 and watch != null:
			watch.go_back()
		else:
			edit(host))
	menu.popup_hide.connect(menu.queue_free, CONNECT_DEFERRED)
	host.add_child(menu)
	menu.reset_size()
	var at := Vector2i(host.get_viewport().get_mouse_position()) - Vector2i(menu.size.x, 0)  # eyes sit at the right edge
	if not host.get_viewport().gui_embed_subwindows:
		at += host.get_window().position
	menu.popup(Rect2i(at, Vector2i.ZERO))


## The one server address (WO-1029): for a client started without --server / HIGHASCG_SERVER. A change restarts onto it.
static func edit(host: Control) -> void:
	var d := ConfirmationDialog.new()
	d.title = "Server address"
	d.ok_button_text = "Save"
	var box := VBoxContainer.new()
	box.custom_minimum_size.x = 420
	d.add_child(box)
	var e := LineEdit.new()
	e.text = Config.saved_server()
	e.placeholder_text = "192.168.0.10 or http://host:4200"
	box.add_child(e)
	d.register_text_enter(e)
	var note := Label.new()
	note.text = "A bare host gets :4200. Leave empty to use the server on this machine. Linked servers are not set here: " \
		+ "the box this client is on tells it which ones it has."
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size.x = 420
	box.add_child(note)
	d.confirmed.connect(func() -> void:
		var next := ServerAddress.normalize(e.text)
		Config.save_server(next)
		if next != "" and next != Config.origin:
			Kit.confirm(host, "Reconnect this client to %s?\n\nThe operator GUI restarts on that server." % next,
				func() -> void: switch_to(host)))
	d.visibility_changed.connect(func() -> void:
		if not d.visible:
			d.queue_free())
	host.add_child(d)
	d.popup_centered()


## Restart onto the saved address (HIGHASCG_SERVER would still win, so say so instead).
static func switch_to(host: Node) -> void:
	if OS.get_environment("HIGHASCG_SERVER") != "":
		Kit.confirm(host, "HIGHASCG_SERVER is set for this client and overrides the saved server address — unset it to switch.",
			func() -> void: pass)
		return
	restart(host)


## Restart this client with its window args (minus --server unless it was handed over): the autoloads start over on the
## origin that wins. The new process is started BEFORE quitting, so a crash on the way out can never cost the restart
## (it did: WO-676). `user_args` replaces the current window args (a handover move brings its own, WO-1029).
static func restart(host: Node, user_args := PackedStringArray(), use_args := false) -> void:
	# WO-688: an exported client (Mac / Windows) carries its project inside; --path there points at no project.
	var args := PackedStringArray(["--"] if OS.has_feature("template") else ["--path", ProjectSettings.globalize_path("res://"), "--"])
	args.append_array(user_args if use_args else ServerAddress.restart_user_args(OS.get_cmdline_user_args()))
	var xr := XRServer.find_interface("OpenXR")
	if xr != null and xr.is_initialized():  # WO-741: a client in a headset restarts in it (get_cmdline_args drops --xr-mode)
		args = PackedStringArray(["--xr-mode", "on"]) + args
	if OS.create_process(OS.get_executable_path(), args) <= 0:
		OS.set_restart_on_exit(true, args)
	host.get_tree().quit()
