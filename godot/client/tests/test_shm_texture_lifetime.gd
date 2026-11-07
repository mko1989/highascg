extends RefCounted
## WO-997 — ShmTexture frees its RD texture, never shows a freed one, and drops nothing queued. Headless has no
## RenderingDevice, so a counting fake stands in and both thread queues are pumped by hand.

const ShmTexture := preload("res://video/shm_texture.gd")
const Game := preload("res://features/visuals/scenes/game.gd")
var t


class FakeRD:
	extends RefCounted
	var live := {}  # RID → true
	var made := 0
	var dead_use := 0  # update/upload into a freed RID

	func texture_create(_fmt: RDTextureFormat, _view: RDTextureView, _data: Array) -> RID:
		made += 1
		var rid := rid_from_int64(made)
		live[rid] = true
		return rid

	func free_rid(rid: RID) -> void:
		if not live.erase(rid):
			dead_use += 1  # double free

	func texture_update(rid: RID, _layer: int, _data: PackedByteArray) -> int:
		if not live.has(rid):
			dead_use += 1
		return OK


class Rig:
	extends RefCounted
	var rd := FakeRD.new()
	var render_q: Array[Callable] = []
	var main_q: Array[Callable] = []
	var shown := RID()  # what the Texture2DRD points at
	var shown_dead := 0  # times a step left it pointing at a freed RID

	func make() -> RefCounted:
		var x: RefCounted = ShmTexture.new()
		x._rd = rd
		x._on_render = func(c: Callable) -> void: render_q.append(c)
		x._on_main = func(c: Callable) -> void: main_q.append(c)
		x._attach = func(rid: RID) -> void: shown = rid
		return x

	func _check() -> void:
		if shown.is_valid() and not rd.live.has(shown):
			shown_dead += 1

	func render() -> void:
		while not render_q.is_empty():
			render_q.pop_front().call()
			_check()

	func main() -> void:
		while not main_q.is_empty():
			main_q.pop_front().call()
			_check()

	func pump() -> void:
		while not (render_q.is_empty() and main_q.is_empty()):
			render()
			main()


func _frame(w: int, h: int) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(w * h * 4)
	return b


func test_free_gpu_frees_after_updates_and_resizes() -> void:
	var r := Rig.new()
	var x := r.make()
	x.update(_frame(8, 8), 8, 8)
	r.pump()
	t.eq(r.rd.live.size(), 1, "one texture after the first frame")
	t.ok(r.shown.is_valid(), "attached")
	x.update(_frame(8, 8), 8, 8)
	x.update_rgba(_frame(4, 4), 4, 4)  # format + size change
	r.pump()
	t.eq(r.rd.live.size(), 1, "the replaced texture is freed once its successor shows")
	t.eq(r.rd.made, 2, "two made")
	x.free_gpu()
	t.eq(r.shown, RID(), "detached on the main thread before the free")
	r.pump()
	t.eq(r.rd.live.size(), 0, "free_gpu frees the last one")
	t.eq(r.rd.dead_use, 0, "no double free or upload into a freed RID")
	t.eq(r.shown_dead, 0, "never shows a freed RID")


func test_resize_keeps_old_texture_until_successor_shows() -> void:
	var r := Rig.new()
	var x := r.make()
	x.update(_frame(8, 8), 8, 8)
	r.pump()
	var first := r.shown
	x.update(_frame(16, 8), 16, 8)
	r.render()  # _create ran; _swap still queued on main
	t.eq(r.rd.live.size(), 2, "both alive between create and swap")
	t.eq(r.shown, first, "still showing the old one")
	t.ok(r.rd.live.has(first), "and the old one is not freed (the pre-WO-997 bug)")
	r.pump()
	t.eq(r.rd.live.size(), 1, "old one reaped after the swap")
	t.eq(r.shown_dead, 0, "never shows a freed RID")


func test_resizes_faster_than_main_thread() -> void:
	var r := Rig.new()
	var x := r.make()
	for w: int in [8, 12, 16, 20]:
		x.update(_frame(w, 4), w, 4)
		r.render()  # four creates before any swap runs
	r.main()
	r.pump()
	t.eq(r.rd.made, 4, "four made")
	t.eq(r.rd.live.size(), 1, "three retired ones freed")
	t.eq(r.shown_dead, 0, "never shows a freed RID mid-chain")
	x.free_gpu()
	r.pump()
	t.eq(r.rd.live.size(), 0, "none left")


func test_free_before_queued_create_runs() -> void:
	var r := Rig.new()
	var x := r.make()
	x.update(_frame(8, 8), 8, 8)  # _create queued, not run
	x.free_gpu()
	r.pump()
	t.eq(r.rd.made, 0, "a create that lost the race makes nothing")
	t.eq(r.rd.live.size(), 0, "nothing leaked")


func test_free_between_create_and_swap() -> void:
	var r := Rig.new()
	var x := r.make()
	x.update(_frame(8, 8), 8, 8)
	r.pump()
	x.update(_frame(16, 16), 16, 16)
	r.render()  # new texture made, old retired, swap pending
	x.free_gpu()
	r.pump()
	t.eq(r.rd.live.size(), 0, "current and retired both freed")
	t.eq(r.shown, RID(), "the late swap does not re-attach")
	t.eq(r.rd.dead_use, 0, "no double free")


func test_no_work_after_free_and_dropped_object_still_frees() -> void:
	var r := Rig.new()
	var x := r.make()
	x.update(_frame(8, 8), 8, 8)
	r.pump()
	x.free_gpu()
	x.update(_frame(8, 8), 8, 8)
	x.update(_frame(4, 4), 4, 4)
	t.eq(r.render_q.size(), 1, "only the free is queued after free_gpu")
	x.free_gpu()
	t.eq(r.render_q.size(), 1, "a second free_gpu is a no-op")
	x = null  # the owner is gone; the queued free must keep the object alive
	r.pump()
	t.eq(r.rd.live.size(), 0, "freed although nothing else holds the ShmTexture")


func test_game_scene_frees_its_texture() -> void:
	var r := Rig.new()
	var g: Node3D = Game.new()
	var x := r.make()
	g.set("_tex", x)
	x.update(_frame(8, 8), 8, 8)
	r.pump()
	t.eq(r.rd.live.size(), 1, "game scene got a frame")
	x = null
	g.free()  # what the stage's clear() ends in
	r.pump()
	t.eq(r.rd.live.size(), 0, "PREDELETE frees the ring texture")
