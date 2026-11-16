extends RefCounted
## WO-1105 — Settings ▸ Games ▸ Show QR: the join code large on the operator screen (a quick scan), the address in
## text with Copy, and "Send to preview": the join card (template/join_qr.html) as a normal look of the project, staged
## on PRV like a deck click (POST /api/scene/take-look target preview). Nothing ever goes to program from here — the
## operator TAKEs the look like any other. The matrix is the server's (src/games/games-qr.js, the games' own encoder).

const M := preload("res://features/settings/games_model.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const DestScope := preload("res://core/dest_scope.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


## Draws an n × n matrix black on white with the 4-module quiet zone, as large as it is.
class QrView extends Control:
	var n := 0
	var dark := PackedByteArray()

	func _draw() -> void:
		var side := minf(size.x, size.y)
		var cells := n + M.QR_QUIET * 2
		if n <= 0 or side <= 0:
			return
		var px := floorf(side / cells)
		var org := Vector2((size.x - px * cells) / 2.0, (size.y - px * cells) / 2.0)
		draw_rect(Rect2(org, Vector2(px * cells, px * cells)), Color.WHITE)
		for r in n:
			for c in n:
				if dark[r * n + c] == 1:
					draw_rect(Rect2(org + Vector2((c + M.QR_QUIET) * px, (r + M.QR_QUIET) * px), Vector2(px, px)), Color.BLACK)


## The dialog for one row (a game or the world). `send(main)` stages the join look on PRV of that screen.
static func open(host: Node, row: Dictionary) -> AcceptDialog:
	var q := M.qr_dialog(row)
	var d := AcceptDialog.new()
	d.title = "Join %s" % q.title
	d.ok_button_text = "Close"
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	d.add_child(box)
	var view := QrView.new()
	view.n = q.n
	view.dark = q.dark
	view.custom_minimum_size = Vector2(620, 620)
	box.add_child(view)
	var url := Label.new()
	url.text = q.url if q.ok else "No join address — open the session first."
	url.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	url.add_theme_font_size_override("font_size", 22)
	box.add_child(url)
	var row_b := HBoxContainer.new()
	row_b.alignment = BoxContainer.ALIGNMENT_CENTER
	row_b.add_theme_constant_override("separation", 10)
	box.add_child(row_b)
	var copy := Button.new()
	copy.text = "Copy address"
	copy.disabled = not q.ok
	copy.pressed.connect(func() -> void: DisplayServer.clipboard_set(q.url))
	row_b.add_child(copy)
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var screens := OptionButton.new()
	for i in DeckModel.screen_count(cm):
		screens.add_item(DeckModel.screen_label(cm, i))
	screens.visible = screens.item_count > 1
	screens.tooltip_text = "The screen whose preview gets the join card"
	row_b.add_child(screens)
	var send := Button.new()
	send.text = "Send to preview"
	send.tooltip_text = "Adds the look \"Join QR — %s\" to the project and stages it on PRV. TAKE it like any other look." % q.title
	send.disabled = not q.ok
	row_b.add_child(send)
	var said := Label.new()
	said.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	said.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	box.add_child(said)
	send.pressed.connect(func() -> void:
		send.disabled = true
		said.text = "Staging on preview…"
		var r: Dictionary = await send_to_preview(row, maxi(0, screens.selected))
		said.text = str(r.text)
		said.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if r.ok else ThemeBuilder.ERROR)
		send.disabled = false)
	d.visibility_changed.connect(func() -> void:
		if not d.visible:
			d.queue_free())
	host.add_child(d)
	d.popup_centered()
	return d


## Find or add the row's join look (data refreshed: the address may have changed), sync the deck, stage it on PRV.
## → {ok, text, id}
static func send_to_preview(row: Dictionary, main: int) -> Dictionary:
	var src := M.qr_source(row)
	if not (Store.project.get("scenes") is Dictionary):
		Store.project["scenes"] = {"scenes": []}
	var root: Dictionary = Store.project.scenes
	if not (root.get("scenes") is Array):
		root["scenes"] = []
	var look := M.find_qr_look(root.scenes, str(row.get("id", "")))
	if look.is_empty():
		var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
		var body := {"mainIdx": main, "mainScope": "0" if DeckModel.screen_count(cm) < 2 else str(main), "source": src}
		var ids := DestScope.ids(cm, Store.get_value("screenDestinations"))
		if main < ids.size() and str(ids[main]) != "":
			body["destScope"] = str(ids[main])
		var res: Dictionary = await Api.post_json("/api/scene/new-look", body)
		if not res.ok or not (res.data is Dictionary) or not ((res.data as Dictionary).get("look") is Dictionary):
			return {"ok": false, "text": "The look was refused: %s" % Store.fail_text(res), "id": ""}
		look = res.data.look
		look["name"] = str(src.label)
		(root.scenes as Array).append(look)
	else:
		for l in look.get("layers", []):
			if l is Dictionary and l.get("source") is Dictionary and str(l.source.get("value", "")) == "join_qr":
				l.source["data"] = src.data
	Store.project_changed.emit(Store.project)
	ProjectSync.send_deck_sync(true)
	ProjectSync.mark_dirty(true)
	var id := str(look.get("id", ""))
	var res2: Dictionary = {}
	for attempt in 4:  # the deck sync (WS) and the take (HTTP) race: the server knows the look a moment later
		await (Engine.get_main_loop() as SceneTree).create_timer(0.4).timeout
		res2 = await Api.post_json("/api/scene/take-look", {"sceneId": id, "mainIdx": main, "target": "preview"})
		if res2.ok or int(res2.get("status", 0)) != 404:
			break
	if not res2.ok:
		return {"ok": false, "text": "Not staged: %s" % Store.fail_text(res2), "id": id}
	return {"ok": true, "text": "On preview: %s. TAKE it from the Live tab when you want it on program." % str(src.label), "id": id}
