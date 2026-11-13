extends SceneTree
## WO-1065 — gamepads → players (retro_keys.gd assign_ports), and the window script still compiles.
##   godot --headless --path godot/retro -s res://tests/test_keys.gd   (exit 0 = pass)

const Keys := preload("res://retro_keys.gd")


func _init() -> void:
	var bad := 0
	var cases := [
		[[-1, -1, -1, -1], [], [-1, -1, -1, -1], "no pad"],
		[[-1, -1, -1, -1], [0], [0, -1, -1, -1], "first pad is player 1"],
		[[0, -1, -1, -1], [0, 1, 2, 3], [0, 1, 2, 3], "four pads, in order"],
		[[0, 1, -1, -1], [1], [-1, 1, -1, -1], "player 1 unplugged: player 2 stays player 2"],
		[[-1, 1, -1, -1], [1, 5], [5, 1, -1, -1], "a new pad takes the lowest free port"],
		[[0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3], "a fifth pad waits"],
		[[0, 1, 2, 3], [1, 2, 3, 4], [4, 1, 2, 3], "…and gets the port that frees up"],
		[[], [7], [7, -1, -1, -1], "short slot list"],
	]
	for c in cases:
		var got := Keys.assign_ports(c[0], c[1])
		if got != c[2]:
			bad += 1
			printerr("FAIL %s: %s → %s, expected %s" % [c[3], c[1], got, c[2]])
	if load("res://retro_window.gd") == null:
		bad += 1
		printerr("FAIL retro_window.gd does not compile")
	print("[retro keys] %d case(s), %d failed" % [cases.size() + 1, bad])
	quit(1 if bad else 0)
