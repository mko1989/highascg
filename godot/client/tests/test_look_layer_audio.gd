extends RefCounted
## WO-817 — audio-only look layers: the helper, and the look editor viewer's pick skipping them (only the list selects).

const A := preload("res://features/live/look_layer_audio.gd")
var t

const VIDEO := {"layerNumber": 10, "source": {"type": "media", "value": "clips/intro.mov"}}
const WAV := {"layerNumber": 11, "source": {"type": "media", "value": "audio_test/tone_pair12_440Hz.wav"}}


func test_is_audio_only() -> void:
	t.eq(A.is_audio_only(WAV), true, "a .wav media layer (the stored shape: type media, no flag)")
	t.eq(A.is_audio_only({"source": {"type": "media", "value": "Bed.MP3"}}), true, "extension case-insensitive")
	t.eq(A.is_audio_only({"source": {"type": "live_audio", "value": "live_audio:1"}}), true, "live_audio source")
	t.eq(A.is_audio_only({"source": {"type": "audio", "value": "x"}}), true, "audio source type")
	t.eq(A.is_audio_only(VIDEO), false, "a movie")
	t.eq(A.is_audio_only({"source": {"type": "media", "value": "still.png"}}), false, "a still")
	t.eq(A.is_audio_only(VIDEO, {"audioOnlyLook": true}), true, "every layer of an audio-only look (WO-572)")
	t.eq(A.is_audio_only({"source": {"value": ""}}, {"audioOnlyLook": true}), false, "an empty layer is not audio")
	t.eq(A.is_audio_only({}), false, "no source")
	t.eq(A.is_audio_only(null), false, "not a layer")


func test_viewer_pick_skips_audio_only() -> void:
	var full := func(_l: Dictionary) -> Rect2: return Rect2(0, 0, 100, 100)
	var at := Vector2(50, 50)
	t.eq(A.pick([VIDEO, WAV], {}, full, at), 0, "the audio layer on top is skipped → the video under it")
	t.eq(A.pick([WAV], {}, full, at), -1, "audio only → nothing (a click on the empty frame)")
	t.eq(A.pick([WAV, VIDEO], {}, full, at), 1, "a video layer on top is picked")
	t.eq(A.pick([VIDEO], {"audioOnlyLook": true}, full, at), -1, "an audio-only look's layers are never picked")
	t.eq(A.pick([VIDEO, WAV], {}, full, Vector2(150, 50)), -1, "outside every box")
