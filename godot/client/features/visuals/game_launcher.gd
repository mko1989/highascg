extends RefCounted
## WO-876 — the Visuals' Game scene's launcher: lists the operator's ROMs, picks a libretro core by file extension and opens
## WO-745's game window (godot/retro, its own process — a crashing core never takes the GUI with it) on the screen this client
## is on. The window plays with keyboard / gamepad and its sound, and publishes the picture as shm ring RING, which
## scenes/game.gd shows with effects. Cores: godot/retro/get-cores.sh (Ubuntu's libretro packages, unpacked, no root).
## ROMs are the operator's own files: GAMES_DIRS, unzipped.

const RING := "visuals-game"
const ROOT := "~/.highascg/retro"
const GAMES_DIRS := ["~/.highascg/retro/games", "~/highascg/media/games"]
## extension → cores in preference order (file names in ROOT/cores)
const CORES := {
	"nes": ["nestopia_libretro.so", "fceumm_libretro.so", "mesen_libretro.so"],
	"fds": ["nestopia_libretro.so", "fceumm_libretro.so"],
	"unf": ["nestopia_libretro.so", "fceumm_libretro.so"],
	"sfc": ["bsnes_mercury_balanced_libretro.so", "snes9x_libretro.so"],
	"smc": ["bsnes_mercury_balanced_libretro.so", "snes9x_libretro.so"],
	"gb": ["mgba_libretro.so", "gambatte_libretro.so", "sameboy_libretro.so"],
	"gbc": ["mgba_libretro.so", "gambatte_libretro.so", "sameboy_libretro.so"],
	"gba": ["mgba_libretro.so"],
	"md": ["genesis_plus_gx_libretro.so"],
	"gen": ["genesis_plus_gx_libretro.so"],
	"smd": ["genesis_plus_gx_libretro.so"],
	"sms": ["genesis_plus_gx_libretro.so"],
	"gg": ["genesis_plus_gx_libretro.so"],
}

const PID_FILE := "~/.highascg/run/visuals-game.pid"

var pid := 0
var playing := ""  # the ROM path the window was opened with
var pid_file := ""  # where the open window is noted ("" = nowhere: tests); the tab sets expand(PID_FILE)
var _adopted := false  # pid is not our child (a window left by a GUI that restarted)


static func expand(p: String) -> String:
	return OS.get_environment("HOME") + p.substr(1) if p.begins_with("~") else p


## Every playable ROM under GAMES_DIRS (sorted by name): [{name, path}].
static func games(dirs: Array = GAMES_DIRS) -> Array:
	var out := []
	for d in dirs:
		var dir := expand(d)
		if not DirAccess.dir_exists_absolute(dir):  # media/games is optional: no ERROR line on every list
			continue
		for f in DirAccess.get_files_at(dir):
			if CORES.has(f.get_extension().to_lower()):
				out.append({"name": f.get_basename(), "path": dir.path_join(f)})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.name.naturalnocasecmp_to(b.name) < 0)
	return out


## The installed core for `rom`, or "".
static func core_for(rom: String, cores_dir: String = expand(ROOT).path_join("cores")) -> String:
	for c in CORES.get(rom.get_extension().to_lower(), []):
		if FileAccess.file_exists(cores_dir.path_join(c)):
			return cores_dir.path_join(c)
	return ""


## godot/retro next to this client project, and whether its extensions are installed (godot/retro/install.sh).
static func retro_dir() -> String:
	return ProjectSettings.globalize_path("res://").path_join("../retro").simplify_path()


static func ready_error(rom: String) -> String:
	if not FileAccess.file_exists(retro_dir().path_join(".godot/extension_list.cfg")):
		return "The game window is not installed — run godot/retro/install.sh"
	if rom == "" or not FileAccess.file_exists(rom):
		return "Pick a game (ROMs go in %s)" % GAMES_DIRS[0]
	if core_for(rom) == "":
		return "No core for .%s files — run godot/retro/get-cores.sh" % rom.get_extension()
	return ""


## The window's command line (OS.create_process).
static func args_for(rom: String, screen: int) -> PackedStringArray:
	return PackedStringArray(["--path", retro_dir(), "--screen", str(screen), "--", "--core", core_for(rom), "--game", rom,
		"--ring", RING])


func running() -> bool:
	if _adopted:  # not our child: is_process_running's waitpid says no for it
		return pid > 0 and _is_window(pid)
	return pid > 0 and OS.is_process_running(pid)


## A game window still open from before this client started (a GUI restart or crash leaves it playing — WO-876 box test)
## becomes this launcher's: the page shows Stop, and a Play replaces it instead of starting a second writer on the ring.
func adopt() -> void:
	if pid_file == "" or running() or not FileAccess.file_exists(pid_file):
		return
	var lines := FileAccess.get_file_as_string(pid_file).split("\n")
	var p := int(lines[0])
	if lines.size() >= 2 and p > 1 and _is_window(p):
		pid = p
		playing = lines[1]
		_adopted = true


## Whether process `p` is a game window on RING (its command line, not just a live pid: pids are reused).
static func _is_window(p: int) -> bool:
	var f := FileAccess.open("/proc/%d/cmdline" % p, FileAccess.READ)
	if f == null:
		return false
	var b := f.get_buffer(16384)
	for i in b.size():
		if b[i] == 0:
			b[i] = 32
	return b.get_string_from_utf8().contains("--ring " + RING)


## Open the game window ("" or why not). A window already open is closed first: one core per process, one game per ring.
func play(rom: String, screen: int) -> String:
	var e := ready_error(rom)
	if e != "":
		return e
	stop()
	pid = OS.create_process(OS.get_executable_path(), args_for(rom, screen))
	if pid <= 0:
		pid = 0
		return "Could not start the game window"
	playing = rom
	if pid_file != "":
		DirAccess.make_dir_recursive_absolute(pid_file.get_base_dir())
		var f := FileAccess.open(pid_file, FileAccess.WRITE)
		if f != null:
			f.store_string("%d\n%s" % [pid, rom])
	return ""


func stop() -> void:
	if running():
		OS.kill(pid)  # the window cannot unlink its ring when killed: unlink it here, or its last frame lingers (WO-877)
		DirAccess.remove_absolute("/dev/shm/highascg-" + RING)
	pid = 0
	playing = ""
	_adopted = false
	if pid_file != "" and FileAccess.file_exists(pid_file):
		DirAccess.remove_absolute(pid_file)
