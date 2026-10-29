extends RefCounted
## WO-818 — the media tree's NotchLC warning: which rows get the ⚠ (media_ops.is_notchlc) and its tooltip text.

const O := preload("res://features/live/media_ops.gd")
var t


func test_codec_decides() -> void:
	t.ok(O.is_notchlc({"id": "mhp_harder/VISUALE.mov", "codec": "notchlc"}), "probed notchlc")
	t.ok(O.is_notchlc({"id": "a.mov", "codec": "NotchLC"}), "case-insensitive")
	t.ok(O.is_notchlc({"id": "a.mov", "codec": " notchlc "}), "trimmed")
	t.ok(not O.is_notchlc({"id": "NOTCH/AKT_1/WIZYTOWKA_L_1_1_HAP.mov", "codec": "hap"}), "hap is not")
	t.ok(not O.is_notchlc({"id": "clips/intro_notchlc.mov", "codec": "hap"}), "a known codec beats the file name")


func test_file_name_fallback_only_without_codec() -> void:
	t.ok(O.is_notchlc({"id": "clips/intro_NotchLC.mov"}), "unprobed: the file name says so")
	t.ok(O.is_notchlc({"id": "clips/intro_notchlc.mov", "codec": null}), "null codec counts as unknown")
	t.ok(O.is_notchlc({"label": "x/notchlc_loop.mov", "codec": ""}), "label when there is no id")
	t.ok(not O.is_notchlc({"id": "projects/NOTCHLC/clip.mov"}), "a folder name is not the file")
	t.ok(not O.is_notchlc({"id": "clips/intro.mov"}), "nothing known")
	t.ok(not O.is_notchlc({}), "empty row")


func test_tooltip_is_two_lines() -> void:
	t.eq(O.NOTCHLC_TIP.split("\n").size(), 2, "two lines")
	t.ok(O.NOTCHLC_TIP.contains("GPU") and O.NOTCHLC_TIP.contains("CPU") and O.NOTCHLC_TIP.contains("transcode it to HAP in HighAsCG"), "WO-820: GPU here, CPU on stock, what to do there")
	t.ok(not O.NOTCHLC_TIP.contains("ffmpeg"), "no command line: HighAsCG transcodes to HAP itself")
