extends RefCounted
## WO-605 slice 3 — host_channels.gd against golden values from the web modules (device-view-host-channels.js and
## -inputs.js, planned-channel-map.js, input-channels.js, roleLabel / destinationRectLabel) run under Node on seven
## payloads (dedicated / shared / MVR / order-host DeckLink, planned-vs-live renumbering, settings-only slots,
## empty): tests/golden/devices_host_channels.json.

const H := preload("res://features/devices/host_channels.gd")
const M := preload("res://features/devices/devices_model.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_host_channels.json"))
	return _g


## JSON has one number type; Godot's Dictionary == tells 5 from 5.0. Compare as JSON would.
static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


func _eq(actual: Variant, expected: Variant, what: String) -> void:
	t.eq(_norm(actual), _norm(expected), what)


func test_all_destinations_per_payload() -> void:
	var g := _golden()
	for k in g.cases:
		var got := H.all_destinations(g.cases[k])
		_eq(got, g.all[k], "all " + k)


func test_destination_ids() -> void:
	for row in _golden().hostIds:
		var a: Array = row[0]
		_eq(H.destination_id(a[0], a[1], a[2] if a.size() > 2 else null), row[1], "id %s" % [a])


func test_default_labels() -> void:
	for row in _golden().labels:
		var r: Dictionary = row[0]
		var role := str(r.get("role", ""))
		_eq(H.default_label(role, r.get("ch"), r.get("slot"), r.get("label"), r.get("sourceId")), row[1], "label %s" % [r])


func test_normalize() -> void:
	for row in _golden().norm:
		var d := H.normalize(row[0])
		_eq(d if not d.is_empty() else null, row[1], "normalize %s" % [row[0]])


func test_planned_badge() -> void:
	for row in _golden().planned:
		t.eq(H.channel_planned(row[0], row[1]), row[2], "planned %s" % [row[0]])


func test_role_and_rect_labels() -> void:
	var g := _golden()
	for r in g.roles:
		t.eq(H.role_label(r, 1), g.roles[r], "role " + r)
	for row in g.rect:
		t.eq(M.dest_sub(row[0]), row[1], "rect %s" % [row[0]])


func test_merge_settings_and_live_map_override() -> void:
	var p := {"live": {"caspar": {"channelMap": {"inputsCh": 4, "decklinkCount": 1}}},
		"screenDestinations": {"destinations": []}}
	t.eq(H.merge_settings(p, null), p, "no settings → payload untouched")
	var m := H.merge_settings(p, {"channelMap": {"decklinkCount": 1, "inputsCh": 6}})
	t.eq(m.settings.channelMap.inputsCh, 6, "channelMap rides along")
	t.eq(m.settings.casparServer, m._settings, "settings without casparServer is the block itself")
	# planned == live counts but a live map from the store wins over the snapshot (getAppStateStore channelMap).
	var live := {"decklinkCount": 1, "inputsCh": 9, "liveAudioCount": 0}
	t.eq(H.channel_map(p, live).inputsCh, 9, "store channelMap wins")
	t.eq(H.channel_map(p, null).inputsCh, 4, "snapshot map without a store map")
