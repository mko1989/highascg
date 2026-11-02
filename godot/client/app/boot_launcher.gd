extends Node
## WO-934 — `--boot-launcher`: only the start-up prompts, no operator GUI. run-client.sh --autostart runs this once the
## node answers and a start-up question is pending, and starts the GUI only after it is answered (never when the
## answer is Run headless). The GUI used to come up first and sit there until the node asked, a minute on a stick boot.
## The main window cannot be hidden in Godot: it starts small (run-client.sh --resolution) and is minimized at once.

const ScreenPicker := preload("res://app/operator_screen_picker.gd")


func _ready() -> void:
	var w := get_window()
	w.mode = Window.MODE_MINIMIZED
	var api := DevicesTarget.box_api
	var r: Dictionary = await api.get_json("/api/system/operator-screen")
	while int(r.get("status", 0)) == 0 and is_inside_tree():  # run-client.sh waited for it; a restart can still race
		await get_tree().create_timer(2.0).timeout
		r = await api.get_json("/api/system/operator-screen")
	var boot: Variant = r.data.get("boot") if r.ok and r.data is Dictionary else null
	if not boot is Dictionary or not bool((boot as Dictionary).get("pending", false)):
		print("[launcher] no start-up question pending")
		get_tree().quit()
		return
	var picker := ScreenPicker.new()
	picker.api = api
	add_child(picker)
	picker.finished.connect(func(res: Dictionary) -> void:
		print("[launcher] answered: ", "headless" if res.get("headless", false) else res.get("name", res.get("error", "")))
		get_tree().quit())
	if not await picker.open_boot(boot):
		print("[launcher] the prompts could not open")
		get_tree().quit()
