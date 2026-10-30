extends RefCounted
## WO-860 — the look editor's frame shows the PRV channel; a main without a PRV bus gets the look composited from HQ
## source thumbnails (look_thumb.gd) under the layer boxes instead, and it follows the edits.

const Backdrop := preload("res://features/live/look_editor_backdrop.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
var t


## The look editor's surface the backdrop uses (look_editor.gd: _frame / _video / _thumb, main, look(), _canvas()).
class FakeEditor:
	extends Control
	var main := 0
	var _frame := Control.new()
	var _video := TextureRect.new()
	var _thumb: Control
	var lk := {"id": "lt", "layers": [{"layerNumber": 10, "source": {"type": "template", "value": "LOWER-THIRDS/LT-CLASSIC-BOX"}}]}

	func _init() -> void:
		_frame.add_child(_video)
		_frame.add_child(Control.new())  # the boxes overlay, after the video

	func look() -> Dictionary:
		return lk

	func _canvas() -> Vector2:
		return Vector2(1920, 1080)


## look_thumb.gd's surface the backdrop uses (setup / refresh / look).
class FakeThumb:
	extends Control
	var look := {}

	func setup(l: Dictionary, _res: Vector2, _cm: Dictionary) -> void:
		look = l

	func refresh(l: Dictionary) -> void:
		look = l


const PGM_ONLY := {"programChannels": [1], "previewChannels": [], "previewEnabledByMain": [false]}


func test_pgm_only_main_gets_thumbnails_under_the_boxes() -> void:
	t.ok(not DeckModel.preview_bus_available(PGM_ONLY, 0), "fixture: no PRV bus on main 1")
	var ed := FakeEditor.new()
	t.eq(Backdrop.open_with(ed, PGM_ONLY, FakeThumb.new), "", "no video role to hold")
	t.ok(ed._thumb is FakeThumb and not ed._video.visible, "thumbnails instead of the (absent) PRV surface")
	t.eq(ed._thumb.look, ed.lk, "the thumbnails composite the edited look")
	t.eq(ed._thumb.get_index(), 1, "between the video and the boxes overlay")
	Backdrop.place(ed, Rect2(10, 20, 320, 180))
	t.eq(ed._thumb.position, Vector2(10, 20), "placed on the canvas box")
	t.eq(ed._thumb.size, Vector2(320, 180), "sized to the canvas box")
	ed.lk = {"id": "lt", "layers": []}
	Backdrop.refresh(ed)
	t.eq(ed._thumb.look, ed.lk, "the backdrop follows the edited look")
	var first: Control = ed._thumb
	Backdrop.open_with(ed, PGM_ONLY, FakeThumb.new)
	t.ok(ed._thumb != first and first.is_queued_for_deletion(), "reopening replaces the old backdrop")
	ed._frame.free()
	ed.free()
