extends PanelContainer
## WO-788 — the timeline editor's live picture (owner 26.10: "there is no live preview in timeline editor"): the Caspar
## channel the timeline plays to, from VideoSurfaces like the look editor's compose frame — PRV of the Dest screen, or
## PGM when the timeline is routed to program only. Held (leased) only while the tab shows it.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const S := preload("res://features/timeline/timeline_send_to.gd")

var role := ""
var _video: TextureRect
var _tag: Label


func _ready() -> void:
	custom_minimum_size.y = 120
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color.BLACK
	add_theme_stylebox_override("panel", bg)
	_video = TextureRect.new()
	_video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_video.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_video)
	_tag = Label.new()
	_tag.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_tag.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_tag.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_tag)
	visibility_changed.connect(_hold)


func follow(st: Dictionary) -> void:
	var next := S.monitor_role(st)
	if next == role:
		return
	if role != "":
		VideoSurfaces.release(role, self)
	role = next
	_tag.text = " %s %s " % [role.substr(0, 3).to_upper(), role.substr(3)]
	_video.texture = VideoSurfaces.texture(role)
	_hold()


func _hold() -> void:
	if role == "":
		return
	if is_visible_in_tree():
		VideoSurfaces.acquire(role, self)
	else:
		VideoSurfaces.release(role, self)


func _exit_tree() -> void:
	VideoSurfaces.release_all(self)
