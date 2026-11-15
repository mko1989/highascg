'use strict'

/**
 * WO-1081 — Stage Skirmish arenas (work/notes/skirmish-game-contract.md §4): generated from the RC bake and checked by
 * validateArena on
 *  - the default empty hall (a project without an MVR, baked into a temp cache — never the box's cache dir),
 *  - the same hall with a raised stage floor added (the stage arena first, id `stage`; hall arenas keep off the stage),
 *  - the newest cached live bake in ~/.highascg/cache/rc-game (read only; skipped when there is none);
 * determinism per rev (twice the same, the async generator the same as the sync one, another rev may differ),
 * validateArena refusing every broken rule, and the served scene (sk-scene.js: no tracks, our glb URL, arenas).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const { kit } = require('../../modules/toy-skirmish/server/sk-kit')
const { generateArenas, generateArenasAsync } = require('../../modules/toy-skirmish/server/sk-arenas')
const { validateArena, floorOcc, sceneScaleOf } = require('../../modules/toy-skirmish/server/sk-arena-check')
const { createSkScene } = require('../../modules/toy-skirmish/server/sk-scene')
const R = require('../../modules/toy-skirmish/server/sk-rules')
const G = require('../../modules/toy-skirmish/server/sk-grid')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1081-arenas-'))
const LIVE_DIR = path.join(os.homedir(), '.highascg', 'cache', 'rc-game')
const clone = (o) => JSON.parse(JSON.stringify(o))

let hall = null // { rev, json }
const baker = kit().createSceneBaker({ loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null },
	cacheDir: path.join(TMP, 'cache'), log: () => {} })

test.before(async () => {
	const b = await baker.get()
	hall = { rev: b.rev, json: JSON.parse(b.text) }
})
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

/** Every §4 rule the arena list must keep as a whole, plus validateArena on each. */
function checkList(scene, arenas, label) {
	assert.ok(arenas.length >= R.ARENA.minArenas && arenas.length <= R.ARENA.maxArenas, `${label}: 3–8 arenas (${arenas.length})`)
	assert.equal(new Set(arenas.map((a) => a.id)).size, arenas.length, `${label}: ids unique`)
	const u = sceneScaleOf(scene)
	for (const a of arenas) {
		assert.deepEqual(Object.keys(a), ['id', 'name', 'floor', 'y', 'rect', 'blocks', 'spawns', 'pickups'], `${label} ${a.id}: key order`)
		const v = validateArena(a, scene)
		assert.ok(v.ok, `${label} ${a.id}: ${v.errors.join('; ')}`)
		const [w, d] = v.stats.size
		assert.ok(w >= 25 - 1e-6 && w <= 80 + 1e-6 && d >= 25 - 1e-6 && d <= 80 + 1e-6, `${label} ${a.id}: size ${w}×${d} u`)
		assert.ok(v.stats.blocked >= 0.08 && v.stats.blocked <= 0.4, `${label} ${a.id}: blocked ${v.stats.blocked}`)
		assert.ok(a.spawns.length >= 10, `${label} ${a.id}: spawns`)
		const kinds = a.pickups.map((p) => p.kind)
		for (const w of ['rattler', 'scatter', 'longshot', 'thumper']) assert.ok(kinds.includes(w), `${label} ${a.id}: ${w} pickup`)
		const surge = kinds.filter((k) => k === 'surge').length
		assert.equal(surge, Math.min(w, d) >= 30 ? 1 : 0, `${label} ${a.id}: surge rule`)
		// every spawn and pickup reachable from the first spawn on the soldier's grid
		const g = G.arenaGrid(a, floorOcc(scene, a.floor), u)
		const mask = G.passable(g, R.SOLDIER.radius * u)
		const s0 = a.spawns[0]
		for (const p of [...a.spawns.slice(1, 4), ...a.pickups.slice(0, 3)]) {
			const route = G.findPath(g, mask, s0.x, s0.z, p.x, p.z)
			assert.ok(route && route.length >= 1, `${label} ${a.id}: path spawn 0 → ${p.kind || 'spawn'} (${p.x}, ${p.z})`)
		}
	}
}

