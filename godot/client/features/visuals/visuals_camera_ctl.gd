extends Node
## WO-896 — the Visuals tab's camera control: the 3D view's orbit (visuals_workarea.gd) → the output stage camera. "Drive output"
## on: every orbit move writes the pose into `slice.camera` and onto the live deck (visuals_deck.gd `cam`, so every layer of the
## stack gets the same camera and stays aligned); off: the output keeps `slice.camera`'s pose and orbiting only moves the editor
## view. The pose and the switch are part of a look (visuals_looks.gd KEYS): a recall (the tab's `_go(true)`) hands the look's pose
## to the INCOMING deck only, so a crossfade between two framings never moves the picture that fades in or out. Lives under the
## tab (visuals_tab.gd) and edits its slice.

const Cam := preload("res://features/visuals/visuals_camera.gd")
const STORE_S := 0.5  # an orbit drag writes the project at most this often (the last pose always goes out)

var tab: Node
var _store_t: Timer


func _init(t: Node) -> void:
	tab = t
	_store_t = Timer.new()
	_store_t.one_shot = true
	_store_t.wait_time = STORE_S
	_store_t.timeout.connect(func() -> void: tab._store())
	add_child(_store_t)
	tab.work.orbit_changed.connect(_on_orbit)


## The pose the output uses now (slice.camera): what the tab hands to the mixer with every stack.
func pose() -> Vector3:
	return Cam.pose_of(tab.slice.camera)


## The slice was (re)loaded or a look recalled: the switch shows its state and, when driving, the editor orbit joins the pose.
func from_slice() -> void:
	var c: Dictionary = tab.slice.camera
	tab.work.drive.set_pressed_no_signal(c.drive)
	if c.drive:
		tab.work.orbit = Cam.pose_of(c)


func _on_orbit() -> void:
	var on: bool = tab.work.drive.button_pressed
	var c: Dictionary = tab.slice.camera
	tab.slice.camera = Cam.with_pose(c, tab.work.orbit if on else Cam.pose_of(c))
	tab.slice.camera.drive = on
	tab.mixer.deck().cam = pose()
	if is_inside_tree():
		_store_t.start()
