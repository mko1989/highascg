extends RefCounted
## WO-608 header slice 2 — badge / chip / menu / config-strip mapping (server shapes: GET /api/streaming-channel,
## /api/replication/status, state.channelMap, state.configComparison).

const M := preload("res://app/header_badges_model.gd")
var t


func test_active_flag_and_output_live() -> void:
	t.eq([M.active_flag(true), M.active_flag(1), M.active_flag("Running"), M.active_flag("off"), M.active_flag(null)], [true, true, true, false, false], "parseActiveFlag")
	t.eq(M.output_live({"active": true, "activeOutputs": ["rec_1"]}, "rec_1"), true, "listed")
	t.eq(M.output_live({"active": true, "activeOutputs": ["rec_2"]}, "rec_1"), false, "another output")
	t.eq(M.output_live({"active": true, "activeOutputs": [], "outputId": "rec_1"}, "rec_1"), true, "single outputId")
	t.eq(M.output_live({"active": false, "activeOutputs": ["rec_1"]}, "rec_1"), false, "inactive")


func test_stream_badges() -> void:
	var rec := [{"id": "rec_1", "label": "Rec1", "enabled": true, "name": "Rec1"}, {"id": "rec_2", "enabled": false}, {"id": ""}]
	var str_out := [{"id": "stream_3", "name": "YouTube"}]
	var idle := M.stream_badges(str_out, rec, {"rtmp": {"active": false}, "record": {"active": false}})
	t.eq(idle.map(func(b: Dictionary) -> Array: return [b.label, b.tone]), [["Y3", "idle"], ["R1", "idle"]], "name initial + number; rec* → R<n>; disabled / id-less skipped")
	t.eq(idle[1].tip, "Rec1 (idle)", "idle tip")
	var on := M.stream_badges([], rec, {"record": {"active": true, "activeOutputs": ["rec_1"], "path": "/media/rec/a.mp4"}})
	t.eq([on[0].tone, on[0].tip], ["live", "Rec1 is recording (/media/rec/a.mp4)"], "recording")
	t.eq(M.stream_badges(null, null, null), [], "nothing configured")


func test_replication_badge() -> void:
	var standalone := {"enabled": false, "role": "standalone", "leaderAvailable": false, "peer": {"host": "", "port": 4200}}
	t.eq(M.replication_badge(standalone), {}, "box today: no badge")
	t.eq(M.replication_badge({"enabled": false, "leaderAvailable": true}).tone, "available", "leader on offer")
	var f := M.replication_badge({"enabled": true, "role": "follower", "peerLinkReady": true, "peer": {"host": "10.0.0.2"}})
	t.eq([f.label, f.tone, f.tip], ["F", "active", "Follower — linked to 10.0.0.2"], "linked follower")
	var l := M.replication_badge({"enabled": true, "role": "leader", "peerLinkReady": false, "peerReachable": true, "peerSelfId": "highascg0002", "peer": {"host": ""}})
	t.eq([l.label, l.tone, l.tip], ["L", "pending", "Leader — waiting for follower (highascg0002)…"], "peerLinkReady wins over peerReachable")
	t.eq(M.replication_badge(null), {}, "poll failed")


func test_timer_chips() -> void:
	var one := M.timer_chips({"programChannels": [1], "screenLabels": ["Main LED (DP-7)"]})
	t.eq(one, [{"main": 0, "channel": 1, "label": "Mai", "tip": "Show playback timer for Main LED (DP-7) (channel 1)"}], "3-letter shorthand (WO-506)")
	var two := M.timer_chips({"programChannels": [1, 3], "playbackChannels": [], "screenLabels": ["", "Side"]})
	t.eq(two.map(func(c: Dictionary) -> Array: return [c.channel, c.label]), [[1, "S1"], [3, "Sid"]], "unnamed → S<n>; empty playbackChannels → program")
	t.eq(M.timer_chips({"playbackChannels": [5]})[0].channel, 5, "playbackChannels win")


func test_monitor_options() -> void:
	var box := {"programChannels": [1], "previewChannels": [2], "monitorCh": null, "audioPreview": {"enabled": false}, "audioPreviewCh": null, "multiviewCh": null}
	t.eq(M.monitor_options(box).options, [], "no monitor bus → no menu")
	var mon := M.monitor_options({"programChannels": [1], "previewChannels": [2], "monitorCh": 7, "multiviewCh": 4})
	t.eq([mon.title, mon.options.map(func(o: Dictionary) -> String: return o.id)], ["Server hardware monitor", ["pgm_1", "prv_1", "multiview"]], "hardware monitor")
	var pv := M.monitor_options({"audioPreview": {"enabled": "true", "bus": "preview_1", "defaultSource": "preview_1"}, "audioPreviewCh": 6})
	t.eq([pv.title, pv.note], ["Headphones (preview bus)", "Solo routes to ch 6 (preview_1). Clear solo restores preview_1."], "preview bus")


func test_config_strip() -> void:
	var ok := M.config_strip({"aligned": true, "serverChannelCount": 8.0, "moduleChannelCount": 8.0,
		"serverChannels": [{"index": 1.0, "videoMode": "1080p5000", "hasScreen": true}], "moduleChannels": [{"index": 1.0, "role": "pgm", "videoMode": "1080p5000"}, {"index": 2.0, "role": "prv", "videoMode": "1080p5000"}]})
	t.eq([ok.ok, ok.summary], [true, "Server config matches module settings (8 channels)."], "aligned")
	t.eq(ok.rows, [["1", "pgm: 1080p5000", "1080p5000 (screen)"], ["2", "prv: 1080p5000", "—"]], "rows padded to the longer side")
	var bad := M.config_strip({"aligned": false, "serverChannelCount": 3, "moduleChannelCount": 4, "screensCountMismatch": true,
		"serverPhysicalScreens": [{"index": 1}], "moduleScreenCount": 2, "issues": ["x"], "hint": "Apply"})
	t.eq(bad.summary, "Mismatch: server has 3 channel(s), module expects 4. Caspar screen outputs: 1 (ch 1). App screens: 2. Screen count differs from app — check multiview or extra screen consumers.", "mismatch")
	t.eq([bad.ok, bad.issues, bad.hint], [false, ["x"], "Apply"], "issues + hint")
	t.eq(M.config_strip({"serverChannelCount": 0}).summary, "Connect to CasparCG or wait for INFO CONFIG to compare channel layout.", "no INFO CONFIG yet")
