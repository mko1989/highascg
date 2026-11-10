extends Control
## WO-1029 plan 07 C9 — the PICTURE of a Live compose window whose screen is output by another linked server.
## The node relays the owner's small JPEG feed under the plain role (`pgm3`, feed_roles.gd); this layer, a child of
## compose_tiles.gd above the atlas crops, holds those roles only while the tiles are visible, draws each frame into the
## window (the parent's placeholder stays underneath until the first frame), keeps the "on <box>" cue on the picture,
## and greys the last frame with "no picture from <box>" when nothing came for 2 s (video_feed.gd LOST_AFTER_MS).
## No relay (older node, owner without the capability) → nothing is held and the placeholder shows as before.

const FR := preload("res://video/feed_roles.gd")
const CR := preload("res://features/live/compose_remote.gd")
const SC := preload("res://core/screen_channels.gd")
const REDRAW_S := 0.1  # the relay runs at ≤ 10 fps by default

var tiles: Control  # compose_tiles.gd
var _held: Array = []
var _acc := 0.0


func _init(owner_tiles: Control) -> void:
	tiles = owner_tiles
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	z_index = 1


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tree_exiting.connect(func() -> void:
		VideoSurfaces.release_all(self)
		_held = [])


func _remote_flags() -> Array:
	var out := []
	for c in tiles.cells:
		out.append(c is Dictionary and CR.is_remote(c))
	return out


func _process(delta: float) -> void:
	var want := FR.tile_roles(tiles.cells, _remote_flags(), VideoSurfaces.descriptors, tiles.is_visible_in_tree())
	for r in _held:
		if not (r in want):
			VideoSurfaces.release(r, self)
	for r in want:
		if not (r in _held):
			VideoSurfaces.acquire(r, self)
	var had := not _held.is_empty()
	_held = want
	_acc += delta
	if (had or not _held.is_empty()) and _acc >= REDRAW_S:  # once more after the last role goes: clears its picture
		_acc = 0.0
		queue_redraw()


func _draw() -> void:
	var font := get_theme_default_font()
	for i in tiles.cells.size():
		var c: Variant = tiles.cells[i]
		if not (c is Dictionary) or not CR.is_remote(c):
			continue
		var role := FR.screen_role(str(c.get("role", "")), int(c.get("mainIndex", -1)))
		if not (role in _held):
			continue
		var rd: Variant = VideoSurfaces.reader(role)
		var st := FR.tile_state(rd != null and int(rd.width) > 0, rd != null and bool(rd.signal_lost))
		if st == "none":
			continue
		var r: Rect2 = tiles._screen(i)
		draw_texture_rect(VideoSurfaces.texture(role), r, false, Color(0.45, 0.45, 0.45) if st == "stalled" else Color.WHITE)
		var who := VideoSurfaces.relay_server(role)
		var cue := SC.cue(Store.get_value("channelMap", {}), int(c.get("mainIndex", 0)), Store.cluster, who)
		var text := cue if st == "live" else "no picture from %s" % (who if who != "" else cue.trim_prefix("on "))
		var tl := TextLine.new()
		tl.add_string(text, font, 11)
		tl.width = maxf(0.0, r.size.x - 12.0)
		tl.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		draw_rect(Rect2(r.position, Vector2(minf(r.size.x, tl.get_size().x + 12.0), tl.get_size().y + 6.0)), Color(0, 0, 0, 0.55))
		tl.draw(get_canvas_item(), r.position + Vector2(6, 3), Color(1, 1, 1, 0.9) if st == "live" else Color("#fbbf24"))
