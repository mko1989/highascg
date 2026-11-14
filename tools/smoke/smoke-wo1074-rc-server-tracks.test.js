'use strict'

/**
 * WO-1074 — RC game tracks (src/game/rc-tracks.js + rc-track-check.js): generated on synthetic scenes (big hall +
 * stage, stage only, tiny floor, many obstacles, no scene) and on the live project's scene (read-only, when present);
 * every emitted track passes validateTrack, generation is deterministic, at least two tracks always exist, and
 * validateTrack rejects broken tracks.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { generateTracks, validateTrack } = require('../../src/game/rc-tracks')

function check(scene, label, min = 2) {
	const r = generateTracks(scene)
	assert.ok(r.tracks.length >= min, `${label}: ${r.tracks.length} tracks (want ≥ ${min})`)
	const ids = new Set()
	for (const t of r.tracks) {
		const v = validateTrack(t, { floors: r.floors, obstacles: scene.obstacles })
		assert.ok(v.ok, `${label} ${t.id}: ${v.errors.join(', ')}`)
		assert.ok(!ids.has(t.id), `${label}: duplicate id ${t.id}`)
		ids.add(t.id)
		assert.ok(t.points.length >= 60 && t.points.length <= 200)
		assert.equal(t.grid.length, 10)
		assert.equal(t.checkpoints[0], 0)
		assert.ok(typeof t.name === 'string' && t.name)
	}
	assert.deepEqual(generateTracks(scene), r, `${label}: deterministic`)
	return r
}

const stageBox = (f) => ({ min: [f.rect[0], 0, f.rect[1]], max: [f.rect[2], f.y, f.rect[3]] })

test('big hall + elevated stage: ≥ 4 different tracks on both floors, avoiding the stage and truss legs', () => {
	const stage = { id: 'stage', y: 1.4, rect: [-9, -10, 9, 0] }
	const hall = { id: 'hall', y: 0, rect: [-20, -14, 20, 26] }
	const legs = [[-10, -11], [10, -11], [-10, 1], [10, 1], [-15, 15], [15, 15]].map(([x, z]) => ({ min: [x - 0.3, 0, z - 0.3], max: [x + 0.3, 6, z + 0.3] }))
	const scene = { floors: [hall, stage], obstacles: [stageBox(stage), ...legs], bounds: { min: [-20, 0, -14], max: [20, 8, 26] } }
	const r = check(scene, 'hall+stage', 4)
	const fams = new Set(r.tracks.map((t) => t.id.replace(/^[a-z]+-/, '')))
	assert.ok(fams.size >= 3, [...fams].join())
	assert.ok(r.tracks.some((t) => t.floor === 'stage') && r.tracks.some((t) => t.floor === 'hall'))
	assert.ok(r.tracks.some((t) => t.id === 'stage-oval'))
	assert.ok(r.tracks.some((t) => t.id === 'stage-figure-eight'))
	for (const t of r.tracks.filter((x) => x.floor === 'stage')) assert.equal(t.y, 1.4)
})

test('stage only, tiny floor (→ arena fallback), many obstacles, no scene', () => {
	check({ floors: [{ id: 'stage', y: 1, rect: [0, 0, 14, 9] }], obstacles: [], bounds: { min: [0, 0, 0], max: [14, 5, 9] } }, 'stage only', 2)
	const tiny = check({ floors: [{ id: 'stage', y: 1, rect: [0, 0, 3, 2] }], obstacles: [], bounds: { min: [0, 0, 0], max: [3, 2, 2] } }, 'tiny', 2)
	assert.ok(tiny.floors.some((f) => f.id === 'arena'), 'fallback arena floor')
	assert.ok(tiny.tracks.every((t) => t.floor === 'arena'))
	let seed = 7
	const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
	const obstacles = Array.from({ length: 150 }, () => {
		const x = -18 + rnd() * 36, z = -12 + rnd() * 24
		return { min: [x, 0, z], max: [x + 0.6, 1, z + 0.6] }
	})
	const hall = { id: 'hall', y: 0, rect: [-20, -14, 20, 14] }
	check({ floors: [hall], obstacles, bounds: { min: [-20, 0, -14], max: [20, 5, 14] } }, 'many obstacles', 2)
	check({ floors: [{ id: 'hall', y: 0, rect: [-15, -10, 15, 10] }], obstacles: [], bounds: { min: [-15, 0, -10], max: [15, 3, 10] } }, 'no scene', 4)
	// a floor that is wall-to-wall obstacles → the arena goes beside the scene
	const full = check({ floors: [hall], obstacles: [{ min: [-20, 0, -14], max: [20, 1, 14] }], bounds: { min: [-20, 0, -14], max: [20, 5, 14] } }, 'blocked', 2)
	const arena = full.floors.find((f) => f.id === 'arena')
	assert.ok(arena && (arena.rect[0] >= 20 || arena.rect[2] <= -20))
	assert.ok(full.bounds.max[0] >= arena.rect[2] || full.bounds.min[0] <= arena.rect[0])
})

test('validateTrack rejects broken tracks', () => {
	const scene = { floors: [{ id: 'hall', y: 0, rect: [-15, -10, 15, 10] }], obstacles: [] }
	const t = generateTracks({ ...scene, bounds: null }).tracks.find((x) => !/eight/.test(x.id))
	assert.ok(validateTrack(t, scene).ok)
	const bad = (mut) => {
		const c = JSON.parse(JSON.stringify(t))
		mut(c)
		return validateTrack(c, scene)
	}
	assert.equal(bad((c) => (c.points[5] = [14.9, 0])).ok, false, 'outside the floor / uneven')
	assert.equal(bad((c) => c.points.push([...c.points[0]])).ok, false, 'closing point repeated')
	assert.equal(bad((c) => (c.points = c.points.slice(0, 50))).ok, false, 'too few points')
	assert.equal(bad((c) => (c.floor = 'stage')).ok, false, 'unknown floor')
	assert.equal(bad((c) => (c.grid = c.grid.slice(0, 9))).ok, false, 'grid of 9')
	assert.equal(bad((c) => (c.grid[0].yaw += Math.PI)).ok, false, 'grid facing backwards')
	assert.equal(bad((c) => (c.checkpoints = [3, 10, 20])).ok, false, 'checkpoints not from 0')
	assert.equal(bad((c) => (c.length *= 2)).ok, false, 'wrong length')
	const p = t.points[20]
	const blocked = { ...scene, obstacles: [{ min: [p[0] - 0.2, 0, p[1] - 0.2], max: [p[0] + 0.2, 0.5, p[1] + 0.2] }] }
	assert.equal(validateTrack(t, blocked).ok, false, 'obstacle on the line')
	const overhead = { ...scene, obstacles: [{ min: [p[0] - 0.2, 2, p[1] - 0.2], max: [p[0] + 0.2, 3, p[1] + 0.2] }] }
	assert.ok(validateTrack(t, overhead).ok, 'an obstacle above car height does not matter')
	// a figure-eight's single crossing is allowed only for a figure-eight
	const eight = generateTracks({ ...scene, bounds: null }).tracks.find((x) => /eight/.test(x.id))
	assert.ok(eight && validateTrack(eight, scene).ok)
	assert.equal(validateTrack({ ...eight, id: 'hall-loop' }, scene).ok, false)
	// a hairpin tighter than 1.2 m
	const sharp = JSON.parse(JSON.stringify(t))
	const n = sharp.points.length
	sharp.points = sharp.points.map((q, i) => (i === Math.floor(n / 2) ? [q[0] + 0.3, q[1] + 0.3] : q))
	assert.equal(validateTrack(sharp, scene).ok, false)
})

/** The live box's newest project that shows an MVR scene, read straight from projects/ (never written). */
function liveInputs() {
	const fs = require('fs')
	const path = require('path')
	const { LIVE_PROJECTS_DIR } = require('../../src/engine/projects-root')
	const { sceneInputs } = require('../../src/game/rc-scene')
	let best = null
	for (const f of fs.existsSync(LIVE_PROJECTS_DIR) ? fs.readdirSync(LIVE_PROJECTS_DIR) : []) {
		if (!/^[\w-]+\.json$/.test(f)) continue
		try {
			const full = path.join(LIVE_PROJECTS_DIR, f)
			const inp = sceneInputs(JSON.parse(fs.readFileSync(full, 'utf8')))
			const t = fs.statSync(full).mtimeMs
			if (inp.id && fs.existsSync(path.join(LIVE_PROJECTS_DIR, '_mvr', `${inp.id}.json`)) && (!best || t > best.t)) best = { inp, t }
		} catch {
			/* not a project */
		}
	}
	return best && { inp: best.inp, dir: LIVE_PROJECTS_DIR }
}

