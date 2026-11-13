extends RefCounted
## WO-1067 — a game controller flies the Previs camera (previs_stage.gd reads the first pad while the Previs tab shows
## the 3D stage). Pure maths here (tests/test_pad_camera.gd):
##   left stick    move: forward / back along the view, left / right across it
##   right stick   look around the orbit point (as a left-button drag)
##   L2 / R2       further / closer (as the wheel)
##   L1 / R1       down / up

const DEADZONE := 0.18
const ORBIT_RAD_S := 1.6  # full stick: radians per second
const ZOOM_PER_S := 1.2  # full trigger: the distance changes by this factor per second (e^±)
const MOVE_DIST_S := 0.8  # full stick: this share of the orbit distance per second (far away = faster)
const MIN_MOVE := 3.0  # …but never slower than this many metres per second


## A stick value with the dead zone cut out and the rest stretched back to 0..1, squared for fine control near centre.
static func axis(v: float) -> float:
	var a := absf(v)
	if a <= DEADZONE:
		return 0.0
	var t := (minf(a, 1.0) - DEADZONE) / (1.0 - DEADZONE)
	return signf(v) * t * t


## The pad's state as the camera needs it. `raw`: {lx, ly, rx, ry, lt, rt} in Godot's ranges (sticks −1..1 with down
## and right positive, triggers 0..1), `l1` / `r1` booleans.
## → {yaw, pitch, zoom, forward, strafe, lift} per second at full deflection = 1; all 0 = the pad is at rest.
static func intent(raw: Dictionary) -> Dictionary:
	return {
		"yaw": -axis(float(raw.get("rx", 0.0))),
		"pitch": axis(float(raw.get("ry", 0.0))),
		"zoom": clampf(float(raw.get("lt", 0.0)), 0.0, 1.0) - clampf(float(raw.get("rt", 0.0)), 0.0, 1.0),
		"forward": -axis(float(raw.get("ly", 0.0))),
		"strafe": axis(float(raw.get("lx", 0.0))),
		"lift": float(raw.get("r1", false)) - float(raw.get("l1", false)),
	}


static func at_rest(i: Dictionary) -> bool:
	for k in i:
		if absf(float(i[k])) > 0.0001:
			return false
	return true


## One frame of orbit: → {yaw, pitch, dist} from the current ones (the stage's limits: pitch −0.2..1.5, dist min..80).
static func orbit(yaw: float, pitch: float, dist: float, i: Dictionary, dt: float, min_dist: float) -> Dictionary:
	return {
		"yaw": yaw + float(i.yaw) * ORBIT_RAD_S * dt,
		"pitch": clampf(pitch + float(i.pitch) * ORBIT_RAD_S * dt, -0.2, 1.5),
		"dist": clampf(dist * exp(float(i.zoom) * ZOOM_PER_S * dt), min_dist, 80.0),
	}


## Metres to move this frame: {forward, strafe, lift}.
static func move(dist: float, i: Dictionary, dt: float) -> Dictionary:
	var speed := maxf(MIN_MOVE, dist * MOVE_DIST_S)
	return {"forward": float(i.forward) * speed * dt, "strafe": float(i.strafe) * speed * dt, "lift": float(i.lift) * speed * 0.6 * dt}
