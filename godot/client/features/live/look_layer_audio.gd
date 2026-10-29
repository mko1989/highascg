extends RefCounted
## WO-817 (owner 29.10: "audio only layers should be transparent in the editor and not pickable in the viewer (the
## looks editor) as it doesnt make sense to select them there. only in the list."): which look layers are audio-only,
## and the viewer's pick that skips them. Pure, tests headless.
## No stored flag exists per layer (a layer's source is {type: "media", value: "x.wav"}), so this follows the web
## (client/lib/media-audio-kind.js isLikelyAudioOnlySource: the audio extensions) plus the two stored markers there
## are: the look's `audioOnlyLook` (WO-572, the whole look plays on the audio layer 200, nothing on screen) and an
## `audio` / `live_audio` source type (web scene-look-kind.js; a live_audio layer is put on air at opacity 0).

const Ops := preload("res://features/live/look_layer_ops.gd")
const AUDIO_EXT := ["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "wma"]  # web media-audio-kind.js AUDIO_EXT
const AUDIO_TYPES := ["audio", "live_audio"]


## True when `layer` shows no picture: its look is an audio-only look, its source type is audio, or its media is an
## audio file. An empty layer is not audio-only.
static func is_audio_only(layer: Variant, look: Dictionary = {}) -> bool:
	if not (layer is Dictionary) or not ((layer as Dictionary).get("source") is Dictionary):
		return false
	var src: Dictionary = layer.source
	var value := str(src.get("value", ""))
	if value == "":
		return false
	if look.get("audioOnlyLook") == true or str(src.get("type", "")) in AUDIO_TYPES:
		return true
	return value.get_extension().to_lower() in AUDIO_EXT


## The look editor viewer's click-to-select pick: Ops.layer_at with every audio-only layer given no box, so a click
## over one falls through to the layer under it or the empty frame. -1 = none.
static func pick(layers: Array, look: Dictionary, rect_of: Callable, at: Vector2) -> int:
	return Ops.layer_at(layers, func(l: Dictionary) -> Rect2: return Rect2() if is_audio_only(l, look) else rect_of.call(l), at)
