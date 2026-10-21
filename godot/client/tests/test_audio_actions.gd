extends RefCounted
## WO-604 — audio_actions.gd: volume payload + solo toggling against the web (tests/golden/audio_mixer.json:
## volumeApiPayload, audio-mixer-state.js toggleSolo); request shapes per strip kind; look / live layer patches.

const AA := preload("res://features/audio/audio_actions.gd")
var t


func _golden() -> Dictionary:
	return JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/audio_mixer.json"))


func test_volume_payload_matches_web() -> void:
	for c in _golden().volumePayload:
		var p := AA.volume_payload(float(c[0]))
		t.eq(p.volume, c[1].volume, "volume for %s" % c[0])
		t.ok(absf(p.volumeDb - c[1].volumeDb) < 1e-9, "dB for %s: %s vs %s" % [c[0], p.volumeDb, c[1].volumeDb])


func test_toggle_solo_matches_web() -> void:
	var cur := []
	for c in _golden().solo:
		cur = AA.toggle_solo(cur, c[0], c[1])
		t.eq(cur, c[2], "solo %s multi=%s" % [c[0], c[1]])


func test_requests_per_strip_kind() -> void:
	var master := {"key": "prv:2", "ch": 2.0, "isMaster": true, "isPreview": true}
	t.eq(AA.volume_request(master, 0.5), ["POST", "/api/audio/volume", {"channel": 2.0, "master": true, "volume": 0.5, "volumeDb": AA.volume_payload(0.5).volumeDb, "key": "prv:2"}], "master: keyed, master flag")
	var look := {"key": "pgm:1:layer:10", "ch": 1.0, "layer": 10.0, "sceneId": "look-1"}
	t.eq(AA.volume_request(look, 1.0), ["POST", "/api/audio/volume", {"channel": 1.0, "layer": 10.0, "volume": 1.0, "volumeDb": 0.0}], "look layer: no key (the look keeps it)")
	t.eq(AA.mute_request(look, true, 0.7), ["POST", "/api/audio/mute", {"channel": 1.0, "layer": 10.0, "muted": true, "volume": 0.7}], "look mute")
	var input := {"key": "input:7", "ch": 7.0, "layer": 4.0, "isLiveInput": true}
	t.eq(AA.mute_request(input, false, 3.0), ["POST", "/api/audio/mute", {"channel": 7.0, "layer": 4.0, "muted": false, "volume": AA.volume_payload(3.0).volume, "key": "input:7"}], "input unmute: keyed, clamped")
	t.eq(AA.solo_request(["pgm:1"]), ["POST", "/api/audio/solo", {"keys": ["pgm:1"]}], "solo by keys")


func test_look_and_live_patches() -> void:
	var project := {"scenes": {"scenes": [{"id": "a", "layers": [{"layerNumber": 10}, {"layerNumber": 11, "volume": 1.0}]}]}}
	t.ok(AA.patch_look_layer(project, "a", 11.0, {"volume": 0.25}), "found")
	t.eq(project.scenes.scenes[0].layers[1].volume, 0.25, "patched")
	t.ok(not AA.patch_look_layer(project, "a", 12, {"muted": true}), "missing layer")
	t.ok(not AA.patch_look_layer(project, "b", 10, {"muted": true}), "missing look")
	var live := {"1": {"scene": {"layers": [{"layerNumber": 10}]}}}
	AA.patch_live_layer(live, 1.0, 10, {"muted": true})
	t.eq(live["1"].scene.layers[0].muted, true, "live copy patched")
	AA.patch_live_layer(null, 1, 10, {})
	t.ok(true, "no live state is fine")


## Box find (WO-604): the 0..100 fader cannot sit on unity, so unmute read back −0.12 dB (0.986) like the web.
## The strip now reports the stored gain while the fader still shows it, the fader position once it moved.
func test_strip_gain_keeps_exact_stored_value() -> void:
	var Strip := preload("res://features/audio/audio_strip.gd")
	var s = Strip.new()
	s.setup({"key": "input:7", "label": "DeckLink 4", "ch": 7.0, "layer": 4.0, "v": 1.0, "isLiveInput": true}, 1, false)
	t.eq(s.gain(), 1.0, "unity stays exactly 1")
	s.fader.value = 50
	t.eq(s.gain(), s.MM.fader_to_gain(50), "a moved fader reads its position")
	var reset := []
	s.gain_changed.connect(func(g: float, final: bool) -> void: reset.append([g, final]))
	s.fader.drag_ended.emit(true)  # the release of a double-click reset, with no drag_started before it
	t.eq(reset, [], "an unpaired drag_ended writes nothing")
	s.free()


