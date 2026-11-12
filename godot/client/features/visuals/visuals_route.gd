extends Node
## WO-1049 — Visuals output 2 (owner 12.11: "play for instance first 2 layers on the bg output pgm1 and layers 4 5 on overlay
## channel pgm2"). Each layer carries a route (visuals_layers.gd `out`, 1 | 2); the decks draw the output-2 layers into their
## transparent `out2` and the mixer mixes those into `out_vp2` (visuals_mixer.gd). This node puts that picture on air: while
## the Visuals are sent (the tab's Send) AND a deck draws into output 2, a second publisher writes `out_vp2` into shm ring
## `visuals-2` (premultiplied alpha, no black back) and `POST /api/play` plays it on output 2's program channel / layer
## (project.visuals.output2, M.output2_target). When no layer uses output 2 any more, or Send ends, the publisher stops and
## that one layer is STOPped. A changed output-2 target moves the PLAY (STOP old, PLAY new). Lives under the tab
## (visuals_tab.gd, 500-line limit); visuals_air.gd replays it after a Caspar restart (WO-914) and ends it on a New
## project (WO-919). The Live tab's expander (features/live/visuals_routing_panel.gd) edits routes and targets through
## set_layer_out() / set_output(): the Visuals tab's own edit paths, so autosave, undo, MIDI and the Visuals tab see them.
## GPU: one more readback at the canvas size, only while output 2 is on air.

const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Publisher := preload("res://features/shm_out/viewport_publisher.gd")

signal changed  # a route, a target or output 2's on-air state changed (the Live expander refreshes)

var tab: Node
var publisher: Node  # the output-2 ring writer (tests put a stand-in here: start(vp, ring, fps) -> "", stop(), sink)
var sending := {}  # {channel, layer} while output 2 is on air
var note := ""  # why output 2 is not on air although a layer is routed there ("" = fine)
var drain_s := 1.0  # Live-source ring: seconds of transparent frames before it stops (the shm producer holds the last)
var _busy := false
var _again := false


func _init(t: Node) -> void:
	tab = t
	name = "VisualsRoute"
	publisher = Publisher.new()
	add_child(publisher)
	t.add_child(self)
	t.mixer.out2_changed.connect(func(_on: bool) -> void: sync())


func ring() -> String:
	return M.ring2(str(tab.ring_name))


## {channel, layer} output 2 plays on now (channel 0 = no screen).
func target() -> Dictionary:
	return M.output2_target(tab._cm(), tab.slice)


## Output 2 belongs on air: the Visuals are sent and a deck draws into it.
func want() -> bool:
	return not tab.sending.is_empty() and tab.mixer.uses_out2()


## The `visuals-2` ring runs: a deck draws into output 2 and the canvas is on air (Send) OR a Live source (output.ring, WO-883 —
## the owner's way: `shm://visuals` on a look). As a Live source, `visuals-2` is listed in Sources ▸ Live for a PGM 2 look.
func want_ring() -> bool:
	return (live_source() or not tab.sending.is_empty()) and tab.mixer.uses_out2()


## The canvas is a Live source (Visuals ▸ Output ▸ Live source).
func live_source() -> bool:
	return tab.slice.get("output") is Dictionary and tab.slice.output.get("ring") == true


## What sync() does: "start" (publish + PLAY), "move" (STOP the old target, PLAY the new), "stop" (STOP + publisher off)
## or "" (nothing). Pure: `publishing` = the output-2 ring is open.
static func plan(wanted: bool, on_air: Dictionary, tg: Dictionary, publishing: bool) -> String:
	if not wanted or int(tg.get("channel", 0)) <= 0:
		return "stop" if not on_air.is_empty() or publishing else ""
	if on_air.is_empty():
		return "start"
	if int(on_air.channel) != int(tg.channel) or int(on_air.layer) != int(tg.layer):
		return "move"
	return ""


## Brings output 2 in line with want() / target(); safe to call any time (a call while one runs makes it run once more).
func sync() -> void:
	if _busy:
		_again = true
		return
	_busy = true
	_again = true
	while _again and is_instance_valid(tab):
		_again = false
		await _step()
	_busy = false
	changed.emit()


