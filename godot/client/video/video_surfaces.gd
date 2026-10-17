extends Node
## WO-599/596/597 — live Caspar channel surfaces (shared memory → Texture2D), one per role.
## The server announces surfaces (GET /api/video-surfaces) and keeps runtime ones (pgm1/prv1/… for
## previs) alive only while leased: this node POSTs /api/video-surfaces/lease every LEASE_EVERY_S with the
## runtime roles the UI currently draws (TTL 15 s server-side → a crashed client releases on-air channels).
## Uses the hshm GDExtension when installed (godot/extensions/hshm/build.sh), else the GDScript reader.

const ShmReader := preload("res://video/shm_reader.gd")
const ShmNative := preload("res://video/shm_native.gd")
const ShmTexture := preload("res://video/shm_texture.gd")
const LEASE_EVERY_S := 5.0
const RUNTIME_ROLES := ["pgm1", "prv1", "pgm2", "prv2", "pgm3", "prv3", "pgm4", "prv4"]

var client_id := "godot-%d-%d" % [OS.get_process_id(), Time.get_unix_time_from_system()]
var descriptors := {}  # role -> server descriptor (path, channel, active, …)
var leasing := false
var _surfaces := {}  # role -> { reader, tex, native, path }
var _timer: Timer


func _ready() -> void:
	_timer = Timer.new()
	_timer.wait_time = LEASE_EVERY_S
	_timer.timeout.connect(_renew)
	add_child(_timer)


## Begin talking to the server (called by the app after bootstrap).
func start() -> void:
	_timer.start()
	_renew()


## Stable Texture2D for a surface (created on first use; stays valid across writer restarts).
func texture(role: String) -> Texture2D:
	return _ensure(role).tex.texture


func reader(role: String) -> Variant:
	return _ensure(role).reader


func is_native() -> bool:
	return ShmNative.available()


## Stop drawing a role (its lease lapses at the next renewal).
func release(role: String) -> void:
	_surfaces.erase(role)


func _ensure(role: String) -> Dictionary:
	if not _surfaces.has(role):
		var path := path_for(role)
		var native := ShmNative.available()
		var r: Variant = ShmNative.new(path) if native else ShmReader.new(path)
		_surfaces[role] = {"reader": r, "tex": ShmTexture.new(), "native": native, "path": path}
	return _surfaces[role]


func path_for(role: String) -> String:
	var d: Variant = descriptors.get(role)
	if d is Dictionary and OS.get_name() == "Linux" and str((d as Dictionary).get("path", "")) != "":
		return str((d as Dictionary)["path"])
	return segment_path(role)


func _renew() -> void:
	var wanted := []
	for role in _surfaces.keys():
		if role in RUNTIME_ROLES:
			wanted.append(role)
	var res: Dictionary = await Api.post_json("/api/video-surfaces/lease", {"clientId": client_id, "roles": wanted})
	leasing = res.ok
	if res.ok and res.data is Dictionary:
		_apply_descriptors((res.data as Dictionary).get("surfaces", []))


func _apply_descriptors(list: Variant) -> void:
	if not (list is Array):
		return
	for d in list:
		if d is Dictionary:
			descriptors[str((d as Dictionary).get("role", ""))] = d
	# A surface whose announced path changed (e.g. operator shmName edited) is reopened.
	for role in _surfaces.keys():
		var want := path_for(role)
		if want != str(_surfaces[role].path):
			_surfaces.erase(role)
			_ensure(role)


func _process(_delta: float) -> void:
	for s in _surfaces.values():
		var r: Variant = s.reader
		if r.poll():
			if s.native:
				s.tex.update_native(r.src)
			else:
				s.tex.update(r.frame, r.width, r.height)


static func segment_path(surface: String) -> String:
	if OS.get_name() == "Linux" and DirAccess.dir_exists_absolute("/dev/shm"):
		return "/dev/shm/highascg-%s" % surface
	var tmp := OS.get_environment("TMPDIR")
	if tmp == "":
		tmp = "/tmp"
	return tmp.path_join("highascg-shm").path_join("highascg-%s" % surface)
