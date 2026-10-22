extends RefCounted
## WO-686 — what differs between the client on the box (Linux, server on loopback) and a GUI on another machine
## (Windows / macOS / Linux). Pure helpers, so tests run without autoloads.


## The server runs on this machine. Off-box, nothing may lay out or prompt on the box's screens (WO-638 / WO-645),
## start box apps (operator dock) or read /dev/shm (the JPEG feed replaces it, WO-670).
static func is_local_origin(origin: String) -> bool:
	var host := origin.trim_prefix("http://").trim_prefix("https://").get_slice("/", 0)
	host = host.get_slice("]", 0).trim_prefix("[") if host.begins_with("[") else host.get_slice(":", 0)
	return host in ["127.0.0.1", "localhost", "::1"]


## The user's home: $HOME (Linux / macOS), %USERPROFILE% (Windows has no HOME), else the Documents folder's parent.
static func home_dir(home := OS.get_environment("HOME"), profile := OS.get_environment("USERPROFILE")) -> String:
	if home != "":
		return home
	if profile != "":
		return profile
	return OS.get_system_dir(OS.SYSTEM_DIR_DOCUMENTS).get_base_dir()


## Where file dialogs start: the OS downloads folder, else ~/Downloads, else home.
static func start_dir() -> String:
	var home := home_dir()
	var system := OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	if system != "" and system.trim_suffix("/") != home.trim_suffix("/") and DirAccess.dir_exists_absolute(system):
		return system
	var dl := home.path_join("Downloads")
	return dl if DirAccess.dir_exists_absolute(dl) else home