test('default empty hall: valid arenas, all generated on the hall floor, blocks give the cover', () => {
	const arenas = generateArenas(hall.json, { rev: hall.rev })
	checkList(hall.json, arenas, 'hall')
	assert.ok(arenas.every((a) => a.floor === 'hall'), 'hall only')
	assert.ok(arenas.every((a) => a.blocks.length > 0), 'an empty hall gets blocks')
	assert.ok(!arenas.some((a) => a.id === 'stage'), 'no stage arena without a stage')
	assert.equal(arenas[0].id, 'tables', 'hall names in order')
})

test('a stage floor: the stage arena comes first and hall arenas stay off the stage', () => {
	const scene = clone(hall.json)
	const stage = { id: 'stage', y: 0.1, rect: [-6, -9.5, 0, -4] } // 60 × 55 u, 1 u above the hall
	scene.floors.push(stage)
	const arenas = generateArenas(scene, { rev: `${hall.rev}+stage` })
	checkList(scene, arenas, 'stage')
	assert.equal(arenas[0].id, 'stage')
	assert.equal(arenas[0].name, 'The Stage')
	assert.equal(arenas[0].floor, 'stage')
	assert.equal(arenas[0].y, 0.1)
	const off = (r) => r[2] <= stage.rect[0] || r[0] >= stage.rect[2] || r[3] <= stage.rect[1] || r[1] >= stage.rect[3]
	for (const a of arenas.slice(1)) assert.ok(off(a.rect), `${a.id} keeps off the stage`)
})

test('deterministic per rev: twice the same, async = sync, the served scene caches per rev', async () => {
	const a = generateArenas(hall.json, { rev: hall.rev })
	const b = generateArenas(clone(hall.json), { rev: hall.rev })
	assert.deepEqual(a, b)
	let pauses = 0
	const c = await generateArenasAsync(hall.json, { rev: hall.rev }, async () => void pauses++)
	assert.deepEqual(c, a)
	assert.ok(pauses > 0, 'the async generator yields between builds')
	const other = generateArenas(hall.json, { rev: 'another-rev' })
	checkList(hall.json, other, 'other rev')
	assert.notDeepEqual(other, a, 'blocks / spawns are seeded by the rev')

	const sc = createSkScene({ baker, pause: async () => {} })
	const [s1, s2] = await Promise.all([sc.get(), sc.get()])
	assert.equal(s1, s2, 'one build for concurrent callers')
	assert.equal(await sc.get(), s1, 'cached per rev')
	assert.equal(s1.rev, hall.rev)
	assert.equal(s1.json.tracks, undefined, 'no RC tracks')
	assert.equal(s1.json.glb, `/api/game/sk/scene.glb?rev=${hall.rev}`)
	assert.deepEqual(s1.json.arenas, a, 'the served arenas are the generator\'s')
	assert.deepEqual(JSON.parse(s1.text), s1.json)
	assert.ok(Buffer.isBuffer(s1.glb) && s1.glb.length > 0, 'the RC GLB is passed through')
	assert.deepEqual(s1.json.floors, hall.json.floors)
	assert.deepEqual(s1.json.occ, hall.json.occ, 'the occ grids stay (the client rasterises the same grid)')
	assert.equal(sc.peek(), s1)
})