## WO-604 slice 3: the live-input routing gestures are one server call each (kind + integer slot from the row).
func test_live_input_routing_requests() -> void:
	var dl := {"key": "input:4", "ch": 4.0, "layer": 1.0, "isLiveInput": true, "inputKind": "decklink", "slot": 1.0}
	var la := {"key": "input:9", "ch": 9.0, "layer": 10.0, "isLiveInput": true, "inputKind": "live_audio", "slot": 2.0}
	var ndi := {"key": "input:11", "ch": 11.0, "layer": 1.0, "isLiveInput": true, "inputKind": "ndi_host", "slot": 1.0}
	t.ok(AA.routed(dl) and not AA.routed(la) and not AA.routed(ndi), "Ch buttons + send policy: DeckLink / v4l2 only")
	t.ok(AA.startable(dl) and AA.startable(la) and not AA.startable(ndi), "START: DeckLink / live audio")
	t.ok(not AA.routed({"key": "pgm:1", "isMaster": true}), "never a master")
	t.eq(AA.route_request(dl, 1, true), ["POST", "/api/audio/inputs/route", {"kind": "decklink", "slot": 1, "channel": 1, "on": true}])
	t.eq(AA.send_request(dl, "always"), ["POST", "/api/audio/inputs/send", {"kind": "decklink", "slot": 1, "send": "always"}])
	t.eq(AA.start_request(la), ["POST", "/api/audio/inputs/start", {"kind": "live_audio", "slot": 2}])
	t.eq(AA.auto_mix_request(false), ["POST", "/api/audio/auto-mix", {"on": false}])
	t.eq(AA.audio_only_stop_request({"ch": 1.0, "isAudioOnlyLook": true}), ["POST", "/api/scene/audio-only/stop", {"channel": 1}])
	var snap := {"autoMix": true, "inputs": [{"key": "input:5", "targets": []}, {"key": "input:4", "send": "always", "targets": [1.0]}]}
	t.eq(AA.routing_entry(snap, dl).get("send"), "always", "matched by strip key")
	t.eq(AA.routing_entry(snap, la), {}, "no entry → {}")
	t.eq(AA.routing_entry(null, dl), {}, "no snapshot yet")


func test_cross_screen_requests() -> void:
	var look := {"key": "l:1:12", "ch": 1.0, "layer": 12.0, "sceneId": "sc1", "audioScreens": [3.0, {"channel": 5}, 3, "x"]}
	var tl := {"key": "t:1:210", "ch": 1.0, "layer": 210.0, "sceneId": null}
	t.ok(AA.cross_screen(look) and not AA.cross_screen(tl), "Screens row: look layers only")
	t.ok(not AA.cross_screen({"sceneId": "x", "isMaster": true}) and not AA.cross_screen({"sceneId": ""}), "never a master / empty id")
	t.eq(AA.cross_screen_targets(look), [3, 5], "ints, deduped, sorted, junk dropped")
	t.eq(AA.cross_screen_targets(tl), [])
	t.eq(AA.cross_screen_plan_request([look, tl]), ["POST", "/api/audio/cross-screen/plan", {"sources": [{"channel": 1, "layer": 12}]}])
	t.eq(AA.cross_screen_request(look, 3, false), ["POST", "/api/audio/cross-screen",
		{"channel": 1, "layer": 12, "target": 3, "enable": false, "current": [3, 5]}])
	var plan := {"sources": [{"channel": 1.0, "layer": 12.0, "buttons": [{"channel": 3.0, "ok": true}]}]}
	t.eq(AA.cross_screen_buttons(plan, look).size(), 1, "matched by channel-layer")
	t.eq(AA.cross_screen_buttons(plan, tl), [], "no entry")
	t.eq(AA.cross_screen_buttons(null, look), [], "no plan yet")
