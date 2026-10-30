extends RefCounted
## WO-741 (future development, detachable) — the pure part of walking the previs: first-person moves at 1:1 (the MVR's
## metres are real metres), mouse / stick look, snap turn, and what a controller trigger / grip does. Godot frame: y up, the
## camera looks down -Z at yaw 0; PSN = [x, -z, 0] (fixtures_3d.gd, aim_drag.gd).

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")

const EYE := 1.7  # metres, eye height above the stage floor
const SPEED := 1.4  # m/s walking; shift / a full stick push x3
const SNAP := PI / 6.0  # 30° per snap turn (comfort: no smooth turning in a headset)
const PITCH_MAX := 1.4


## Where the walk starts: on the floor `back` metres downstage (+Z) of `target`, looking upstage at it.
static func start_pose(target: Vector3, back := 8.0) -> Dictionary:
	return {"pos": Vector3(target.x, EYE, target.z + back), "yaw": 0.0, "pitch": 0.0}


## One frame of walking: `move` x = strafe right, y = forward (each -1..1), along the floor whatever the pitch.
static func step(pos: Vector3, yaw: float, move: Vector2, dt: float, speed := SPEED) -> Vector3:
	if move.length() > 1.0:
		move = move.normalized()
	var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	return pos + (fwd * move.y + right * move.x) * speed * dt


## Mouse look: `rel` pixels → [yaw, pitch], pitch clamped short of straight up / down.
static func look(yaw: float, pitch: float, rel: Vector2, k := 0.004) -> Vector2:
	return Vector2(wrapf(yaw - rel.x * k, -PI, PI), clampf(pitch - rel.y * k, -PITCH_MAX, PITCH_MAX))


## WASD (held) → a move vector.
static func keys(w: bool, a: bool, s: bool, d: bool) -> Vector2:
	return Vector2(float(d) - float(a), float(w) - float(s))


## Snap turn on a stick's x: one SNAP per push past 0.7, re-armed once it is back under 0.3. → [yaw, armed].
static func snap(yaw: float, x: float, armed: bool) -> Array:
	if armed and absf(x) > 0.7:
		return [wrapf(yaw - signf(x) * SNAP, -PI, PI), false]
	return [yaw, armed or absf(x) < 0.3]


## WO-859 — owner 30.10: "the righthand analog should allow flying by moving up and down". The right stick's y lifts
## or lowers the rig while it outweighs x (x snap-turns) and the ray is off the wrist panel (there it scrolls); never
## below the floor (0). The right stick's click lands back on the floor.
const FLY_SPEED := 1.5  # m/s at a full push
const FLY_DEAD := 0.2


static func fly(height: float, stick: Vector2, dt: float, speed := FLY_SPEED) -> float:
	if absf(stick.y) < FLY_DEAD or absf(stick.y) <= absf(stick.x):
		return height
	return maxf(0.0, height + stick.y * speed * dt)


## The stick's x for the snap turn: 0 while y outweighs it, so a diagonal flight never turns.
static func turn_x(stick: Vector2) -> float:
	return stick.x if absf(stick.x) > absf(stick.y) else 0.0


## WO-859 — owner 30.10: "when the first trigger is held down it acts as ctrl/cmd [...] so user can select multiple
## fixtures by clicking one by one". The left trigger held adds to the selection; the left grip still does too (WO-774).
static func add_held(left_trigger: bool, left_grip: bool) -> bool:
	return left_trigger or left_grip


## A trigger along a ray. `hit_id` = the head the ray goes through (else `near_id`, the head centred nearest it);
## a head → {do: "pick", id, add} (the left grip held adds, as ctrl-click — WO-774); else {do: "press"}: a press in the
## stage off the heads that waits for its release (a drag = a box select). WO-841: the trigger only selects — it never
## aims any more; the right grip points (grip_mode / aim_due below).
static func trigger(hit_id: String, near_id: String, add := false) -> Dictionary:
	var id := hit_id if hit_id != "" else near_id
	if id != "":
		return {"do": "pick", "id": id, "add": add}
	return {"do": "press"}


## WO-841 — owner 30.10: "make the pointing of selected heads in the vr world with the second trigger [the grip] ...
## the first trigger should be only selecting." The right grip going down: with the left grip already held it is the
## WO-774 fan ("fan"); else it points the selection ("point") — not while the ray is on the wrist panel and not with
## nothing selected ("none"). The mode is decided at the press and kept until the right grip is let go.
static func grip_mode(left_held: bool, has_sel: bool, on_panel: bool) -> String:
	if left_held:
		return "fan"
	return "point" if has_sel and not on_panel else "none"


