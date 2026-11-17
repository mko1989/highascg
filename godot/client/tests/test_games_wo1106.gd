extends RefCounted
## WO-1106 — review fixes of Settings ▸ Games (the Godot side): local-only join addresses tagged (A7), the house slider
## posts on any change (A10), a per-game default can go back to "the game's own" (A27), rows of uninstalled game
## modules are freed (A28), "Send to preview" survives a closed dialog (A29), the join pick says what it reaches (A31).

const M := preload("res://features/settings/games_model.gd")
var t


static func _src(name: String) -> String:
	return FileAccess.get_file_as_string("res://features/settings/" + name)


func test_address_items_tag_local_only() -> void:
	var st := {"join": {"addresses": [{"ip": "192.0.2.15", "iface": "eno1", "kind": "lan"},
		{"ip": "100.101.245.97", "iface": "tailscale0", "kind": "vpn"}, {"ip": "172.17.0.1", "iface": "docker0", "kind": "local"},
		{"ip": "127.0.0.1", "iface": "lo", "kind": "loopback"}]}}
	var items := M.address_items(st)
	t.eq(items.map(func(i: Array) -> String: return str(i[0])), ["", "192.0.2.15", "100.101.245.97", "172.17.0.1"], "never loopback")
	t.eq(str(items[1][1]), "192.0.2.15 — eno1")
	t.eq(str(items[2][1]), "100.101.245.97 — tailscale0 (VPN)")
	t.eq(str(items[3][1]), "172.17.0.1 — docker0 (local only — phones cannot reach it)", "A7: a docker bridge is tagged")


func test_rows_of_uninstalled_games_are_freed() -> void:
	var st := {"world": {"id": "world"}, "games": [{"id": "rc"}, {"id": "salad"}]}
	t.eq(M.gone_ids(["world", "rc", "sk", "salad"], st), ["sk"], "A28: sk's module was uninstalled")
	t.eq(M.gone_ids(["world", "rc"], {"world": null, "games": [{"id": "rc"}]}), ["world"], "the world row goes with its module")
	t.eq(M.gone_ids(["rc"], {"games": [{"id": "rc"}]}), [])
	t.eq(M.gone_ids(["rc"], {}), ["rc"], "no games at all")
	var pane := _src("games_pane.gd")
	t.ok(pane.contains("for gid in M.gone_ids(_by_id.keys(), st):"), "the pane frees them")
	t.ok(pane.contains("_by_id.erase(gid)"), "and forgets them (a reinstall builds a fresh row)")


func test_defaults_can_go_back_to_the_games_own() -> void:
	var li := M.level_items(["easy", "normal", "hard"])
	t.eq(li, [["", "Game's own"], ["easy", "easy"], ["normal", "normal"], ["hard", "hard"]])
	t.eq(M.level_items(null), [["", "Game's own"]])
	var ai := M.affect_items()
	t.eq(ai.map(func(i: Array) -> String: return str(i[0])), ["", "on", "soft", "off"], "A27: on can be picked, it is not the unset look")
	t.eq(M.item_index(ai, null), 0, "nothing stored → the game's own")
	t.eq(M.item_index(ai, "on"), 1)
	t.eq(M.item_index(li, "hard"), 3)
	t.eq(M.item_index(li, "bogus"), 0)
	t.eq(M.default_patch("rc", "botLevel", ""), {"games": {"defaults": {"rc": {"botLevel": null}}}}, "the game's own = null (the server drops the key)")
	t.eq(M.default_patch("rc", "affect", "on"), {"games": {"defaults": {"rc": {"affect": "on"}}}})
	t.eq(M.default_patch("rc", "bots", 2), {"games": {"defaults": {"rc": {"bots": 2}}}})
	t.eq(M.reset_patch("sk"), {"games": {"defaults": {"sk": null}}}, "every default of the game")
	var row := _src("games_row.gd")
	t.ok(row.contains("Settings.patch(M.reset_patch(id))"), "a Game's own button resets the game")
	t.ok(row.contains("Settings.patch(M.default_patch(id, key, v))"), "every default goes through default_patch")
	t.ok(row.contains("M.item_index(M.affect_items(), d.get(\"affect\"))"), "an unset affect shows Game's own, not on")


func test_house_slider_posts_on_any_change() -> void:
	var pane := _src("games_pane.gd")
	t.ok(not pane.contains("drag_ended"), "A10: not only on drag end (the wheel and arrow keys move it too)")
	t.ok(pane.contains("_house_post.start()"), "posted from value_changed, debounced")
	t.ok(pane.contains("_post(M.body_global(\"house\", _house_want))"), "the value the operator set, not one a broadcast wrote since")
	t.ok(pane.contains("if not _quiet:\n\t\t\t_house_want = v / 100.0"), "a value set by the state never posts back")


func test_send_to_preview_survives_a_closed_dialog() -> void:
	var q := _src("games_qr.gd")
	var at := q.find("await send_to_preview(")
	var guard := q.find("if not is_instance_valid(said) or not is_instance_valid(send):")
	t.ok(at > 0 and guard > at, "A29: checked after the await, before the labels are written")
	t.ok(guard < q.find("said.text = str(r.text)"))


func test_join_pick_says_what_it_reaches() -> void:
	t.ok(_src("games_pane.gd").contains("The games' own host pages list every address of this box."), "A31 (partial): said in the pane")
	for path in ["games_pane.gd", "games_row.gd", "games_model.gd", "games_qr.gd"]:
		var n := _src(path).split("\n").size()
		t.ok(n <= 500, "%s ≤ 500 lines (%d)" % [path, n])
