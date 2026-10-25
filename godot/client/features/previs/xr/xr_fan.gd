extends RefCounted
## WO-774 (detachable, WO-741) — owner 25.10: "There are two buttons under fingers the one that is pointing fixtures is
## good the second one should change their fan." The right grip (middle finger) held: moving the controller fans the
## selection's pan (sideways) and tilt (up / down) — xr_walk_model.gd fan_*. A fan works on Pan / Tilt as programmed:
## Point at (the server's follow IK) is one-shot — it programs Pan / Tilt and keeps no aim point — so after an aim the
## fan spreads the beams around where they point. Values go out as ordinary programmer writes (POST
## /api/fixtures/program, one per fixture: each gets its own value), one round in flight, the newest spread winning
## (as aim_drag.gd). The release announces `sel.aimed`, so the Programmer's sliders follow.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")

var sel: RefCounted = Sel.shared()
var get_json: Callable  ## (path) → awaitable {ok, data}; the walk passes Api.get_json
var post_json: Callable  ## (path, body) → awaitable; the walk passes Api.post_json
var active := false
var bases: Array = []  # Walk.fan_bases at the grip press
var _spread := Vector2.ZERO
var _axes := {}  # "Pan" / "Tilt" once the hand has moved along it (an untouched axis is never written)
var _busy := false
var _dirty := false
var _gen := 0


## Grip down: what the selection's pan / tilt are now (their ranges and programmed values).
func start() -> void:
	_gen += 1
	var gen := _gen
	active = true
	bases = []
	_spread = Vector2.ZERO
	_axes = {}
	var ids: Array = sel.ids.duplicate()
	if ids.is_empty() or not get_json.is_valid():
		return
	var res: Dictionary = await get_json.call("/api/fixtures/program/features?ids=" + ",".join(ids).uri_encode())
	var cur: Dictionary = await get_json.call("/api/fixtures/program")
	if gen != _gen:
		return
	var feats: Dictionary = res.data.get("fixtures", {}) if res.get("ok") and res.get("data") is Dictionary else {}
	var values: Dictionary = cur.data.get("values", {}) if cur.get("ok") and cur.get("data") is Dictionary else {}
	bases = Walk.fan_bases(ids, feats, values)
	if active and not _axes.is_empty():
		_send()  # the hand moved while the values were on their way


## The spread this frame (Vector2(pan, tilt) degrees, Walk.fan_move).
func move(spread: Vector2) -> void:
	if not active or spread == _spread:
		return
	_spread = spread
	if spread.x != 0.0:
		_axes["Pan"] = true
	if spread.y != 0.0:
		_axes["Tilt"] = true
	if not _axes.is_empty():
		_send()


## Grip up: the fan stays where it is.
func end() -> void:
	if not active:
		return
	active = false
	if not _busy and not _axes.is_empty():
		sel.aimed.emit()


func _send() -> void:
	_dirty = true
	if _busy or bases.is_empty() or not post_json.is_valid():
		return
	_busy = true
	while _dirty:
		_dirty = false
		var vals := Walk.fan_values(bases, _spread, _axes.keys())
		for id in vals:
			await post_json.call("/api/fixtures/program", {"ids": [id], "values": vals[id]})
	_busy = false
	if not active:
		sel.aimed.emit()
