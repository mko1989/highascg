extends RefCounted
## WO-899 (owner 31.10) — "fit all the Sources tab in its space always: shrink the font, then when a visibility
## threshold is reached trim the label". Pure planner, no nodes: the callers (app/fit_tabs.gd for a TabContainer,
## features/live/project_media_bar.gd for a button row) measure with their own font and apply the plan.
##
## The order is fixed and the same everywhere:
##   1. natural size and padding, if everything fits;
##   2. font steps from NATURAL_SIZE down to MIN_SIZE (one px at a time), the horizontal padding scaling with the font
##      (pad_for), so a narrower column first gets slightly smaller, then slightly tighter, text;
##   3. at MIN_SIZE with the tightest padding: the labels are trimmed with "…", WIDEST FIRST, one character at a time,
##      so the short names ("CGs", "Live") stay whole and only the long ones lose their tail (full text → tooltip).
## MIN_SIZE is 11 px: the theme's default is 15 (app/theme_builder.gd) and the Sources column already sets its secondary
## lines (media quick-look, Visuals note, Live note: 11-12) at 11, so 11 is the smallest size that is already a normal
## reading size in this column; anything below is trimmed instead of shrunk.

const NATURAL_SIZE := 15
const MIN_SIZE := 11
const MIN_PAD := 6
const MAX_PAD := 16
const ELLIPSIS := "…"
const SLACK := 2.0  # px kept free: widths are fractional, a tab bar scrolls (‹ ›) at the first sub-pixel overflow


## The horizontal padding (each side of a tab / button label) that goes with a font size: 15 → 8, 11 → 6.
static func pad_for(size: int) -> int:
	return clampi(roundi(size * 0.55), MIN_PAD, MAX_PAD)


## measure: Callable(text: String, size: int) -> float (the string's width in px).
## chrome:   Callable(size: int) -> float — everything beside the text at that size (paddings, check boxes, gaps),
##           or a plain number.
## Returns {size, titles, trimmed, fits}. `natural` = true when no step was needed (callers drop their overrides).
static func plan(texts: Array, avail: float, measure: Callable, chrome: Variant) -> Dictionary:
	var room := avail - SLACK
	var steps: Array = []
	for s in range(NATURAL_SIZE, MIN_SIZE - 1, -1):
		steps.append(s)
	for s in steps:
		var w := _chrome(chrome, s)
		for t in texts:
			w += measure.call(str(t), s)
		if w <= room:
			return {"size": s, "titles": texts.duplicate(), "trimmed": false, "fits": true, "natural": s == NATURAL_SIZE}
	var out := trim_all(texts, room - _chrome(chrome, MIN_SIZE), measure, MIN_SIZE)
	return {"size": MIN_SIZE, "titles": out.titles, "trimmed": true, "fits": out.fits, "natural": false}


## Widest label first, one character off its tail (+ "…"), until the labels together fit `budget` px. A label never goes
## below one character + "…"; if even that does not fit, fits = false and the best effort is returned.
static func trim_all(texts: Array, budget: float, measure: Callable, size: int) -> Dictionary:
	var keep: Array = []  # characters kept per label
	var cur: Array = []
	for t in texts:
		keep.append(str(t).length())
		cur.append(str(t))
	while true:
		var total := 0.0
		var widest := -1
		var widest_w := -1.0
		for i in cur.size():
			var w: float = measure.call(cur[i], size)
			total += w
			if keep[i] > 1 and w > widest_w:
				widest = i
				widest_w = w
		if total <= budget:
			return {"titles": cur, "fits": true}
		if widest < 0:
			return {"titles": cur, "fits": false}
		keep[widest] -= 1
		cur[widest] = str(texts[widest]).substr(0, keep[widest]).strip_edges(false, true) + ELLIPSIS
	return {"titles": cur, "fits": false}


## One text into `width` px: the longest head + "…" that fits (the text itself when it already does).
static func trim_to(text: String, width: float, measure: Callable, size: int) -> String:
	if measure.call(text, size) <= width:
		return text
	var n := text.length()
	while n > 1:
		n -= 1
		var s := text.substr(0, n).strip_edges(false, true) + ELLIPSIS
		if measure.call(s, size) <= width:
			return s
	return text.substr(0, 1) + ELLIPSIS


static func _chrome(chrome: Variant, size: int) -> float:
	return float(chrome.call(size)) if chrome is Callable else float(chrome)