test('validateArena refuses every broken rule', () => {
	const base = generateArenas(hall.json, { rev: hall.rev })[0]
	assert.ok(validateArena(base, hall.json).ok)
	const u = sceneScaleOf(hall.json)
	const broken = {
		'too few spawns': (a) => (a.spawns = a.spawns.slice(0, 9)),
		'spawns too close': (a) => (a.spawns[1] = { ...a.spawns[1], x: a.spawns[0].x + 2 * u, z: a.spawns[0].z }),
		'spawn on a block': (a) => (a.spawns[0] = { ...a.spawns[0], x: a.blocks[0].x, z: a.blocks[0].z }),
		'spawn outside': (a) => (a.spawns[0] = { ...a.spawns[0], x: a.rect[2] + 1 }),
		'bad team': (a) => (a.spawns[0].team = 2),
		'block yaw': (a) => (a.blocks[0].yaw = 0.5),
		'block colour': (a) => (a.blocks[0].c = 6),
		'block too low': (a) => (a.blocks[0].h = 0.5 * u),
		'block outside': (a) => (a.blocks[0].x = a.rect[2] + 2),
		'no longshot': (a) => (a.pickups = a.pickups.filter((p) => p.kind !== 'longshot').map((p, i) => ({ ...p, id: i }))),
		'five health': (a) => {
			for (let n = 0; n < 5; n++) a.pickups.push({ id: a.pickups.length, kind: 'health', x: a.spawns[n].x, z: a.spawns[n].z })
		},
		'pickups too close': (a) => (a.pickups[1] = { ...a.pickups[1], x: a.pickups[0].x + 1 * u, z: a.pickups[0].z }),
		'pickup on a spawn': (a) => (a.pickups[0] = { ...a.pickups[0], x: a.spawns[0].x + 1 * u, z: a.spawns[0].z }),
		'pickup ids': (a) => (a.pickups[0].id = 9),
		'unknown pickup': (a) => (a.pickups[0].kind = 'cake'),
		'too small': (a) => (a.rect = [a.rect[0], a.rect[1], a.rect[0] + 20 * u, a.rect[3]]),
		'too large': (a) => (a.rect = [a.rect[0], a.rect[1], a.rect[0] + 90 * u, a.rect[3]]),
		'wrong y': (a) => (a.y += 1),
		'unknown floor': (a) => (a.floor = 'roof'),
		'unsnapped rect': (a) => (a.rect = [a.rect[0] + 0.011, a.rect[1], a.rect[2] + 0.011, a.rect[3]]),
		'a wall splits it': (a) => {
			const cx = (a.rect[0] + a.rect[2]) / 2
			a.blocks = [{ x: cx, z: (a.rect[1] + a.rect[3]) / 2, w: 1.2 * u, d: a.rect[3] - a.rect[1], h: 1 * u, yaw: 0, c: 0 }]
		},
	}
	for (const [why, mutate] of Object.entries(broken)) {
		const a = clone(base)
		mutate(a)
		const v = validateArena(a, hall.json)
		assert.equal(v.ok, false, `refused: ${why}`)
		assert.ok(v.errors.length > 0, why)
	}
})

test('blocks rasterise as the contract says: a cell is solid when its centre lies inside the rectangle; yaw π/2 swaps w / d', () => {
	const occ = floorOcc(hall.json, 'hall')
	const arena = { floor: 'hall', y: 0, rect: [-1.5, -1.5, 1.5, 1.5], blocks: [{ x: 0, z: 0, w: 0.6, d: 0.12, h: 0.1, yaw: 0, c: 0 }] }
	const g = G.arenaGrid(arena, occ, 0.1)
	const solidAt = (x, z) => g.bits[G.cellIndex(g, x, z)] === 1
	assert.ok(solidAt(0.25, 0), 'along X at yaw 0')
	assert.ok(!solidAt(0, 0.25), 'not along Z at yaw 0')
	const g2 = G.arenaGrid({ ...arena, blocks: [{ ...arena.blocks[0], yaw: Math.PI / 2 }] }, occ, 0.1)
	assert.equal(g2.bits[G.cellIndex(g2, 0, 0.25)], 1, 'yaw π/2: along Z')
	assert.equal(g2.bits[G.cellIndex(g2, 0.25, 0)], 0)
	assert.ok(!G.lineClear(g, 0, -1, 0, 1, true), 'a 4-cell block stops a shot even on the shrunk grid')
	assert.ok(G.lineClear(g, -1, -1, -1, 1, true), 'open floor is clear')
	assert.ok(!G.lineClear(g, 0, 0, 2, 0), 'the arena edge is solid')
})

test('the cached live bake (when the box has one): valid arenas, deterministic', (t) => {
	let files = []
	try {
		// a project's bake (rev `none-…` = the empty hall of a process without a project, e.g. a sandbox)
		files = fs.readdirSync(LIVE_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('none-')).map((f) => path.join(LIVE_DIR, f))
	} catch {}
	if (!files.length) return t.skip('no cached live bake on this machine')
	files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
	const json = JSON.parse(fs.readFileSync(files[0], 'utf8'))
	const rev = json.rev || path.basename(files[0], '.json')
	const arenas = generateArenas(json, { rev })
	checkList(json, arenas, `live ${rev}`)
	const stage = (json.floors || []).find((f) => f.id === 'stage')
	if (stage) assert.equal(arenas[0].id, 'stage', 'a stage floor → the stage arena first')
	assert.deepEqual(generateArenas(json, { rev }), arenas, 'deterministic')
	t.diagnostic(arenas.map((a) => {
		const v = validateArena(a, json)
		return `${a.id} ${v.stats.size.map((n) => n.toFixed(1)).join('×')} u ${(v.stats.blocked * 100).toFixed(1)} %`
	}).join(' · '))
})
