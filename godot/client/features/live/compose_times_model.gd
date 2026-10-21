extends RefCounted
## WO-652 — per-layer times on the Live 2D compose windows. A port of the multiview overlay's "Layer timers stack"
## (template/multiview_overlay.js, WO-195 / WO-203 highlightTopTimer): one row per layer of the look on that bus, top
## layer first; the topmost running layer is the big one. Pure, so it tests headless.

const P := preload("res://features/live/pgm_timer_model.gd")
const PIP_TEMPLATES := ["pip_border", "pip-border", "pip_shadow", "pip-shadow", "pip_edge_strip", "pip-edge-strip",
	"pip_glow", "pip-glow", "pip_router", "pip-router"]


## [{num, label, running, elapsed, duration, top}] for `look` on `channel` (an OSC mirror channel). PGM layers sit
## +100 on bank 'b'; PRV is bank-less (physical = logical, WO-195.4). Stale OSC counts as not running.
static func rows(look: Dictionary, channel: Variant, bank: Variant, is_pgm: bool, now_ms: float) -> Array:
	var osc: Dictionary = channel.get("layers") if channel is Dictionary and channel.get("layers") is Dictionary else {}
	var out := []
	for l in (look.get("layers") if look.get("layers") is Array else []):
		if not (l is Dictionary) or not ((l as Dictionary).get("source") is Dictionary):
			continue
		var src: Dictionary = l.source
		var value := str(src.get("value", ""))
		if value == "" or value.contains("playback_timers.html") or _is_pip(value):
			continue
		var num := int(l.get("layerNumber", 0))
		var ly: Variant = osc.get(str(num + 100 if is_pgm and bank == "b" else num))
		if ly is Dictionary and P.is_stale(ly, now_ms):
			ly = null
		var f: Dictionary = ly.file if ly is Dictionary and (ly as Dictionary).get("file") is Dictionary else {}
		var dur := _num(f.get("duration"))
		var playing := str(f.get("name", "")) if str(f.get("name", "")) != "" else str(f.get("path", ""))
		out.append({"num": num, "label": "L%d  %s" % [num, _base(playing) if playing != "" else source_name(src)],
			"running": dur > 0.0, "elapsed": _num(f.get("elapsed")), "duration": dur, "top": false})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.num > b.num)
	for r in out:
		if r.running:
			r.top = true
			break
	return out


## "0:37 / 1:00  (−0:23)"; empty for a layer with nothing running.
static func time_text(r: Dictionary) -> String:
	if not r.running:
		return ""
	return "%s / %s  (−%s)" % [P.format_mmss(r.elapsed), P.format_mmss(r.duration), P.format_mmss(maxf(0.0, r.duration - r.elapsed))]


static func progress(r: Dictionary) -> float:
	return clampf(r.elapsed / r.duration, 0.0, 1.0) if r.running else 0.0


static func remaining(r: Dictionary) -> Variant:
	return maxf(0.0, r.duration - r.elapsed) if r.running else null


## Live / template sources by their label ("DeckLink 2"), media by the file name without extension.
static func source_name(src: Dictionary) -> String:
	var label := str(src.get("label", ""))
	if str(src.get("type", "media")) != "media" and label != "":
		return label
	return _base(str(src.get("value", "")))


static func _base(s: String) -> String:
	var seg := s.replace("\\", "/").split("/", false)
	var name := seg[seg.size() - 1] if not seg.is_empty() else s
	return name.get_basename() if name.get_extension() != "" else name


static func _is_pip(value: String) -> bool:
	var v := value.to_lower()
	return PIP_TEMPLATES.any(func(k: String) -> bool: return v.contains(k))


static func _num(v: Variant) -> float:
	return float(v) if (v is float or v is int) and is_finite(float(v)) else 0.0
