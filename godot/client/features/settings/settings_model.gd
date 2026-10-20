extends RefCounted
## WO-608 — settings helpers, pure (no autoloads, so the offline tests can load them): settings paths, the web's
## on/off reading of stored flags, the Companion connection-status text and query (settings-modal-companion.js).


## "a.b.c", v → {a: {b: {c: v}}}
static func nest(path: String, v: Variant) -> Dictionary:
	var parts := path.split(".")
	var out: Variant = v
	for i in range(parts.size() - 1, -1, -1):
		out = {parts[i]: out}
	return out


## Stored value → on/off: unset = the fallback (web `x !== false` / `!!x`), "true" counts as on.
static func is_on(v: Variant, fallback: bool) -> bool:
	if v == null:
		return fallback
	if v is bool:
		return v
	return str(v) == "true"


## web settings-modal-companion.js formatStatusText
static func companion_status_text(st: Variant) -> String:
	if not (st is Dictionary):
		return "Could not check Companion connection."
	var http: Dictionary = st.get("http", {}) if st.get("http") is Dictionary else {}
	var at := "%s:%s" % [str(http.get("host", "")), _num(http.get("port", ""))]
	var err := " (%s)" % str(http.error) if http.get("error") != null and str(http.error) != "" else ""
	var lines := ["HTTP press API reachable at %s." % at if is_on(http.get("connected"), false)
		else "HTTP press API unreachable at %s%s." % [at, err]]
	var sat: Variant = st.get("satellite")
	if sat is Dictionary and is_on(sat.get("enabled"), false):
		var sat_at := "%s:%s" % [str(sat.get("host", "")), _num(sat.get("port", ""))]
		var sub: Variant = sat.get("subscriptionsSupported")
		if is_on(sat.get("connected"), false):
			if sub is bool and sub == false:
				lines.append("Satellite TCP connected at %s, but Button Subscriptions API is not enabled in Companion." % sat_at)
			elif sub is bool and sub == true:
				lines.append("Satellite preview connected at %s." % sat_at)
			else:
				lines.append("Satellite TCP reachable at %s." % sat_at)
		else:
			var se := " (%s)" % str(sat.error) if sat.get("error") != null and str(sat.error) != "" else ""
			lines.append("Satellite unreachable at %s%s." % [sat_at, se])
		if sat.get("hint") != null and str(sat.hint) != "" and sub is bool and sub == false:
			lines.append(str(sat.hint))
	else:
		lines.append("Satellite preview disabled in these settings.")
	return " ".join(lines)


## The status query from the stored companion settings (web buildStatusQuery reads the form; ours is saved on commit).
static func companion_query(c: Dictionary) -> String:
	var q := "host=%s&port=%d&satelliteEnabled=%s&satellitePort=%d" % [
		(str(c.get("host", "")).strip_edges() if str(c.get("host", "")).strip_edges() != "" else "127.0.0.1").uri_encode(),
		_int_or(c.get("port"), 8000), "1" if is_on(c.get("satelliteEnabled"), true) else "0",
		_int_or(c.get("satellitePort"), 16622)]
	var sh := str(c.get("satelliteHost", "")).strip_edges() if c.get("satelliteHost") != null else ""
	return q + ("&satelliteHost=%s" % sh.uri_encode() if sh != "" else "")


## JSON numbers arrive as floats: 8000.0 reads 8000.
static func _num(v: Variant) -> String:
	return str(int(v)) if v is float and v == floorf(v) else str(v)


static func _int_or(v: Variant, fallback: int) -> int:
	var n := int(v) if (v is int or v is float or (v is String and (v as String).is_valid_int())) else 0
	return n if n != 0 else fallback


## `Content-Disposition: attachment; filename="x.zip"` among raw response headers → "x.zip" (else `fallback`).
static func attachment_name(headers: PackedStringArray, fallback: String) -> String:
	for h in headers:
		if h.to_lower().begins_with("content-disposition:"):
			var m := RegEx.create_from_string("filename=\"?([^\";]+)\"?").search(h)
			if m != null:
				return m.get_string(1).get_file()
	return fallback
