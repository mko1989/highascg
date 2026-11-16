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

describe('stage-fx hands house to onHouse', () => {
	it('welcome / state → onHouse(bool); a state without the field (older server) → nothing; no hook → no throw', () => {
		const calls = []
		const scene = new THREE.Scene()
		const fx = FX.createStageFx({ THREE, scene, send: () => true, onHouse: (on) => calls.push(on) })
		assert.equal(fx.onMessage({ t: 'welcome', state: { lights: true, wall: true, house: false } }), false)
		assert.equal(fx.onMessage({ t: 'state', state: { lights: true, wall: true, house: true } }), false)
		fx.onMessage({ t: 'state', state: { lights: true, wall: true } })
		assert.deepEqual(calls, [false, true])
		const plain = FX.createStageFx({ THREE, scene: new THREE.Scene(), send: () => true }) // no hook: no throw
		assert.equal(plain.onMessage({ t: 'state', state: { house: false } }), false)
		fx.dispose()
		plain.dispose()
	})
})

describe('wiring (source)', () => {
	it('world.js: setHouse darkens the background, scales hemi + sun, and the venue follows every load / quality swap', () => {
		const w = read('rc-game/client/world.js')
		assert.match(w, /import \{ applyHouse, HOUSE_BG_OFF \} from '\.\/house\.js'/)
		assert.match(w, /setHouse\(on\) \{[\s\S]*?renderer\.setClearColor\(on \? BG : HOUSE_BG_OFF, 1\)[\s\S]*?scene\.background\.setHex\(on \? BG : HOUSE_BG_OFF\)[\s\S]*?applyHouse\(\{ lights: \[hemi, sun\], on \}\)/)
		assert.match(w, /cheapMaterials\(world\.model, world\.quality === 'low'\)\n\t+applyCut\(world\.model\) \/\/ §3\.1[^\n]*\n\t+houseVenue\(\)/, 'setQuality')
		assert.match(w, /cheapMaterials\(world\.model, world\.quality === 'low'\)\n\t+applyCut\(world\.model\)\n\t+houseVenue\(\)\n\t+return \{ ok: true \}/, 'loadScene')
		assert.match(w, /const houseVenue = \(\) => applyHouse\(\{ venue: statics, on: houseOn \}\)/, 'the venue = world.statics (GLB, ground, arena)')
		assert.match(w, /addArena\(statics, info\)\n\t+houseVenue\(\)\n\t+return \{ ok: true, arena: true \}/, 'the plain arena')
		assert.match(w, /color: m\.userData\.houseColor \? new THREE\.Color\(\)\.fromArray\(m\.userData\.houseColor\) : m\.color/, 'low copies from the undimmed colour')
	})

	it('each game hands house to its world (players and spectators share game.js)', () => {
		for (const f of ['rc-game/client/game.js', 'toy-skirmish/client/game.js', 'stage-salad/client/game.js'])
			assert.match(read(f), /createStageFx\(\{[^}]*\n?\t*onHouse: \(on\) => G\.world\.setHouse\(on\) \}\)/, f)
		assert.match(read('toy-skirmish/client/sk-world.js'), /import \{ createWorld \} from '\.\/kit\/world\.js'/)
		assert.match(read('stage-salad/client/game.js'), /import \{ createWorld \} from '\.\/kit\/world\.js'/)
		assert.match(read('rc-game/client/stage-fx.js'), /if \(typeof state\.house === 'boolean'\) o\.onHouse\?\.\(state\.house\)/)
	})

	it('each host page: a "House lights" switch with its tooltip, posting { action: house, on }, synced from state', () => {
		for (const g of ['rc-game', 'toy-skirmish', 'stage-salad']) {
			const s = read(`${g}/client/host.js`)
			assert.match(s, /h\('label\.host-switch', \{ title: "The general light on the room\. Off = a dark room lit only by the rig, the LED walls and the game's own lights\." \}, houseBox, ' House lights'\),\n\t+h\('label\.host-switch', lightsBox, ' Live lights in the game'\)/, g)
			assert.match(s, /act\(\{ action: 'house', on: houseBox\.checked \}/, g)
			assert.match(s, /houseBox\.checked = on && state\.house !== false/, g)
			assert.match(s, /houseBox\.disabled = lightsBox\.disabled = wallBox\.disabled = !on/, g)
		}
	})
})
