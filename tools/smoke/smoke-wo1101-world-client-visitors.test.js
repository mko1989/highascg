'use strict'

/**
 * WO-1101 — Game World client: visitors.js + props.js + visitor-fx.js driven in node with the real three.js scene graph
 * (no WebGL needed) — work/notes/game-world-contract.md §2:
 *  - a model module that does not load → a neutral stand-in, never an exception;
 *  - the five real model files of the games (car-model.js, soldier-model.js, veg-models.js, slingshot-model.js,
 *    avatar-model.js) build and update through props.js with no stand-in (a stub 2D canvas for their tags / shadows);
 *  - the cut-away (shadow + ring instead of the object above the cut; slingshots / avatars clipped), the camera inside a
 *    visitor hides it, fx visuals, gone / wst off / dispose leave nothing in the scene, slick patches, the cap;
 *  - fuzzed garbage through ingest / effect / update never throws.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const REPO = path.join(__dirname, '..', '..')
const DIR = path.join(REPO, 'modules', 'game-world', 'client')
const url = (p) => pathToFileURL(p).href

/* a 2D canvas stub: the games draw their name tags / blob shadows on canvases */
const ctx = new Proxy({}, {
	get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
	set: () => true,
})
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }

const GAME_DIRS = { '/game/rc/': 'rc-game', '/game/sk/': 'toy-skirmish', '/game/salad/': 'stage-salad' }
const realImporter = (u) => {
	for (const [p, d] of Object.entries(GAME_DIRS)) if (u.startsWith(p)) return import(url(path.join(REPO, 'modules', d, 'client', u.slice(p.length))))
	return Promise.reject(new Error('unknown ' + u))
}
const MODELS = { car: '/game/rc/car-model.js', soldier: '/game/sk/soldier-model.js', veg: '/game/salad/veg-models.js', sling: '/game/salad/slingshot-model.js', av: '/game/salad/avatar-model.js' }
const WST = { t: 'wst', v: 1, on: true, client: '/game/world/visitors.js', models: MODELS, scale: 0.1, safe: false, affect: 'on', games: [] }
const tick = () => new Promise((r) => setTimeout(r, 15))

let THREE, V

before(async () => {
	THREE = await import(url(path.join(REPO, 'node_modules', 'three', 'build', 'three.module.js')))
	V = await import(url(path.join(DIR, 'visitors.js')))
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

describe('WO-1101 visitors with stand-ins (no model loads)', () => {
	it('a failing model import → stand-ins drawn; gone / wst off / dispose leave nothing behind', async () => {
		const { scene, vis, cam } = make({ view: 'rc', quality: 'high', importer: () => Promise.reject(new Error('404')) })
		assert.equal(vis.ingest(JSON.stringify(WST)), true)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[1, 'car', 'rc', '#ff0000', 'Ola', ''], [2, 'veg', 'salad', '#e2392b', '', 'tomato']], e: [[1, 1, 0, 0, 0, 0], [2, 2, 1, 0, 0, 0, 0, 0, 0]] })
		await warm(vis, cam)
		const i = vis.info()
		assert.equal(i.live, 2)
		assert.equal(i.drawn, 2)
		assert.equal(i.standIns, 2)
		vis.ingest({ t: 'wv', v: 1, ts: 1200, gone: [1] })
		assert.equal(vis.count(), 1)
		vis.ingest({ t: 'wst', v: 1, on: false })
		assert.equal(vis.count(), 0)
		vis.ingest({ t: 'wv', v: 1, ts: 1300, add: [[3, 'car', 'rc', '#ff0000', 'x', '']] })
		assert.equal(vis.count(), 0, 'nothing while the world is off')
		vis.dispose()
		assert.equal(scene.children.length, 0)
	})

	it('the cut-away: a vegetable above the cut is a shadow + ring, below it is drawn; a splat on a table is hidden', async () => {
		const { scene, vis, cam } = make({ view: 'sk', quality: 'medium', importer: () => Promise.reject(new Error('x')), cutY: () => 0.4, floorY: () => 0 })
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[1, 'veg', 'salad', '#e2392b', '', 'tomato'], [2, 'veg', 'salad', '#7cc44e', '', 'cabbage'], [3, 'splat', 'salad', '#e2392b', '', 150]], e: [[1, 0, 2, 0, 0, 0, 0, 0, 0], [2, 3, 0.1, 0, 0, 0, 0, 0, 0], [3, 5, 0.75, 5, 0, 1]] })
		await warm(vis, cam)
		assert.equal(vis.info().drawn, 1, 'only the low one')
		const rings = []
		const shadows = []
		scene.traverse((o) => {
			if (o.isMesh && o.geometry.type === 'RingGeometry' && o.visible) rings.push(o)
			if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.material.map && o.visible) shadows.push(o)
		})
		assert.equal(rings.length, 1, 'one warning ring in the veg colour')
		assert.equal('#' + rings[0].material.color.getHexString(), '#e2392b')
		assert.equal(shadows.length, 1)
		assert.ok(Math.abs(shadows[0].position.y - 0.004) < 1e-6, 'on the floor')
		let splatShown = false
		scene.traverse((o) => o.isGroup && o.children.some((c) => c.geometry?.type === 'CircleGeometry') && (splatShown = o.visible))
		assert.equal(splatShown, false, 'the splat above the cut is hidden')
		assert.deepEqual(vis.patches(), [{ x: 5, y: 0.75, z: 5, r: 0.15, until: 9000 }])
		vis.dispose()
	})

	it('the camera inside a visitor hides it for that frame', async () => {
		const { vis, cam } = make({ view: 'rc', quality: 'high', importer: () => Promise.reject(new Error('x')) })
		vis.ingest(WST)
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add: [[1, 'veg', 'salad', '#7cc44e', '', 'cabbage']], e: [[1, 0, 0.1, 0, 0, 0, 0, 0, 0]] })
		await warm(vis, cam)
		assert.equal(vis.info().drawn, 1)
		cam.position.set(0.02, 0.1, 0)
		vis.update(1200, 0.016, cam)
		assert.equal(vis.info().drawn, 0)
		vis.dispose()
	})

	it('the cap holds: Low 6, then High 20 (and setQuality answers the wq message)', async () => {
		const { vis, cam } = make({ view: 'salad', quality: 'low', importer: () => Promise.reject(new Error('x')) })
		vis.ingest(WST)
		const add = []
		const e = []
		for (let w = 1; w <= 30; w++) {
			add.push([w, 'car', 'rc', '#ff0000', 'c' + w, ''])
			e.push([w, w * 0.3, 0, 0, 0, 0])
		}
		vis.ingest({ t: 'wv', v: 1, ts: 1000, add, e })
		await warm(vis, cam)
		assert.equal(vis.info().drawn, 6)
		assert.deepEqual(vis.setQuality('high'), { t: 'wq', n: 20 })
		vis.update(1300, 0.016, cam)
		assert.equal(vis.info().drawn, 20)
		assert.deepEqual(vis.wq(), { t: 'wq', n: 20 })
		vis.dispose()
	})

	it('fuzz: garbage through ingest / effect / update never throws', async () => {
		const { vis, cam } = make({ view: 'rc', quality: 'high', importer: () => { throw new Error('sync throw') }, cutY: () => { throw new Error('bad cut') }, floorY: () => NaN })
		vis.ingest(WST)
		let seed = 7
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
		const pick = (a) => a[Math.floor(rnd() * a.length)]
		const junk = () => pick([null, 1, -1, 1e9, NaN, 'x', '#fff', [], {}, 'tomato', 3.5, true, 2 ** 31, '#00ff00'])
		for (let i = 0; i < 400; i++) {
			const m = { t: pick(['wv', 'wst', 'x']), v: pick([1, 1, 2]), ts: 1000 + i * 10 }
			m.add = [[Math.ceil(rnd() * 20), pick(['car', 'veg', 'soldier', 'sling', 'av', 'splat', 'tank']), pick(['rc', 'sk', 'salad', 'BAD']), junk(), junk(), junk()]]
			m.e = [[Math.ceil(rnd() * 20), rnd() * 10, rnd(), rnd() * 10, junk(), junk(), junk(), junk(), junk()]]
			m.gone = rnd() < 0.1 ? [Math.ceil(rnd() * 20)] : []
			m.fx = [[Math.ceil(rnd() * 20), pick(['splat', 'sparks', 'stun', 'hop', 'scatter', 'bonk', 'boom']), Math.floor(rnd() * 3000), junk()]]
			if (m.t === 'wst') Object.assign(m, WST, { on: rnd() < 0.9 })
			assert.doesNotThrow(() => vis.ingest(rnd() < 0.2 ? JSON.stringify(m) : m))
			assert.doesNotThrow(() => vis.effect([junk(), junk(), junk(), junk()]))
			assert.doesNotThrow(() => vis.update(1000 + i * 10, pick([0.016, -1, NaN, 5]), pick([cam, null, {}])))
			if (i % 50 === 0) await tick()
		}
		assert.doesNotThrow(() => vis.dispose())
	})
})

