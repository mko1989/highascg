'use strict'

/**
 * WO-1106 — Game World client kit (modules/game-world/client visitors.js + props.js), driven in node with the real
 * three.js scene graph (no WebGL):
 *  - A1  silence means unchanged: a car / soldier / avatar / slingshot is never faded or dropped on quiet; only a flying
 *        vegetable fades (and is dropped 30 s later);
 *  - A4  `wst` off (what a game ingests on every socket `welcome`) leaves nothing; patches(now?) only returns patches
 *        whose `until` is still ahead of the server time;
 *  - A14 an effect pushed out by the 4-effect cap leaves the scene;
 *  - A21 a model that breaks while clipped frees its clip material copies;
 *  - A33 a model that failed / timed out is taken when it arrives late or on the next `wst`, and the stand-ins swap to it.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const REPO = path.join(__dirname, '..', '..')
const DIR = path.join(REPO, 'modules', 'game-world', 'client')
const url = (p) => pathToFileURL(p).href

const MODELS = { car: '/game/rc/car-model.js', soldier: '/game/sk/soldier-model.js', veg: '/game/salad/veg-models.js', sling: '/game/salad/slingshot-model.js', av: '/game/salad/avatar-model.js' }
const WST = { t: 'wst', v: 1, on: true, client: '/game/world/visitors.js', models: MODELS, scale: 0.1, safe: false, affect: 'on', games: [] }
const tick = () => new Promise((r) => setTimeout(r, 15))
const fail = () => Promise.reject(new Error('404'))

let THREE, V, P

before(async () => {
	THREE = await import(url(path.join(REPO, 'node_modules', 'three', 'build', 'three.module.js')))
	V = await import(url(path.join(DIR, 'visitors.js')))
	P = await import(url(path.join(DIR, 'props.js')))
})

function make(opts) {
	const scene = new THREE.Scene()
	const vis = V.createVisitors(THREE, scene, opts)
	const cam = new THREE.PerspectiveCamera()
	cam.position.set(20, 10, 20)
	return { scene, vis, cam }
}

async function warm(vis, cam, t0 = 1100) {
	for (let i = 0; i < 6; i++) {
		vis.update(t0 + i, 0.016, cam)
		await tick()
	}
}

/** A fake game model module: a group with one mesh, and the methods props.js calls. */
function fakeMods(log = {}) {
	const group = () => {
		const g = new THREE.Group()
		g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial()))
		return g
	}
	return {
		createCarModel: () => ({ group: (log.car = group()), update() {}, setTag() {}, dispose() {} }),
		createSlingshot: () => ({
			group: (log.sling = group()),
			setVeg() {},
			setAim() {},
			update() {
				throw new Error('broken model')
			},
			dispose() {},
		}),
	}
}

describe('WO-1106 A1 — silence means unchanged', () => {
	it('a moving car that goes quiet for a minute is still drawn and follows a later update; a flying veg still fades out', async () => {
		const { vis, cam } = make({ view: 'rc', quality: 'high', importer: fail })
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[1, 'car', 'rc', '#ff0000', 'Ola', ''], [2, 'soldier', 'sk', '#00ff00', 'Kuba', ''], [3, 'veg', 'salad', '#e2392b', '', 'tomato']], e: [[1, 0, 0, 0, 0, 0], [2, 0, 0, 3, 0, 0], [3, 2, 1, 0, 0, 0, 1, 1, 0]] })
		vis.ingest({ t: 'wv', v: 1, ts: 1100, e: [[1, 1, 0, 0, 0, 0], [2, 1, 0, 3, 0, 0], [3, 2.1, 1.1, 0, 0, 0, 1, 1, 0]] })
		await warm(vis, cam, 1200)
		assert.equal(vis.info().drawn, 3)
		vis.update(4000, 0.016, cam)
		assert.equal(vis.count(), 3, 'nothing dropped yet')
		assert.equal(vis.info().drawn, 2, 'the car and the soldier stay; the quiet vegetable has faded')
		vis.update(61200, 0.016, cam)
		assert.equal(vis.count(), 2, 'the faded vegetable is dropped 30 s later, the car and soldier are not')
		assert.equal(vis.info().drawn, 2)
		vis.update(70000, 0.016, cam)
		vis.ingest({ t: 'wv', v: 1, ts: 70000, e: [[1, 5, 0, 0, 0, 0]] })
		vis.update(70500, 0.016, cam)
		const car = vis.group.children.find((o) => o.visible && Math.abs(o.position.x - 5) < 1e-6)
		assert.ok(car, 'the car moved to its new position')
		vis.dispose()
	})
})

