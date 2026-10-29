extends RefCounted
## Mixer-style fader for the audio strips: a physical-looking cap (dark body, lighter edge, one bright groove line)
## as the VSlider grabber, and a thin dark track as the "slider" stylebox. Built in code and cached: one ImageTexture
## per highlight state and one StyleBoxFlat. Static helpers only, no state beyond the caches. The ALSA mixer panel
## can use the same helper (grabber() / track()) with its VSlider.

const WIDTH := 26  # cap size in px
const HEIGHT := 14
const TRACK_W := 4  # track width in px
const BODY := Color("#2b3038")
const EDGE := Color("#8b949e")
const EDGE_HI := Color("#c9d1d9")  # the grabber_highlight variant (hover / drag)
const GROOVE := Color("#e6edf3")
const TRACK := Color("#161b22")

static var _grabs := {}  # highlight (bool) → ImageTexture
static var _track: StyleBoxFlat


## The VSlider grabber: a WIDTH x HEIGHT cap. highlight = true gives the brighter edge for grabber_highlight.
static func grabber(highlight := false) -> ImageTexture:
	if not _grabs.has(highlight):
		_grabs[highlight] = _make_cap(EDGE_HI if highlight else EDGE)
	return _grabs[highlight]


static func _make_cap(edge: Color) -> ImageTexture:
	var img := Image.create_empty(WIDTH, HEIGHT, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	img.fill_rect(Rect2i(0, 0, WIDTH, HEIGHT), edge)  # 1 px edge
	img.fill_rect(Rect2i(1, 1, WIDTH - 2, HEIGHT - 2), BODY)
	img.fill_rect(Rect2i(3, HEIGHT / 2, WIDTH - 6, 1), GROOVE)  # the one groove line across the middle
	return ImageTexture.create_from_image(img)


## The VSlider "slider" stylebox: a TRACK_W px wide dark bar with 2 px corners and no fill of its own.
## Margins are left/right only, so the minimum width is TRACK_W and the top/bottom run the full height.
static func track() -> StyleBoxFlat:
	if _track == null:
		_track = StyleBoxFlat.new()
		_track.bg_color = TRACK
		_track.set_corner_radius_all(2)
		_track.content_margin_left = TRACK_W / 2.0
		_track.content_margin_right = TRACK_W / 2.0
		_track.content_margin_top = 0
		_track.content_margin_bottom = 0
	return _track
