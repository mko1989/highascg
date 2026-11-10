extends RefCounted
## WO-1029 — the Live compose windows follow the screen list. Cells are keyed by screen index (id pgm_N / prv_N,
## mainIndex), and deleting / adding / reordering a destination shifts the indices: box B (10.11) kept the windows of
## four screens after two were deleted and drew "PGM 3 / S3" for a screen that no longer exists while the wall's own
## window was hidden. Mirrors the server (src/system/operator-gui-reconcile.js), pure and headless:
##  - a cell with `destId` is re-resolved by destination first (screenHosts), index second; no destId = index;
##  - a cell of an index beyond the screen count / of a deleted destination is dropped;
##  - a PRV cell of a screen that is here and has no preview channel (PGM-only) is dropped;
##  - a cell of a screen on another server stays (compose_remote.gd draws "on <box>"; the server routes nothing for it);
##  - `add_missing`: a screen that is here and has no PGM / PRV window gets one (PRV when it has a preview channel),
##    placed by Auto's rule over the whole canvas (compose_auto_layout.gd).
## Other windows (sources, multiview cells, media) pass through.

const SC := preload("res://core/screen_channels.gd")
const AL := preload("res://features/live/compose_auto_layout.gd")


static func _is_compose(c: Variant) -> bool:
	return c is Dictionary and str(c.get("role", "")) in ["pgm", "prv"]


static func _idx(c: Dictionary) -> int:
	return maxi(0, int(c.get("mainIndex", 0)))


## One row per screen: {idx, destId, here, prv, aspect, label}.
static func rows(cm: Variant) -> Array:
	var out := []
	if not (cm is Dictionary):
		return out
	var labels: Variant = (cm as Dictionary).get("screenLabels")
	var res: Variant = (cm as Dictionary).get("programResolutions")
	var pe: Variant = (cm as Dictionary).get("previewEnabledByMain")
	for i in SC.screen_count(cm):
		var here := SC.is_here(cm, i)
		var enabled: bool = not (pe is Array and i < pe.size() and pe[i] == false)
		var prv_ok: bool = (SC.prv(cm, i) >= 0 and SC.prv(cm, i) != SC.pgm(cm, i)) if here else enabled
		var r: Variant = res[i] if res is Array and i < res.size() else null
		var ar := float(r.w) / float(r.h) if r is Dictionary and float(r.get("w", 0)) > 0 and float(r.get("h", 0)) > 0 else 16.0 / 9.0
		out.append({"idx": i, "destId": str(SC.host_entry(cm, i).get("destId", "")), "here": here, "prv": prv_ok, "aspect": ar,
			"label": str(labels[i]) if labels is Array and i < labels.size() else ""})
	return out


## The screens' signature (destination ids): add_missing only when it changed, so a window the operator closed stays closed.
static func signature(cm: Variant) -> String:
	var bits := PackedStringArray()
	for r in rows(cm):
		bits.append("%s:%s" % [r.destId, "1" if r.here else "0"])
	return ",".join(bits)


## The row a cell belongs to ({} = none): by destId when it has one and the map knows ids, else by index.
static func row_of(c: Dictionary, rs: Array) -> Dictionary:
	var has_ids := rs.any(func(r: Dictionary) -> bool: return r.destId != "")
	var did := str(c.get("destId", ""))
	if did != "" and has_ids:
		for r in rs:
			if r.destId == did:
				return r
		return {}
	var i := _idx(c)
	return rs[i] if i < rs.size() else {}


## The reconciled cells (a new array; `cells` untouched). `changed` tells the caller whether anything differed.
static func reconcile(cells: Array, cm: Variant, add_missing := false) -> Dictionary:
	var rs := rows(cm)
	if rs.is_empty():
		return {"cells": cells, "changed": false}
	var out := []
	var seen := {}
	var changed := false
	for c in cells:
		if not _is_compose(c):
			out.append(c)
			continue
		var row := row_of(c, rs)
		if row.is_empty() or (str(c.role) == "prv" and row.here and not row.prv):
			changed = true
			continue
		var moved: bool = int(row.idx) != _idx(c)
		var id := "%s_%d" % [c.role, int(row.idx) + 1] if moved else str(c.get("id", ""))
		if moved and seen.has(id):
			changed = true
			continue
		seen[id] = true
		var n: Dictionary = (c as Dictionary).duplicate(true)
		n["id"] = id
		n["mainIndex"] = row.idx
		if row.destId != "":
			n["destId"] = row.destId
		if n != c:
			changed = true
		out.append(n)
	if add_missing and out.any(_is_compose):
		var have := {}
		for c in out:
			if _is_compose(c):
				have[_idx(c)] = true
		var need := rs.filter(func(r: Dictionary) -> bool: return r.here and not have.has(r.idx))
		if not need.is_empty():
			var mains := []
			for r in rs:
				mains.append({"main": r.idx, "prv": r.prv, "aspect": r.aspect})
			var canvas := Vector2(1920, 1080)
			var rects := AL.tile(mains, Rect2(Vector2.ZERO, canvas), canvas, canvas.y * 0.03)
			for r in need:
				for role in (["pgm", "prv"] if r.prv else ["pgm"]):
					var id := "%s_%d" % [role, int(r.idx) + 1]
					if rects.has(id):
						var cell := {"id": id, "role": role, "mainIndex": r.idx, "rect": rects[id], "surface": "compose"}
						if r.destId != "":
							cell["destId"] = r.destId
						out.append(cell)
						changed = true
	return {"cells": out, "changed": changed}


## The tile label: the destination's own label, found by destId first (never "S3" for a real screen).
static func screen_label(c: Dictionary, cm: Variant) -> String:
	var rs := rows(cm)
	var row := row_of(c, rs)
	if not row.is_empty() and str(row.label) != "":
		return str(row.label)
	return "S%d" % (_idx(c) + 1)
