extends RefCounted
## WO-600 M — mv_doc.gd: stored layout → editor state (web loadFromData defaults + route migration), the project
## slice export (no audio focus), preset slots, the cell strip label, the WO-156 self-route refusal, canvas size.

const D := preload("res://features/multiview/mv_doc.gd")
var t

const CM := {"programChannels": [1], "previewChannels": [2], "multiviewChannels": [3], "multiviewCh": 3,
	"programResolutions": [{"w": 1920, "h": 1080, "fps": 50}], "channelResolutionsByChannel": {"3": {"w": 3840, "h": 2160}},
	"virtualMainChannels": [{"name": "Stage"}]}


func test_load_and_export() -> void:
	t.eq(D.load(null, CM), null, "nothing stored → keep state")
	t.eq(D.load({"canvasWidth": 10}, CM), null, "no cell array → keep state")
	var s: Dictionary = D.load({"cells": [{"id": "p", "source": {"value": "route://2-11"}}], "timerScale": 999, "bgColor": ""}, CM)
	t.eq(s.cells[0].source.value, "route://2", "legacy PRV route://N-11 migrated")
	t.eq([s.canvasWidth, s.canvasHeight, s.timerScale, s.bgColor, s.showOverlay, s.autoApply, s.highlightTopTimer, s.showTimersUnderLabels],
		[1920.0, 1080.0, 300.0, "#000000", true, true, true, false], "web defaults + timer clamp")
	s.audioActiveCellId = "p"
	t.ok(not D.export(s).has("audioActiveCellId"), "audio focus is per session, not in the project")
	t.eq(D.snapshot(s).audioActiveCellId, "p", "but presets keep it")
	var e := D.export(s)
	e.cells[0].id = "changed"
	t.eq(s.cells[0].id, "p", "export is a copy")
	var kept: Dictionary = D.load({"cells": []}, CM, {"canvasWidth": 1280.0, "canvasHeight": 720.0, "bgColor": "#112233"})
	t.eq([kept.canvasWidth, kept.bgColor], [1280.0, "#112233"], "a preset without size / bg keeps the current ones")


func test_slots_label_guard_size() -> void:
	t.eq(D.slots(null), [null, null, null, null], "4 empty slots")
	t.eq(D.slots([1, 2]), [null, null, null, null], "wrong length → empty")
	t.eq(D.cell_label({"id": "pgm", "type": "pgm", "label": "PGM", "screenIdx": 0}, CM), "PGM · Stage (1920x1080 50p)", "virtual main name + suffix")
	t.eq(D.cell_label({"id": "c", "type": "media", "label": "L", "source": {"value": "AMB"}}, CM), "AMB", "source value when no source label")
	t.eq(D.cell_label({"id": "c", "type": "media"}, CM), "c", "falls back to the id")
	t.eq(D.cell_label({"id": "c", "type": "media", "label": "x".repeat(40)}, CM), "x".repeat(33) + "…", "cut to 36")
	t.ok(D.self_route_message("route://3-1", 3).contains("own output"), "own channel refused")
	t.eq(D.self_route_message("route://4", 3), "", "other channels fine")
	t.eq(D.self_route_message("AMB", 3), "", "media fine")
	t.eq(D.canvas_size(CM), Vector2(3840, 2160), "the multiview channel's resolution")
	t.eq(D.canvas_size({"programResolutions": [{"w": 1280, "h": 720}]}), Vector2(1280, 720), "else screen 1")
	t.eq(D.canvas_size({}), Vector2.ZERO, "unknown")
	t.eq(D.mv_channels({"multiviewCh": 7}), [7], "legacy single channel")
