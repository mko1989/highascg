extends RefCounted
## WO-1093 — the compacted Settings tab: the pane list, what moved into which fold, what left the Godot client
## (and where it lives now), the fold widget, and the save path of the live-audio program-route defaults that moved to
## the Devices live-audio inspector.

const K := preload("res://features/settings/pane_kit.gd")
const IS := preload("res://features/devices/input_slots_model.gd")
var t


static func _src(path: String) -> String:
	return FileAccess.get_file_as_string(path)


## Source without its ## / # comment lines (a header may name what was removed).
static func _code(path: String) -> String:
	var out := PackedStringArray()
	for line in _src(path).split("\n"):
		if not line.strip_edges().begins_with("#"):
			out.append(line)
	return "\n".join(out)


static func _matches(src: String, pattern: String) -> Array:
	var out := []
	for m in RegEx.create_from_string(pattern).search_all(src):
		out.append(m.get_string(1))
	return out


func test_pane_list_most_used_first() -> void:
	var tab := _src("res://features/settings/settings_tab.gd")
	t.eq(_matches(tab, "_pane\\(\"([^\"]+)\"\\)"),
		["Defaults", "Media / USB", "This screen", "Companion", "System", "Nuclear", "About"],
		"7 panes (WO-1092 moved Timecode to the Audio tab: features/audio/ltc_fold.gd)")
	for gone in ["Live audio", "Network", "Updates", "GDTF library", "DeckLink", "Diagnostics", "Tailscale",
			"Controllers", "Variables", "Lockscreen"]:
		t.ok(not tab.contains("_pane(\"%s\")" % gone), gone + " is no longer a pane of its own")
	t.ok(not tab.contains("LiveAudioPane") and not tab.contains("NetworkPane"), "Live audio / Network panes are not built")
	t.ok(not FileAccess.file_exists("res://features/settings/live_audio_pane.gd"), "the Live audio pane is deleted")


func test_moved_panes_are_folds_in_their_new_home() -> void:
	var tab := _src("res://features/settings/settings_tab.gd")
	t.eq(_matches(tab, "K\\.fold_pane\\(sys, \"([^\"]+)\""),
		["System time", "Tailscale", "Game controllers", "Blackmagic DeckLink", "GDTF library", "Hardware"], "System folds, in order")
	t.ok(tab.contains("sys.add_child(UpdatesPane.new())"), "Updates opens the System pane")
	t.ok(tab.contains("Panes.startup(sys)"), "start-up is in System")
	t.ok(tab.contains("K.fold_pane(screen, \"Lockscreen\", LockscreenPane.new())"), "Lockscreen folds under This screen")
	t.ok(tab.contains("K.fold(comp, \"Variables\").add_child(VariablesPane.new())"), "Variables folds under Companion")
	t.ok(tab.contains("Panes.diagnostics(about, _bundle, logs, _bundle_status)"), "support bundle + logs are in About")
	t.ok(tab.contains("_tabs.get_tab_title(i) == \"Companion\"") and tab.contains("_tabs.get_tab_title(i) == \"About\""),
		"the Companion check and the About fetch still run when their pane opens")


func test_defaults_holds_editor_defaults_only() -> void:
	var panes := _src("res://features/settings/settings_panes.gd")
	var start := panes.find("static func defaults(")
	var body := panes.substr(start, panes.find("\n\n\n", start) - start)
	for key in ["editorDefaults.coordinateOrigin", "editorDefaults.scene.loop", "editorDefaults.timeline.contentFit",
			"editorDefaults.transition.type"]:
		t.ok(body.contains(key), key + " stays in Defaults")
	for key in ["composePreview.", "startup.mode", "ui.invertTouchpadScroll", "UI scale", "demo_switch"]:
		t.ok(not body.contains(key), key + " left Defaults")
	t.ok(not panes.contains("ui.invertTouchpadScroll"), "the web-only touchpad switch is not in the Godot client")
	t.ok(panes.contains("f.target = K.fold(f, \"Previews for the web client and Companion\")\n\tcompose_preview(f)"),
		"the compose preview is a Companion fold")
	t.ok(panes.contains("f.target = K.fold(f, \"Button previews (Satellite)\")"), "Satellite rows fold under Companion")
	t.ok(panes.contains("\"startup.mode\"") and panes.contains("static func startup(f: Form)"), "start-up keeps its key")
	t.ok(panes.contains("/api/system/operator-display") and panes.contains("static func this_screen(f: Form)"),
		"the operator display line is next to Choose operator screen")


