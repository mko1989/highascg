extends Control
## WO-901 — the lockscreen's "Bounce" style: ONE HighAsCG character (the LED test pattern's six eye frames, shrunk to
## assets/ui/bounce/) drifting DVD-style; the eyes change on every wall bounce. All motion maths is core/bounce_model.gd
## (unit-tested). Cheap by design: a _draw of one textured rect per frame, no shaders, and _process only runs while the
## control is visible in the tree (the overlay's root is hidden when unlocked).

const BounceModel := preload("res://core/bounce_model.gd")

var size_pct := BounceModel.SIZE_DEFAULT
var speed := BounceModel.SPEED_DEFAULT
var frame := 0
var pos := Vector2.ZERO
var vel := Vector2.ZERO

static var _tex: Array = []  # Texture2D per BounceModel.FRAMES, loaded once for the process

var _rng := RandomNumberGenerator.new()
var _started := false
var _box := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	_rng.randomize()
	frame = _rng.randi() % BounceModel.FRAMES.size()
	set_process(false)
	visibility_changed.connect(func() -> void:
		set_process(is_visible_in_tree())
		if is_visible_in_tree():
			restart())


## The six frames (a missing file leaves null → that frame is skipped when drawing).
static func textures() -> Array:
	if _tex.is_empty():
		for f in BounceModel.FRAMES:
			var img := Image.new()
			if img.load_png_from_buffer(FileAccess.get_file_as_bytes(BounceModel.DIR + f + ".png")) == OK:
				img.generate_mipmaps()
				_tex.append(ImageTexture.create_from_image(img))
			else:
				_tex.append(null)
	return _tex


## New size / speed prefs (Settings → Lockscreen): the character keeps going from where it is, rescaled.
func configure(new_size_pct: int, new_speed: float) -> void:
	var old_px := BounceModel.speed_px(_box, speed)
	size_pct = BounceModel.clamp_size(new_size_pct)
	speed = BounceModel.clamp_speed(new_speed)
	if _started:
		_box = BounceModel.box_px(size, size_pct)
		var new_px := BounceModel.speed_px(_box, speed)
		vel = vel * (new_px / old_px) if old_px > 0.0 else vel
	queue_redraw()


## A fresh random start (each lock).
func restart() -> void:
	_started = false
	queue_redraw()


func drawn_size() -> Vector2:
	var t: Texture2D = textures()[frame]
	return BounceModel.fit(_box, t.get_size() if t else Vector2.ONE)


func _process(delta: float) -> void:
	if size.x < 1.0 or size.y < 1.0:
		return
	_box = BounceModel.box_px(size, size_pct)
	if not _started:
		var s := BounceModel.start(size, drawn_size(), BounceModel.speed_px(_box, speed), _rng)
		pos = s.pos
		vel = s.vel
		_started = true
	var r := BounceModel.step(pos, vel, delta, size, drawn_size())
	pos = r.pos
	vel = r.vel
	if r.hit:
		frame = BounceModel.next_frame(frame, BounceModel.FRAMES.size(), _rng.randf())
	queue_redraw()


func _draw() -> void:
	var t: Texture2D = textures()[frame]
	if t != null and _started:
		draw_texture_rect(t, Rect2(pos, drawn_size()), false)
