extends RefCounted
## WO-628 — operator dock geometry + gating, pure (testable without a display).

const ICON := 40          # icon px (owner 20.10: "way too small … it can be bigger")
const CELL := 52          # button px (square)
const PAD := 6            # panel padding
const SEP := 9            # a VSeparator's width
const GAP := 4            # between buttons
const HANDLE := Vector2i(160, 4)  # collapsed: a thin line, bottom centre
const REVEAL_S := 0.4     # the pointer must REST on the line this long — passing over it does nothing ("not too triggery")
const HIDE_S := 1.0       # grace after the pointer leaves the dock / its menu
const MENU_W := 300       # the ⋯ list
const MENU_ROW := 34
const MENU_ICON := 22
const DOT := 5            # running-app dot under an icon (WO-628, macOS style)


## The dock launches apps on the BOX's display, so it only makes sense when this client runs on the box itself
## (origin on loopback). `--dock=1` forces it, `--dock=0` turns it off.
static func wanted(origin: String, args: Dictionary) -> bool:
	if args.has("dock"):
		return str(args["dock"]) not in ["0", "false", "off", "no"]
	return preload("res://core/platform.gd").is_local_origin(origin)


## Expanded size for `n` buttons plus separators.
static func expanded_size(n: int, separators: int) -> Vector2i:
	return Vector2i(PAD * 2 + n * CELL + separators * SEP + maxi(0, n + separators - 1) * GAP, PAD * 2 + CELL)


## Bottom-centre placement of `size` inside the usable rect of the client's screen.
static func place(usable: Rect2i, size: Vector2i) -> Rect2i:
	return Rect2i(usable.position.x + (usable.size.x - size.x) / 2, usable.end.y - size.y, size.x, size.y)


## The ⋯ list: right-aligned with the dock, just above it; as tall as its rows (`content_h`, measured — a row's real
## height depends on the theme) but never above the screen (it scrolls).
static func menu_rect(dock: Rect2i, content_h: int, usable: Rect2i) -> Rect2i:
	var h := mini(PAD * 2 + maxi(MENU_ROW, content_h), dock.position.y - usable.position.y - 8)
	var x := maxi(usable.position.x, dock.end.x - MENU_W)
	return Rect2i(x, dock.position.y - h - 4, MENU_W, h)


## "app:org.gnome.FileRoller" or "firefox" → the icon route (WO-387).
static func icon_path(action: String) -> String:
	return "/api/system/operator-helper-icon?action=" + action.uri_encode()


## Decode a PNG or SVG icon reply into an Image of `px` square (null when it is neither).
static func decode_icon(bytes: PackedByteArray, px: int) -> Image:
	if bytes.is_empty():
		return null
	var img := Image.new()
	var head := bytes.slice(0, mini(64, bytes.size())).get_string_from_ascii().strip_edges()
	var err := img.load_svg_from_buffer(bytes, 2.0) if head.begins_with("<") else img.load_png_from_buffer(bytes)
	if err != OK or img.is_empty():
		return null
	img.resize(px, px, Image.INTERPOLATE_LANCZOS)
	return img


## GET /api/system/dock `running` → {action: true}; the HighAsCG button is always running (it is this window).
static func running_set(data: Variant) -> Dictionary:
	var out := {"highascg": true}
	var r: Variant = (data as Dictionary).get("running") if data is Dictionary else null
	if r is Array:
		for a in r:
			out[str(a)] = true
	return out
