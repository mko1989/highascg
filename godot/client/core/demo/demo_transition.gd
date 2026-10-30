extends RefCounted
## WO-865 — the demo display engine's transition math (pure). What the node does with a take: scene-transition.js
## fades / moves the incoming look's layers over `defaultTransition.duration` FRAMES of the channel (type CUT | MIX |
## PUSH | WIPE | SLIDE, each also "… + ANIMATE" on a PGM-only main; tween = Caspar tween name; the default is
## client/lib/transition-presets.js DEFAULT_TRANSITION = CUT, the demo looks and the deck's globalDefaultTransition carry
## MIX 12 frames). Here: the type's base name, the duration in seconds on the channel's fps, the eased progress, and what
## a type does to the incoming / outgoing picture at progress p.

## A visitor must be able to SEE a fade: 12 frames at 50 fps is 0.24 s, so every non-CUT transition lasts at least this.
const MIN_SECONDS := 0.5
## Fade to black (POST /api/ftb has no duration of its own in the demo) and PRV clear.
const CLEAR_SECONDS := 0.6
const DEFAULT_FPS := 25.0


## "MIX + ANIMATE" → "MIX"; anything unknown → "MIX"; "" / null → "CUT".
static func base_type(tr: Variant) -> String:
	var t := str(tr.get("type", "")).to_upper().split("+")[0].strip_edges() if tr is Dictionary else ""
	if t == "":
		return "CUT"
	return t if t in ["CUT", "MIX", "PUSH", "WIPE", "SLIDE"] else "MIX"


## Seconds the transition lasts on a channel of `fps` (0 for a CUT or zero frames).
static func seconds(tr: Variant, fps: float) -> float:
	if base_type(tr) == "CUT" or not (tr is Dictionary):
		return 0.0
	var frames := float(tr.get("duration", 0))
	if frames <= 0.0:
		return 0.0
	return maxf(MIN_SECONDS, frames / (fps if fps > 0.0 else DEFAULT_FPS))


## Caspar tween names: linear, easeinquad, easeoutsine, easeinoutcubic, … (family = quad, cubic, quart, sine, expo, …).
static func ease(tween: String, p: float) -> float:
	var x := clampf(p, 0.0, 1.0)
	var t := tween.to_lower()
	if not (t.begins_with("easein") or t.begins_with("easeout")):
		return x
	var power := 3.0 if t.ends_with("cubic") else (4.0 if t.ends_with("quart") else (5.0 if t.ends_with("quint") else 2.0))
	if t.begins_with("easeinout"):
		return 0.5 * pow(2.0 * x, power) if x < 0.5 else 1.0 - 0.5 * pow(2.0 * (1.0 - x), power)
	if t.begins_with("easein"):
		return pow(x, power)
	return 1.0 - pow(1.0 - x, power)


## How the incoming look is drawn at eased progress `e` on a `size` canvas: {alpha, offset (px), clip (px Rect2 or empty)}.
static func incoming(type: String, e: float, size: Vector2) -> Dictionary:
	match type:
		"SLIDE", "PUSH":
			return {"alpha": 1.0, "offset": Vector2(size.x * (1.0 - e), 0), "clip": Rect2()}
		"WIPE":
			return {"alpha": 1.0, "offset": Vector2.ZERO, "clip": Rect2(0, 0, maxf(size.x * e, 0.01), size.y)}  # never empty: empty = "no clip"
	return {"alpha": e, "offset": Vector2.ZERO, "clip": Rect2()}


## The outgoing look: a MIX keeps the layers the incoming look covers and fades the others out (the node's
## scene-exit-layers); a PUSH moves everything left; SLIDE / WIPE leave it. `covered` = the incoming look has a layer
## on this layer number.
static func outgoing(type: String, e: float, size: Vector2, covered: bool) -> Dictionary:
	match type:
		"PUSH":
			return {"alpha": 1.0, "offset": Vector2(-size.x * e, 0), "clip": Rect2()}
		"SLIDE", "WIPE":
			return {"alpha": 1.0, "offset": Vector2.ZERO, "clip": Rect2()}
	return {"alpha": 1.0 if covered else 1.0 - e, "offset": Vector2.ZERO, "clip": Rect2()}
