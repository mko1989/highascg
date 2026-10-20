extends RefCounted
## WO-600 O — pure port of the PGM top-layer timer rules (client/components/playback-timer.js +
## playback-timer-format.js): which layer counts, labels, formats, traffic-light tiers. The server's
## `osc` WS snapshots already carry file.elapsed/remaining/duration/progress (endian-correct since WO-613).

const TIMER_BAND := [980, 989]
const BORDER_LAYER := 998
const STALE_MS := 12000
const COLORS := {
	"muted": {"bar": Color("#666"), "fill": Color("#888"), "text": Color("#aaa")},
	"green": {"bar": Color("#1a3d1a"), "fill": Color("#2ecc71"), "text": Color("#cfe")},
	"orange": {"bar": Color("#4d3319"), "fill": Color("#e67e22"), "text": Color("#fdebd0")},
	"red": {"bar": Color("#3d1a1a"), "fill": Color("#e74c3c"), "text": Color("#fcc")},
}


static func format_hmsf(sec: float, fps: float) -> String:
	if is_nan(sec) or is_inf(sec) or sec < 0.0:
		return "--:--:--:--"
	var f := fps if not is_nan(fps) and fps > 0.0 else 50.0
	var h := int(floor(sec / 3600.0))
	var m := int(floor(fmod(sec, 3600.0) / 60.0))
	var s := int(floor(fmod(sec, 60.0)))
	var ff := int(minf(f - 1.0, floor((sec - floor(sec)) * f)))
	return "%02d:%02d:%02d:%02d" % [h, m, s, ff]


static func format_mmss(sec: float) -> String:
	if is_nan(sec) or is_inf(sec) or sec < 0.0:
		return "--:--"
	return "%d:%02d" % [int(floor(sec / 60.0)), int(floor(fmod(sec, 60.0)))]


## Green > 10 s left, orange 5–10 s, red ≤ 5 s.
static func tier(remaining: Variant) -> String:
	if not (remaining is float or remaining is int) or is_nan(float(remaining)) or is_inf(float(remaining)):
		return "muted"
	var r := float(remaining)
	return "green" if r > 10.0 else ("orange" if r > 5.0 else "red")


static func truncate(s: String, max_len := 32) -> String:
	return s if s.length() <= max_len else s.substr(0, maxi(0, max_len - 1)) + "…"


static func file_label(f: Variant) -> String:
	if not (f is Dictionary):
		return ""
	var name := str(f.get("name", "")).strip_edges() if f.get("name") != null else ""
	if name != "":
		return truncate(name)
	var p: Variant = f.get("path")
	if p is String:
		var segs := (p as String).replace("\\", "/").split("/", false)
		if not segs.is_empty():
			return truncate(segs[segs.size() - 1])
	return ""


static func idle_label(ly: Variant) -> String:
	if not (ly is Dictionary):
		return ""
	var type := str(ly.get("type", "")).strip_edges() if ly.get("type") != null else ""
	if type == "empty":
		return ""
	var fl := file_label(ly.get("file"))
	if fl != "":
		return fl
	var tpl: Variant = ly.get("template")
	if tpl is Dictionary and tpl.get("path") != null and str(tpl.path).strip_edges() != "":
		var segs := str(tpl.path).replace("\\", "/").split("/", false)
		if not segs.is_empty():
			return truncate(segs[segs.size() - 1])
	return truncate(type) if type != "" else ""


static func has_playback_hints(f: Variant) -> bool:
	if not (f is Dictionary):
		return false
	for k in ["duration", "frameTotal"]:
		if _finite(f.get(k)) and float(f.get(k)) > 0.0:
			return true
	for k in ["elapsed", "frameElapsed"]:
		if _finite(f.get(k)) and float(f.get(k)) >= 0.0:
			return true
	return false


static func is_route_layer(ly: Variant) -> bool:
	if not (ly is Dictionary):
		return false
	if str(ly.get("type", "")).strip_edges().to_lower() == "route":
		return true
	var f: Variant = ly.get("file")
	if f is Dictionary:
		var n: Variant = f.get("name") if f.get("name") else f.get("path")
		return n is String and (n as String).strip_edges().to_lower().begins_with("route://")
	return false


static func is_stale(ly: Variant, now_ms: float) -> bool:
	var last := float(ly.get("_lastOscAt", 0)) if ly is Dictionary and _finite(ly.get("_lastOscAt")) else 0.0
	if last <= 0.0 or now_ms <= 0.0:
		return false
	return now_ms - last > STALE_MS


