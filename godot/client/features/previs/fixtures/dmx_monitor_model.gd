extends RefCounted
## WO-693 — pure helpers for the DMX viewer (dmx_monitor_window.gd): universe labels, the node / source list from
## GET /api/dmx-monitor, and the status line for the shown universe (network input, or what this box sends from
## GET /api/fixtures/dmx/frame).

const ARTNET_MAX := 32767
const SACN_MAX := 63999


## Art-Net port-address 0x123 → "1:2:3 (291)" (net : sub-net : universe); sACN → "5".
static func universe_label(protocol: String, u: int) -> String:
	if protocol == "sacn":
		return str(u)
	return "%d:%d:%d (%d)" % [(u >> 8) & 0x7f, (u >> 4) & 0x0f, u & 0x0f, u]


static func clamp_universe(protocol: String, u: int) -> int:
	return clampi(u, 1, SACN_MAX) if protocol == "sacn" else clampi(u, 0, ARTNET_MAX)


static func query(protocol: String, u: int) -> String:
	return "/api/dmx-monitor?protocol=%s&universe=%d" % ["sacn" if protocol == "sacn" else "artnet", u]


static func _list(d: Variant, key: String) -> Array:
	return d.get(key, []) if d is Dictionary and d.get(key) is Array else []


static func _unis(protocol: String, list: Array) -> String:
	var parts := PackedStringArray()
	for u in list.slice(0, 8):
		parts.append(universe_label(protocol, int(u)) if protocol == "sacn" else str(int(u)))
	return ", ".join(parts) + (" …" if list.size() > 8 else "")


## The list rows for `protocol`: {text, tip, universe (-1 = none to jump to)}. Art-Net: polled nodes first, then who
## sends ArtDmx; sACN: every source by CID. This box is marked.
static func rows(snap: Dictionary, protocol: String) -> Array:
	var out := []
	if protocol == "sacn":
		for s in _list(snap.get("sacn"), "sources"):
			var u: Array = s.get("universes", [])
			out.append({"text": "%s · %s%s  → U %s" % [s.get("name", "?"), s.get("ip", "?"), "  (this box)" if s.get("self") else "",
				_unis("sacn", u)], "tip": "CID %s" % s.get("cid", ""), "universe": int(u[0]) if not u.is_empty() else -1})
		return out
	for n in _list(snap.get("artnet"), "nodes"):
		var o: Array = n.get("outputs", [])
		var i: Array = n.get("inputs", [])
		var name := str(n.get("shortName", "")) if str(n.get("shortName", "")) != "" else str(n.get("longName", "node"))
		out.append({"text": "◆ %s · %s%s%s%s" % [name, n.get("ip", "?"), "  (this box)" if n.get("self") else "",
			("  out %s" % _unis("artnet", o)) if not o.is_empty() else "", ("  in %s" % _unis("artnet", i)) if not i.is_empty() else ""],
			"tip": "%s\n%s\nMAC %s" % [n.get("longName", ""), n.get("report", ""), n.get("mac", "")],
			"universe": int(o[0]) if not o.is_empty() else (int(i[0]) if not i.is_empty() else -1)})
	for s in _list(snap.get("artnet"), "sources"):
		var u: Array = s.get("universes", [])
		out.append({"text": "▸ %s%s  → %s" % [s.get("ip", "?"), "  (this box)" if s.get("self") else "", _unis("artnet", u)],
			"tip": "%d ArtDmx packets" % int(s.get("packets", 0)), "universe": int(u[0]) if not u.is_empty() else -1})
	return out


## The line over the grid. `view` "in" (network) / "out" (this box); `res` the GET result ({ok, status, data}).
static func status(view: String, protocol: String, u: int, res: Dictionary) -> String:
	var name := "%s %s" % ["sACN" if protocol == "sacn" else "Art-Net", universe_label(protocol, u)]
	var data: Variant = res.get("data")
	if view == "out":
		if res.get("ok") and data is Dictionary:
			return "%s — this box %s to %s" % [name, "sends" if data.get("live") else "would send (not live)", data.get("dest", "?")]
		if int(res.get("status", 0)) == 404:
			return "%s — this box outputs nothing on this universe" % name
		return "%s — fixture engine off (the Tracking module on the server)" % name
	if not res.get("ok") or not data is Dictionary:
		return "%s — the server does not answer (%s)" % [name, res.get("error", "?")]
	var f: Variant = data.get("frame")
	if not f is Dictionary:
		return "%s — no input" % name
	var age := float(f.get("age_ms", 0))
	var src := str(f.get("source", ""))
	return "%s ← %s%s%s" % [name, f.get("from", "?"), (" \"%s\"" % src) if src != "" else "",
		"  (stale %.1f s)" % (age / 1000.0) if age > 2500.0 else ""]


## The 512 values to draw: the input frame / the box's frame, else [] (grid empty).
static func values(view: String, res: Dictionary) -> Array:
	var data: Variant = res.get("data")
	if not res.get("ok") or not data is Dictionary:
		return []
	if view == "out":
		return data.get("data", []) if data.get("data") is Array else []
	var f: Variant = data.get("frame")
	return f.get("data", []) if f is Dictionary and f.get("data") is Array else []