## The floor spot under a ray as the server's PSN [x, -z, 0] (what the trigger's aim used to send), null in the sky.
static func point_psn(from: Vector3, dir: Vector3) -> Variant:
	var at: Variant = F.floor_hit(from, dir)
	return [at.x, -at.z, 0.0] if at != null else null


## The held grip follows the ray, but the API is not flooded (aim_drag.gd sends one request at a time, newest wins;
## this thins what is offered to it): at most one aim per AIM_MIN_S and only once the spot has moved AIM_MIN_M (metres
## on the floor) from the last one sent. `st` keeps the last sent ({} = the grip just went down: send at once).
const AIM_MIN_S := 1.0 / 15.0
const AIM_MIN_M := 0.05


## Whether `psn` goes out at time `now` (seconds); records it in `st` when so.
static func aim_due(st: Dictionary, psn: Array, now: float) -> bool:
	if st.has("psn"):
		var last: Array = st.psn
		if now - float(st.t) < AIM_MIN_S or Vector2(psn[0], psn[1]).distance_to(Vector2(last[0], last[1])) < AIM_MIN_M:
			return false
	st.psn = psn
	st.t = now
	return true


## WO-757: the Programmer panel (xr_panel.gd) — its quad in metres and its pixels (2 per mm, the same aspect).
const PANEL_SIZE := Vector2(0.30, 0.42)
const MIRROR_FOV := 90.0  ## WO-770: about the Quest's own field of view
const MIRROR_MAX := Vector2i(1280, 720)  ## the desktop mirror's render size cap (a third render of the stage)
const PANEL_PX := Vector2i(600, 840)


## Where the ray (from, dir) meets a quad (transform `xf`, facing its +Z, `size` metres) as a UV with (0, 0) top left, or
## null when it misses. `hold` (a drag in progress) keeps following on the quad's plane past its edge, clamped.
static func panel_uv(xf: Transform3D, size: Vector2, from: Vector3, dir: Vector3, hold := false) -> Variant:
	var inv := xf.affine_inverse()
	var o := inv * from
	var d := inv.basis * dir
	if absf(d.z) < 1e-6:
		return null
	var t := -o.z / d.z
	if t < 0.0:
		return null
	var p := o + d * t
	var uv := Vector2(p.x / size.x + 0.5, 0.5 - p.y / size.y)
	if hold:
		return uv.clamp(Vector2.ZERO, Vector2.ONE)
	return uv if uv.x >= 0.0 and uv.x <= 1.0 and uv.y >= 0.0 and uv.y <= 1.0 else null


## Owner 27.10: "the programmer tablet in vr is too sensitive. it needs smoothing." The ray's panel pixel goes through
## a One-Euro filter (Casiez et al. 2012): its cut-off rises with the pointer's speed, so a still hand's tremor is
## smoothed hard (EURO_MIN_HZ) and a quick sweep follows with little lag (EURO_BETA per px/s). Pixels of PANEL_PX.
const EURO_MIN_HZ := 1.0
const EURO_BETA := 0.004
const EURO_D_HZ := 1.0
## A trigger press holds the pointer where it was (pulling the trigger twitches the controller) until the smoothed ray
## moves PRESS_SLOP_PX away: a click lands where it was aimed, a deliberate drag still drags.
const PRESS_SLOP_PX := 10.0


static func _euro_a(hz: float, dt: float) -> float:
	var tau := 1.0 / (TAU * hz)
	return 1.0 / (1.0 + tau / maxf(dt, 1e-4))


## One step of the filter: `st` keeps its state ({} = start again, e.g. the ray came back onto the panel).
static func euro(st: Dictionary, x: Vector2, dt: float) -> Vector2:
	if not st.has("x"):
		st.x = x
		st.dx = Vector2.ZERO
		return x
	var prev: Vector2 = st.x
	var dx: Vector2 = (st.dx as Vector2).lerp((x - prev) / maxf(dt, 1e-4), _euro_a(EURO_D_HZ, dt))
	var out: Vector2 = prev.lerp(x, _euro_a(EURO_MIN_HZ + EURO_BETA * dx.length(), dt))
	st.dx = dx
	st.x = out
	return out


