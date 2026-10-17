extends SceneTree

# Verifies that the Godot APIs the HighAsCG port plan relies on exist in this engine build.

const CLASSES := [
	"Texture2DRD", "AtlasTexture", "ImageTexture", "RenderingDevice", "RenderingServer",
	"GLTFDocument", "GLTFState", "FBXDocument", "WebSocketPeer", "HTTPRequest", "HTTPClient",
	"PacketPeerUDP", "GraphEdit", "GraphNode", "Tree", "ItemList", "SubViewport", "Window",
	"DisplayServer", "FileAccess", "Thread", "WorkerThreadPool", "JSON", "Tween", "AnimationPlayer",
	"CodeEdit", "TextEdit", "SpinBox", "ColorPicker", "Shortcut", "InputEventMouseButton",
	"VideoStreamPlayer", "VideoStreamTheora", "SharedMemory", "GDExtensionManager",
]

const METHODS := [
	["RenderingDevice", "texture_update"],
	["RenderingDevice", "texture_create"],
	["RenderingDevice", "texture_create_from_extension"],
	["RenderingDevice", "texture_is_format_supported_for_usage"],
	["RenderingDevice", "get_driver_resource"],
	["RenderingServer", "texture_2d_update"],
	["RenderingServer", "get_rendering_device"],
	["RenderingServer", "texture_rd_create"],
	["Texture2DRD", "set_texture_rd_rid"],
	["ImageTexture", "update"],
	["Image", "set_data"],
	["Image", "create_from_data"],
	["AtlasTexture", "set_region"],
	["GLTFDocument", "append_from_file"],
	["GLTFDocument", "append_from_buffer"],
	["GLTFDocument", "generate_scene"],
	["FileAccess", "get_buffer"],
	["FileAccess", "seek"],
	["FileAccess", "get_64"],
	["Window", "set_current_screen"],
	["Window", "set_mouse_passthrough_polygon"],
	["DisplayServer", "get_screen_count"],
	["DisplayServer", "screen_get_position"],
	["DisplayServer", "screen_get_size"],
	["DisplayServer", "screen_get_refresh_rate"],
	["DisplayServer", "file_dialog_show"],
	["DisplayServer", "window_set_vsync_mode"],
	["DisplayServer", "clipboard_set"],
	["WebSocketPeer", "set_inbound_buffer_size"],
	["WebSocketPeer", "set_max_queued_packets"],
	["HTTPRequest", "set_download_chunk_size"],
	["OS", "set_low_processor_usage_mode"],
	["Tree", "create_item"],
	["GraphEdit", "connect_node"],
]

const CONSTS := [
	["RenderingDevice", "DATA_FORMAT_B8G8R8A8_UNORM"],
	["RenderingDevice", "DATA_FORMAT_R8G8B8A8_UNORM"],
	["RenderingDevice", "TEXTURE_USAGE_SAMPLING_BIT"],
	["RenderingDevice", "TEXTURE_USAGE_CAN_UPDATE_BIT"],
	["Image", "FORMAT_RGBA8"],
]

const SIGNALS := [
	["Window", "files_dropped"],
	["GraphEdit", "connection_request"],
	["HTTPRequest", "request_completed"],
]

func _init() -> void:
	print("ENGINE ", Engine.get_version_info().string)
	for c in CLASSES:
		print("CLASS  %-28s %s" % [c, "yes" if ClassDB.class_exists(c) else "NO"])
	for m in METHODS:
		var ok: bool = ClassDB.class_exists(m[0]) and ClassDB.class_has_method(m[0], m[1])
		print("METHOD %-50s %s" % [m[0] + "." + m[1], "yes" if ok else "NO"])
	for k in CONSTS:
		var ok2: bool = ClassDB.class_exists(k[0]) and ClassDB.class_has_integer_constant(k[0], k[1])
		print("CONST  %-50s %s" % [k[0] + "." + k[1], "yes" if ok2 else "NO"])
	for s in SIGNALS:
		var ok3: bool = ClassDB.class_exists(s[0]) and ClassDB.class_has_signal(s[0], s[1])
		print("SIGNAL %-50s %s" % [s[0] + "." + s[1], "yes" if ok3 else "NO"])
	if ClassDB.class_has_method("RenderingDevice", "texture_update"):
		for a in ClassDB.class_get_method_list("RenderingDevice"):
			if a.name in ["texture_update", "texture_create_from_extension"]:
				var args := []
				for arg in a.args:
					args.append("%s:%s" % [arg.name, type_string(arg.type)])
				print("SIG    RenderingDevice.%s(%s)" % [a.name, ", ".join(args)])
	quit()
