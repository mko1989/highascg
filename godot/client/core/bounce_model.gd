extends RefCounted
## WO-901 — the pure half of the lockscreen's "Bounce" style (app/bounce_character.gd draws it): ONE HighAsCG character
## drifting DVD-style over the screen, its eyes swapped on every wall bounce. The motion mirrors the LED test pattern's
## bouncing character (template/led_grid_test-render.js, WO-411): the box is a fraction of the shorter screen side, the
## speed is the box size in px per second per axis (±20 % jitter), the wall test uses the DRAWN glyph rect, the frame
## step is capped at 0.1 s, and a bounce picks another of the six eye frames. Prefs live in lock_model.gd (ui.cfg).

## The test pattern's six frames: three eye states in the two eye colours. "{colour}_{open|left|right}" = the PNG name
## under assets/ui/bounce/ (the test pattern's ch_*_green.svg and both_open / left_closed / right_closed .svg, shrunk).
const FRAMES := ["green_open", "green_left", "green_right", "red_open", "red_left", "red_right"]
const DIR := "res://assets/ui/bounce/"
const SIZE_MIN := 10  # percent of the shorter screen side (the box the character is fitted in)
const SIZE_MAX := 60
const SIZE_DEFAULT := 26  # the test pattern's 0.26
const SPEED_MIN := 0.1  # × the box size per second
const SPEED_MAX := 3.0
const SPEED_DEFAULT := 1.0
const MIN_BOX_PX := 40.0
const MAX_DT := 0.1  # a stall (window drag, load) never teleports the character through a wall


static func clamp_size(v: Variant) -> int:
	return clampi(roundi(float(v)), SIZE_MIN, SIZE_MAX) if v is int or v is float else SIZE_DEFAULT


static func clamp_speed(v: Variant) -> float:
	return snappedf(clampf(float(v), SPEED_MIN, SPEED_MAX), 0.05) if v is int or v is float else SPEED_DEFAULT


## The square the character is fitted in: `pct` of the shorter side of `bounds`, at least MIN_BOX_PX.
static func box_px(bounds: Vector2, pct: float) -> float:
	return maxf(MIN_BOX_PX, roundf(minf(bounds.x, bounds.y) * pct / 100.0))


## Aspect-fit a texture of `tex` px into the `box` square (the longer side = box), like the test pattern's drawW/drawH.
static func fit(box: float, tex: Vector2) -> Vector2:
	if tex.x <= 0.0 or tex.y <= 0.0:
		return Vector2(box, box)
	var ratio := tex.x / tex.y
	return Vector2(box, box / ratio) if ratio > 1.0 else Vector2(box * ratio, box)


## Px per second on each axis: the box size × the speed pref.
static func speed_px(box: float, speed: float) -> float:
	return box * speed


## A random start: top-left inside the screen, ±(0.8…1.2) × speed_px on each axis, either direction.
static func start(bounds: Vector2, drawn: Vector2, speed: float, rng: RandomNumberGenerator) -> Dictionary:
	var travel := Vector2(maxf(10.0, bounds.x - drawn.x), maxf(10.0, bounds.y - drawn.y))
	var v := Vector2(speed * rng.randf_range(0.8, 1.2), speed * rng.randf_range(0.8, 1.2))
	if rng.randf() < 0.5:
		v.x = -v.x
	if rng.randf() < 0.5:
		v.y = -v.y
	return {"pos": Vector2(rng.randf() * travel.x, rng.randf() * travel.y), "vel": v}


## One frame. `pos` = top-left of the drawn rect (size `drawn`) inside `bounds`. → {pos, vel, hit} where hit = a wall
## was touched (the eyes change). An axis the character does not fit on never moves and never "bounces".
static func step(pos: Vector2, vel: Vector2, dt: float, bounds: Vector2, drawn: Vector2) -> Dictionary:
	var p := pos + vel * minf(maxf(dt, 0.0), MAX_DT)
	var v := vel
	var hit := false
	var room := Vector2(bounds.x - drawn.x, bounds.y - drawn.y)
	if room.x <= 0.0:
		p.x = 0.0
	elif p.x < 0.0:
		p.x = 0.0
		v.x = absf(v.x)
		hit = true
	elif p.x > room.x:
		p.x = room.x
		v.x = -absf(v.x)
		hit = true
	if room.y <= 0.0:
		p.y = 0.0
	elif p.y < 0.0:
		p.y = 0.0
		v.y = absf(v.y)
		hit = true
	elif p.y > room.y:
		p.y = room.y
		v.y = -absf(v.y)
		hit = true
	return {"pos": p, "vel": v, "hit": hit}


## The next eye frame after a bounce: `r` in [0,1) picks among the OTHER frames (the eyes always visibly change).
static func next_frame(cur: int, count: int, r: float) -> int:
	if count < 2:
		return 0
	var k := clampi(int(r * (count - 1)), 0, count - 2)
	return k if k < cur else k + 1
