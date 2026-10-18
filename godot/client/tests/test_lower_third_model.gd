extends RefCounted
## WO-601 lower thirds — golden values from the web's lower-third-cg-data.js under node.

const LT := preload("res://features/live/lower_third_model.gd")
const NetUtil := preload("res://core/net_util.gd")
## [config, buildLowerThirdCasparCgData(config) JSON]
const CASES := [
	[{}, "{\"name\":\"\",\"title\":\"\",\"displayDurationSec\":10,\"primaryColor\":\"#4fc3f7\",\"textColor\":\"#ffffff\",\"position\":\"left\",\"titleFontSize\":46,\"subtitleFontSize\":27,\"renderScale\":100,\"fontFamily\":\"arial\",\"fontFamilyId\":\"arial\",\"data\":{\"name\":\"\",\"title\":\"\",\"displayDurationSec\":\"10\",\"primaryColor\":\"#4fc3f7\",\"textColor\":\"#ffffff\",\"position\":\"left\",\"titleFontSize\":\"46\",\"subtitleFontSize\":\"27\",\"renderScale\":\"100\",\"fontFamily\":\"arial\",\"fontFamilyId\":\"arial\"},\"style\":{\"primaryColor\":\"#4fc3f7\",\"textColor\":\"#ffffff\",\"position\":\"left\",\"displayDurationSec\":10,\"titleFontSize\":46,\"subtitleFontSize\":27,\"renderScale\":100,\"fontFamilyId\":\"arial\"}}"],
	[{"title": "  Jan Kowalski ", "subtitle": "CEO", "titleFontSize": 52, "displayDurationSec": 2.5, "renderScale": "120", "fontFamily": "Georgia", "position": "right", "primaryColor": "#ff0000"}, "{\"name\":\"  Jan Kowalski \",\"title\":\"CEO\",\"displayDurationSec\":2.5,\"primaryColor\":\"#ff0000\",\"textColor\":\"#ffffff\",\"position\":\"right\",\"titleFontSize\":52,\"subtitleFontSize\":27,\"renderScale\":120,\"fontFamily\":\"georgia\",\"fontFamilyId\":\"georgia\",\"data\":{\"name\":\"  Jan Kowalski \",\"title\":\"CEO\",\"displayDurationSec\":\"2.5\",\"primaryColor\":\"#ff0000\",\"textColor\":\"#ffffff\",\"position\":\"right\",\"titleFontSize\":\"52\",\"subtitleFontSize\":\"27\",\"renderScale\":\"120\",\"fontFamily\":\"georgia\",\"fontFamilyId\":\"georgia\"},\"style\":{\"primaryColor\":\"#ff0000\",\"textColor\":\"#ffffff\",\"position\":\"right\",\"displayDurationSec\":2.5,\"titleFontSize\":52,\"subtitleFontSize\":27,\"renderScale\":120,\"fontFamilyId\":\"georgia\"}}"],
	[{"titleFontSize": "", "subtitleFontSize": -3, "displayDurationSec": "x", "renderScale": null, "textColor": ""}, "{\"name\":\"\",\"title\":\"\",\"displayDurationSec\":10,\"primaryColor\":\"#4fc3f7\",\"position\":\"left\",\"titleFontSize\":46,\"subtitleFontSize\":0,\"renderScale\":100,\"fontFamily\":\"arial\",\"fontFamilyId\":\"arial\",\"data\":{\"name\":\"\",\"title\":\"\",\"displayDurationSec\":\"10\",\"primaryColor\":\"#4fc3f7\",\"position\":\"left\",\"titleFontSize\":\"46\",\"subtitleFontSize\":\"0\",\"renderScale\":\"100\",\"fontFamily\":\"arial\",\"fontFamilyId\":\"arial\"},\"style\":{\"primaryColor\":\"#4fc3f7\",\"position\":\"left\",\"displayDurationSec\":10,\"titleFontSize\":46,\"subtitleFontSize\":0,\"renderScale\":100,\"fontFamilyId\":\"arial\"}}"],
	[{"name": "Legacy", "role": "Role"}, "{\"name\":\"\",\"title\":\"\",\"displayDurationSec\":10,\"primaryColor\":\"#4fc3f7\",\"textColor\":\"#ffffff\",\"position\":\"left\",\"titleFontSize\":46,\"subtitleFontSize\":27,\"renderScale\":100,\"fontFamily\":\"arial\",\"fontFamilyId\":\"arial\",\"data\":{\"name\":\"\",\"title\":\"\",\"displayDurationSec\":\"10\",\"primaryColor\":\"#4fc3f7\",\"textColor\":\"#ffffff\",\"position\":\"left\",\"titleFontSize\":\"46\",\"subtitleFontSize\":\"27\",\"renderScale\":\"100\",\"fontFamily\":\"arial\",\"fontFamilyId\":\"arial\"},\"style\":{\"primaryColor\":\"#4fc3f7\",\"textColor\":\"#ffffff\",\"position\":\"left\",\"displayDurationSec\":10,\"titleFontSize\":46,\"subtitleFontSize\":27,\"renderScale\":100,\"fontFamilyId\":\"arial\"}}"],
]
var t


func test_caspar_cg_data_matches_web() -> void:
	for c in CASES:
		# byte-equal wire JSON = same values, key order and number format as the web writes
		t.eq(NetUtil.to_json(LT.caspar_cg_data(c[0])), c[1], "cgData %s" % [c[0]])


func test_source_detection_and_template_id() -> void:
	t.ok(LT.is_lower_third({"value": "lower-thirds/lt-classic-box"}), "lower-thirds/lt-")
	t.ok(LT.is_lower_third({"value": "LOWER_THIRDS\\LT-Bar"}), "backslash + underscore + case")
	t.ok(not LT.is_lower_third({"value": "templates/x"}) and not LT.is_lower_third({}), "others")
	t.eq(LT.template_id("lower-thirds/lt-classic-box"), "lt-classic-box", "id")
	t.eq(LT.template_id("LOWER_THIRDS\\LT-Bar"), "lt-bar", "lower-cased")
	t.eq(LT.template_id("templates/x"), "", "none")


func test_patch_keeps_source() -> void:
	var src := {"type": "template", "value": "lower-thirds/lt-classic-box", "lowerThirdRoster": {"rows": [1]}}
	var p := LT.patch_for(src, {"title": "A"})
	t.eq(p.source.lowerThirdRoster, {"rows": [1]}, "roster kept")
	t.eq(p.source.lowerThirdConfig, {"title": "A"}, "config stored")
	t.eq(p.cgData.name, "A", "cgData rebuilt")
	t.ok(not src.has("lowerThirdConfig"), "input untouched")
