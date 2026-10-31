extends RefCounted
## WO-894 phase 2 — Visuals ▸ Shader values without a recompile, the native twin of the Caspar player's glide (WO-580 phase B,
## template/shaders/player-live.js). A config whose sources differ from the running ones only in float literals inside
## function bodies compiles ONCE with those literals read from the runner's UBO (`_hgG`, shadertoy_glsl.gd HEADER) and eased
## from the old values to the new; the next change of the same literals (a slider drag) only moves the targets. Anything
## else (a structural edit, an int, a literal in a `const` or global initialiser, > SLOTS literals) takes the plain source.
## Slots: a pass's own literals 0..31 (`_hgG[0..7]`), common's 32..63 (`_hgG[8..15]`) — each pass's UBO carries both.

const SLOTS := 32
const TAU_S := 0.35
const COMMON := "common"
const NUM := "(?<![\\w.])(?:\\d+\\.\\d*(?:[eE][+-]?\\d+)?|\\.\\d+(?:[eE][+-]?\\d+)?|\\d+[eE][+-]?\\d+)(?![\\w.])"

static var _num := RegEx.create_from_string(NUM)
static var _comment := RegEx.create_from_string("/\\*[\\s\\S]*?\\*/|//[^\\n]*")
var _st := {}  # key (COMMON or a pass name) → {base, uni: {literal index: slot}, cur, to}


## Comments → spaces (same length, newlines kept), so literals and braces inside them do not count.
static func mask(src: String) -> String:
	var out := ""
	var at := 0
	for m in _comment.search_all(src):
		out += src.substr(at, m.get_start() - at) + RegEx.create_from_string("[^\\n]").sub(m.get_string(), " ", true)
		at = m.get_end()
	return out + src.substr(at)


## The float literals of a source: {m: masked text, lits: [{at, len, v}]}.
static func parse(src: String) -> Dictionary:
	var m := mask(src)
	var lits := []
	for x in _num.search_all(m):
		lits.append({"at": x.get_start(), "len": x.get_end() - x.get_start(), "v": x.get_string().to_float()})
	return {"m": m, "lits": lits}


## Same text between the literals → {a, b, changed: literal indices}; anything else → {}.
static func diff(src_a: String, src_b: String) -> Dictionary:
	var a := parse(src_a)
	var b := parse(src_b)
	if a.lits.size() != b.lits.size():
		return {}
	for i in a.lits.size() + 1:
		if _gap(src_a, a.lits, i) != _gap(src_b, b.lits, i):  # comments too
			return {}
	var changed := []
	for i in a.lits.size():
		if a.lits[i].v != b.lits[i].v:
			changed.append(i)
	return {"a": a, "b": b, "changed": changed}


static func _gap(src: String, lits: Array, i: int) -> String:
	var from: int = lits[i - 1].at + lits[i - 1].len if i > 0 else 0
	var to: int = lits[i].at if i < lits.size() else src.length()
	return src.substr(from, to - from)


## Can the literal at `at` (masked text) be a uniform: in a function body, not in a `const`; a #define's value when every
## use of the macro can (macros in macros: up to `left` deep).
static func eligible(m: String, at: int, left := 4) -> bool:
	var line_start := m.rfind("\n", at - 1) + 1 if at > 0 else 0
	var head := m.substr(line_start, at - line_start)
	var def := RegEx.create_from_string("^\\s*#\\s*define\\s+(\\w+)").search(head)
	if def != null:
		if left <= 0:
			return false
		var own := line_start + def.get_start(1)
		for x in RegEx.create_from_string("\\b%s\\b" % def.get_string(1)).search_all(m):
			if x.get_start() != own and not eligible(m, x.get_start(), left - 1):
				return false
		return true
	if RegEx.create_from_string("^\\s*#").search(head) != null:  # #if / #ifdef / #undef …
		return false
	var cs := m.substr(0, at).to_utf32_buffer().to_int32_array()
	var depth := 0
	var stmt := 0
	for i in cs.size():
		var c := cs[i]
		if c == 123:  # {
			depth += 1
		elif c == 125:  # }
			depth -= 1
		if c == 123 or c == 125 or c == 59:  # { } ;
			stmt = i + 1
	return depth > 0 and RegEx.create_from_string("\\bconst\\b").search(m.substr(stmt, at - stmt)) == null


