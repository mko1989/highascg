extends Node
## WO-900 — the MIDI inputs of this client. Godot's Linux driver (drivers/alsamidi, 4.7.2) is ALSA *rawmidi*:
## OS.open_midi_inputs() lists the rawmidi devices once (snd_device_name_hint "rawmidi"), opens each input and starts one
## reader thread; there is no hot-plug — a controller plugged in later is not seen until the inputs are closed and opened
## again, and one unplugged while open makes the reader print snd_rawmidi_read errors until then. So this node watches
## /dev/snd for the midiC*D* nodes (and their creation times) every POLL s and re-opens on any change.
## The ALSA list always holds "Virtual RawMIDI" (alsa.conf rawmidi.virtual: a sequencer port of this process) — not a device.
## libasound is loaded by the ALSA or PulseAudio audio driver only: under the Dummy driver (--headless, the test runner,
## --check) OS.open_midi_inputs() crashes the engine (SIGSEGV, measured on this box) — can_open() keeps it off there.
## InputEventMIDI reaches every window's viewport (_input); a window with a modal dialog open gets none.

signal devices_changed(names: PackedStringArray)

const VIRTUAL := "Virtual RawMIDI"
const POLL := 0.5

var names := PackedStringArray()  ## the real devices open now
var open := false
var _sig := ""  # the /dev/snd MIDI nodes at the last open
var _timer: Timer


## Can this process open MIDI inputs without crashing? Linux: only with libasound loaded (the ALSA / PulseAudio driver).
static func can_open(os_name: String, audio_driver: String, display: String) -> bool:
	if display == "headless" or os_name == "Web":
		return false
	return audio_driver in ["ALSA", "PulseAudio"] if os_name in ["Linux", "FreeBSD", "NetBSD", "OpenBSD", "BSD"] else true


## The rawmidi device nodes of a /dev/snd listing with their creation times: a change = a controller came or went.
static func signature(files: PackedStringArray, mtime: Callable) -> String:
	var out := []
	for f in files:
		if f.begins_with("midiC"):
			out.append("%s@%d" % [f, int(mtime.call("/dev/snd/" + f))])
	out.sort()
	return ",".join(out)


## The real devices of OS.get_connected_midi_inputs() (the ALSA virtual port left out).
static func real(all: PackedStringArray) -> PackedStringArray:
	var out := PackedStringArray()
	for n in all:
		if n != VIRTUAL:
			out.append(n)
	return out


## Open now and follow plugs from here on; "" or why MIDI stays off in this process.
func start() -> String:
	if not can_open(OS.get_name(), AudioServer.get_driver_name(), DisplayServer.get_name()):
		return "MIDI is off in this process (audio driver %s)" % AudioServer.get_driver_name()
	_reopen()
	if OS.get_name() == "Linux" and _timer == null:
		_timer = Timer.new()
		_timer.wait_time = POLL
		_timer.timeout.connect(_poll)
		add_child(_timer)
		_timer.start()
	return ""


func _poll() -> void:
	if _sig != _signature():
		_reopen()


func _signature() -> String:
	return signature(DirAccess.get_files_at("/dev/snd"), func(p: String) -> int: return FileAccess.get_modified_time(p))


## Fewer devices open than /dev/snd has MIDI nodes: another process reads the rest (rawmidi input is single-open: a second
## open is EBUSY, measured with amidi beside a client holding the APC40, and Godot skips it without a word).
func held_elsewhere() -> bool:
	return _sig.get_slice_count(",") > names.size() if _sig != "" else false


func _reopen() -> void:
	_sig = _signature() if OS.get_name() == "Linux" else ""
	if open:
		OS.close_midi_inputs()
	OS.open_midi_inputs()
	open = true
	var now := real(OS.get_connected_midi_inputs())
	print("[midi] inputs: %s" % (", ".join(now) if not now.is_empty() else "none"))
	names = now
	devices_changed.emit(names)


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and open:
		OS.close_midi_inputs()
		open = false
