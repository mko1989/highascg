extends Node
## WO-599/596/597 — live Caspar channel surfaces (shared memory → Texture2D), one per role.
## The server announces surfaces (GET /api/video-surfaces) and keeps runtime ones (pgm1/prv1/…, WO-616 inN/chN for
## previs) alive only while leased: this node POSTs /api/video-surfaces/lease every LEASE_EVERY_S with the
## runtime roles the UI currently draws (TTL 15 s server-side → a crashed client releases on-air channels).
## Uses the hshm GDExtension when installed (godot/extensions/hshm/build.sh), else the GDScript reader.
## WO-670 P1: when the server is on another machine (or `--video=feed`) there is no /dev/shm to read — every role's
## reader is then a video_feed.gd RoleReader fed by one JPEG WebSocket; textures, holders and leases are unchanged.
## WO-1029 C9: per-role transport — a role the node marks `transport: "feed"` (a screen on another linked server,
## relayed by the node: feed_roles.gd) is read from the node's feed even on the box; the others keep shm.

const ShmReader := preload("res://video/shm_reader.gd")
const ShmNative := preload("res://video/shm_native.gd")
const ShmTexture := preload("res://video/shm_texture.gd")
const SurfaceHolders := preload("res://video/surface_holders.gd")
const VideoFeed := preload("res://video/video_feed.gd")
const FeedRoles := preload("res://video/feed_roles.gd")
const Demo := preload("res://core/demo/demo_server.gd")
const DemoVideo := preload("res://core/demo/demo_video.gd")
const DemoStage := preload("res://core/demo/demo_stage.gd")
const LEASE_EVERY_S := 5.0

signal sources_changed  # WO-694: the roles that have a Caspar channel changed (pickers rebuild)

var client_id := "godot-%d-%d" % [OS.get_process_id(), Time.get_unix_time_from_system()]
var descriptors := {}  # role -> server descriptor (path, channel, active, …)
var leasing := false
var _surfaces := {}  # role -> { reader, tex, native, path }
var holders := SurfaceHolders.new()  # WO-617: only held roles are polled, uploaded and leased
var _timer: Timer
var feed: VideoFeed = null  # WO-670 P1: set when pictures come over the network
var local_feed: VideoFeed = null  # WO-1029 C9: on the box, the node's feed for relayed roles only (made on first use)
var _stage: DemoStage = null  # WO-865: a demo's display engine (SubViewports are the role textures)


func _ready() -> void:
	if VideoFeed.wanted(Config.origin, Config.args) and not Config.demo:  # WO-815: a demo has no picture source
		feed = VideoFeed.new(VideoFeed.url_for(Config.origin, Config.args))
	_timer = Timer.new()
	_timer.wait_time = LEASE_EVERY_S
	_timer.timeout.connect(_renew)
	add_child(_timer)


## Begin talking to the server (called by the app after bootstrap).
func start() -> void:
	_timer.start()
	_renew()


## Stable Texture2D for a surface (created on first use; stays valid across writer restarts and
## across release/re-acquire). Does NOT hold it: nothing is read or leased until someone acquires.
func texture(role: String) -> Texture2D:
	return _ensure(role).tex.texture


## WO-617: hold a surface for `owner` (polled, uploaded and leased while ≥ 1 holder). Same texture as texture().
func acquire(role: String, owner: Object) -> Texture2D:
	if holders.hold(role, owner) and SurfaceHolders.is_runtime_role(role) and _timer != null and not _timer.is_stopped():
		_renew()  # lease now, not at the next 5 s tick
	return texture(role)


func reader(role: String) -> Variant:
	return _ensure(role).reader


func is_native() -> bool:
	return feed == null and not Config.demo and ShmNative.available()


## Drop `owner`'s hold on a role; with no holders left it stops being read and its lease lapses
## (server REMOVEs the runtime consumer after the TTL). The texture object is kept for re-acquire.
func release(role: String, owner: Object) -> void:
	holders.drop(role, owner)


func release_all(owner: Object) -> void:
	holders.drop_all(owner)


func is_held(role: String) -> bool:
	return holders.is_held(role)


## WO-1029 C9: does the node relay this role from another linked server (its picture comes over the feed)?
func relayed(role: String) -> bool:
	return FeedRoles.is_relayed(descriptors.get(role))


## WO-1029 C9: the owner's name of a relayed role ("" when it is not relayed).
func relay_server(role: String) -> String:
	return FeedRoles.server_name(descriptors.get(role))


func _relay_feed() -> VideoFeed:
	if local_feed == null:
		local_feed = VideoFeed.new(VideoFeed.url_for(Config.origin, Config.args))
	return local_feed


