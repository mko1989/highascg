extends RefCounted
## WO-601 — lower-third layer data, pure 1:1 port of client/lib/lower-third-cg-data.js (golden-tested):
## the inspector patches `source.lowerThirdConfig` AND `cgData` synchronously, like the web, so a TAKE right
## after typing never carries stale text. Template/config resolution and CG actions stay on the server
## (POST /api/scene/lower-third).

const DEFAULTS := {
	"title": "", "subtitle": "", "primaryColor": "#4fc3f7", "textColor": "#ffffff", "position": "left",
	"fontFamily": "arial", "titleFontSize": 46, "subtitleFontSize": 27, "renderScale": 100, "displayDurationSec": 10,
}
const POSITIONS := ["left", "center", "right"]
const UPDATE_DEBOUNCE_MS := 450  # LOWER_THIRD_CG_UPDATE_DEBOUNCE_MS


## isLowerThirdSource
static func is_lower_third(source: Variant) -> bool:
	if not (source is Dictionary) or str(source.get("value", "")) == "":
		return false
	var v := str(source.value).to_lower().replace("\\", "/")
	return v.contains("lower-thirds/lt-") or v.contains("lower_thirds/lt-")


## deriveTemplateId: first /lt-[\w-]+/i, lower-cased.
static func template_id(value: String) -> String:
	var re := RegEx.create_from_string("(?i)lt-[\\w-]+")
	var m := re.search(value)
	return m.get_string().to_lower() if m != null else ""


## JS parseFloat(String(v)) prefix semantics; NAN when nothing parses.
static func _parse_float(v: Variant) -> float:
	if v is float or v is int:
		return float(v)
	if v is bool:
		return NAN
	var m := RegEx.create_from_string("^\\s*[-+]?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?").search(str(v))
	return m.get_string().strip_edges().to_float() if m != null else NAN


## parsePositiveNumber / parseLowerThirdDisplayDurationSec: '' / null / NaN → fallback, else max(0, n).
static func _positive(v: Variant, fallback: float) -> float:
	if v == null or (v is String and v == ""):
		return fallback
	var n := _parse_float(v)
	return fallback if is_nan(n) else maxf(0.0, n)


## JS String(number): integral → no decimals.
static func _js_num(n: float) -> String:
	return str(int(n)) if n == floorf(n) and absf(n) < 1e15 else str(n)


## JS truthiness for JSON values.
## Integral → int so the stored JSON says 46 (as the web writes), not 46.0.
static func _jsv(n: float) -> Variant:
	return int(n) if n == floorf(n) and absf(n) < 1e15 else n


static func _truthy(v: Variant) -> bool:
	if v == null:
		return false
	if v is bool:
		return v
	if v is String:
		return v != ""
	if v is float or v is int:
		return float(v) != 0.0 and not is_nan(float(v))
	return true


## buildLowerThirdCgData → {data, style} (key order kept: it is the CG payload).
static func cg_data(config: Dictionary) -> Dictionary:
	var m := DEFAULTS.duplicate()
	m.merge(config, true)
	var name: Variant = m.get("title") if m.get("title") != null else m.get("name")
	var secondary: Variant = m.get("subtitle") if m.get("subtitle") != null else m.get("role")
	var data := {"name": str(name) if name != null else "", "title": str(secondary) if secondary != null else ""}
	var style := {}
	var dur := _positive(m.get("displayDurationSec"), 10.0)
	var tfs := _positive(m.get("titleFontSize"), DEFAULTS.titleFontSize)
	var sfs := _positive(m.get("subtitleFontSize"), DEFAULTS.subtitleFontSize)
	var scale := _positive(m.get("renderScale"), DEFAULTS.renderScale)
	var font := str(m.get("fontFamily") if _truthy(m.get("fontFamily")) else DEFAULTS.fontFamily).to_lower()
	for k in ["primaryColor", "textColor", "position"]:
		if _truthy(m.get(k)):
			style[k] = m[k]
	style["displayDurationSec"] = _jsv(dur)
	style["titleFontSize"] = _jsv(tfs)
	style["subtitleFontSize"] = _jsv(sfs)
	style["renderScale"] = _jsv(scale)
	style["fontFamilyId"] = font
	data["displayDurationSec"] = _js_num(dur)
	for k in ["primaryColor", "textColor", "position"]:
		if style.has(k):
			data[k] = style[k]
	data["titleFontSize"] = _js_num(tfs)
	data["subtitleFontSize"] = _js_num(sfs)
	data["renderScale"] = _js_num(scale)
	data["fontFamily"] = font
	data["fontFamilyId"] = font
	return {"data": data, "style": style}


## buildLowerThirdCasparCgData → layer.cgData: {...data, ...style, data, style}.
static func caspar_cg_data(config: Dictionary) -> Dictionary:
	var ds := cg_data(config)
	var out: Dictionary = (ds.data as Dictionary).duplicate()
	out.merge(ds.style, true)
	out["data"] = ds.data
	out["style"] = ds.style
	return out


## The web persistLocalConfig patch: source keeps everything, gains lowerThirdConfig; cgData rebuilt.
static func patch_for(source: Dictionary, config: Dictionary) -> Dictionary:
	var src := source.duplicate(true)
	src["lowerThirdConfig"] = config.duplicate()
	return {"source": src, "cgData": caspar_cg_data(config)}
