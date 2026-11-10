extends RefCounted
## WO-1029 C15 — core/screen_channels.gd with the real hole maps of the two linked boxes.

const SC := preload("res://core/screen_channels.gd")
var t

const A := {"screenCount": 4, "channelsWhereCabled": true, "programChannels": [2, null, null, null], "previewChannels": [3, null, null, null],
	"screenHosts": [{"idx": 0, "destId": "d0", "here": true}, {"idx": 1, "destId": "d1", "here": false}, {"idx": 2, "destId": "d2", "here": false}, {"idx": 3, "destId": "d3", "here": false}]}
const B := {"screenCount": 4, "channelsWhereCabled": true, "programChannels": [null, null, 2, 4], "previewChannels": [null, null, 3, 5]}
const CLUSTER := {"self": {"id": "highascg7579", "hostname": "highascg7579"}, "peers": [{"id": "highascg5867", "name": "highascg5867"}]}


func test_pgm_prv_holes() -> void:
	t.eq([SC.pgm(A, 0), SC.pgm(A, 1), SC.pgm(A, 9), SC.pgm(A, -1)], [2, -1, -1, -1], "box A pgm")
	t.eq([SC.prv(A, 0), SC.prv(A, 2)], [3, -1], "box A prv")
	t.eq([SC.pgm(B, 0), SC.pgm(B, 2), SC.pgm(B, 3), SC.prv(B, 3)], [-1, 2, 4, 5], "box B")
	t.eq(SC.pgm({}, 0), -1, "empty map")
	t.eq(SC.pgm(null, 0), -1, "null map")


func test_here_and_lists() -> void:
	t.eq(SC.local_screens(A), [0], "A local")
	t.eq(SC.remote_screens(A), [1, 2, 3], "A remote")
	t.eq(SC.local_screens(B), [2, 3], "B local without screenHosts")
	t.eq(SC.first_local(B), 2, "B first")
	t.eq(SC.first_local({"screenCount": 2, "channelsWhereCabled": true, "programChannels": [null, null]}), -1, "none here")
	t.eq(SC.is_here(A, 1), false, "A screen 2 remote")
	var legacy := {"screenCount": 2, "programChannels": [2, 4], "previewChannels": [3, 5]}
	t.eq(SC.local_screens(legacy), [0, 1], "flag off: all here")
	t.eq(SC.is_here({}, 0), true, "no map: legacy")


func test_screen_of_channel() -> void:
	t.eq([SC.screen_of_channel(B, 4), SC.screen_of_channel(B, 3), SC.screen_of_channel(B, 1), SC.screen_of_channel(A, -1)], [3, 2, -1, -1], "channel to screen")


func test_host_and_cue() -> void:
	t.eq(SC.host(A, 1, CLUSTER).name, "highascg5867", "single peer is the owner")
	t.eq(SC.cue(A, 1, CLUSTER), "on highascg5867", "cue")
	t.eq(SC.cue(A, 0, CLUSTER), "", "here: no cue")
	t.eq(SC.cue(A, 1, null), "on another server", "no cluster known")
	var m := A.duplicate(true)
	m.screenHosts[1]["owners"] = ["highascg5867"]
	t.eq(SC.host(m, 1, CLUSTER).owners, ["highascg5867"], "owners from map")
	t.eq(SC.disabled_tip(A, 2, CLUSTER), "This screen is on highascg5867 — drive it from there.", "tip")


func test_remote_note() -> void:
	t.eq(SC.remote_note(A, CLUSTER), "Screens 2, 3, 4 are on highascg5867", "box A")
	t.eq(SC.remote_note(B, CLUSTER), "Screens 1, 2 are on highascg5867", "box B")
	t.eq(SC.remote_note({"screenCount": 2, "programChannels": [2, 4]}, CLUSTER), "", "legacy: nothing")


func test_cue_hint_and_dest() -> void:
	t.eq(SC.cue(A, 2, CLUSTER, "box-z"), "on box-z", "owner's own name wins")
	t.eq(SC.screen_of_dest(A, "d2", -1), 2, "dest to screen")
	t.eq(SC.screen_of_dest(A, "nope", 7), 7, "fallback")