## The source with the literals in `uni` (index → slot) read from the UBO; `base` = 0 for a pass, SLOTS for common.
static func build(src: String, lits: Array, uni: Dictionary, base: int) -> String:
	var idx := uni.keys()
	idx.sort()
	idx.reverse()
	for i in idx:
		var s: int = base + uni[i]
		src = src.substr(0, lits[i].at) + "_hgG[%d][%d]" % [s >> 2, s & 3] + src.substr(lits[i].at + lits[i].len)
	return src


## A config's sources (COMMON + each pass's) → {compile: bool, sources: {key: source to compile}}. compile false = only
## the targets moved (the running SPIR-V reads the new values from the UBO).
func plan(sources: Dictionary) -> Dictionary:
	for k in _st.keys():
		if not sources.has(k):
			_st.erase(k)
	var compile := false
	var out := {}
	for k in sources:
		var src: String = sources[k]
		var fresh_key := not _st.has(k)
		var st: Dictionary = _st.get(k, {"base": src, "uni": {}, "cur": _zeros(), "to": _zeros()})
		_st[k] = st
		var base: String = st.base
		st.base = src
		var d := {"changed": [], "b": parse(src)} if base == src else diff(base, src)
		var plain: bool = d.is_empty() or d.changed.any(func(i: int) -> bool: return not eligible(d.b.m, d.b.lits[i].at))
		var fresh: Array = [] if plain else d.changed.filter(func(i: int) -> bool: return not st.uni.has(i))
		if plain or st.uni.size() + fresh.size() > SLOTS:
			st.uni = {}
			compile = true
			out[k] = src
			continue
		for i in d.changed:
			if st.uni.has(i):
				st.to[st.uni[i]] = d.b.lits[i].v
		for i in fresh:
			var slot: int = st.uni.size()
			st.uni[i] = slot
			st.cur[slot] = d.a.lits[i].v
			st.to[slot] = d.b.lits[i].v
		compile = compile or fresh_key or not fresh.is_empty()
		out[k] = build(src, d.b.lits, st.uni, SLOTS if k == COMMON else 0) if not st.uni.is_empty() else src
	return {"compile": compile, "sources": out}


## Forget the slots (the scene left, or a glided compile failed: the plain sources compile next).
func reset() -> void:
	_st = {}


## The state before a plan, to put back when nothing compiled (the old SPIR-V keeps running with its slots).
func save() -> Dictionary:
	return _st.duplicate(true)


func restore(saved: Dictionary) -> void:
	_st = saved


## Ease every slot toward its target (per drawn frame).
func frame(dt: float) -> void:
	var k := 1.0 - exp(-clampf(dt, 0.0, 0.1) / TAU_S)
	for st in _st.values():
		for j in st.uni.size():
			var next: float = st.cur[j] + (st.to[j] - st.cur[j]) * k
			st.cur[j] = st.to[j] if absf(next - st.to[j]) <= 1e-6 * maxf(1.0, absf(st.to[j])) else next


## The UBO tail of one pass: its own slots then common's (2 × SLOTS floats).
func values(pass_name: String) -> PackedFloat32Array:
	var own: PackedFloat32Array = _st[pass_name].cur if _st.has(pass_name) else _zeros()
	return own + (_st[COMMON].cur if _st.has(COMMON) else _zeros())


static func _zeros() -> PackedFloat32Array:
	var z := PackedFloat32Array()
	z.resize(SLOTS)
	return z
