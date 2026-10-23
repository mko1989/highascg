extends RefCounted
## WO-695 — re-patch the selected heads (patch_edit_section.gd): mode, protocol, universe and start address; the
## heads after the first run on from the previous head's last channel, in their address order. Pure; the patch shape
## is follow_model.gd's. An edited entry carries `manual_patch` so an MVR re-patch keeps it (mvr_model merge_patch).

const F := preload("res://features/previs/tracking/follow_model.gd")
const M := preload("res://features/previs/fixtures/fixtures_model.gd")


## The selected entries in address order (protocol, universe, address).
static func selected(patch: Array, ids: Array) -> Array:
	var sel := patch.filter(func(f: Variant) -> bool: return f is Dictionary and ids.has(str(f.get("id", ""))))
	sel.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return [str(a.protocol), int(a.universe), int(a.address)] < [str(b.protocol), int(b.universe), int(b.address)])
	return sel


## The GDTF type every selected head shares, or "" (mixed / generic heads: the mode stays as it is).
static func common_type(sel: Array) -> String:
	var t := ""
	for fx in sel:
		var id := str(fx.get("typeId", ""))
		if id == "" or (t != "" and id != t):
			return ""
		t = id
	return t


## Who uses channel `ch` (1-based) of (protocol, universe, dest) in `patch`, or "".
static func user_of(patch: Array, types: Array, protocol: String, universe: int, dest: String, ch: int) -> String:
	for fx in patch:
		if fx.enabled and fx.protocol == protocol and int(fx.universe) == universe and str(fx.dest) == dest:
			var a := int(fx.address)
			if ch >= a and ch < a + M.fixture_footprint(fx, types):
				return str(fx.name)
	return ""


## → {patch, next} with the selection re-patched, or {error}. `mode` "" keeps each head's mode.
static func repatch(patch: Array, types: Array, ids: Array, mode: String, protocol: String, universe: int,
		start: int) -> Dictionary:
	var sel := selected(patch, ids)
	if sel.is_empty():
		return {"error": "Select the heads to re-patch first."}
	var placed := patch.filter(func(f: Variant) -> bool: return f is Dictionary and not ids.has(str(f.get("id", ""))))
	var moved := {}
	var at := start
	for fx in sel:
		var nf: Dictionary = (fx as Dictionary).duplicate(true)
		if mode != "" and str(nf.get("typeId", "")) != "":
			if M.find_mode(types, str(nf.typeId), mode).is_empty():
				return {"error": "%s has no mode \"%s\"." % [nf.name, mode]}
			nf["mode"] = mode
		# a unicast Art-Net destination (a node) is kept; sACN has none; Art-Net from sACN gets the broadcast
		nf["dest"] = "" if protocol == "sacn" else (str(fx.dest) if fx.protocol == "artnet" else F.DEFAULT_DEST)
		nf["protocol"] = protocol
		nf["universe"] = universe
		nf["address"] = at
		nf["manual_patch"] = true
		var fp := M.fixture_footprint(nf, types)
		if at + fp - 1 > 512:
			return {"error": "%s does not fit: channels %d–%d run past 512." % [nf.name, at, at + fp - 1]}
		for c in fp:
			var who := user_of(placed, types, protocol, universe, str(nf.dest), at + c)
			if who != "":
				return {"error": "%s would overlap %s on channel %d." % [nf.name, who, at + c]}
		placed.append(nf)
		moved[str(nf.id)] = nf
		at += fp
	var out := patch.map(func(f: Variant) -> Variant: return moved.get(str(f.get("id", "")), f) if f is Dictionary else f)
	return {"patch": out, "next": at}
