extends RefCounted
## WO-913 — the APC40 mkII's RGB pad palette and a visual's main colour. A pad's colour is a Note On velocity: an index into
## the APC's fixed 128-colour table (Akai "APC40 Mk2 Communications Protocol", RGB LED table; values as transcribed in
## github.com/hepp/akai-apc40-mk2 AkaiAPC40Utils.java, MIT). main_color() picks a thumbnail's dominant bright colour (dark and
## grey pixels count little) at full brightness, nearest() the palette entry a pad shows for it.

const HEX := [
	"000000", "1E1E1E", "7F7F7F", "FFFFFF", "FF4C4C", "FF0000", "590000", "190000", "FFBD6C", "FF5400", "591D00", "271B00",
	"FFFF4C", "FFFF00", "595900", "191900", "88FF4C", "54FF00", "1D5900", "142B00", "4CFF4C", "00FF00", "005900", "001900",
	"4CFF5E", "00FF19", "00590D", "001902", "4CFF88", "00FF55", "00591D", "001F12", "4CFFB7", "00FF99", "005935", "001912",
	"4CC3FF", "00A9FF", "004152", "001019", "4C88FF", "0055FF", "001D59", "000819", "4C4CFF", "0000FF", "000059", "000019",
	"874CFF", "5400FF", "190064", "0F0030", "FF4CFF", "FF00FF", "590059", "190019", "FF4C87", "FF0054", "59001D", "220013",
	"FF1500", "993500", "795100", "436400", "033900", "005735", "00547F", "0000FF", "00454F", "2500CC", "7F7F7F", "202020",
	"FF0000", "BDFF2D", "AFED06", "64FF09", "108B00", "00FF87", "00A9FF", "002AFF", "3F00FF", "7A00FF", "B21A7D", "402100",
	"FF4A00", "88E106", "72FF15", "00FF00", "3BFF26", "59FF71", "38FFCC", "5B8AFF", "3151C6", "877FE9", "D31DFF", "FF005D",
	"FF7F00", "B9B000", "90FF00", "835D07", "392b00", "144C10", "0D5038", "15152A", "16205A", "693C1C", "A8000A", "DE513D",
	"D86A1C", "FFE126", "9EE12F", "67B50F", "1E1E30", "DCFF6B", "80FFBD", "9A99FF", "8E66FF", "404040", "757575", "E0FFFF",
	"A00000", "350000", "1AD000", "074200", "B9B000", "3F3100", "B35F00", "4B1502",
]


## The visual's main colour from its thumbnail — its DOMINANT colour (WO-1070: the weighted mean of a red-and-blue picture
## is a magenta that is nowhere in it): pixels vote for their hue (BINS around the wheel) with saturation × brightness²,
## the strongest hue (with its two neighbours) wins and its pixels' mean is brought to full brightness; a grey picture → white.
const BINS := 24


static func main_color(img: Image) -> Color:
	if img == null or img.is_empty():
		return Color.WHITE
	var im := img.duplicate() as Image
	if im.is_compressed():
		im.decompress()
	im.convert(Image.FORMAT_RGB8)
	im.resize(32, 18, Image.INTERPOLATE_BILINEAR)
	var sums := []
	var ws := PackedFloat32Array()
	ws.resize(BINS)
	for i in BINS:
		sums.append(Vector3.ZERO)
	var w := 0.0
	for y in im.get_height():
		for x in im.get_width():
			var c := im.get_pixel(x, y)
			var k := c.s * c.v * c.v
			var bin := int(c.h * BINS) % BINS
			sums[bin] += Vector3(c.r, c.g, c.b) * k
			ws[bin] += k
			w += k
	if w < 0.5:  # (of 576 pixels: next to nothing coloured)
		return Color.WHITE
	var best := 0
	var bw := -1.0
	for i in BINS:
		var near := ws[i] + ws[(i + 1) % BINS] + ws[(i + BINS - 1) % BINS]
		if near > bw:
			bw = near
			best = i
	var sum: Vector3 = sums[best] + sums[(best + 1) % BINS] + sums[(best + BINS - 1) % BINS]
	var m := Color(sum.x / bw, sum.y / bw, sum.z / bw)
	return Color.from_hsv(m.h, clampf(m.s * 1.3, 0.0, 1.0), 1.0)


## The palette index (velocity) closest to `c`; a near-grey colour → white (3).
static func nearest(c: Color) -> int:
	if c.s < 0.15:
		return 3
	var best := 3
	var bd := INF
	for i in range(4, HEX.size()):
		var p := Color.html(HEX[i])
		var d := Vector3(p.r - c.r, p.g - c.g, p.b - c.b).length_squared()
		if d < bd:
			bd = d
			best = i
	return best


## A stand-in colour when a visual has no thumbnail (a game, one not rendered yet): a hue of its name.
static func of_name(name: String) -> Color:
	return Color.from_hsv(float(hash(name) & 0xFFFF) / 65536.0, 0.85, 1.0)


## WO-1070: what a colour is called ("Red" … "Pink", "White" for a grey) — the pad banks' names.
const HUES := ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink"]
const HUE_ENDS := [0.04, 0.11, 0.2, 0.44, 0.55, 0.72, 0.82, 0.96]  # where each name's hue range ends (then Red again)


static func hue_name(c: Color) -> String:
	if c.s < 0.15:
		return "White"
	for i in HUE_ENDS.size():
		if c.h < HUE_ENDS[i]:
			return HUES[i]
	return HUES[0]