describe('WO-1101 visitors with the games\' real model files', () => {
	it('car, soldier, veg, slingshot and avatar build from their own modules — no stand-in — and run the effects', async () => {
		const { scene, vis, cam } = make({ view: 'sk', quality: 'medium', importer: realImporter, cutY: (x) => (x < 3 ? 0.4 : null), floorY: () => 0 })
		vis.ingest(WST)
		vis.ingest({
			t: 'wv', v: 1, ts: 1000,
			add: [[1, 'car', 'rc', '#ff0000', 'Ola', ''], [2, 'veg', 'salad', '#f07c1c', '', 'carrot'], [5, 'soldier', 'sk', '#00ff00', 'Kuba', 'rattler'], [6, 'sling', 'salad', '#0000ff', 'Ann', 50], [7, 'av', 'salad', '#336699', '', 182]],
			e: [[1, 3.5, 0, 0, 0, 16], [2, 1, 0.1, 1, 0, 0, 1, 2, 0], [5, 4, 0, 1, 1, 33], [6, 1, 0, 3, 0, 0], [7, 5, 0, 5, 0, 8 | 16 | 1]],
		})
		await warm(vis, cam)
		let i = vis.info()
		assert.equal(i.standIns, 0, JSON.stringify(i))
		assert.equal(i.drawn, 5)
		for (const k of ['car', 'soldier', 'veg', 'sling', 'av']) assert.equal(i.kinds[k], 'ready', k)
		vis.ingest({ t: 'wv', v: 1, ts: 1100, e: [[1, 3.6, 0, 0, 0.1, 1], [7, 5.1, 0, 5, 0, 1]], fx: [[1, 'splat', 4000, '#e2392b'], [1, 'sparks', 500, ''], [5, 'stun', 800, ''], [7, 'hop', 600, '']] })
		for (let t = 1110; t < 1500; t += 16) vis.update(t, 0.016, cam)
		let clipped = 0
		scene.traverse((o) => o.material && !Array.isArray(o.material) && o.material.clippingPlanes && clipped++)
		assert.ok(clipped > 10, 'the slingshot in the cut is clipped (' + clipped + ')')
		vis.setQuality('low')
		vis.setQuality('high')
		vis.update(1520, 0.016, cam)
		i = vis.info()
		assert.equal(i.drawn, 5)
		assert.equal(i.standIns, 0)
		vis.dispose()
		assert.equal(scene.children.length, 0)
	})
})
