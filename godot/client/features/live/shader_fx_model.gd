extends RefCounted
## WO-606 — Shader FX editor, pure helpers (web shader-fx-modal.js, WO-266 / WO-380). The library lives in the
## node (/api/shaders, import, export to template/shaders/); the params panel scans / rewrites through
## /api/shader-live/scan|rewrite.

const PASSES := [["image", "Image"], ["bufferA", "Buffer A"], ["bufferB", "Buffer B"], ["bufferC", "Buffer C"], ["bufferD", "Buffer D"]]
const CHANNEL_OPTIONS := ["", "A", "B", "C", "D", "audio", "camera"]  # WO-376: camera = the virtual cam

const GLSL_TYPES := ["void", "bool", "int", "uint", "float", "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "bvec2", "bvec3", "bvec4", "mat2", "mat3", "mat4", "sampler2D", "samplerCube"]
const GLSL_KEYWORDS := ["if", "else", "for", "while", "do", "return", "break", "continue", "discard", "const", "uniform", "in", "out", "inout", "struct", "precision", "highp", "mediump", "lowp", "true", "false"]
const SHADERTOY := ["iTime", "iResolution", "iMouse", "iFrame", "iTimeDelta", "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iChannelResolution", "iDate", "fragCoord", "fragColor", "mainImage"]


## "Audio Reactive Galaxy ♪" (web list badge).
static func list_label(meta: Dictionary) -> String:
	return str(meta.get("name", meta.get("id", ""))) + (" ♪" if meta.get("audio", false) else "")


## Channel select index for a stored value ("" / null → 0).
static func channel_index(v: Variant) -> int:
	var i := CHANNEL_OPTIONS.find(str(v) if v != null else "")
	return maxi(0, i)


## WO-662 — the three beat knobs (flash / bump / kick), each clamped 0..1, missing → 0.
static func beat_knobs(src: Variant) -> Dictionary:
	var d: Dictionary = src if src is Dictionary else {}
	return {"flash": clampf(float(d.get("flash", 0.0)), 0.0, 1.0), "bump": clampf(float(d.get("bump", 0.0)), 0.0, 1.0), "kick": clampf(float(d.get("kick", 0.0)), 0.0, 1.0)}


## WO-662 — a loaded config's audio.beat (missing → all zeros).
static func beat_of(cfg: Dictionary) -> Dictionary:
	var audio: Variant = cfg.get("audio")
	return beat_knobs(audio.get("beat") if audio is Dictionary else null)


## The POST /api/shaders body (web collectForm): empty passes dropped, "" channels → null.
static func collect(id: String, name: String, common: String, sources: Dictionary, channels: Dictionary, audio: bool, alpha: bool, beat: Dictionary = {}) -> Dictionary:
	var passes := {}
	for p in PASSES:
		var k: String = p[0]
		var src := str(sources.get(k, ""))
		if src.strip_edges() == "":
			continue
		var chs: Array = []
		for c in channels.get(k, ["", "", "", ""]):
			chs.append(null if str(c) == "" else str(c))
		passes[k] = {"source": src, "channels": chs}
	var body := {"name": name.strip_edges(), "common": common, "passes": passes, "audio": {"enabled": audio, "beat": beat_knobs(beat)}, "opts": {"alpha": alpha}}
	if id != "":
		body["id"] = id
	return body


## The scan / rewrite body: every source, common included.
static func sources_body(common: String, sources: Dictionary) -> Dictionary:
	var passes := {}
	for k in sources:
		passes[k] = {"source": str(sources[k])}
	return {"common": common, "passes": passes}


## Import result → status line (web: "Imported … — review and save — not imported: …").
static func import_note(cfg: Dictionary) -> String:
	var skipped: Array = cfg.get("skipped", []) if cfg.get("skipped") is Array else []
	return "Imported \"%s\" — review and save%s" % [str(cfg.get("name", "")), (" — not imported: " + ", ".join(skipped)) if not skipped.is_empty() else ""]


## GLSL syntax colours for a CodeEdit.
static func highlighter(type_c: Color, kw_c: Color, toy_c: Color, num_c: Color, comment_c: Color, fn_c: Color) -> CodeHighlighter:
	var h := CodeHighlighter.new()
	h.number_color = num_c
	h.symbol_color = Color(0.75, 0.78, 0.82)
	h.function_color = fn_c
	h.member_variable_color = Color(0.85, 0.85, 0.85)
	for w in GLSL_TYPES:
		h.add_keyword_color(w, type_c)
	for w in GLSL_KEYWORDS:
		h.add_keyword_color(w, kw_c)
	for w in SHADERTOY:
		h.add_keyword_color(w, toy_c)
	h.add_color_region("//", "", comment_c, true)
	h.add_color_region("/*", "*/", comment_c)
	h.add_color_region("#", "", kw_c, true)
	return h
