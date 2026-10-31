extends RefCounted
## WO-838 — lockscreen model: the per-machine prefs (ui.cfg [lockscreen], like the UI scale: a client preference, not
## project data), the lock/unlock key chord (parse / format / match / capture verdicts) and the custom-logo import.
## Pure helpers — the overlay (app/lock_overlay.gd) and the Settings pane (features/settings/lockscreen_pane.gd) call
## these; tests/test_lock_model.gd covers them. The locked state itself is never stored: the client starts unlocked.

const BounceModel := preload("res://core/bounce_model.gd")

const UI_CFG := "user://ui.cfg"
const SECTION := "lockscreen"
const DEFAULT_TEXT := "LOCKED"
const DEFAULT_BG := Color(0.0, 0.0, 0.0, 0.6)
const DEFAULT_KEY := "Ctrl+Shift+L"
const STYLES := ["plain", "bounce"]  # WO-901: plain = logo + text; bounce = one character bouncing DVD-style
const LOGO_PREFIX := "lockscreen_logo."
const LOGO_EXTS := ["png", "jpg", "jpeg", "svg"]
const LOGO_FILTER := "*.png, *.jpg, *.jpeg, *.svg ; Images"
const DEFAULT_LOGO_RES := "res://assets/ui/logo.png"
const SVG_TARGET_PX := 256.0  # an SVG has no pixel size: rasterise it about this tall


static func defaults() -> Dictionary:
	return {"enabled": true, "text": DEFAULT_TEXT, "logo": "", "bg": DEFAULT_BG, "key": DEFAULT_KEY,
		"style": "plain", "bounce_size": BounceModel.SIZE_DEFAULT, "bounce_speed": BounceModel.SPEED_DEFAULT}


## The stored prefs, every value validated (a hand-edited or stale cfg falls back to the default per key).
static func load_prefs(path := UI_CFG) -> Dictionary:
	var cfg := ConfigFile.new()
	cfg.load(path)
	var out := defaults()
	var en: Variant = cfg.get_value(SECTION, "enabled", true)
	out.enabled = en if en is bool else true
	var tx: Variant = cfg.get_value(SECTION, "text", DEFAULT_TEXT)
	out.text = tx if tx is String else DEFAULT_TEXT
	var lg: Variant = cfg.get_value(SECTION, "logo", "")
	out.logo = lg if lg is String and FileAccess.file_exists(lg) else ""  # a deleted copy → the default logo
	var bg: Variant = cfg.get_value(SECTION, "bg", "")
	out.bg = Color.html(bg) if bg is String and Color.html_is_valid(bg) else DEFAULT_BG
	var k: Variant = cfg.get_value(SECTION, "key", DEFAULT_KEY)
	out.key = chord_string(parse_chord(k)) if k is String and not parse_chord(k).is_empty() else DEFAULT_KEY
	var st: Variant = cfg.get_value(SECTION, "style", "plain")
	out.style = st if st is String and STYLES.has(st) else "plain"
	out.bounce_size = BounceModel.clamp_size(cfg.get_value(SECTION, "bounce_size", BounceModel.SIZE_DEFAULT))
	out.bounce_speed = BounceModel.clamp_speed(cfg.get_value(SECTION, "bounce_speed", BounceModel.SPEED_DEFAULT))
	return out


## Store one pref. The cfg is re-read right before the write: ui.cfg is shared by many keys (a copy loaded earlier
## and saved later would drop what was written in between).
static func save_pref(key: String, value: Variant, path := UI_CFG) -> void:
	var cfg := ConfigFile.new()
	cfg.load(path)
	if value is Color:
		value = (value as Color).to_html(true)
	cfg.set_value(SECTION, key, value)
	cfg.save(path)


# --- the key chord ------------------------------------------------------------------------------------------------

## "Ctrl+Shift+L" → {keycode, ctrl, shift, alt, meta}; {} when unusable (unknown key, modifier-only, no modifier).
static func parse_chord(s: String) -> Dictionary:
	var c := {"keycode": 0, "ctrl": false, "shift": false, "alt": false, "meta": false}
	var parts := s.split("+", false)
	if s.ends_with("++"):  # the "+" key itself
		parts = s.trim_suffix("+").split("+", false)
		parts.append("Plus")
	for p in parts:
		match p.strip_edges().to_lower():
			"ctrl", "control": c.ctrl = true
			"shift": c.shift = true
			"alt", "option": c.alt = true
			"meta", "cmd", "command", "super", "win": c.meta = true
			var other:
				if c.keycode != 0:
					return {}
				c.keycode = OS.find_keycode_from_string(other)
	return c if capture_verdict(c.keycode, c.ctrl, c.shift, c.alt, c.meta) == "ok" else {}


static func chord_string(c: Dictionary) -> String:
	if c.is_empty():
		return ""
	var out: PackedStringArray = []
	for m in [["ctrl", "Ctrl"], ["shift", "Shift"], ["alt", "Alt"], ["meta", "Meta"]]:
		if c.get(m[0], false):
			out.append(m[1])
	out.append(OS.get_keycode_string(int(c.keycode)))
	return "+".join(out)


