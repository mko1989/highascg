extends RefCounted
## WO-598 D — the node's /api/client-prefs mirror for the Multiview tab (web client/lib/client-prefs.js +
## multiview-state.js readStored / writeStored). Every multiviewer's presets and multiviewer 2+ layouts live on the
## node so the web editor sees the same thing; ui.cfg is written alongside as the offline fallback. Multiviewer 1's
## layout is the project's `multiview` slice, so it has no pref key. Pure: the tab owns the HTTP / ConfigFile calls.

const KEYS := ["multiviewPresets", "multiviewLayouts"]


static func empty() -> Dictionary:
	return {"multiviewPresets": {}, "multiviewLayouts": {}}


## "" = not a node pref (multiviewer 1's layout).
static func pref_key(kind: String, n: int) -> String:
	if kind == "presets":
		return "multiviewPresets"
	return "" if n == 1 else "multiviewLayouts"


static func cfg_key(kind: String, n: int) -> String:
	return ("presets_%d" if kind == "presets" else "layout_%d") % n


## GET /api/client-prefs body → mirror (unknown / malformed keys → empty).
static func from_reply(body: Variant) -> Dictionary:
	var out := empty()
	var p: Variant = body.get("prefs") if body is Dictionary else null
	if p is Dictionary:
		for k in KEYS:
			if p.get(k) is Dictionary:
				out[k] = (p[k] as Dictionary).duplicate(true)
	return out


## The node's value when it has one, else the local (ui.cfg) value.
static func stored(prefs: Dictionary, kind: String, n: int, local: Variant) -> Variant:
	var pk := pref_key(kind, n)
	if pk != "" and (prefs[pk] as Dictionary).has(str(n)):
		var v: Variant = prefs[pk][str(n)]
		return v.duplicate(true) if v is Dictionary or v is Array else v
	return local


## Record a local write in the mirror; returns the POST body (null when it is not a node pref).
static func write(prefs: Dictionary, kind: String, n: int, value: Variant) -> Variant:
	var pk := pref_key(kind, n)
	if pk == "":
		return null
	if value == null:
		(prefs[pk] as Dictionary).erase(str(n))
	else:
		prefs[pk][str(n)] = value.duplicate(true) if value is Dictionary or value is Array else value
	return {"key": pk, "n": n, "value": value}


## WS client_prefs { key, n, value } → true when the mirror changed (false for our own echo / unknown key).
static func apply_broadcast(prefs: Dictionary, d: Variant) -> bool:
	if not (d is Dictionary) or not prefs.has(str(d.get("key", ""))):
		return false
	var slot: Dictionary = prefs[str(d.key)]
	var k := str(int(d.get("n", 0)))
	var v: Variant = d.get("value")
	if JSON.stringify(slot.get(k)) == JSON.stringify(v):
		return false
	if v == null:
		slot.erase(k)
	else:
		slot[k] = v
	return true


## Entries only this machine has (ui.cfg values keyed by [kind, n]) → POST bodies to push up once after a load.
static func to_push(prefs: Dictionary, local: Dictionary) -> Array:
	var out := []
	for n in range(1, 5):
		for kind in ["presets", "layout"]:
			var pk := pref_key(kind, n)
			var v: Variant = local.get(cfg_key(kind, n))
			if pk == "" or (prefs[pk] as Dictionary).has(str(n)) or v == null:
				continue
			if (v is Array and (v as Array).all(func(x: Variant) -> bool: return x == null)) or (v is Dictionary and (v as Dictionary).is_empty()):
				continue  # nothing saved ([] or four empty slots)
			out.append({"key": pk, "n": n, "value": v})
	return out
