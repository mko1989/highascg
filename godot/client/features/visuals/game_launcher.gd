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

var pid := 0
var playing := ""  # the ROM path the window was opened with


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
	return pid > 0 and OS.is_process_running(pid)


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
	return ""


func stop() -> void:
	if running():
		OS.kill(pid)  # the window cannot unlink its ring when killed: unlink it here, or its last frame lingers (WO-877)
		DirAccess.remove_absolute("/dev/shm/highascg-" + RING)
	pid = 0
	playing = ""