## The reader of `role` for its transport: the network feed (remote client / relayed role) or shared memory.
func _reader_for(role: String, path: String, native: bool) -> Variant:
	if feed != null:
		return feed.reader(role)
	if relayed(role):
		return _relay_feed().reader(role)
	return ShmNative.new(path) if native else ShmReader.new(path)


func _ensure(role: String) -> Dictionary:
	if not _surfaces.has(role):
		var path := path_for(role)
		var native := is_native()
		var r: Variant
		if Config.demo:  # WO-815 phase 2: the look the simulated server has on that bus, as a still
			r = DemoVideo.new(role, Demo.shared())
		else:
			r = _reader_for(role, path, native)
		# WO-865: in a demo the texture is the engine's SubViewport, nothing is uploaded
		var tex: Variant = {"texture": demo_stage().texture(role)} if Config.demo else ShmTexture.new()
		var via := feed != null or (not Config.demo and relayed(role))
		_surfaces[role] = {"reader": r, "tex": tex, "native": native and not via, "path": path, "via_feed": via}
	return _surfaces[role]


## WO-865: the demo display engine (core/demo/demo_stage.gd), created on first use.
func demo_stage() -> DemoStage:
	if _stage == null:
		_stage = DemoStage.new(Demo.shared())
		add_child(_stage)
	return _stage


func path_for(role: String) -> String:
	if Config.demo:  # WO-815: never this box's real Caspar channels — a path no writer ever creates
		return OS.get_user_data_dir().path_join("demo-no-video").path_join("highascg-%s" % role)
	var d: Variant = descriptors.get(role)
	if d is Dictionary and OS.get_name() == "Linux" and str((d as Dictionary).get("path", "")) != "":
		return str((d as Dictionary)["path"])
	return segment_path(role)


func _renew() -> void:
	var wanted := []
	for role in holders.roles():
		if SurfaceHolders.is_runtime_role(role):
			wanted.append(role)
	var res: Dictionary = await Api.post_json("/api/video-surfaces/lease", {"clientId": client_id, "roles": wanted})
	leasing = res.ok
	if res.ok and res.data is Dictionary:
		_apply_descriptors((res.data as Dictionary).get("surfaces", []))


func _apply_descriptors(list: Variant) -> void:
	if not (list is Array):
		return
	var before := _channels()
	for d in list:
		if d is Dictionary:
			descriptors[str((d as Dictionary).get("role", ""))] = d
	if _channels() != before:
		sources_changed.emit()
	# A surface whose announced path changed (e.g. operator shmName edited) is reopened.
	if feed != null or Config.demo:
		return  # the feed reads by role on the server (a demo draws its stills); no local path to reopen
	for role in _surfaces.keys():
		var want := path_for(role)
		var s: Dictionary = _surfaces[role]
		if relayed(role) != bool(s.get("via_feed", false)) or (not s.via_feed and want != str(s.path)):
			# swap the reader only — the Texture2D object must stay the same for everything bound to it (WO-1029 C9: a
			# screen that moved to / from another server swaps transport the same way)
			var native := relayed(role) == false and is_native()
			s.reader = _reader_for(role, want, native)
			s.native = native
			s.via_feed = relayed(role)
			s.path = want


func _process(_delta: float) -> void:
	if Config.demo:  # WO-865: the GPU draws every held role, the readers only say "no signal"
		for role in holders.roles():
			_ensure(role).reader.update_lost()
		demo_stage().step(holders.roles(), Demo.shared().clock())
		return
	if feed != null:
		feed.pump(holders.roles())
	elif local_feed != null:
		local_feed.pump(FeedRoles.feed_roles(holders.roles(), descriptors, false))
	for role in holders.roles():
		var s: Dictionary = _ensure(role)
		var r: Variant = s.reader
		if r.poll():
			if s.native:
				s.tex.update_native(r.src)
			elif feed != null or Config.demo or s.get("via_feed", false):
				s.tex.update_rgba(r.frame, r.width, r.height)
			else:
				s.tex.update(r.frame, r.width, r.height)


func _channels() -> Dictionary:
	var out := {}
	for r in descriptors:
		out[r] = descriptors[r].get("channel") if descriptors[r] is Dictionary else null
	return out


static func segment_path(surface: String) -> String:
	if OS.get_name() == "Linux" and DirAccess.dir_exists_absolute("/dev/shm"):
		return "/dev/shm/highascg-%s" % surface
	var tmp := OS.get_environment("TMPDIR")
	if tmp == "":
		tmp = "/tmp"
	return tmp.path_join("highascg-shm").path_join("highascg-%s" % surface)
