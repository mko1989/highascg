extends RefCounted
## WO-962 — the Trim section's clip transport: jump / step targets (clip_trim_model.gd).

const T := preload("res://features/live/clip_trim_model.gd")
var t


func test_jump_targets() -> void:
	t.eq(T.jump_ms({}, 10000.0, T.JUMP_IN, 25.0), 0.0, "no trim: in = clip start")
	t.eq(T.jump_ms({"trimInMs": 2000}, 10000.0, T.JUMP_IN, 25.0), 2000.0, "in = the stored in point")
	t.eq(T.jump_ms({}, 10000.0, T.JUMP_OUT, 25.0), 9960.0, "no trim: out = last frame of the clip")
	t.eq(T.jump_ms({"trimOutMs": 8000}, 10000.0, T.JUMP_OUT, 25.0), 7960.0, "out = the frame before the out point")
	t.eq(T.jump_ms({"trimInMs": 5000, "trimOutMs": 5020}, 10000.0, T.JUMP_OUT, 25.0), 5000.0, "never before the in point")


func test_step_targets() -> void:
	t.eq(T.step_ms(1000.0, 1, 10000.0, 25.0), 1040.0, "one frame forward")
	t.eq(T.step_ms(1000.0, -1, 10000.0, 25.0), 960.0, "one frame back")
	t.eq(T.step_ms(0.0, -1, 10000.0, 25.0), 0.0, "stops at the start")
	t.eq(T.step_ms(10000.0, 1, 10000.0, 25.0), 10000.0, "stops at the end")
