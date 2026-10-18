extends RefCounted
## WO-601 — countdown / timer template layers, pure (web inspector-countdown.js, inspector-countdown-controller.js,
## lib/scene-state-timers.js, lib/duration-hms-input.js). Timer instances (WO-208) live in the project's scenes
## envelope (`project.scenes.timers = [{id, name, config, canonicalLayerByScreen}]`, saved by autosave — the deck
## sync does not carry them); a countdown layer binds one through `source.countdownTimerId`, and a config edit
## propagates to every bound layer in every look.
## Deliberate difference: the web's getCurrentConfig() rebuilds the config from a fixed key list without
## posX/posY, so its "Position px" override (WO-320A) is never stored or sent — here the whole config is kept.

const DEFAULTS := {  # inspector-countdown.js DEFAULT_COUNTDOWN_CONFIG
	"mode": "duration", "durationSec": 300, "targetTime": "18:00:00", "format": "auto", "amberThresholdSec": 60,
	"redThresholdSec": 15, "position": "center", "hideTimer": false, "timerFontSize": 15, "auxFontSize": 5,
	"timerColor": "#ffffff", "amberColor": "#ffb300", "redColor": "#ff3b30", "auxColor": "#ffffff",
	"auxTop": "", "auxMiddle": "", "auxBottom": "",
}
const TIMER_DEFAULTS_EXTRA := {"timerFontFamily": "", "timerBorderWidth": 0, "timerBorderColor": "#000000"}  # scene-state-timers.js
const MODES := [["duration", "Countdown (duration)"], ["clock", "Countdown to clock time"], ["countup", "Count up"]]
const FORMATS := [["auto", "Auto (HH:MM:SS / MM:SS)"], ["hms", "HH:MM:SS"], ["ms", "MM:SS"]]
const POSITIONS := [["top-left", "Top Left"], ["top-middle", "Top Middle"], ["top-right", "Top Right"], ["bottom-left", "Bottom Left"],
	["bottom-middle", "Bottom Middle"], ["bottom-right", "Bottom Right"], ["center", "Center"]]
const UPDATE_DEBOUNCE_MS := 450  # COUNTDOWN_CG_UPDATE_DEBOUNCE_MS


static func is_countdown(source: Variant) -> bool:
	return source is Dictionary and str(source.get("value", "")).to_lower().replace("\\", "/").contains("countdown/countdown")


## resolveLayerCountdownConfig
static func config_of(layer: Dictionary) -> Dictionary:
	var out := DEFAULTS.duplicate()
	var src: Variant = layer.get("source")
	if src is Dictionary and src.get("countdownConfig") is Dictionary:
		out.merge(src.countdownConfig, true)
	return out


## persistLocalConfig patch: structured source.countdownConfig + flat cgData (what the scene take's CG ADD reads).
static func patch_for(source: Dictionary, config: Dictionary) -> Dictionary:
	var src := source.duplicate(true)
	src["countdownConfig"] = config.duplicate()
	return {"source": src, "cgData": config.duplicate()}


## secondsToHms
static func secs_to_hms(total: float) -> Vector3i:
	var n := maxi(0, floori(total))
	return Vector3i(n / 3600, (n % 3600) / 60, n % 60)


## hmsToSeconds (clamped to 99:59:59)
static func hms_to_secs(h: float, m: float, s: float) -> int:
	return clampi(floori(h), 0, 99) * 3600 + clampi(floori(m), 0, 59) * 60 + clampi(floori(s), 0, 59)


## The scenes envelope's timer list (created when missing).
static func timers(root: Dictionary) -> Array:
	if not (root.get("timers") is Array):
		root["timers"] = []
	return root.timers


static func find_timer(root: Dictionary, id: String) -> Dictionary:
	for t in timers(root):
		if t is Dictionary and str(t.get("id", "")) == id:
			return t
	return {}


## createTimerFromLayer — id like the web's non-crypto newId (`sc_<ms>_<7 base36>`), name `Timer #<ms % 100>`.
static func new_timer(layer: Dictionary, main_idx: int, now_ms: int, rand7: String) -> Dictionary:
	var cfg := DEFAULTS.duplicate()
	cfg.merge(TIMER_DEFAULTS_EXTRA, true)
	var src: Variant = layer.get("source")
	if src is Dictionary and src.get("countdownConfig") is Dictionary:
		cfg.merge(src.countdownConfig, true)
	return {"id": "sc_%d_%s" % [now_ms, rand7], "name": "Timer #%d" % (now_ms % 100), "config": cfg,
		"canonicalLayerByScreen": {str(main_idx): layer.get("layerNumber")} if main_idx >= 0 else {}}


## findBoundLayers → [[look, layer index], …]
static func bound_layers(root: Dictionary, timer_id: String) -> Array:
	var out: Array = []
	for sc in (root.get("scenes", []) if root.get("scenes") is Array else []):
		if not (sc is Dictionary) or str(sc.get("id", "")) == "":
			continue
		var layers: Array = sc.get("layers", []) if sc.get("layers") is Array else []
		for i in layers.size():
			var s: Variant = layers[i].get("source") if layers[i] is Dictionary else null
			if s is Dictionary and str(s.get("countdownTimerId", "")) == timer_id:
				out.append([sc, i])
	return out


## Config edit: timer.config + every OTHER bound layer (propagateConfigToBoundLayers). Returns changed look ids.
static func propagate(root: Dictionary, timer_id: String, cfg: Dictionary, self_look: String, self_index: int) -> Array:
	var t := find_timer(root, timer_id)
	if t.is_empty():
		return []
	t["config"] = cfg.duplicate()
	var changed: Array = []
	for b in bound_layers(root, timer_id):
		if str(b[0].id) == self_look and b[1] == self_index:
			continue
		var layer: Dictionary = b[0].layers[b[1]]
		layer.merge(patch_for(layer.source, cfg), true)
		if not changed.has(str(b[0].id)):
			changed.append(str(b[0].id))
	return changed


## renameTimer + the bound layers' source.label. Blank names are refused (returns []). Returns changed look ids.
static func rename(root: Dictionary, timer_id: String, name: String) -> Array:
	var t := find_timer(root, timer_id)
	var nm := name.strip_edges()
	if t.is_empty() or nm == "":
		return []
	t["name"] = nm
	var changed: Array = []
	for b in bound_layers(root, timer_id):
		(b[0].layers[b[1]].source as Dictionary)["label"] = nm
		if not changed.has(str(b[0].id)):
			changed.append(str(b[0].id))
	return changed