## WO-770: the desktop mirror's render size for a host of `size` px — its aspect, at most MIRROR_MAX, at least 16 px.
static func mirror_px(size: Vector2) -> Vector2i:
	if size.x <= 0.0 or size.y <= 0.0:
		return Vector2i(640, 360)
	var k := minf(1.0, minf(MIRROR_MAX.x / size.x, MIRROR_MAX.y / size.y))
	return Vector2i(maxi(16, roundi(size.x * k)), maxi(16, roundi(size.y * k)))


## WO-774 — owner 25.10: "In vr add ability to select via dragging a selection box over fixtures." A right trigger
## pressed off the heads and dragged past BOX_MIN_DEG draws a box between the press ray and the ray now, in the press
## ray's own view (x right, y up, the horizon level whatever the controller's roll); its release selects the heads
## whose centres show inside. Angles are radians: Vector2(right of the press ray, above it).
const BOX_MIN_DEG := 3.0
const BOX_DIST := 3.0  ## metres: where the drawn box hangs in front of the controller
const BOX_STEPS := 8  ## segments per drawn edge (an edge at a constant angle is a curve, not a straight line)


## The view of a ray `dir`: x right, y up (level with the floor), -z along the ray. Straight down: "up" is upstage.
static func view_frame(dir: Vector3) -> Basis:
	var f := dir.normalized()
	var up := Vector3.UP if absf(f.dot(Vector3.UP)) < 0.99 else Vector3(0, 0, -1)
	var right := f.cross(up).normalized()
	return Basis(right, right.cross(f), -f)


## `v` seen in `frame` → Vector2(angle right, angle up), or null when it is behind (90° or more off the ray).
static func view_angles(frame: Basis, v: Vector3) -> Variant:
	var l := frame.inverse() * v
	if -l.z <= 1e-6:
		return null
	return Vector2(atan2(l.x, -l.z), atan2(l.y, Vector2(l.x, l.z).length()))


## Whether the ray has moved far enough from the press (at `a`) to be a box, not a click.
static func dragged(a: Variant, min_deg := BOX_MIN_DEG) -> bool:
	return a is Vector2 and maxf(absf(a.x), absf(a.y)) >= deg_to_rad(min_deg)


## Whether `p` lies in the box from the press (0, 0) to `corner`, edges included.
static func in_box(corner: Vector2, p: Vector2) -> bool:
	return p.x >= minf(0.0, corner.x) and p.x <= maxf(0.0, corner.x) and p.y >= minf(0.0, corner.y) and p.y <= maxf(0.0, corner.y)


## The heads (id → {at: world centre, type}) inside the box dragged from ray `dir0` to `dir1`, both from `from`, left
## to right as the box sees them (then top down) — the order a fan spreads in. `only_type` = the panel's type filter.
static func box_pick(from: Vector3, dir0: Vector3, dir1: Vector3, heads: Dictionary, only_type := "") -> Array:
	var frame := view_frame(dir0)
	var corner: Variant = view_angles(frame, dir1)
	if corner == null:
		return []
	var inside: Array = []
	for id in heads:
		var h: Dictionary = heads[id]
		if only_type != "" and str(h.get("type", "")) != only_type:
			continue
		var a: Variant = view_angles(frame, (h.at as Vector3) - from)
		if a != null and in_box(corner, a):
			inside.append([a.x, -a.y, str(id)])
	inside.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	return inside.map(func(e: Array) -> String: return e[2])


## The drawn box: its outline as a closed line strip of world points BOX_DIST along the rays from `from`.
static func box_outline(from: Vector3, dir0: Vector3, dir1: Vector3, dist := BOX_DIST) -> PackedVector3Array:
	var out := PackedVector3Array()
	var frame := view_frame(dir0)
	var c: Variant = view_angles(frame, dir1)
	if c == null:
		return out
	var corners := [Vector2.ZERO, Vector2(c.x, 0.0), c, Vector2(0.0, c.y), Vector2.ZERO]
	for e in 4:
		for s in BOX_STEPS:
			out.append(from + frame * _ray_at((corners[e] as Vector2).lerp(corners[e + 1], float(s) / BOX_STEPS)) * dist)
	out.append(out[0])
	return out


static func _ray_at(a: Vector2) -> Vector3:
	return Vector3(cos(a.y) * sin(a.x), sin(a.y), -cos(a.y) * cos(a.x))


## The selection after a box: it replaces the selection (`add` = the left grip held: adds). An empty box changes
## nothing — a stray drag in the headset never wipes the selection (None clears it on the panel).
static func box_select(current: Array, picked: Array, add: bool) -> Array:
	if picked.is_empty():
		return current
	return current + picked.filter(func(id: String) -> bool: return not current.has(id)) if add else picked