static func chord_from_event(k: InputEventKey) -> Dictionary:
	return {"keycode": int(k.keycode), "ctrl": k.ctrl_pressed, "shift": k.shift_pressed, "alt": k.alt_pressed,
		"meta": k.meta_pressed}


## Exactly this chord: the key and precisely these modifiers (Ctrl+Shift+Alt+L is another chord).
static func matches(c: Dictionary, keycode: int, ctrl: bool, shift: bool, alt: bool, meta: bool) -> bool:
	return not c.is_empty() and keycode == int(c.keycode) and ctrl == c.ctrl and shift == c.shift and alt == c.alt \
		and meta == c.meta


static func event_matches(c: Dictionary, k: InputEventKey) -> bool:
	return matches(c, int(k.keycode), k.ctrl_pressed, k.shift_pressed, k.alt_pressed, k.meta_pressed)


static func is_modifier_key(keycode: int) -> bool:  # also: no key at all
	return keycode in [KEY_SHIFT, KEY_CTRL, KEY_ALT, KEY_META, KEY_HYPER, KEY_CAPSLOCK, KEY_NUMLOCK, KEY_SCROLLLOCK, KEY_UNKNOWN, 0]  # 0: a name OS.find_keycode_from_string did not know


## What a key press means while the Settings "Set…" button is recording: "wait" (only a modifier so far), "cancel"
## (plain Escape), "reject" (a key without a modifier would lock/unlock on every stroke of it), "ok".
static func capture_verdict(keycode: int, ctrl: bool, shift: bool, alt: bool, meta: bool) -> String:
	if is_modifier_key(keycode):
		return "wait"
	var any := ctrl or shift or alt or meta
	if keycode == KEY_ESCAPE and not any:
		return "cancel"
	return "ok" if any else "reject"


# --- the logo --------------------------------------------------------------------------------------------------------

## An image from `path` (png / jpg / svg; res:// or a file) or null when it cannot be decoded.
static func load_image(path: String) -> Image:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		return null
	var img := Image.new()
	var err := ERR_FILE_UNRECOGNIZED
	match path.get_extension().to_lower():
		"svg":
			err = img.load_svg_from_buffer(bytes, 1.0)
			if err == OK and img.get_height() > 0:
				err = img.load_svg_from_buffer(bytes, clampf(SVG_TARGET_PX / img.get_height(), 0.05, 16.0))
		"jpg", "jpeg":
			err = img.load_jpg_from_buffer(bytes)
		"png":
			err = img.load_png_from_buffer(bytes)
	return img if err == OK and not img.is_empty() else null


## Copy the chosen image into `dir` (user:// by default) so the logo survives the original moving. → {ok, path|error}.
static func import_logo(src: String, dir := "user://") -> Dictionary:
	var ext := src.get_extension().to_lower()
	if not LOGO_EXTS.has(ext):
		return {"ok": false, "error": "Use a PNG, JPG or SVG image."}
	if load_image(src) == null:
		return {"ok": false, "error": "Cannot read %s as an image." % src.get_file()}
	var bytes := FileAccess.get_file_as_bytes(src)
	clear_logos(dir)
	var dst := dir.path_join(LOGO_PREFIX + ext)
	var f := FileAccess.open(dst, FileAccess.WRITE)
	if f == null:
		return {"ok": false, "error": "Cannot write %s (%s)." % [dst, error_string(FileAccess.get_open_error())]}
	f.store_buffer(bytes)
	f.close()
	return {"ok": true, "path": dst}


## Remove any earlier imported copy (a different extension would otherwise linger).
static func clear_logos(dir := "user://") -> void:
	for e in LOGO_EXTS:
		var p: String = dir.path_join(LOGO_PREFIX + e)
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(p)


## The image shown on the lockscreen: the custom copy, else the HighAsCG logo.
static func logo_image(prefs: Dictionary) -> Image:
	var img: Image = load_image(str(prefs.logo)) if str(prefs.logo) != "" else null
	return img if img != null else load_image(DEFAULT_LOGO_RES)


## Resample once (Lanczos) to the exact pixels it covers: `h` px tall, at most `max_w` wide (the header logo's lesson —
## a plain bilinear sample of a small outlined mascot breaks into dots).
static func fit_texture(img: Image, h: int, max_w: int) -> Texture2D:
	if img == null or img.is_empty() or h < 1:
		return null
	var w := maxi(1, roundi(h * float(img.get_width()) / img.get_height()))
	if w > max_w:
		w = max_w
		h = maxi(1, roundi(w * float(img.get_height()) / img.get_width()))
	var out := img.duplicate() as Image
	out.resize(w, h, Image.INTERPOLATE_LANCZOS)
	return ImageTexture.create_from_image(out)
