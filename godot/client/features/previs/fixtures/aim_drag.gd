extends RefCounted
## WO-679 — right-click a head in the previs 3D view, hold and move: the selection points at the stage floor under the
## mouse (the server aims through the follow IK, as Point at does). A head outside the selection selects it alone.
## One aim request in flight; moves meanwhile keep only the newest target. Release → `sel.aimed` (sliders follow).

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")

var sel: RefCounted = Sel.shared()
var post: Callable  ## (body: Dictionary) → awaitable result; the tab passes Api.post_json on /api/fixtures/program/aim
var active := false
var _busy := false
var _next: Variant = null  # the newest target not sent yet


## → whether the event belonged to an aim drag. `rig.hit(cam, pos)` names the fixture body under the mouse.
func input(e: InputEvent, cam: Camera3D, rig: Object) -> bool:
	var mb := e as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_RIGHT:
		if mb.pressed:
			var id: String = rig.hit(cam, mb.position)
			if id == "":
				return false
			if not sel.ids.has(id):
				sel.pick(id, false)
			active = true
			return true
		if not active:
			return false
		active = false
		if not _busy:
			sel.aimed.emit()
		return true
	var mm := e as InputEventMouseMotion
	if mm != null and active:
		var hit: Variant = F.floor_hit(cam.project_ray_origin(mm.position), cam.project_ray_normal(mm.position))
		if hit != null:
			aim([hit.x, -hit.z, 0.0])
		return true
	return false


## Sends `psn` (PSN [x, y, z] metres), or keeps it for when the request in flight returns.
func aim(psn: Array) -> void:
	_next = psn
	if _busy or not post.is_valid():
		return
	_busy = true
	while _next != null:
		var t: Array = _next
		_next = null
		await post.call({"ids": sel.ids.duplicate(), "target": t})
	_busy = false
	if not active:
		sel.aimed.emit()
