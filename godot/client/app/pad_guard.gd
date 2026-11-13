extends RefCounted
## WO-1067 — game controllers never work the GUI. Godot's built-in ui_* actions (focus left / right / up / down, accept,
## cancel, page up / down …) each carry a gamepad binding, so a connected pad moved the keyboard focus across the
## Operator window and pressed whatever it landed on (owner 13.11: "i can see focus change on gui elements when moving
## analog"). Pads belong to the game window (godot/retro) and to the Previs camera, which read them directly
## (Input.get_joy_axis), not through actions — so every gamepad binding is taken off every action at start-up.


## Removes the joypad button / stick events of every action. Returns how many were removed.
static func strip() -> int:
	var n := 0
	for action in InputMap.get_actions():
		for ev in InputMap.action_get_events(action):
			if ev is InputEventJoypadButton or ev is InputEventJoypadMotion:
				InputMap.action_erase_event(action, ev)
				n += 1
	return n
