extends RefCounted
## WO-608 — right-click on the connection eyes: A/B hot-backup hosts (web replication-status-banner.js "Connect to
## A/B" + "A/B hosts", which the web never mounted). Profiles live in ui.cfg [connection] (core/config.gd); a switch
## flips the active side and restarts the client so every autoload (Api, Ws, Store, Settings) starts on the new
## host — the web did window.location.reload(). Promote / failover stays on Devices → Server (become leader).

const Profiles := preload("res://core/connection_profiles_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")


static func show_menu(host: Control) -> void:
	var p := Config.profiles()
	var menu := PopupMenu.new()
	if Profiles.has_dual(p):
		menu.add_item("Connect to %s — %s" % [Profiles.peer_letter(p), Profiles.peer_origin(p)], 0)
	else:
		menu.add_item("Connect to backup host (set A/B hosts first)", 0)
		menu.set_item_disabled(0, true)
	menu.add_item("A/B hosts…", 1)
	menu.id_pressed.connect(func(i: int) -> void:
		if i == 0:
			var next := Profiles.flipped(Config.profiles())
			Kit.confirm(host, "Reconnect this client to host %s?\n%s\n\nThe operator GUI restarts on that server."
				% [next.active, Profiles.active_origin(next)], func() -> void: switch_to(host, next))
		else:
			edit(host))
	menu.popup_hide.connect(menu.queue_free, CONNECT_DEFERRED)
	host.add_child(menu)
	menu.reset_size()
	var at := Vector2i(host.get_viewport().get_mouse_position()) - Vector2i(menu.size.x, 0)  # eyes sit at the right edge
	if not host.get_viewport().gui_embed_subwindows:
		at += host.get_window().position
	menu.popup(Rect2i(at, Vector2i.ZERO))


static func edit(host: Control) -> void:
	var p := Config.profiles()
	var d := ConfirmationDialog.new()
	d.title = "A/B hosts"
	d.ok_button_text = "Save"
	var box := VBoxContainer.new()
	box.custom_minimum_size.x = 420
	d.add_child(box)
	var edits := {}
	for k in [["hostA", "Host A — primary playout"], ["hostB", "Host B — hot backup"]]:
		var l := Label.new()
		l.text = k[1]
		box.add_child(l)
		var e := LineEdit.new()
		e.text = str(p[k[0]])
		e.placeholder_text = "192.168.0.10 or http://host:4200"
		box.add_child(e)
		d.register_text_enter(e)
		edits[k[0]] = e
	var note := Label.new()
	note.text = "Active: host %s. A bare host gets :4200. Leave both empty to use the default server." % p.active
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size.x = 420
	box.add_child(note)
	d.confirmed.connect(func() -> void:
		var next := Profiles.clean({"hostA": edits.hostA.text, "hostB": edits.hostB.text, "active": p.active})
		Config.save_profiles(next)
		var o := Profiles.active_origin(next)
		if o != "" and o != Config.origin:
			Kit.confirm(host, "Host %s is now %s.\nReconnect this client there?" % [next.active, o],
				func() -> void: switch_to(host, next)))
	d.visibility_changed.connect(func() -> void:
		if not d.visible:
			d.queue_free())
	host.add_child(d)
	d.popup_centered()


## Store the profile and restart with the same window args minus --server (HIGHASCG_SERVER would still win).
static func switch_to(host: Node, p: Dictionary) -> void:
	Config.save_profiles(p)
	if OS.get_environment("HIGHASCG_SERVER") != "":
		Kit.confirm(host, "HIGHASCG_SERVER is set for this client and overrides A/B hosts — unset it to switch.",
			func() -> void: pass)
		return
	var args := PackedStringArray(["--path", ProjectSettings.globalize_path("res://"), "--"])
	args.append_array(Profiles.restart_user_args(OS.get_cmdline_user_args()))
	OS.set_restart_on_exit(true, args)
	host.get_tree().quit()
