extends RefCounted
## WO-745 — keyboard and gamepad → libretro joypad ids (libretro.h RETRO_DEVICE_ID_JOYPAD_*), RetroArch's default
## keyboard layout and a positional pad layout (the bottom face button is the SNES "B", as on the real pad).

const B := 0
const Y := 1
const SELECT := 2
const START := 3
const UP := 4
const DOWN := 5
const LEFT := 6
const RIGHT := 7
const A := 8
const X := 9
const L := 10
const R := 11

const KEYS := {
	KEY_UP: UP, KEY_DOWN: DOWN, KEY_LEFT: LEFT, KEY_RIGHT: RIGHT,
	KEY_X: A, KEY_Z: B, KEY_S: X, KEY_A: Y, KEY_Q: L, KEY_W: R,
	KEY_ENTER: START, KEY_KP_ENTER: START, KEY_SHIFT: SELECT,
}
const PAD := {
	JOY_BUTTON_A: B, JOY_BUTTON_B: A, JOY_BUTTON_X: Y, JOY_BUTTON_Y: X,
	JOY_BUTTON_BACK: SELECT, JOY_BUTTON_START: START,
	JOY_BUTTON_LEFT_SHOULDER: L, JOY_BUTTON_RIGHT_SHOULDER: R,
	JOY_BUTTON_DPAD_UP: UP, JOY_BUTTON_DPAD_DOWN: DOWN, JOY_BUTTON_DPAD_LEFT: LEFT, JOY_BUTTON_DPAD_RIGHT: RIGHT,
}


## The joypad id a key event maps to, or -1.
static func for_key(keycode: Key) -> int:
	return KEYS.get(keycode, -1)


## Pressed joypad ids of gamepad `device` (buttons, plus the left stick as a d-pad past half way).
static func pad_state(device: int) -> Dictionary:
	var on := {}
	for b in PAD:
		if Input.is_joy_button_pressed(device, b):
			on[PAD[b]] = true
	var sx := Input.get_joy_axis(device, JOY_AXIS_LEFT_X)
	var sy := Input.get_joy_axis(device, JOY_AXIS_LEFT_Y)
	if sx < -0.5: on[LEFT] = true
	if sx > 0.5: on[RIGHT] = true
	if sy < -0.5: on[UP] = true
	if sy > 0.5: on[DOWN] = true
	return on
