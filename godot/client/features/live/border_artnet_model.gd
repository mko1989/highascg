extends RefCounted
## WO-601 — global border lighting input (Art-Net / sACN), pure port of client/lib/global-border-artnet-map.js
## (golden-tested): the 18 DMX offsets from artnetPatch.startChannel, the per-offset "desk drives it" map, and
## mergeArtnetBorderRuntime — how a `global_border_sync` (DMX-driven runtime) lands on the local slot.

const COUNT := 18
const LABELS := ["On/Off", "Effect type", "Opacity", "Color red", "Color green", "Color blue", "Width / thickness", "Speed",
	"Spread / blur", "Glow red", "Glow green", "Glow blue", "Radius", "Count (edge strip)", "Length (edge strip)",
	"Segments per edge", "Segment ease", "Segmentation mode"]
## [offset of the gate, remote param keys copied when that offset is on] (colour triples handled separately)
const SIMPLE := [[2, ["opacity"]], [6, ["width", "thickness", "intensity"]], [7, ["speed", "pulseSpeed"]], [8, ["spread", "blur"]],
	[12, ["radius"]], [13, ["count"]], [14, ["length"]], [15, ["segments"]], [16, ["segmentEase"]], [17, ["segmentationMode"]]]


## normalizeArtnetChannelMap: only an explicit `false` turns an offset off.
static func normalize_map(m: Variant) -> Array:
	var out: Array = []
	for i in COUNT:
		out.append(not (m is Array and i < (m as Array).size() and m[i] is bool and m[i] == false))
	return out


static func _rgb(c: Variant) -> Variant:
	var s := str(c if c != null else "").strip_edges().trim_prefix("#")
	if s.length() != 6 or not s.is_valid_hex_number():
		return null
	var n := s.hex_to_int()
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]


static func _merge_color(local_c: Variant, remote_c: Variant, m: Array, off: int) -> String:
	var l: Variant = _rgb(local_c)
	if l == null:
		l = [230, 57, 70]
	var r: Variant = _rgb(remote_c)
	if r == null:
		r = l
	return "#%02x%02x%02x" % [r[0] if m[off] else l[0], r[1] if m[off + 1] else l[1], r[2] if m[off + 2] else l[2]]


## mergeArtnetBorderRuntime(local, remote, channelMap) → {enabled, type, fadeDuration, params}
static func merge_runtime(local: Dictionary, remote: Dictionary, channel_map: Variant) -> Dictionary:
	var m := normalize_map(channel_map)
	var lp: Dictionary = (local.params as Dictionary).duplicate() if local.get("params") is Dictionary else {}
	lp["side"] = "inside"
	var rp: Dictionary = remote.params if remote.get("params") is Dictionary else {}
	var out := {}
	var pick := func(key: String, gate: bool) -> void:
		var v: Variant = remote.get(key) if gate and remote.has(key) else local.get(key)
		if v != null:
			out[key] = v
	pick.call("enabled", m[0])
	pick.call("type", m[1])
	if local.get("fadeDuration") != null:
		out["fadeDuration"] = local.fadeDuration
	var params := lp.duplicate()
	for g in SIMPLE:
		if m[g[0]]:
			for k in g[1]:
				if rp.has(k) and rp[k] != null:
					params[k] = rp[k]
	if m[3] or m[4] or m[5]:
		params["color"] = _merge_color(lp.get("color"), rp.get("color"), m, 3)
	if m[9] or m[10] or m[11]:
		params["glowColor"] = _merge_color(lp.get("glowColor"), rp.get("glowColor"), m, 9)
	out["params"] = params
	return out


## web applyRemoteGlobalBorderSlot(…, {source: 'artnet'}) for a configured slot: ignored unless listening;
## runtime fields merged, everything else (slices, config, presets, snapshot) kept.
static func apply_sync(local: Variant, remote: Dictionary) -> Variant:
	if not (local is Dictionary) or (local as Dictionary).get("artnetListenEnabled") != true:
		return local
	var out: Dictionary = (local as Dictionary).duplicate(true)
	out.merge(merge_runtime(local, remote, local.get("artnetChannelMap")), true)
	return out
