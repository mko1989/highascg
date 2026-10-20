extends RefCounted
## WO-605 slice 4 — the GPU-output page's live control values as one Dictionary, and what each edit does (the web
## page's change handlers): `initial` = what the controls start as, `apply` = one edit → the effects it fires,
## in order — "caspar" (saveCasparSettings), "os" (the per-port OS save), "confine" (pointer confine), "preview"
## (re-fetch the timing preview). The controller only mirrors widgets ↔ this dict and runs the effects; the replay
## against the web page lives in test_devices_gpu_output.gd.

const GO := preload("res://features/devices/gpu_output_model.gd")
const GM := preload("res://features/devices/gpu_modeline_model.gd")
const MI := preload("res://core/math_input.gd")
## The controls whose edits re-save the consumer patch (the web's saveCasparSettings listeners).
const CASPAR_FIELDS := ["windowed", "fullscreen", "vsync", "border", "key_only", "aot", "operator_monitor", "interactive",
	"nvidia_sync", "sbs_key", "force_linear", "mipmaps", "high_bitdepth", "mode", "custom_w", "custom_h", "custom_fps",
	"edid", "stretch", "colour", "name", "ar", "pos_x", "pos_y"]
const OS_FIELDS := ["display", "os_w", "os_h", "os_fps", "timing", "override", "backend"]
## Fields whose edits also refresh the timing preview (the backend select and the consumer-only fields do not).
const PREVIEW_FIELDS := ["mode", "custom_w", "custom_h", "custom_fps", "display", "os_w", "os_h", "os_fps", "timing", "override"]


## cst = GO.consumer_state, mst = gpu_modeline_model.state. Texts are what the inputs show (math inputs format on
## attach: W/H 0 decimals, rates 2).
static func initial(cst: Dictionary, mst: Dictionary) -> Dictionary:
	var ui := {"windowed": cst.windowed, "vsync": cst.vsync, "border": not cst.borderless, "edid": cst.edid_override,
		"stretch": cst.stretch, "colour": cst.colour, "name": cst.name, "ar": cst.ar, "pos_x": cst.pos_x, "pos_y": cst.pos_y,
		"confine": cst.confine, "mode": mst.mode, "prev_standard": mst.prev_standard,
		"custom_w": MI.fixed(mst.custom.w, 0), "custom_h": MI.fixed(mst.custom.h, 0), "custom_fps": MI.fixed(mst.custom.fps, 2),
		"display": mst.display_sel, "os_w": MI.fixed(mst.os_custom.w, 0), "os_h": MI.fixed(mst.os_custom.h, 0),
		"os_fps": MI.fixed(mst.os_custom.r, 2), "override": mst.override, "timing": mst.timing, "backend": mst.backend}
	for t in GO.TOGGLES:
		ui[t[0]] = cst[t[0]]
	return ui


## One edit: `field` ← `value` (bools for checks, texts for selects / inputs). Mutates `ui`; returns the effects.
static func apply(ui: Dictionary, field: String, value: Variant) -> Array:
	match field:
		"fullscreen":
			ui.windowed = not value
		"operator_monitor":
			ui.operator_monitor = value
			if value:
				ui.interactive = true  # operator monitor implies Caspar interactive on this consumer
		"mode":
			if value == "custom" and ui.mode != "custom" and ui.prev_standard != "":
				var r := GM.custom_from_mode(ui.prev_standard)
				ui.custom_w = GM.js_num_str(r.w)
				ui.custom_h = GM.js_num_str(r.h)
				ui.custom_fps = GM.js_num_str(r.fps)
			ui.mode = value
			if value != "custom":
				ui.prev_standard = value
		"confine":
			ui.confine = value
			return ["confine"]
		_:
			ui[field] = value
	var out := []
	if field in CASPAR_FIELDS:
		out.append("caspar")
	if field in OS_FIELDS:
		out.append("os")
	if field in PREVIEW_FIELDS:
		out.append("preview")
	return out


## Row visibility / enablement: the custom W/H/FPS row shows (and is editable) only for a Custom video mode; the
## OS WxH × Hz row only for the Custom detected-mode pick.
static func custom_shown(ui: Dictionary) -> bool:
	return ui.mode == "custom"


static func os_custom_shown(ui: Dictionary) -> bool:
	return ui.display == "custom"

