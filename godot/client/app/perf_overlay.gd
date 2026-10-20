extends CanvasLayer
## WO-623 — performance overlay (owner: "a system overlay that can be turned on/off with performance stats. cpu gpu
## ram etc."). Top-right panel over everything, click-through. Client numbers refresh twice a second from Godot's
## monitors + /proc/self; box numbers poll GET /api/host-stats every 2 s — only while shown, so the overlay costs
## nothing when off. Toggled from the header (pulse icon) or F3; remembered in ui.cfg [overlay] perf.

const M := preload("res://app/perf_overlay_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const UI_CFG := "user://ui.cfg"
const CLIENT_S := 0.5
const HOST_S := 2.0

signal toggled(on: bool)

var _panel: PanelContainer
var _grid: GridContainer
var _host: Variant = {}
var _host_busy := false
var _t_client := 0.0
var _t_host := HOST_S
var _prev_ticks := -1
var _client_rows: Array = []
var _vps: Array = []  # root window + every SubViewport (previs 3D) — render time is summed over all of them
var _vp_age := 0


func _ready() -> void:
	layer = 90
	_panel = PanelContainer.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := ThemeBuilder.box(Color(ThemeBuilder.BG_DARK, 0.95), ThemeBuilder.BORDER, 1)
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_panel.position.y = ThemeBuilder.HEADER_H + 6
	add_child(_panel)
	_grid = GridContainer.new()
	_grid.columns = 2
	_grid.add_theme_constant_override("h_separation", 14)
	_grid.add_theme_constant_override("v_separation", 1)
	_grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel.add_child(_grid)
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	var v: Variant = Config.args.get("perf", cfg.get_value("overlay", "perf", false))  # dev arg --perf=1 (not saved)
	set_on(v if v is bool else str(v) in ["1", "true", "on"], false)


func is_on() -> bool:
	return visible


func set_on(on: bool, save := true) -> void:
	visible = on
	set_process(on)
	for vp in _vps:
		if is_instance_valid(vp):
			RenderingServer.viewport_set_measure_render_time((vp as Viewport).get_viewport_rid(), false)
	_vps = []
	_vp_age = 0
	if on:
		_t_client = CLIENT_S
		_t_host = HOST_S
		_prev_ticks = -1
	if save:
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		cfg.set_value("overlay", "perf", on)
		cfg.save(UI_CFG)
	toggled.emit(on)


func _process(delta: float) -> void:
	_t_client += delta
	_t_host += delta
	if _t_host >= HOST_S and not _host_busy:
		_t_host = 0.0
		_poll_host()
	if _t_client >= CLIENT_S:
		_client_rows = M.client_rows(_sample_client(_t_client), M.cores_of(_host))
		_t_client = 0.0
		_render()


func _sample_client(dt: float) -> Dictionary:
	_vp_age -= 1
	if _vp_age <= 0:  # rescan every 5 s — tabs build their SubViewports lazily
		_vp_age = 10
		_vps = [get_viewport()] + get_tree().root.find_children("*", "SubViewport", true, false)
		for vp in _vps:
			RenderingServer.viewport_set_measure_render_time((vp as Viewport).get_viewport_rid(), true)
	var rcpu := 0.0
	var rgpu := 0.0
	for vp in _vps:
		if is_instance_valid(vp):
			rcpu += RenderingServer.viewport_get_measured_render_time_cpu((vp as Viewport).get_viewport_rid())
			rgpu += RenderingServer.viewport_get_measured_render_time_gpu((vp as Viewport).get_viewport_rid())
	var c := {
		"fps": Engine.get_frames_per_second(),
		"frame_ms": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		"render_cpu_ms": rcpu,
		"render_gpu_ms": rgpu,
		"draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"objects": Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
		"vram": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),
	}
	var ticks := M.stat_ticks(_read_proc("/proc/self/stat"))
	c["cpu_pct"] = M.cpu_pct(_prev_ticks, ticks, dt)
	_prev_ticks = ticks
	c["rss"] = M.vm_rss_bytes(_read_proc("/proc/self/status"))
	if c.rss < 0:
		c["rss"] = OS.get_static_memory_usage()  # not Linux: Godot's own allocator total
	return c


## /proc files report length 0, so FileAccess.get_file_as_string() returns "" for them — read line by line.
static func _read_proc(path: String) -> String:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return ""
	var out := PackedStringArray()
	while not f.eof_reached():
		out.append(f.get_line())
	return "\n".join(out)


func _poll_host() -> void:
	_host_busy = true
	var r: Dictionary = await Api.get_json("/api/host-stats")
	_host_busy = false
	_host = r.data if r.ok and r.data is Dictionary else {}
	_render()


func _render() -> void:
	var cells: Array = []  # [text, size, colour] — two per grid row
	for sec in [["THIS CLIENT", _client_rows], ["BOX", M.host_rows(_host)]]:
		cells.append([sec[0], 10, ThemeBuilder.ACCENT])
		cells.append(["", 10, ThemeBuilder.ACCENT])
		for row in sec[1]:
			cells.append([str(row.label), 12, ThemeBuilder.TEXT_MUTED])
			cells.append([str(row.value), 12, [ThemeBuilder.TEXT, ThemeBuilder.WARN, ThemeBuilder.ERROR][clampi(int(row.level), 0, 2)]])
	while _grid.get_child_count() > cells.size():  # reuse the labels — this runs twice a second
		var last := _grid.get_child(_grid.get_child_count() - 1)
		_grid.remove_child(last)
		last.queue_free()
	while _grid.get_child_count() < cells.size():
		var l := Label.new()
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_grid.add_child(l)
	for i in cells.size():
		var l: Label = _grid.get_child(i)
		l.text = cells[i][0]
		l.add_theme_font_size_override("font_size", cells[i][1])
		l.add_theme_color_override("font_color", cells[i][2])
