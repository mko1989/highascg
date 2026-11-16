'use strict'

/**
 * WO-1099 — house lights, the browser half (one shared function, modules/rc-game/client/house.js, used by all three
 * games through world.js — Skirmish and Salad reach it through their `kit/` alias):
 *  - applyHouse with real three.js objects headless in node: off = hemisphere + sun at the readability floor (not 0),
 *    every venue material's colour × HOUSE_VENUE and its glow out (emissive / emissiveMap, single and multi-material
 *    meshes, PBR, unlit and the "low" Lambert copies); on = the exact values from before; idempotent; objects outside
 *    the venue root (the games' own) untouched;
 *  - stage-fx hands `house` from `welcome` / `state` to onHouse (players and spectators share that path) and the rig's
 *    `lights` / `wall` switches are not disturbed by it;
 *  - source pins: world.js re-applies the venue after every scene load and quality swap (the Lambert copies) and darkens
 *    the background; each game's createStageFx passes onHouse → world.setHouse; each host page has the switch.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const MODS = path.join(__dirname, '..', '..', 'modules')
const RC = path.join(MODS, 'rc-game', 'client')
const load = (f) => import(pathToFileURL(path.join(RC, f)).href)
const read = (f) => fs.readFileSync(path.join(MODS, f), 'utf8')

let H, FX, THREE

before(async () => {
	H = await load('house.js')
	FX = await load('stage-fx.js')
	THREE = await import('three')
})

describe('applyHouse', () => {
	function venue() {
		const root = new THREE.Group()
		const glow = new THREE.MeshStandardMaterial({ color: 0x806040, emissive: 0x334455, emissiveIntensity: 1.5 })
		const tex = new THREE.Texture()
		const pic = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveMap: tex })
		const low = new THREE.MeshLambertMaterial({ emissive: 0x112233 })
		const plain = new THREE.MeshBasicMaterial({ color: 0xffffff }) // unlit, no emissive at all
		const g = new THREE.BoxGeometry()
		root.add(new THREE.Mesh(g, glow), new THREE.Mesh(g, [pic, plain]))
		const sub = new THREE.Group()
		sub.add(new THREE.Mesh(g, low))
		root.add(sub)
		return { root, glow, pic, low, plain }
	}

	it('off: lights at the floor (not zero), the venue dimmed and its glow out; on: exactly as before; idempotent', () => {
		assert.ok(H.HOUSE_FLOOR >= 0.1 && H.HOUSE_FLOOR <= 0.5, `a readability floor for the game, not darkness: ${H.HOUSE_FLOOR}`)
		assert.ok(H.HOUSE_FLOOR * H.HOUSE_VENUE <= 0.05, 'the room itself ends dark (linear; ≈ 20 % on an sRGB screen)')
		const car = new THREE.MeshLambertMaterial({ color: 0xff3300, emissive: 0x220000 }) // a game object, not in the venue
		const scene = new THREE.Scene()
		const hemi = new THREE.HemisphereLight(0xeef2ff, 0x4a4234, 2.6)
		const sun = new THREE.DirectionalLight(0xffffff, 1.8)
		const v = venue()
		scene.add(v.root, new THREE.Mesh(new THREE.BoxGeometry(), car))
		const glowColor = v.glow.color.toArray()
		H.applyHouse({ lights: [hemi, sun], venue: v.root, on: false })
		H.applyHouse({ lights: [hemi, sun], venue: v.root, on: false }) // twice: still relative to the original
		assert.ok(Math.abs(hemi.intensity - 2.6 * H.HOUSE_FLOOR) < 1e-9 && hemi.intensity > 0)
		assert.ok(Math.abs(sun.intensity - 1.8 * H.HOUSE_FLOOR) < 1e-9 && sun.intensity > 0)
		for (const m of [v.glow, v.pic, v.low]) assert.equal(m.emissiveIntensity, 0, m.type)
		assert.equal(v.pic.emissiveMap.isTexture, true, 'the picture stays — only its strength goes')
		const k = H.HOUSE_VENUE
		assert.ok(v.glow.color.toArray().every((c, i) => Math.abs(c - glowColor[i] * k) < 1e-9), 'venue colour × HOUSE_VENUE')
		assert.ok(Math.abs(v.plain.color.r - k) < 1e-9, 'an unlit venue material is dimmed too')
		assert.ok(!('houseGlow' in v.plain.userData), 'no glow to remember')
		assert.equal(car.color.getHex(), 0xff3300, 'a game object keeps its colour')
		assert.equal(car.emissiveIntensity, 1, 'and its glow')
		assert.deepEqual(Object.keys(car.userData), [])
		H.applyHouse({ lights: [hemi, sun], venue: v.root, on: true })
		assert.equal(hemi.intensity, 2.6)
		assert.equal(sun.intensity, 1.8)
		assert.equal(v.glow.emissiveIntensity, 1.5)
		assert.equal(v.pic.emissiveIntensity, 1)
		assert.equal(v.low.emissiveIntensity, 1)
		assert.deepEqual(v.glow.color.toArray(), glowColor, 'the colour exactly as before')
		assert.equal(v.plain.color.getHex(), 0xffffff)
		assert.equal(v.glow.emissive.getHex(), 0x334455, 'the glow colour itself never changes')
	})

	it('a game that set its own levels after creation (Skirmish 1.9 / 1.5) gets those back; the venue only = lights untouched', () => {
		const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1.9)
		const v = venue()
		H.applyHouse({ venue: v.root, on: false })
		assert.equal(hemi.intensity, 1.9, 'not passed in → not touched')
		H.applyHouse({ lights: [hemi], on: false, floor: 0.2 })
		assert.ok(Math.abs(hemi.intensity - 0.38) < 1e-9)
		H.applyHouse({ lights: [hemi], on: true })
		assert.equal(hemi.intensity, 1.9)
		H.applyHouse() // nothing handed in: nothing to do, no throw
	})

	it('the "low" swap: a fresh Lambert copy made while the house is off goes dark too and returns to its own value', () => {
		const v = venue()
		H.applyHouse({ venue: v.root, on: false })
		const mesh = v.root.children[0]
		const orig = mesh.material
		const lowCopy = new THREE.MeshLambertMaterial({ emissive: orig.emissive }) // world.js cheapMaterials: the undimmed colour
		lowCopy.color.fromArray(orig.userData.houseColor)
		mesh.material = lowCopy
		H.applyHouse({ venue: v.root, on: false })
		assert.equal(lowCopy.emissiveIntensity, 0)
		assert.ok(Math.abs(lowCopy.color.r - orig.userData.houseColor[0] * H.HOUSE_VENUE) < 1e-9, 'dimmed once, not twice')
		H.applyHouse({ venue: v.root, on: true })
		assert.ok(Math.abs(lowCopy.color.r - orig.userData.houseColor[0]) < 1e-9)
		H.applyHouse({ venue: v.root, on: false })
		mesh.material = orig // back to "high"
		H.applyHouse({ venue: v.root, on: true })
		assert.equal(orig.emissiveIntensity, 1.5)
	})
})

describe('house level: curve, restore, toggle', () => {
	const mk = () => {
		const hemi = new THREE.HemisphereLight(0xeef2ff, 0x4a4234, 2.6)
		const root = new THREE.Group()
		const m = new THREE.MeshStandardMaterial({ color: 0x806040, emissive: 0x334455, emissiveIntensity: 1.5 })
		root.add(new THREE.Mesh(new THREE.BoxGeometry(), m))
		return { hemi, root, m, c0: m.color.toArray() }
	}
	it('the curve: level^2.2 — 0 → 0, 0.5 ≈ 0.2176, 1 → 1; normHouse clamps and converts booleans', () => {
		assert.equal(H.houseCurve(0), 0)
		assert.equal(H.houseCurve(1), 1)
		assert.ok(Math.abs(H.houseCurve(0.5) - Math.pow(0.5, 2.2)) < 1e-12 && Math.abs(H.houseCurve(0.5) - 0.2176) < 1e-3)
		assert.deepEqual([true, false, 2, -1, NaN, 'x', undefined, 0.25].map(H.normHouse), [1, 0, 1, 0, 1, 1, 1, 0.25])
		assert.equal(H.lerpHex(0x030407, 0x151a26, 0), 0x030407)
		assert.equal(H.lerpHex(0x030407, 0x151a26, 1), 0x151a26)
		const mid = H.lerpHex(0x000000, 0x204060, 0.5)
		assert.equal(mid, (0x10 << 16) | (0x20 << 8) | 0x30)
	})
	it('level 0 = the old off exactly, level 1 = the old on exactly, 0.5 in between by the curve', () => {
		const { hemi, root, m, c0 } = mk()
		H.applyHouse({ lights: [hemi], venue: root, level: 0 })
		assert.ok(Math.abs(hemi.intensity - 2.6 * H.HOUSE_FLOOR) < 1e-12)
		assert.ok(Math.abs(m.color.r - c0[0] * H.HOUSE_VENUE) < 1e-12)
		assert.equal(m.emissiveIntensity, 0)
		H.applyHouse({ lights: [hemi], venue: root, level: 0.5 })
		const g = Math.pow(0.5, 2.2)
		assert.ok(Math.abs(hemi.intensity - 2.6 * (H.HOUSE_FLOOR + (1 - H.HOUSE_FLOOR) * g)) < 1e-12)
		assert.ok(Math.abs(m.color.g - c0[1] * (H.HOUSE_VENUE + (1 - H.HOUSE_VENUE) * g)) < 1e-12)
		assert.ok(Math.abs(m.emissiveIntensity - 1.5 * g) < 1e-12)
		const snap = [hemi.intensity, m.color.toArray(), m.emissiveIntensity]
		H.applyHouse({ lights: [hemi], venue: root, level: 0.5 }) // idempotent
		assert.deepEqual([hemi.intensity, m.color.toArray(), m.emissiveIntensity], snap)
		H.applyHouse({ lights: [hemi], venue: root, level: 1 })
		assert.equal(hemi.intensity, 2.6)
		assert.deepEqual(m.color.toArray(), c0)
		assert.equal(m.emissiveIntensity, 1.5)
		H.applyHouse({ lights: [hemi], venue: root, on: true }) // `on` still works
		H.applyHouse({ lights: [hemi], venue: root, on: false })
		assert.ok(Math.abs(hemi.intensity - 2.6 * H.HOUSE_FLOOR) < 1e-12)
		for (const lv of [0.9, 0.3, 0.77, 1]) H.applyHouse({ lights: [hemi], venue: root, level: lv }) // a drag, then home
		assert.equal(hemi.intensity, 2.6)
		assert.deepEqual(m.color.toArray(), c0, 'exact restore after any path')
	})
	it('houseToggle: lit → 0 remembering the level; dark → the last non-zero level (default 1)', () => {
		assert.deepEqual(H.houseToggle(0.6, 1), { level: 0, last: 0.6 })
		assert.deepEqual(H.houseToggle(0, 0.6), { level: 0.6, last: 0.6 })
		assert.deepEqual(H.houseToggle(0), { level: 1, last: 1 })
		assert.deepEqual(H.houseToggle(0, 0), { level: 1, last: 1 })
	})
})

describe('stage-fx hands house to onHouse', () => {
	it('welcome / state → onHouse(level); a boolean of an older server → 1 / 0; no field → nothing; no hook → no throw', () => {
		const calls = []
		const scene = new THREE.Scene()
		const fx = FX.createStageFx({ THREE, scene, send: () => true, onHouse: (on) => calls.push(on) })
		assert.equal(fx.onMessage({ t: 'welcome', state: { lights: true, wall: true, house: false } }), false)
		assert.equal(fx.onMessage({ t: 'state', state: { lights: true, wall: true, house: true } }), false)
		fx.onMessage({ t: 'state', state: { lights: true, wall: true, house: 0.5 } })
		fx.onMessage({ t: 'state', state: { lights: true, wall: true } })
		assert.deepEqual(calls, [0, 1, 0.5])
		const plain = FX.createStageFx({ THREE, scene: new THREE.Scene(), send: () => true }) // no hook: no throw
		assert.equal(plain.onMessage({ t: 'state', state: { house: false } }), false)
		fx.dispose()
		plain.dispose()
	})
})

describe('wiring (source)', () => {
	it('world.js: setHouse darkens the background, scales hemi + sun, and the venue follows every load / quality swap', () => {
		const w = read('rc-game/client/world.js')
		assert.match(w, /import \{ applyHouse, houseCurve, lerpHex, normHouse, HOUSE_BG_OFF \} from '\.\/house\.js'/)
		assert.match(w, /setHouse\(level\) \{[\s\S]*?level = normHouse\(level\)[\s\S]*?lerpHex\(HOUSE_BG_OFF, BG, houseCurve\(level\)\)[\s\S]*?renderer\.setClearColor\(bg, 1\)[\s\S]*?scene\.background\.setHex\(bg\)[\s\S]*?applyHouse\(\{ lights: \[hemi, sun\], level \}\)/)
		assert.match(w, /cheapMaterials\(world\.model, world\.quality === 'low'\)\n\t+applyCut\(world\.model\) \/\/ §3\.1[^\n]*\n\t+houseVenue\(\)/, 'setQuality')
		assert.match(w, /cheapMaterials\(world\.model, world\.quality === 'low'\)\n\t+applyCut\(world\.model\)\n\t+houseVenue\(\)\n\t+return \{ ok: true \}/, 'loadScene')
		assert.match(w, /const houseVenue = \(\) => applyHouse\(\{ venue: statics, level: houseLevel \}\)/, 'the venue = world.statics (GLB, ground, arena)')
		assert.match(w, /addArena\(statics, info\)\n\t+houseVenue\(\)\n\t+return \{ ok: true, arena: true \}/, 'the plain arena')
		assert.match(w, /color: m\.userData\.houseColor \? new THREE\.Color\(\)\.fromArray\(m\.userData\.houseColor\) : m\.color/, 'low copies from the undimmed colour')
	})

	it('each game hands house to its world (players and spectators share game.js)', () => {
		for (const f of ['rc-game/client/game.js', 'toy-skirmish/client/game.js', 'stage-salad/client/game.js'])
			assert.match(read(f), /createStageFx\(\{[^}]*\n?\t*onHouse: \(level\) => G\.world\.setHouse\(level\) \}\)/, f)
		assert.match(read('toy-skirmish/client/sk-world.js'), /import \{ createWorld \} from '\.\/kit\/world\.js'/)
		assert.match(read('stage-salad/client/game.js'), /import \{ createWorld \} from '\.\/kit\/world\.js'/)
		assert.match(read('rc-game/client/stage-fx.js'), /typeof state\.house === 'number' \|\| typeof state\.house === 'boolean'\) o\.onHouse\?\.\(typeof state\.house === 'boolean' \? \(state\.house \? 1 : 0\) : state\.house\)/)
	})

	it('each host page: label + range 0–100 + % (house-slider.js) where the checkbox was, posting { action: house, level }, synced from state', () => {
		const sl = read('rc-game/client/house-slider.js')
		assert.match(sl, /type: 'range', min: 0, max: 100, step: 1/)
		assert.match(sl, /h\('span\.house-lbl', \{ text: 'House lights'/)
		assert.match(sl, /post\(\{ action: 'house', level: lv \}\)/)
		assert.match(sl, /THROTTLE_MS = 100/)
		assert.match(sl, /range\.addEventListener\('change'/)
		assert.match(sl, /if \(dragging \|\| timer /, 'sync never fights a drag')
		for (const [g, imp] of [['rc-game', './house-slider.js'], ['toy-skirmish', './kit/house-slider.js'], ['stage-salad', './kit/house-slider.js']]) {
			const s = read(`${g}/client/host.js`)
			assert.ok(s.includes(`import { createHouseSlider } from '${imp}'`), g)
			assert.match(s, /createHouseSlider\(\{ h, post: apiHost, say: \(t\) => say\(t\) \}\)/, g)
			assert.match(s, /houseSlider\.el,\n\t+h\('label\.host-switch', lightsBox, ' Live lights in the game'\)/, g)
			assert.match(s, /houseSlider\.sync\(state, on\)/, g)
			assert.match(s, /lightsBox\.disabled = wallBox\.disabled = !on/, g)
		}
		assert.ok(read('rc-game/client/house-slider.js').includes('The general light on the room'), 'tooltip kept')
	})
})