func _step() -> void:
	var tg := target()
	var wanted := want()
	var ring_on := want_ring()
	var what := plan(wanted, sending, tg, publisher.sink != null and not ring_on)
	note = "Output 2: no screen destination." if wanted and int(tg.channel) <= 0 else ""
	var played := not sending.is_empty()
	if what == "stop" or what == "move":
		if played and _api() != null:
			await _api().post_json("/api/stop", M.stop_body(int(sending.channel), int(sending.layer)))
		sending = {}
	if not ring_on and publisher.sink != null:
		if not played and drain_s > 0.0:  # a Live source on someone's look: Caspar holds the last frame — let it go transparent
			await tab.get_tree().create_timer(drain_s).timeout
			if want_ring():
				return
		publisher.stop()
	elif ring_on and publisher.sink == null:
		var why: String = tab.can_publish()
		if why == "":
			why = publisher.start(tab.mixer.out_vp2, ring(), _fps(tg))
		if why != "":
			note = why
			return
	if what != "start" and what != "move":
		return
	var r: Dictionary = await _api().post_json("/api/play", M.play_body(int(tg.channel), int(tg.layer), ring()))
	if r.get("ok"):
		sending = {"channel": int(tg.channel), "layer": int(tg.layer)}
	else:
		note = "Output 2 PLAY failed: %s" % str(r.get("error", r.get("status", "")))
		if not live_source():
			publisher.stop()


## WO-914: Caspar's AMCP link came back — PLAY output 2 again (the ring never stopped).
func replay() -> void:
	if sending.is_empty() or _api() == null:
		return
	var r: Dictionary = await _api().post_json("/api/play", M.play_body(int(sending.channel), int(sending.layer), ring()))
	print("[visuals] Caspar reconnected: output 2 again to %d-%d — %s" % [sending.channel, sending.layer, "ok" if r.get("ok") else str(r)])


## WO-919 F11: the server cleared the show — output 2 is over without a STOP (the channels belong to the new show).
func end() -> void:
	sending = {}
	publisher.stop()
	note = ""
	changed.emit()


## The layer stack of the bank on the canvas (A/B: the crossfader's side; else the Visuals' one stack), bottom → top.
func air_layers() -> Array:
	return (tab.slice.dj.other.layers if _air_is_other() else tab.slice.layers) as Array


## Layer `i` of the bank on the canvas to output `out` (1 | 2). The edited bank goes through the Visuals page's own edit path
## (layers_changed: in place on the live deck, stored, the page refreshed); the other A/B bank is stored in slice.dj.other and
## re-applied onto its deck like visuals_dj.gd does. Either way only the draw rect moves — nothing restarts (L.key).
func set_layer_out(i: int, out: int) -> void:
	if i < 0 or i >= air_layers().size() or L.out_of(air_layers()[i]) == out:
		return
	if _air_is_other():
		tab.slice.dj.other.layers = L.routed(tab.slice.dj.other.layers, i, out)
		tab.dj._load_other()
		tab._store()
	else:
		tab.page.layers_changed.emit(L.routed(tab.slice.layers, i, out))
	sync()


## Output `n`'s target. Output 1 goes through the Visuals page's own Output path (like its Screen / Layer pickers: a running
## Send stays where it is until sent again); output 2 is stored and, when on air, moved at once.
func set_output(n: int, screen: int, layer: int) -> void:
	if n == 2:
		tab.slice.output2 = M.output2_of({"screen": screen, "layer": layer})
		tab._store()
	else:
		var o: Dictionary = (tab.slice.output as Dictionary).duplicate()
		o.screen = maxi(0, screen)
		o.layer = clampi(layer, 1, 9999)
		tab.page.output_changed.emit(o)
		tab.page.set_state(tab.slice, tab._cm())
	sync()


func _air_is_other() -> bool:
	return tab.dj.on and tab.slice.get("dj") is Dictionary and tab.mixer.air() != tab.mixer.live


func _api() -> Variant:
	if tab.replay_api != null:
		return tab.replay_api
	var dt: Node = tab._g("DevicesTarget")
	return dt.box_api if dt != null else null


## The ring's rate: output 2's screen's channel rate (programResolutions), 50 when unknown.
func _fps(_tg: Dictionary) -> int:
	var cm: Variant = tab._cm()
	var res: Array = cm.get("programResolutions", []) if cm is Dictionary and cm.get("programResolutions") is Array else []
	var i := int(M.output2_of(tab.slice.get("output2")).screen)
	i = i if i < res.size() else 0
	return int(res[i].get("fps", 50)) if i < res.size() and res[i] is Dictionary else 50