describe('WO-1106 A4 — wst off resets everything; patches honour until', () => {
	it('wst off leaves no visitor, effect, shadow, ring or slick behind; the world comes back on the next wst', async () => {
		const { scene, vis, cam } = make({ view: 'sk', quality: 'medium', importer: fail, cutY: () => 0.4, floorY: () => 0 })
		vis.ingest(WST)
		vis.ingest({
			t: 'wv', v: 1, ts: 1000,
			add: [[1, 'veg', 'salad', '#e2392b', '', 'tomato'], [2, 'car', 'rc', '#ff0000', 'Ola', ''], [3, 'splat', 'salad', '#e2392b', '', 150]],
			e: [[1, 0, 2, 0, 0, 0, 0, 0, 0], [2, 3, 0, 0, 0, 0], [3, 5, 0, 5, 0, 1]],
			fx: [[2, 'stun', 4000, '']],
		})
		await warm(vis, cam)
		assert.ok(vis.group.children.length > 3, 'holders, shadow, ring and splat are in the scene')
		assert.equal(vis.patches().length, 1)
		vis.ingest({ t: 'wst', v: 1, on: false })
		assert.equal(vis.count(), 0)
		assert.equal(vis.group.children.length, 0, 'nothing left under the visitors group')
		assert.deepEqual(vis.patches(), [])
		assert.equal(vis.info().drawn, 0)
		assert.equal(vis.info().on, false)
		assert.equal(scene.children.length, 1, 'only the (empty) visitors group')
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 2000, add: [[2, 'car', 'rc', '#ff0000', 'Ola', '']], e: [[2, 3, 0, 0, 0, 0]] })
		await warm(vis, cam, 2100)
		assert.equal(vis.info().drawn, 1)
		vis.dispose()
	})

	it('patches(now?): a slick patch is gone once its until (first seen + 8 s) has passed — by argument or by update()', async () => {
		const { vis, cam } = make({ view: 'rc', quality: 'high', importer: fail })
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[3, 'splat', 'salad', '#e2392b', '', 150]], e: [[3, 5, 0, 5, 0, 1]] })
		await warm(vis, cam)
		assert.deepEqual(vis.patches(), [{ x: 5, y: 0, z: 5, r: 0.15, until: 9000 }])
		assert.equal(vis.patches(8999).length, 1)
		assert.deepEqual(vis.patches(9000), [], 'expired by the server time passed in')
		vis.update(9500, 0.016, cam)
		assert.deepEqual(vis.patches(), [], 'expired by the last update() server time')
		assert.equal(vis.patches(5000).length, 1, 'an explicit now wins')
		vis.dispose()
	})
})

describe('WO-1106 A14 / A21 — nothing orphaned', () => {
	it('A14: effects over the cap of 4 leave the visitor holder', async () => {
		const { vis, cam } = make({ view: 'rc', quality: 'high', importer: fail })
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[1, 'car', 'rc', '#ff0000', 'Ola', '']], e: [[1, 1, 0, 0, 0, 0]] })
		await warm(vis, cam)
		const holder = vis.group.children.find((o) => o.children.length === 1)
		assert.ok(holder)
		for (let i = 0; i < 20; i++) assert.equal(vis.effect([1, 'stun', 5000, '']), true)
		assert.equal(holder.children.length, 1 + 4, 'the handle + the 4 live effects, no orphans')
		vis.dispose()
	})

	it('A21: a model that throws while clipped is replaced by a stand-in and its clip copies are freed', async () => {
		const log = {}
		const mods = fakeMods(log)
		const { vis, cam } = make({ view: 'sk', quality: 'medium', importer: () => Promise.resolve(mods), cutY: () => 0.4, floorY: () => 0 })
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[6, 'sling', 'salad', '#0000ff', 'Ann', 50]], e: [[6, 1, 0, 3, 0, 0]] })
		await warm(vis, cam)
		assert.ok(log.sling, 'the fake slingshot was built')
		assert.ok(log.sling.userData.wvClip, 'it was clipped before it broke')
		assert.equal(log.sling.userData.wvClip.size, 0, 'its material copies are disposed')
		assert.equal(log.sling.parent, null)
		assert.equal(vis.info().standIns, 1)
		vis.dispose()
	})
})

describe('WO-1106 A33 — a model that failed once is not a stand-in for good', () => {
	it('props: a late success after the 8 s time-out is taken', async () => {
		let t = 0
		let resolve
		const props = P.createProps(THREE, { importer: () => new Promise((r) => (resolve = r)), now: () => t })
		props.setModels(MODELS)
		assert.equal(props.build('car', { c: '#ff0000', n: 'x', scale: 0.1 }), null, 'still loading')
		t = P.LOAD_TIMEOUT_MS + 1
		assert.equal(props.build('car', { c: '#ff0000', n: 'x', scale: 0.1 }).standIn, true, 'timed out: a stand-in')
		assert.equal(props.state('car'), 'failed')
		resolve(fakeMods())
		await tick()
		assert.equal(props.state('car'), 'ready', 'the late module is taken')
		assert.equal(props.build('car', { c: '#ff0000', n: 'x', scale: 0.1 }).standIn, false)
	})

	it('props: a failed import is tried again on the next wst models (with a cache-busting query)', async () => {
		const urls = []
		let ok = false
		const props = P.createProps(THREE, { importer: (u) => (urls.push(u), ok ? Promise.resolve(fakeMods()) : fail()) })
		props.setModels(MODELS)
		props.build('car', { c: '#ff0000', n: 'x', scale: 0.1 })
		await tick()
		assert.equal(props.state('car'), 'failed')
		ok = true
		props.setModels(MODELS)
		assert.equal(props.build('car', { c: '#ff0000', n: 'x', scale: 0.1 }), null, 'loading again')
		await tick()
		assert.equal(props.state('car'), 'ready')
		assert.deepEqual(urls, ['/game/rc/car-model.js', '/game/rc/car-model.js?retry=1'])
	})

	it('visitors: stand-ins drawn while the model was missing swap to the model once a retry loads it', async () => {
		let ok = false
		const mods = fakeMods()
		const { vis, cam } = make({ view: 'rc', quality: 'high', importer: () => (ok ? Promise.resolve(mods) : fail()) })
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[1, 'car', 'rc', '#ff0000', 'Ola', ''], [2, 'car', 'rc', '#00ff00', 'Kuba', '']], e: [[1, 1, 0, 0, 0, 0], [2, 2, 0, 0, 0, 0]] })
		await warm(vis, cam)
		assert.equal(vis.info().standIns, 2)
		ok = true
		vis.ingest(WST) // the next wst (a phase change, a reconnect)
		await warm(vis, cam, 1200)
		assert.equal(vis.info().standIns, 0, JSON.stringify(vis.info()))
		assert.equal(vis.info().drawn, 2)
		assert.equal(vis.info().kinds.car, 'ready')
		vis.dispose()
	})
})
