/**
 * Smoke test — previs stream-source manager + scene-model per-mesh bindings.
 *
 * Exercises the multi-source refactor (WO-17 Phase 4 / T3.1 multi-stream):
 *   - Stream manager refcounts acquisitions so multiple meshes on the same source share
 *     a single binding.
 *   - Scene model acquires / releases bindings correctly as meshes are tagged / retagged
 *     with a different source / untagged, and on disposal.
 *
 * Runs with a bare-metal THREE shim — no real WebGL / video required.
 * Run: `node tools/smoke-previs-stream.mjs`
 */

import { createPrevisStreamManager } from '../web/lib/previs-stream-sources.js'
import { createPrevisSceneModel } from '../web/lib/previs-scene-model.js'

let pass = 0
let fail = 0
function assert(cond, msg) {
	if (cond) { pass++; return }
	fail++
	console.error(`FAIL: ${msg}`)
}

class FakeDisposable { constructor() { this.disposed = false } dispose() { this.disposed = true } }
class FakeVector3 {
	constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
	set(x, y, z) { this.x = x; this.y = y; this.z = z; return this }
}
class FakeBox3 {
	constructor() { this.min = new FakeVector3(-1, -1, -1); this.max = new FakeVector3(1, 1, 1) }
	setFromObject() { return this }
	getSize(v) { v.set(2, 2, 2); return v }
}
class FakeQuat { setFromEuler() { return this } }
class FakeEuler { setFromQuaternion() { return this } }
class FakeObject3D {
	constructor() {
		this.children = []
		this.parent = null
		this.uuid = `uuid_${Math.random().toString(36).slice(2, 10)}`
		this.name = ''
		this.userData = {}
		this.material = { dispose() {} }
	}
	add(c) { c.parent = this; this.children.push(c) }
	remove(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parent = null } }
	traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn) }
}
class FakeGroup extends FakeObject3D {}
class FakeMesh extends FakeObject3D {
	constructor(name = 'mesh') {
		super()
		this.name = name
		this.isMesh = true
		this.geometry = { dispose() {} }
	}
}
class FakeScene extends FakeObject3D {}
class FakeBoxHelper extends FakeDisposable {
	constructor() { super(); this.material = { depthTest: true, transparent: false, dispose() {} }; this.parent = null }
}
const THREE = {
	Scene: FakeScene,
	Group: FakeGroup,
	Mesh: FakeMesh,
	Vector3: FakeVector3,
	Box3: FakeBox3,
	Quaternion: FakeQuat,
	Euler: FakeEuler,
	PlaneGeometry: class { constructor() { this.type = 'plane' } dispose() {} },
	MeshBasicMaterial: class {
		constructor(opts) { Object.assign(this, opts || {}); this.needsUpdate = false }
		dispose() { this.disposed = true }
	},
	DataTexture: class { constructor() {} dispose() {} },
	VideoTexture: class { constructor() {} dispose() {} },
	CanvasTexture: class { constructor() {} dispose() {} },
	BoxHelper: FakeBoxHelper,
	DoubleSide: 2,
	RGBAFormat: 1023,
	SRGBColorSpace: 'srgb',
	LinearFilter: 1006,
}

function makeSource(id) {
	let disposedCount = 0
	const src = { id, label: id.toUpperCase(), findVideo: () => null }
	src.disposedCount = () => disposedCount
	return src
}

const pgmSrc = makeSource('pgm')
const prvSrc = makeSource('prv')
const manager = createPrevisStreamManager(THREE, [pgmSrc, prvSrc])
assert(typeof manager.tick === 'function' && typeof manager.getStreamStatuses === 'function', 'manager exposes tick + getStreamStatuses')
const st0 = manager.getStreamStatuses()
assert(st0.length === 2 && st0[0].id === 'pgm' && !st0[0].acquired && st0[1].id === 'prv', 'getStreamStatuses before acquire')
manager.tick()

// Patch each binding on acquire so we can observe dispose externally.
function wrapDispose(binding) {
	const inner = binding.dispose
	binding.__disposed = false
	binding.dispose = () => { binding.__disposed = true; inner.call(binding) }
	return binding
}

const a = wrapDispose(manager.acquire('pgm'))
const b = manager.acquire('pgm')
assert(a === b, 'acquire(pgm) twice returns the same binding (refcount share)')
assert(!a.__disposed, 'binding not disposed while refcount > 0')

manager.release('pgm')
assert(!a.__disposed, 'binding still alive after one release (refcount 1)')
manager.release('pgm')
assert(a.__disposed, 'binding disposed after final release')

const c = wrapDispose(manager.acquire('pgm'))
assert(c !== a, 'fresh binding created after previous was disposed')
assert(manager.acquire('does-not-exist') === null, 'unknown source returns null')

const sources = manager.listSources()
assert(sources.length === 2 && sources[0].id === 'pgm' && sources[1].label === 'PRV', 'listSources returns registered entries')

manager.dispose()
assert(c.__disposed, 'manager.dispose disposes all bindings')
assert(manager.acquire('pgm') === null, 'acquire after dispose returns null')

const manager2 = createPrevisStreamManager(THREE, [pgmSrc, prvSrc])
const scene = new FakeScene()
const root = new FakeGroup()
const mesh1 = new FakeMesh('wall'); mesh1.userData = {}
const mesh2 = new FakeMesh('monitor'); mesh2.userData = {}
root.add(mesh1)
root.add(mesh2)
const loadedModel = {
	root,
	meshInfos: [
		{ uuid: mesh1.uuid, name: 'wall' },
		{ uuid: mesh2.uuid, name: 'monitor' },
	],
}

const host = createPrevisSceneModel({
	scene,
	THREE,
	streamManager: manager2,
	showDemoWhenEmpty: false,
})
host.setModel(loadedModel)

const firstAutoPick = host.getScreenMesh()
assert(firstAutoPick === mesh1 || firstAutoPick === mesh2, 'auto-pick selected a mesh from the model')
assert(host.getBindings().size === 1, 'exactly one binding active after auto-pick')

host.setMeshSource(mesh2, 'prv')
const bindings = host.getBindings()
assert(bindings.has(mesh2.uuid), 'mesh2 bound after setMeshSource(prv)')
assert(host.getMeshSource(mesh2.uuid) === 'prv', 'mesh2 source read back as prv')

host.setMeshSource(mesh1, 'pgm')
assert(host.getBindings().size === 2, 'two bindings active with different sources')
assert(host.getMeshSource(mesh1.uuid) === 'pgm', 'mesh1 source is pgm')

host.setMeshSource(mesh1, 'prv')
assert(host.getMeshSource(mesh1.uuid) === 'prv', 'mesh1 source switched to prv (unbind+rebind)')

host.untagMesh(mesh1)
assert(host.getMeshSource(mesh1.uuid) === null, 'mesh1 source cleared after untag')
assert(host.getBindings().size === 1, 'only mesh2 bound after mesh1 untagged')

host.dispose()
assert(host.getBindings().size === 0, 'dispose clears all bindings')

if (fail === 0) {
	console.log(`[previs-stream] passed: ${pass}  failed: 0`)
	process.exit(0)
} else {
	console.error(`[previs-stream] passed: ${pass}  failed: ${fail}`)
	process.exit(1)
}
