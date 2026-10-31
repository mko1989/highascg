extends RefCounted
## WO-900 — fader sync ("soft takeover" / pickup) for a physical fader or knob bound to an in-app value (owner 31.10: "a
## physical fader doesn't move the in app fader until the irl fader is brought to the current value of the digital one").
##
## A binding starts WAITING. A physical move does nothing to the target until the physical value comes within TOL of the
## target's current value, or passes over it between two messages (a fast move skips 7-bit steps: 30 → 90 over a target at
## 60 is a pickup). From then it is LIVE: every move sets the target. Whenever the target's value is no longer the one this
## binding last set (a UI drag, a look recall, a playlist or the autopilot moved it), it is WAITING again.
## Values are 0..1 on both sides: the physical one is the 7-bit value / 127, the target's is its Range.ratio. A target with a
## coarser step than 1/127 reads back its own quantised value (took()), so its rounding never counts as "moved elsewhere".

const TOL := 1.5 / 127.0  # 1.5 steps of 7-bit: every target value has a physical step within reach
const EPS := 0.0005  # a target value this far from the last one set was moved by something else


## {live, hw: the last physical value (-1 = none seen), sent: the target value read back after the last set (-1 = none)}
static func new_state() -> Dictionary:
	return {"live": false, "hw": -1.0, "sent": -1.0}


## The target's value now, from anywhere: a value other than the one this binding last set → waiting for pickup again.
static func observe(st: Dictionary, app: float) -> void:
	if st.live and absf(app - float(st.sent)) > EPS:
		st.live = false


## A physical move to `hw` against the target's current value `app`: the value to set it to, or -1.0 (still waiting).
static func move(st: Dictionary, hw: float, app: float, tol := TOL) -> float:
	observe(st, app)
	var prev := float(st.hw)
	st.hw = hw
	if not st.live:
		var crossed := prev >= 0.0 and (prev - app) * (hw - app) <= 0.0
		if absf(hw - app) > tol and not crossed:
			return -1.0
		st.live = true
	return hw


## A position reported, not moved (the APC40 sends every fader's position when it is greeted): remembered, nothing set.
## Already at the target's value → live; else waiting, and the UI can show where it is.
static func seen(st: Dictionary, hw: float, app: float, tol := TOL) -> void:
	st.hw = hw
	st.live = absf(hw - app) <= tol
	st.sent = app


## After a set: the target's value as it reads back now (its own step applied).
static func took(st: Dictionary, app_now: float) -> void:
	st.sent = app_now


## Waiting with a known physical position — the UI shows that position as a ghost marker on the target.
static func waiting(st: Dictionary) -> bool:
	return not st.live and float(st.hw) >= 0.0
