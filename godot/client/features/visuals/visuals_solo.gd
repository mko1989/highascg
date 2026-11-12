extends Node
## WO-1051 — Visuals layers as their own Live sources (owner 13.11: "pick layers from the live tab of the sources, when the shm
## visuals are on, give me layers to pick and stack them on look layers"). `project.visuals.output.solo` lists 1-based stack
## positions (visuals_model.gd solo_of): while the canvas is a Live source (output.ring, WO-883) each one is drawn into its own
## transparent composite instead of the canvas (visuals_deck.gd / visuals_mixer.gd set_solo) and published here as shm ring
## `<ring>-L<n>` (visuals_model.gd solo_ring) at the main ring's rate. Positions, not scenes: an APC pad that swaps what plays
## on a slot changes what that ring shows. Sources ▸ Live lists the positions under the `visuals` row
## (features/live/visuals_solo_rows.gd): a drag makes one solo, its toggle ends it.
## A ring that stops being wanted (solo off, Live source off) keeps publishing transparent frames for `drain_s` before it
## closes — Caspar's shm producer holds the last frame (shm_producer.cpp), so a look playing it goes clear, not frozen.
## A position past the stack keeps its ring, transparent: a look may still play it. Lives under the tab (visuals_tab.gd,
## 500-line limit): _sync_ring() calls sync(). GPU: one canvas-size readback per solo position, only while it runs.

const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Publisher := preload("res://features/shm_out/viewport_publisher.gd")

signal changed  # the solo list or a ring's state changed

var tab: Node
var pubs := {}  # position → its publisher (start(vp, ring, fps) -> "", stop(), sink)
var note := ""  # why a solo ring could not start ("" = fine)
var drain_s := 1.0  # seconds of transparent frames before a ring that is no longer wanted closes (tests: 0)
var make_publisher := func() -> Node: return Publisher.new()  # tests put a stand-in here
var publish_check := func() -> String: return tab.can_publish()  # "" when this client can write rings
var _draining := {}  # position → the drain's token (a newer sync() for the same position cancels it)
var _seq := 0


func _init(t: Node) -> void:
	tab = t
	name = "VisualsSolo"
	t.add_child(self)


## The page's Output edit (screen, layer, size, Live source) replaces `slice.output`: the solo list rides along.
func keep(prev: Dictionary, o: Dictionary) -> Dictionary:
	if prev.has("solo"):
		o = o.duplicate()
		o.solo = prev.solo
	return o


## The stored solo positions (whether or not the canvas is a Live source).
func positions() -> Array:
	var o: Variant = tab.slice.get("output")
	return M.solo_of(o.get("solo") if o is Dictionary else null)


## The canvas is a Live source (Visuals ▸ Output ▸ Live source).
func live_source() -> bool:
	return tab.slice.get("output") is Dictionary and tab.slice.output.get("ring") == true


## The positions solo right now: only while a Live source (else every layer is in the canvas and the list waits).
func active() -> Array:
	return positions() if live_source() else []


func ring(n: int) -> String:
	return M.solo_ring(str(tab.ring_name), n)


## Position `n` solo on / off: stored with the slice (autosave + undo) and the rings brought in line.
func set_solo(n: int, on: bool) -> void:
	var ps := positions()
	if n < 1 or n > L.MAX or (n in ps) == on:
		return
	if on:
		ps.append(n)
	else:
		ps.erase(n)
	ps = M.solo_of(ps)
	if ps.is_empty():
		(tab.slice.output as Dictionary).erase("solo")
	else:
		tab.slice.output.solo = ps
	tab._store()
	sync()


## The layer stack of the bank on the canvas, bottom → top (A/B: the crossfader's side; else the one stack).
func air_layers() -> Array:
	var dj: Variant = tab.get("dj")
	var other: bool = dj != null and bool(dj.get("on")) and tab.slice.get("dj") is Dictionary \
		and tab.slice.dj.get("other") is Dictionary and tab.mixer.air() != tab.mixer.live
	var ls: Variant = tab.slice.dj.other.get("layers") if other else tab.slice.get("layers")
	return ls if ls is Array else []


## Decks, mixes and rings in line with active(); safe to call any time.
func sync() -> void:
	var want := active()
	for n in want:
		_draining.erase(n)  # wanted again before its drain ended: the same ring keeps going
	for n in pubs.keys():
		if not n in want and not _draining.has(n):
			_drain(n)
	tab.mixer.set_solo(want, _draining.keys())
	note = ""
	for n in want:
		if pubs.has(n):
			continue
		var why: String = publish_check.call()
		if why == "":
			var p: Node = make_publisher.call()
			add_child(p)
			why = p.start(tab.mixer.solo_out[n], ring(n), int(tab._fps()))
			if why == "":
				pubs[n] = p
			else:
				remove_child(p)
				p.queue_free()
		if why != "":
			note = why
	_badges(want)
	changed.emit()


func _drain(n: int) -> void:
	_seq += 1
	var token := _seq
	_draining[n] = token
	if drain_s > 0.0 and is_inside_tree():
		await get_tree().create_timer(drain_s).timeout
	if _draining.get(n) != token:
		return  # solo again (or a newer drain)
	_draining.erase(n)
	var p: Node = pubs.get(n)
	pubs.erase(n)
	if p != null:
		p.stop()
		remove_child(p)
		p.queue_free()
	tab.mixer.set_solo(active(), _draining.keys())
	changed.emit()


## The Visuals layer list's `L<n>` badges (why a layer is missing from the canvas).
func _badges(want: Array) -> void:
	var page: Variant = tab.get("page")
	if page != null and page.get("layer_list") != null:
		page.layer_list.set_solo(want)
