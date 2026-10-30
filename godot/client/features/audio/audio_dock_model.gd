extends RefCounted
## WO-806 — the Program audio dock's pure half (web audio-mixer-panel.js, the owner's "compact audio mixer"): masters
## first, then one group of dense rows per program channel (live inputs before them), and the WO-227 dense rule on the
## compact surface — a master with more than 4 bus channels draws narrow bars so an 8-channel screen's master column
## stays ≈ 82 px (web dense strips: 80) and four of them (2 screens × PGM / PRV) fit the 400 px Inspector column on one
## line (the masters flow-wrap beyond that); 2–4 channels keep meter_bank.gd's own 9 px bars.

const AA := preload("res://features/audio/audio_actions.gd")
const R := preload("res://features/devices/cable_rules.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const DENSE_BARS := 4  # > 4 bus channels → dense master
const DENSE_ROWS := 4  # > 4 layers in a group → tighter rows
const BAR_W := 9  # meter_bank.gd's width per bar
const BAR_W_DENSE := 6
const INLINE_ROUTES := 4  # up to this many routing toggles sit on the row itself, more go on a line of their own
const COLUMN_W := 400  # shell.gd: the Inspector column's minimum width


static func dense_master(bars: int) -> bool:
	return bars > DENSE_BARS


## A master's meter width: 9 px per bar (meter_bank.gd's own), 6 px per bar when dense.
static func meter_width(bars: int) -> int:
	return maxi(10, maxi(1, bars) * (BAR_W_DENSE if dense_master(bars) else BAR_W))


static func masters(rows: Array) -> Array:
	return rows.filter(func(r: Dictionary) -> bool: return r.get("isMaster", false) == true)


## "PGM 1 Master" → "PGM 1" (the dock's column is narrow; the tooltip keeps the channel).
static func master_label(r: Dictionary) -> String:
	return str(r.get("label", "")).trim_suffix(" Master")


## [{title, rows, dense}]: "Live inputs" (when any), then "PGM n (ch c)" per program channel with layers —
## "Dioda PGM (ch c)" for a labelled screen.
static func groups(rows: Array, programs: Array, cm := {}) -> Array:
	var out: Array = []
	var live := rows.filter(func(r: Dictionary) -> bool: return r.get("isLiveInput", false) == true)
	if not live.is_empty():
		out.append({"title": "Live inputs", "rows": live, "dense": live.size() > DENSE_ROWS})
	for i in programs.size():
		var list := rows.filter(func(r: Dictionary) -> bool:
			return r.get("isMaster", false) != true and r.get("isLiveInput", false) != true and float(r.ch) == float(programs[i]))
		if not list.is_empty():
			out.append({"title": AR.inputs_title(cm, i, programs[i], ""), "rows": list, "dense": list.size() > DENSE_ROWS})
	return out


## The row's routing toggles: "routes" (a live input's Ch buttons), "screens" (a look layer's cross-screen buttons —
## only with more than one program channel: a lone host button says nothing), or "".
static func routing(r: Dictionary, programs: Array) -> String:
	if AA.routed(r):
		return "routes"
	if AA.cross_screen(r) and programs.size() > 1:
		return "screens"
	return ""


static func routes_inline(programs: Array) -> bool:
	return programs.size() <= INLINE_ROUTES


## What a rebuild depends on (values sync in place).
static func shape(rows: Array, bars_of: Callable, programs: Array) -> String:
	var sig := [programs]
	for r in rows:
		sig.append([r.key, r.label, r.get("sceneId"), bars_of.call(r) if r.get("isMaster", false) == true else 1, r.get("liveAudioSlot")])
	return JSON.stringify(sig)
