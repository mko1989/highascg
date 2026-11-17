extends Node
## WO-1109 + WO-1108 — the camera slider and the Previs output, wired into the Previs tab. previs_tab.gd has two hooks:
## `_build_panel` adds the folds attach() returns (under View), and `_apply_mode` keeps the stage's videos live while the
## output renders (feeding_changed calls it again). The tab is built at shell start (app/shell.gd), so an enabled output
## starts as soon as the project has loaded, without the operator ever opening the Previs tab.
## Dev: --previs-ring=<name> writes another ring (a probe never writes the operator's); --probe-previs-output=<dir>
## (output/previs_output_probe.gd).

const Runtime := preload("res://features/previs/camera/camera_slider.gd")
const Section := preload("res://features/previs/camera/camera_slider_section.gd")
const Output := preload("res://features/previs/output/previs_output.gd")
const OutSection := preload("res://features/previs/output/previs_output_section.gd")
const OM := preload("res://features/previs/output/previs_output_model.gd")
const Fold := preload("res://features/previs/fold_section.gd")

var tab: Node  # previs_tab.gd
var runtime: Runtime
var section: Section
var output: Output
var out_section: OutSection
var probe_cfg := {}  # the probe's own slice (never saved); {} = the project's
var _autostart := true


## Builds the runtime nodes under `t` (the Previs tab, in the tree, its stage built) and returns the Inspector folds.
static func attach(t: Node) -> Array:
	var c := new()
	c.name = "PrevisCinema"
	c.tab = t
	t.add_child(c)
	c._build()
	return [Fold.new("Camera slider", [c.section]), Fold.new("Output", [c.out_section])]


func _build() -> void:
	runtime = Runtime.new()
	runtime.stage = tab.stage
	add_child(runtime)
	section = Section.new()
	section.runtime = runtime
	output = Output.new()
	add_child(output)
	output.attach(tab.stage)
	output.ring = OM.ring_name(Config.args)
	_autostart = OM.may_autostart(Config.args)
	out_section = OutSection.new()
	out_section.edited.connect(_apply)
	section.changed.connect(_apply)
	output.feeding_changed.connect(func() -> void: tab.call("_apply_mode"))
	Store.project_changed.connect(func(_p: Dictionary) -> void: _apply())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "channelMap":
			_apply())
	if Config.args.has("probe-previs-output"):  # dev: --probe-previs-output=<dir> (the lead's box check)
		(func() -> void: preload("res://features/previs/output/previs_output_probe.gd").run(self, str(Config.args["probe-previs-output"]))).call_deferred()
	_apply.call_deferred()


## "" when this client can write the ring (on the box, with libhshm_sink), else why not — the Visuals wording.
func can_publish() -> String:
	if DevicesTarget == null or not DevicesTarget.on_box():
		return "Sending works on the box itself (the ring is local shared memory)."
	if not Output.Publisher.available():
		return "libhshm_sink is not loaded (godot/extensions/hshm/build.sh)."
	return ""


## The project's slice (or the probe's) onto the output and the Output fold.
func _apply() -> void:
	if not is_inside_tree() or section == null:
		return
	var out := OM.of_project(Store.project) if probe_cfg.is_empty() else OM.normalize(probe_cfg)
	var shown := out.duplicate(true)
	var cannot := can_publish()
	if not _autostart and probe_cfg.is_empty() and out.enabled:
		out.enabled = false
		cannot = "This client does not send (it was started for a check or a probe)."
	var moves: Array = section.cfg.get("moves", [])
	output.apply(out, moves, cannot, OM.out_fps(Store.get_value("channelMap", {})))
	out_section.show_state(shown, moves, output.status_text())