## WO-774 — owner 25.10: "Then give a drop down to select only by fixture type." The patch's GDTF types: [{id, name,
## count}] by name; `names` = typeId → "Manufacturer Name" (GET /api/fixtures/types).
static func patch_types(patch: Array, names: Dictionary) -> Array:
	var count := {}
	for f in patch:
		var t := str(f.get("typeId", ""))
		if t != "":
			count[t] = int(count.get(t, 0)) + 1
	var out: Array = []
	for t in count:
		out.append({"id": t, "name": str(names.get(t, "")) if str(names.get(t, "")) != "" else "Type %s" % t.left(6), "count": count[t]})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.name < b.name or (a.name == b.name and a.id < b.id))
	return out


## The fixtures of type `type_id`, in patch order.
static func of_type(patch: Array, type_id: String) -> Array:
	return patch.filter(func(f: Dictionary) -> bool: return str(f.get("typeId", "")) == type_id).map(
		func(f: Dictionary) -> String: return str(f.id))


## WO-774 — owner 25.10: "the second one should change their fan." The right grip held (WO-841: with the left grip
## already held; alone the right grip points), the controller moved: pan fans by the sideways move, tilt by the up / down move. A fan spreads a value across the selection in its order:
## the first fixture moves -spread, the last +spread, the middle stays (fan_k), each from its own value and clamped
## to its range. FAN_DEAD_M of hand jitter does nothing; then FAN_DEG_PER_M degrees per metre (tune in the headset).
const FAN_DEG_PER_M := 150.0
const FAN_DEAD_M := 0.02


## Fixture `i` of `n` → its share of the spread, -1 (first) … 0 (middle) … +1 (last).
static func fan_k(i: int, n: int) -> float:
	return 0.0 if n <= 1 else 2.0 * i / (n - 1) - 1.0


## A hand move (metres) → degrees of spread.
static func fan_spread(m: float) -> float:
	return signf(m) * maxf(0.0, absf(m) - FAN_DEAD_M) * FAN_DEG_PER_M


## The controller from `p0` to `p1` (room metres), the head turned `head` → Vector2(pan spread, tilt spread) degrees:
## x along the head's level right, y up.
static func fan_move(p0: Vector3, p1: Vector3, head: Basis) -> Vector2:
	var r := Vector3(head.x.x, 0.0, head.x.z)
	r = r.normalized() if r.length() > 1e-4 else Vector3.RIGHT
	var d := p1 - p0
	return Vector2(fan_spread(d.dot(r)), fan_spread(d.y))


## What a fan starts from, in selection order: [{id, Pan: [value, lo, hi], Tilt: [...]}] for the fixtures that have
## pan or tilt. `feats` = GET /api/fixtures/program/features (pan / tilt {from, to, at}), `values` = GET
## /api/fixtures/program (physical degrees as programmed; unprogrammed = the channel's GDTF default `at`).
static func fan_bases(ids: Array, feats: Dictionary, values: Dictionary) -> Array:
	var out: Array = []
	for id in ids:
		var f: Dictionary = feats.get(id) if feats.get(id) is Dictionary else {}
		var v: Dictionary = values.get(id) if values.get(id) is Dictionary else {}
		var b := {"id": str(id)}
		for spec in [["pan", "Pan"], ["tilt", "Tilt"]]:
			var r: Variant = f.get(spec[0])
			if not (r is Dictionary and r.has("from") and r.has("to")):
				continue
			var lo := minf(float(r.from), float(r.to))
			var hi := maxf(float(r.from), float(r.to))
			var at: Variant = v.get(spec[1])
			b[spec[1]] = [float(at) if at is float or at is int else float(r.get("at", lo)), lo, hi]
		if b.size() > 1:
			out.append(b)
	return out


## The fanned values: id → {Pan, Tilt} (only the `axes` the hand has moved), each base + fan_k × spread, clamped.
static func fan_values(bases: Array, spread: Vector2, axes: Array = ["Pan", "Tilt"]) -> Dictionary:
	var out := {}
	for i in bases.size():
		var b: Dictionary = bases[i]
		var v := {}
		for spec in [["Pan", spread.x], ["Tilt", spread.y]]:
			if axes.has(spec[0]) and b.has(spec[0]):
				var r: Array = b[spec[0]]
				v[spec[0]] = snappedf(clampf(float(r[0]) + fan_k(i, bases.size()) * float(spec[1]), float(r[1]), float(r[2])), 0.01)
		if not v.is_empty():
			out[b.id] = v
	return out