func test_kiosk_era_launch_buttons_left_the_client() -> void:
	var sys := _code("res://features/settings/system_pane.gd")
	t.ok(not sys.contains("gui-launch") and not sys.contains("Open browser") and not sys.contains("Open file manager"),
		"Open browser / Open file manager are not in the Godot System pane (route stays for the web UI)")
	t.ok(sys.contains("/api/system/time"), "system time stays")
	t.ok(_src("res://features/settings/hardware_pane.gd").contains("/api/system/hardware"), "the hardware summary stays")


func test_network_lives_on_the_devices_server_page() -> void:
	var server := _src("res://features/devices/server_controls.gd")
	t.ok(server.contains("preload(\"res://features/settings/network_pane.gd\")") and server.contains("NetworkPane.new()"),
		"the only Network pane is the Devices server page's")


func test_alsa_mixer_only_in_the_audio_tab() -> void:
	t.ok(_src("res://features/audio/audio_tab.gd").contains("AlsaMixer.new()"), "the Audio tab docks the ALSA mixer")
	t.ok(not _src("res://features/settings/settings_tab.gd").contains("alsa_mixer"), "Settings has no second copy")


func test_fold_opens_and_closes() -> void:
	var parent := VBoxContainer.new()
	var body := K.fold(parent, "Hardware")
	var b: Button = parent.get_child(0)
	t.eq(parent.get_child_count(), 2, "toggle + body")
	t.eq(parent.get_child(1), body, "the body follows the toggle")
	t.eq(body.visible, false, "closed by default")
	t.eq(b.text, "▸ Hardware")
	b.button_pressed = true
	t.eq(body.visible, true, "opens")
	t.eq(b.text, "▾ Hardware")
	b.button_pressed = false
	t.eq(body.visible, false, "closes")
	t.eq(K.fold(parent, "Open", true).visible, true, "open = true starts open")
	parent.free()


func test_fold_pane_hides_the_repeated_heading() -> void:
	var parent := VBoxContainer.new()
	var pane := VBoxContainer.new()
	K.heading(pane, "Tailscale")
	K.note(pane, "body")
	K.fold_pane(parent, "Tailscale", pane)
	t.eq((pane.get_child(0) as Label).visible, false, "the pane's own 'Tailscale' heading is hidden under the fold title")
	t.eq((pane.get_child(1) as Label).visible, true, "the rest stays")
	var other := VBoxContainer.new()
	K.heading(other, "Something else")
	K.fold_pane(parent, "Hardware", other)
	t.eq((other.get_child(0) as Label).visible, true, "a different heading is kept")
	parent.free()


func test_program_route_defaults_save_through_settings() -> void:
	t.eq(IS.pgm_route_body("live_audio_pgm_always_on", false), {"casparServer": {"live_audio_pgm_always_on": false}})
	t.eq(IS.pgm_route_body("live_audio_pgm_audio_only", true), {"casparServer": {"live_audio_pgm_audio_only": true}})
	t.eq(IS.pgm_route_body("live_audio_pgm_layer", 4), {"casparServer": {"live_audio_pgm_layer": 4}})
	t.eq(IS.pgm_route_body("live_audio_pgm_layer", 0), {"casparServer": {"live_audio_pgm_layer": 1}}, "layer ≥ 1")
	t.eq(IS.pgm_route_body("live_audio_pgm_layer", 12.0), {"casparServer": {"live_audio_pgm_layer": 9}}, "layer ≤ 9 audio tracks")
	t.eq(IS.PGM_ROUTE_KEYS, ["live_audio_pgm_always_on", "live_audio_pgm_layer", "live_audio_pgm_audio_only"])
	var ui := IS.read_live_audio({"live_audio_pgm_always_on": false, "live_audio_pgm_layer": 3.0, "live_audio_pgm_audio_only": "false"})
	t.eq([ui.pgmAlwaysOn, ui.pgmLayer, ui.pgmAudioOnly], [false, 3, false], "the inspector reads what it saved")


func test_program_route_defaults_in_the_live_audio_inspector() -> void:
	var src := _src("res://features/devices/host_input_controls.gd")
	t.ok(src.contains("_live_audio(int(slot), ch, entry.get(\"layer\")), pgm_routes(), _remove_input(int(slot), \"live_audio\")"),
		"every live-audio input inspector shows the fold")
	t.ok(src.contains("DevicesTarget.api.post_json(\"/api/settings\", IS.pgm_route_body(key, value))"),
		"saved through POST /api/settings (casparServer is in newConfig) on the inspected server")
	var at := src.find("func pgm_routes()")
	var fn := src.substr(at, src.find("\nfunc ", at + 5) - at)
	t.ok(at >= 0 and not fn.contains("live-inputs/apply") and not fn.contains("_run("), "no re-apply (it would re-PLAY inputs on air)")
	for key in IS.PGM_ROUTE_KEYS:
		t.ok(src.contains("\"%s\"" % key), key + " has a control")
