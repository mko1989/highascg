extends RefCounted
## WO-601 layer style clipboard / presets — golden values from the web's scene-state-layer-logic.js under node.

const S := preload("res://features/live/layer_style_model.gd")
const NetUtil := preload("res://core/net_util.gd")
const STYLE := "{\"fill\":{\"x\":0.1,\"y\":0.2,\"scaleX\":0.5,\"scaleY\":0.5},\"opacity\":0.8,\"rotation\":15,\"loop\":true,\"audioRoute\":\"3+4\",\"volume\":0.5,\"muted\":false,\"straightAlpha\":true,\"contentFit\":\"fill-canvas\",\"aspectLocked\":false,\"startBehaviour\":\"beginning\",\"effects\":[{\"type\":\"crop\",\"params\":{\"left\":0.1}}],\"transition\":{\"type\":\"MIX\",\"duration\":12},\"fadeOnEnd\":{\"enabled\":false,\"frames\":12},\"pipOverlays\":[{\"type\":\"border\",\"params\":{\"width\":3}}]}"
const APPLIED := "{\"layerNumber\":11,\"source\":{\"value\":\"Y\"},\"fill\":{\"x\":0.1,\"y\":0.2,\"scaleX\":0.5,\"scaleY\":0.5},\"opacity\":0.8,\"transition\":{\"type\":\"MIX\",\"duration\":12},\"pipOverlays\":[{\"type\":\"border\",\"params\":{\"width\":3}}],\"cgData\":{\"k\":1},\"rotation\":15,\"loop\":true,\"audioRoute\":\"3+4\",\"volume\":0.5,\"muted\":false,\"straightAlpha\":true,\"contentFit\":\"fill-canvas\",\"aspectLocked\":false,\"effects\":[{\"type\":\"crop\",\"params\":{\"left\":0.1}}],\"startBehaviour\":\"beginning\",\"fadeOnEnd\":{\"enabled\":false,\"frames\":12}}"
const APPLIED_MIN := "{\"layerNumber\":12,\"opacity\":0.3,\"transition\":null,\"effects\":[{\"type\":\"brightness\"}],\"fill\":{\"x\":0.5,\"y\":0,\"scaleX\":1,\"scaleY\":1}}"
var t


## JSON round trip on both sides: compares values the way they are stored (ints and floats alike).
func _same(got: Variant, expected_json: String) -> bool:
	return JSON.parse_string(NetUtil.to_json(got)) == JSON.parse_string(expected_json)


func _source_layer() -> Dictionary:
	return {"layerNumber": 10, "source": {"value": "X"}, "fill": {"x": 0.1, "y": 0.2, "scaleX": 0.5, "scaleY": 0.5}, "opacity": 0.8, "rotation": 15,
		"loop": true, "audioRoute": "3+4", "volume": 0.5, "muted": false, "straightAlpha": true, "contentFit": "fill-canvas", "aspectLocked": false,
		"startBehaviour": "weird", "effects": [{"type": "crop", "params": {"left": 0.1}}], "transition": {"type": "MIX", "duration": 12},
		"pipOverlay": {"type": "border", "params": {"width": 3}}}


func test_style_data_matches_web() -> void:
	var d := S.style_data(_source_layer())
	t.ok(_same(d, STYLE), "getLayerStyleDataFromLayer (no source; legacy pipOverlay → list; odd startBehaviour → beginning)")
	t.ok(not d.has("source") and not d.has("loopAlways"), "source never copied; absent keys omitted")


func test_apply_matches_web() -> void:
	var tgt := {"layerNumber": 11, "source": {"value": "Y"}, "fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}, "opacity": 1, "transition": {"type": "CUT"},
		"pipOverlays": [{"type": "glow", "params": {}}], "cgData": {"k": 1}}
	tgt.merge(S.style_patch(S.style_data(_source_layer())), true)
	t.ok(_same(tgt, APPLIED), "applyLayerStyleData: everything but source/cgData")
	var t2 := {"layerNumber": 12, "opacity": 0.3, "transition": {"type": "MIX"}, "effects": [{"type": "brightness"}]}
	t2.merge(S.style_patch({"fill": {"x": 0.5}, "transition": null}), true)
	t.ok(_same(t2, APPLIED_MIN), "partial preset: fill completed from full fill, transition cleared, rest kept")


func test_unique_name() -> void:
	t.eq(S.unique_name([{"name": "Logo"}, {"name": "logo (2)"}], " Logo "), "Logo (3)", "case-insensitive numbering")
	t.eq(S.unique_name([], "  "), "Layer preset", "blank → default")