test('the live project scene (read-only): ≥ 4 tracks, every one valid, within the GLB budget', { timeout: 120000 }, async (t) => {
	const live = liveInputs()
	if (!live) return t.skip('no project with an MVR scene on this machine')
	const store = require('../../src/stage/mvr-store')
	// mvr-store reads projectsRoot() (a temp dir under the test runner); point it at the live dir only for each read call
	const withLive = (fn) => {
		const prev = process.env.HIGHASCG_PROJECTS_DIR
		process.env.HIGHASCG_PROJECTS_DIR = live.dir
		try {
			return fn()
		} finally {
			if (prev == null) delete process.env.HIGHASCG_PROJECTS_DIR
			else process.env.HIGHASCG_PROJECTS_DIR = prev
		}
	}
	const mvrStore = { get: (id) => withLive(() => store.get(id)), mesh: (id, key) => withLive(() => store.mesh(id, key)) }
	const { bakeScene } = require('../../src/game/rc-scene')
	const { json, glb } = await bakeScene(live.inp, 'smoke', { mvrStore })
	assert.ok(json.tracks.length >= 4, json.tracks.map((x) => x.id).join())
	for (const tr of json.tracks) {
		const v = validateTrack(tr, json)
		assert.ok(v.ok, `${tr.id}: ${v.errors.join(', ')}`)
	}
	assert.ok(json.obstacles.length <= 300)
	assert.ok(glb.length <= 8 * 1024 * 1024 && json.stats.triangles <= 400000, `${glb.length} bytes, ${json.stats.triangles} triangles`)
})