## {layer, state} of the topmost eligible layer: bank 'b' → 110-199, else 10-99; timer band, border,
## route layers and stale layers skipped. `want_running` = needs timing (else: any content, idle label).
static func pick_top_layer(channel: Variant, bank: Variant, now_ms: float, want_running := true) -> Dictionary:
	var none := {"layer": null, "state": null}
	if not (channel is Dictionary) or not (channel.get("layers") is Dictionary):
		return none
	var lo := 110 if bank == "b" else 10
	var hi := 199 if bank == "b" else 99
	var best := -1
	var best_state: Variant = null
	for key in (channel.layers as Dictionary):
		var s := str(key)
		if not s.is_valid_int():
			continue
		var n := s.to_int()
		if (n >= TIMER_BAND[0] and n <= TIMER_BAND[1]) or n == BORDER_LAYER or n < lo or n > hi:
			continue
		var ly: Variant = channel.layers[key]
		if is_route_layer(ly) or is_stale(ly, now_ms):
			continue
		var ok := has_playback_hints((ly as Dictionary).get("file")) if want_running else idle_label(ly) != ""
		if n > best and ok:
			best = n
			best_state = ly
	return {"layer": best, "state": best_state} if best >= 0 else none


## web osc-client mergeChannel: layer-level shallow merge, nested `file` merged too.
static func merge_channel(a: Variant, b: Variant) -> Dictionary:
	if not (b is Dictionary):
		return a if a is Dictionary else {}
	if not (a is Dictionary):
		return (b as Dictionary).duplicate(true)
	var o := (a as Dictionary).duplicate()
	o.merge(b as Dictionary, true)
	if (a as Dictionary).has("layers") or (b as Dictionary).has("layers"):
		var layers: Dictionary = (a.get("layers", {}) as Dictionary).duplicate()
		for k in (b.get("layers", {}) as Dictionary):
			var al: Dictionary = layers.get(k, {}) if layers.get(k) is Dictionary else {}
			var bl: Dictionary = b.layers[k]
			var merged := al.duplicate()
			merged.merge(bl, true)
			if al.get("file") is Dictionary and bl.get("file") is Dictionary:
				var f: Dictionary = (al.file as Dictionary).duplicate()
				f.merge(bl.file, true)
				merged["file"] = f
			layers[k] = merged
		o["layers"] = layers
	# WO-604: meter slots merge slot-wise (web osc-client mergeChannel), so a delta's fresh dBFS replaces a stale peak.
	var ba: Variant = (b as Dictionary).get("audio")
	if ba is Dictionary and ba.get("levels") is Array:
		var aa: Dictionary = a.get("audio") if a.get("audio") is Dictionary else {}
		var al: Variant = aa.get("levels")
		var audio := aa.duplicate()
		audio.merge(ba, true)
		var levels := []
		for i in (ba.levels as Array).size():
			var slot: Dictionary = (al[i] as Dictionary).duplicate() if al is Array and i < al.size() and al[i] is Dictionary else {}
			if ba.levels[i] is Dictionary:
				slot.merge(ba.levels[i], true)
			levels.append(slot)
		audio["levels"] = levels
		o["audio"] = audio
	return o


## PGM channel actually playing for main `i` (web refresh(): switcher_bus remap) + its layer bank.
static func resolve_pgm(cm: Dictionary, scene_state: Variant, main: int) -> Dictionary:
	var progs: Array = cm.get("programChannels", []) if cm.get("programChannels") is Array else []
	var ch := int(progs[main]) if main < progs.size() else main + 1
	var banks: Dictionary = (scene_state as Dictionary).get("programLayerBankByChannel", {}) if scene_state is Dictionary and (scene_state as Dictionary).get("programLayerBankByChannel") is Dictionary else {}
	var bank: Variant = null
	if str(cm.get("transitionModel", "")) == "switcher_bus":
		bank = banks.get(str(ch), "a")
		var buses: Variant = cm.get("switcherBusChannels") if bank == "b" else cm.get("switcherBus1Channels")
		if buses is Array and main < (buses as Array).size() and buses[main] != null:
			ch = int(buses[main])
	if bank == null:
		bank = banks.get(str(ch))
	return {"channel": ch, "bank": bank}


static func _finite(v: Variant) -> bool:
	return (v is float or v is int) and not is_nan(float(v)) and not is_inf(float(v))
