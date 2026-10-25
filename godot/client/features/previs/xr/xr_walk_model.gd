extends RefCounted
## WO-741 (future development, detachable) — the pure part of walking the previs: first-person moves at 1:1 (the MVR's
## metres are real metres), mouse / stick look, snap turn, and what a controller trigger does. Godot frame: y up, the
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


## A trigger along a ray. `hit_id` = the head the ray goes through (else `near_id`, the head centred nearest it);
## a head → {do: "pick", id, add} (grip held adds, as ctrl-click); no head with a selection → the floor under the ray
## → {do: "aim", psn} (the server's follow IK, as Point at / a right-drag); else {do: "none"}.
static func trigger(hit_id: String, near_id: String, has_sel: bool, from: Vector3, dir: Vector3, add := false) -> Dictionary:
	var id := hit_id if hit_id != "" else near_id
	if id != "":
		return {"do": "pick", "id": id, "add": add}
	if not has_sel:
		return {"do": "none"}
	var at: Variant = F.floor_hit(from, dir)
	return {"do": "aim", "psn": [at.x, -at.z, 0.0]} if at != null else {"do": "none"}


## WO-757: the Programmer panel (xr_panel.gd) — its quad in metres and its pixels (2 per mm, the same aspect).
const PANEL_SIZE := Vector2(0.30, 0.42)
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
