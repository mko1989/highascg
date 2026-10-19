extends RefCounted
## Port of client/lib/math-input.js (WO-200): number fields accept arithmetic ("1920/2", "(960-10)*2"), clamp to
## min/max and format to `decimals`; garbage or an empty field restores the last good value instead of committing
## NaN. evaluate() is the web's recursive-descent grammar (Godot's Expression would integer-divide "5/2" and accept
## far more than digits and + - * / ( ) .). Pure.

## expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ; factor := NUMBER | '(' expr ')' | ('-'|'+') factor
static func evaluate(text: String) -> float:
	var s := text.strip_edges()
	if s == "" or not RegEx.create_from_string("^[\\d\\s+\\-*/.()]+$").search(s):
		return NAN
	var toks := _tokenize(s)
	if toks.is_empty() and s != "":
		return NAN
	var st := {"t": toks, "i": 0, "bad": false}
	var v := _expr(st)
	if st.bad or st.i < toks.size() or not is_finite(v):
		return NAN
	return v


static func _tokenize(s: String) -> Array:
	var out := []
	var i := 0
	while i < s.length():
		var ch := s[i]
		if ch == " " or ch == "\t" or ch == "\n":
			i += 1
		elif ch.is_valid_int() or (ch == "." and i + 1 < s.length() and s[i + 1].is_valid_int()):
			var num := ""
			while i < s.length() and (s[i].is_valid_int() or s[i] == "."):
				num += s[i]
				i += 1
			out.append(_js_float(num))
		else:
			out.append(ch)
			i += 1
	return out


## parseFloat on a digits-and-dots run: "1.2.3" → 1.2, "." never reaches here.
static func _js_float(num: String) -> float:
	var m := RegEx.create_from_string("^\\d*\\.?\\d*").search(num)
	return m.get_string(0).to_float()


static func _peek(st: Dictionary) -> Variant:
	return st.t[st.i] if st.i < st.t.size() else null


static func _expr(st: Dictionary) -> float:
	var r := _term(st)
	while _peek(st) is String and (_peek(st) == "+" or _peek(st) == "-"):
		var op: String = st.t[st.i]
		st.i += 1
		var right := _term(st)
		r = r + right if op == "+" else r - right
	return r


static func _term(st: Dictionary) -> float:
	var r := _factor(st)
	while _peek(st) is String and (_peek(st) == "*" or _peek(st) == "/"):
		var op: String = st.t[st.i]
		st.i += 1
		var right := _factor(st)
		if op == "*":
			r *= right
		else:
			r = r / right if right != 0.0 else (INF if r > 0 else (-INF if r < 0 else NAN))
	return r


static func _factor(st: Dictionary) -> float:
	var tok: Variant = _peek(st)
	if tok == null:
		st.bad = true
		return NAN
	if tok is float:
		st.i += 1
		return tok
	if tok == "(":
		st.i += 1
		var r := _expr(st)
		if _peek(st) != ")":
			st.bad = true
			return NAN
		st.i += 1
		return r
	if tok == "+" or tok == "-":
		st.i += 1
		var v := _factor(st)
		return v if tok == "+" else -v
	st.bad = true
	return NAN


## parseNumberInput: the expression, else parseFloat's numeric prefix, else NAN.
static func parse(text: String) -> float:
	var s := text.strip_edges()
	if s == "":
		return NAN
	var m := evaluate(s)
	if not is_nan(m):
		return m
	var p := RegEx.create_from_string("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?").search(s)
	return p.get_string(0).to_float() if p else NAN


## computeMathCommit → {value, text, restored}. `lo` / `hi` may be -INF / INF; `decimals` < 0 = unformatted.
static func commit(raw: String, lo: float, hi: float, decimals: int, last_good: Variant) -> Dictionary:
	var parsed := parse(raw)
	var value: float
	var restored := is_nan(parsed)
	if restored:
		if last_good != null and is_finite(float(last_good)):
			value = float(last_good)
		elif is_finite(lo):
			value = lo
		elif is_finite(hi):
			value = hi
		else:
			value = 0.0
	else:
		value = parsed
	if is_finite(lo):
		value = maxf(lo, value)
	if is_finite(hi):
		value = minf(hi, value)
	if value == 0.0:
		value = 0.0  # JS (-0).toFixed() is "0"; printf would say "-0"
	return {"value": value, "text": fixed(value, decimals), "restored": restored}


## Number.prototype.toFixed(decimals), or String(value) for decimals < 0.
static func fixed(value: float, decimals: int) -> String:
	if decimals < 0:
		return str(int(value)) if is_equal_approx(value, roundf(value)) and absf(value) < 1e15 else str(value)
	return ("%." + str(decimals) + "f") % value
