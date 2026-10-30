extends Node
## WO-865 — the demo display engine's GPU half (VideoSurfaces owns one in a demo). Every role VideoSurfaces hands out is a
## SubViewport whose texture IS the role's Texture2D (no RGBA frames, no uploads: a browser's single thread does not have
## the time for per-pixel Image work at 25-30 fps):
##   - pgmN / prvN / chN: black + one demo_bus_view.gd of that channel's bus (demo_server.gd bus(): the look on air, its
##     layer opacity / placement / rotation, the take's fade);
##   - opgui, the operator surface: black + one scaled, clipped bus view per PGM / PRV window of the compose layout.
## `step()` runs once a frame with the roles somebody holds; only those viewports render. Real clips (Ogg Theora) play in
## VideoStreamPlayer nodes, one per layer instance (key = channel | layer | media | start), freed when no view asks for
## them any more; a clip that ended without `loop` is paused on its last frame, like Caspar holds it.

const Video := preload("res://core/demo/demo_video.gd")
const BusView := preload("res://core/demo/demo_bus_view.gd")

const KEEP_S := 1.0  ## a player nobody asks for lives this long (a tab switch does not restart the clip)

var server: RefCounted
var _surfaces := {}  # role → {vp, root, views: Array, sig}
var _players := {}  # key → {player, seen (s)}
var _now := 0.0


func _init(server_: RefCounted) -> void:
	server = server_


## The role's texture (stable for the life of the stage); rendering starts when `step` sees the role held.
func texture(role: String) -> Texture2D:
	return _surface(role).vp.get_texture()


func surface_size(role: String) -> Vector2i:
	return _surface(role).vp.size


func _surface(role: String) -> Dictionary:
	if not _surfaces.has(role):
		var vp := SubViewport.new()
		vp.disable_3d = true
		vp.gui_disable_input = true
		vp.transparent_bg = false
		vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
		vp.size = Vector2i(960, 540)
		var root := Control.new()
		root.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)  # the viewport's whole size, whatever it becomes
		var bg := ColorRect.new()
		bg.color = Color.BLACK
		bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bg.set_anchors_preset(Control.PRESET_FULL_RECT)
		root.add_child(bg)
		vp.add_child(root)
		add_child(vp)
		_surfaces[role] = {"vp": vp, "root": root, "views": [], "sig": ""}
	return _surfaces[role]


## Once a frame: draw what is held, retire the clips nobody shows.
func step(held: Array, now: float) -> void:
	_now = now
	for role in _surfaces:
		var s: Dictionary = _surfaces[role]
		var on: bool = held.has(role)
		s.vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
		if on:
			refresh(role, now)
	_retire()


## Bring a surface's views up to date at `now` (public: tests drive it without a render loop).
func refresh(role: String, now: float) -> void:
	_now = now
	var s := _surface(role)
	if role == Video.OPERATOR:
		_refresh_operator(s, now)
		return
	var ch := Video.role_channel(role, server.state.get("channelMap"))
	if ch <= 0:
		_views(s, 0, Vector2i(960, 540))
		return
	var bus: RefCounted = server.bus(ch, now)
	var v: Control = _views(s, 1, bus.size)[0]
	(v as Control).position = Vector2.ZERO
	v.apply(bus.frame(now))


func _refresh_operator(s: Dictionary, now: float) -> void:
	var canvas := Video.operator_size(server)
	if s.vp.size != canvas:
		s.vp.size = canvas
	var wins := []
	for c in server.op_cells:
		var cp: Dictionary = Video.cell_picture(server, c, Vector2(canvas))
		if not cp.is_empty():
			wins.append(cp)
	var sig := "%s|%s" % [str(wins), str(canvas)]
	if sig != s.sig:  # the compose layout changed: rebuild the windows
		s.sig = sig
		_clear(s)
		for w in wins:
			var clipper := Control.new()
			clipper.mouse_filter = Control.MOUSE_FILTER_IGNORE
			clipper.clip_contents = true
			clipper.position = (w.rect as Rect2).position.round()
			clipper.size = (w.rect as Rect2).size.round()
			var view: Control = BusView.new()
			view.stage = self
			clipper.add_child(view)
			s.root.add_child(clipper)
			s.views.append({"clipper": clipper, "view": view, "channel": int(w.channel)})
	for w in s.views:
		var bus: RefCounted = server.bus(int(w.channel), now)
		var view: Control = w.view
		if view.size != Vector2(bus.size):
			view.size = Vector2(bus.size)
			view.scale = (w.clipper as Control).size / Vector2(bus.size)
		view.apply(bus.frame(now))


## `count` bus views (0 or 1) of `sz` inside a plain bus surface.
func _views(s: Dictionary, count: int, sz: Vector2i) -> Array:
	if s.vp.size != sz:
		s.vp.size = sz
	if s.views.size() != count:
		_clear(s)
		for i in count:
			var view: Control = BusView.new()
			view.stage = self
			s.root.add_child(view)
			s.views.append(view)
	for v in s.views:
		(v as Control).size = Vector2(sz)
	return s.views


func _clear(s: Dictionary) -> void:
	for v in s.views:
		var n: Node = v.clipper if v is Dictionary else v
		n.queue_free()
	s.views = []


## The texture of the clip a "stream" item plays (one player per layer instance); null when the file cannot be played.
func video_texture(it: Dictionary) -> Texture2D:
	if not is_inside_tree():
		return null
	var key := str(it.key)
	var rec: Variant = _players.get(key)
	if rec == null:
		var stream: Variant = load(str(it.stream))
		if not (stream is VideoStream):
			return null
		var p := VideoStreamPlayer.new()
		p.stream = stream
		p.loop = bool(it.loop)
		p.volume_db = -80.0
		p.visible = false
		add_child(p)
		p.play()
		rec = {"player": p, "seen": _now}
		_players[key] = rec
	rec.seen = _now
	var player: VideoStreamPlayer = rec.player
	if bool(it.ended) and not player.paused:
		player.paused = true  # the last frame stays
	return player.get_video_texture()


func player_count() -> int:
	return _players.size()


func _retire() -> void:
	for key in _players.keys():
		if _now - float(_players[key].seen) > KEEP_S:
			(_players[key].player as Node).queue_free()
			_players.erase(key)
