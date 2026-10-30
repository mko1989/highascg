extends RefCounted
## Devices rear panel — grabbing a live cable with the pointer (owner 30.10: "possible to grab a cable with pointer and
## play around with it (not disconnecting), should disconnect when grabbed close to a node dot"). The pure part, so it
## is unit-testable: given the drawn cable shapes and where the pointer went down, which cable is under it, which rope
## point it holds, and is that press on the BODY (drag the rope, both ends stay plugged) or near an END (the port dot:
## the existing select / re-plug gesture of cable_gesture.gd). All distances are local pixels of the cable layer, which
## is unscaled Devices-tab space, so they equal screen px.

const BODY_PX := 6.0  # a press this close to the drawn polyline is on the cable (same reach as cable_layer HIT_PX)
const END_PX := 18.0  # …and within this of a cable's port dot (anchor) it is the END, not the body — the plug boot
# hangs BOOT_DROP (16) below the anchor, so the whole boot counts as the end


## `shapes`: cable id → drawn polyline; `owners`: cable id → rope point index of every polyline point (loop points
## belong to the rope point they hang from; omit for cables that are not ropes); `ends`: cable id → [source anchor,
## sink anchor]. Returns {} when no cable is within BODY_PX of `p`, else {id, kind: "end"|"body", end: "source"|
## "sink" (the nearer port), idx: rope point to hold (-1 = none / not a rope), at: closest point on the cable}.
static func pick(shapes: Dictionary, owners: Dictionary, ends: Dictionary, p: Vector2, skip := "") -> Dictionary:
	var best := {}
	var best_d := BODY_PX
	for id in shapes:
		if id == skip:
			continue
		var pts: PackedVector2Array = shapes[id]
		for i in range(pts.size() - 1):
			var q := Geometry2D.get_closest_point_to_segment(p, pts[i], pts[i + 1])
			var d := p.distance_to(q)
			if d < best_d:
				best_d = d
				var nearer := i if p.distance_squared_to(pts[i]) <= p.distance_squared_to(pts[i + 1]) else i + 1
				best = {"id": id, "near": nearer, "at": q}
	if best.is_empty():
		return {}
	var cid: String = best.id
	var e: Array = ends.get(cid, [])
	var da: float = p.distance_to(e[0]) if e.size() == 2 else INF
	var db: float = p.distance_to(e[1]) if e.size() == 2 else INF
	var own: PackedInt32Array = owners.get(cid, PackedInt32Array())
	var pt: int = best.near
	var at_end := minf(da, db) <= END_PX
	return {"id": cid, "kind": "end" if at_end else "body", "end": "source" if da <= db else "sink",
		"idx": own[pt] if pt < own.size() else -1, "at": best.at}
