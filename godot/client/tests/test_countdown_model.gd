extends RefCounted
## WO-601 countdown / timer instances (web inspector-countdown*.js, scene-state-timers.js, duration-hms-input.js).

const C := preload("res://features/live/countdown_model.gd")
var t


func _root() -> Dictionary:
	var cd := func(id: String, tid: String) -> Dictionary:
		return {"layerNumber": 30, "source": {"type": "template", "value": "countdown/countdown", "countdownTimerId": tid, "label": "Old"}}
	return {
		"scenes": [
			{"id": "A", "layers": [cd.call("a", "T1"), {"layerNumber": 10, "source": {"type": "media", "value": "CLIP"}}]},
			{"id": "B", "layers": [cd.call("b", "T1")]},
			{"id": "C", "layers": [cd.call("c", "T2")]},
		],
		"timers": [{"id": "T1", "name": "Doors", "config": {}}, {"id": "T2", "name": "Other", "config": {}}],
	}


func test_detection_config_patch() -> void:
	t.ok(C.is_countdown({"value": "Countdown\\countdown.html"}), "path match, case + backslash")
	t.ok(not C.is_countdown({"value": "lower-thirds/lt-x"}), "other template")
	var cfg := C.config_of({"source": {"countdownConfig": {"mode": "clock", "posX": 120}}})
	t.eq(cfg.mode, "clock", "stored value wins")
	t.eq(cfg.durationSec, 300, "defaults filled")
	t.eq(cfg.posX, 120, "px override kept (the web drops it)")
	var p := C.patch_for({"value": "countdown/countdown", "countdownTimerId": "T1"}, cfg)
	t.eq(p.source.countdownTimerId, "T1", "binding kept")
	t.eq(p.cgData, cfg, "flat cgData = config")


func test_hms() -> void:
	t.eq(C.secs_to_hms(3725.9), Vector3i(1, 2, 5), "3725.9 s → 1:02:05 (floor)")
	t.eq(C.secs_to_hms(-5), Vector3i.ZERO, "negative → 0")
	t.eq(C.hms_to_secs(1, 2, 5), 3725, "back")
	t.eq(C.hms_to_secs(120, 75, 99), 99 * 3600 + 59 * 60 + 59, "clamped to 99:59:59")


func test_new_timer() -> void:
	var tm := C.new_timer({"layerNumber": 30, "source": {"countdownConfig": {"durationSec": 60}}}, 1, 1760000000042, "abc1234")
	t.eq(tm.id, "sc_1760000000042_abc1234", "web fallback id format")
	t.eq(tm.name, "Timer #42", "Timer #<ms % 100>")
	t.eq(tm.config.durationSec, 60, "layer config wins")
	t.eq(tm.config.timerBorderColor, "#000000", "timer-only defaults")
	t.eq(tm.canonicalLayerByScreen, {"1": 30}, "canonical layer per screen")


func test_bound_propagate_rename() -> void:
	var r := _root()
	t.eq(C.bound_layers(r, "T1").map(func(b: Array) -> String: return "%s:%d" % [b[0].id, b[1]]), ["A:0", "B:0"], "bound across looks")
	var changed := C.propagate(r, "T1", {"mode": "countup"}, "A", 0)
	t.eq(changed, ["B"], "self skipped")
	t.eq(r.scenes[1].layers[0].source.countdownConfig, {"mode": "countup"}, "other look patched")
	t.eq(r.scenes[1].layers[0].cgData, {"mode": "countup"}, "…with cgData")
	t.ok(not r.scenes[0].layers[0].source.has("countdownConfig"), "self left to the editor")
	t.eq(r.timers[0].config, {"mode": "countup"}, "timer config stored")
	t.ok(not r.scenes[2].layers[0].source.has("countdownConfig"), "other timer untouched")
	t.eq(C.rename(r, "T1", "  "), [], "blank refused")
	t.eq(C.rename(r, "T1", " Doors open "), ["A", "B"], "rename touches bound looks")
	t.eq(r.scenes[1].layers[0].source.label, "Doors open", "label copied")
	t.eq(r.timers[0].name, "Doors open", "trimmed")
	t.eq(C.propagate(r, "NOPE", {}, "A", 0), [], "unknown timer")
