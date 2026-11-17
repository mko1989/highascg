extends Node
## WO-1108 — keeps the Previs output CLEAN: every helper drawn on the previs stage — selection boxes (stage objects,
## MVR walls, heads), projector frustum lines, tracking-camera frustums and coverage, hub marker pins, stage calibration
## marks, handover lines, every 3D label — goes to visibility layer LAYER, which the output camera's cull_mask drops.
## The operator's own camera (and the tracking camera overlay, which hides only FLOOR_LAYER) keeps every layer, so
## nothing changes on the operator's screen. Helpers are found by rule (is_helper), not by edits in each helper's
## file: lines (ImmediateMesh), Label3D, the subtrees of the helper nodes (HELPER_SCRIPTS) and anything marked with
## META (mvr_scene.gd's selection boxes). While active, meshes that join the stage later are classified too.

const LAYER := 1 << 18  # previs_stage.gd FLOOR_LAYER is 1 << 19
const META := "previs_helper"
const HELPER_SCRIPTS := [
	"res://features/previs/tracking/coverage_3d.gd",
	"res://features/previs/tracking/marker_pins_3d.gd",
	"res://features/previs/fixtures/calib_marks_3d.gd",
	"res://features/previs/tracking/handover_3d.gd",
]

var root: Node  # the previs stage
var active := false
var _pending: Array = []


## A helper (drawn for the operator, not part of the show picture)? Only geometry under `root` counts.
static func is_helper(n: Node, root_node: Node) -> bool:
	if not n is GeometryInstance3D:
		return false
	if n is Label3D or n.has_meta(META):
		return true
	if n is MeshInstance3D and (n as MeshInstance3D).mesh is ImmediateMesh:
		return true
	var p := n.get_parent()
	while p != null and p != root_node:
		if p.has_meta(META) or helper_script(p.get_script()):
			return true
		p = p.get_parent()
	return false


static func helper_script(s: Variant) -> bool:
	return s is Script and HELPER_SCRIPTS.has((s as Script).resource_path)


## `n` on the helper layer (and casting no shadow) when it is a helper; returns whether it is.
static func mark(n: Node, root_node: Node) -> bool:
	if not is_helper(n, root_node):
		return false
	var g := n as GeometryInstance3D
	g.layers = LAYER
	g.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return true


## Every helper under `root_node`; returns how many.
static func mark_tree(root_node: Node) -> int:
	var n := 0
	for c in root_node.find_children("*", "GeometryInstance3D", true, false):
		if mark(c, root_node):
			n += 1
	return n


func set_active(on: bool) -> void:
	if on == active or root == null or not is_inside_tree():
		return
	active = on
	if on:
		get_tree().node_added.connect(_on_added)
		mark_tree(root)
	elif get_tree().node_added.is_connected(_on_added):
		get_tree().node_added.disconnect(_on_added)


## Classified a frame later: a line mesh is often assigned after its node joined the tree.
func _on_added(n: Node) -> void:
	if n is GeometryInstance3D and root.is_ancestor_of(n):
		_pending.append(n)
		if _pending.size() == 1:
			_flush.call_deferred()


func _flush() -> void:
	for n in _pending:
		if is_instance_valid(n) and (n as Node).is_inside_tree():
			mark(n, root)
	_pending.clear()
