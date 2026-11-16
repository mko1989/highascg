'use strict'

/**
 * WO-1103 — realistic human test puppets (owner 16.11: "try to create a woman and man avatars but try to make them as
 * much human like as possible"; "the hq avatars are for previz purposes only as a 'puppet'"). Proven here:
 *  - the API: `body` cartoon (default, persons unchanged but for body / heading) / woman / man / mixed, refusals, human
 *    heights from the same draw (the walk and looks under a seed are the same whatever the body), `walk: false` stands
 *    them where they are and `walk: true` walks on;
 *  - the shipped bodies: the GLBs + textures exist, the licence manifest names every shipped file with a CC0 source,
 *    THIRD_PARTY_NOTICES names them, the build recipe is in the repo, every file has a "keep" .import;
 *  - the Godot wiring (source text): the row's Look / Walk controls, the cards carry body + heading, the layer picks the
 *    human node for woman / man only.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const W = require(path.join(ROOT, 'src', 'tracking', 'puppet-wander'))
const { createPuppetPeople, PATH, BODIES, WOMAN_M, MAN_M } = require(path.join(ROOT, 'src', 'tracking', 'puppet-people'))

const GRID = { width: 3, depth: 15, spacing: 1, x_offset: 11.05, y_offset: -3.5, z_offset: 0.639 }
const PEOPLE = 'godot/client/assets/people'

function mk() {
	let t = 1000
	const p = createPuppetPeople({ stage: () => GRID, now: () => t, timers: { setInterval: () => 1, clearInterval: () => {} } })
	const post = (b) => p.handle('POST', PATH, JSON.stringify(b))
	const walk = (n) => {
		for (let i = 0; i < n; i++) p.step((t += 33))
	}
	return { p, post, walk }
}

describe('WO-1103 human test puppets', () => {
	it('body: cartoon by default, woman / man / mixed, refusals; the walk and the looks do not depend on it', () => {
		assert.deepEqual(BODIES, ['cartoon', 'woman', 'man', 'mixed'])
		const runs = {}
		for (const body of [null, ...BODIES]) {
			const { p, post, walk } = mk()
			const r = post(body ? { enabled: true, count: 3, seed: 11, body } : { enabled: true, count: 3, seed: 11 })
			assert.equal(r.status, 200)
			assert.equal(JSON.parse(r.body).body, body || 'cartoon')
			walk(300)
			runs[body || 'default'] = p.persons()
		}
		const strip = (ps) => ps.map(({ x, y, vx, vy, heading, traits }) => ({ x, y, vx, vy, heading, traits }))
		for (const b of BODIES) assert.deepEqual(strip(runs[b]), strip(runs.default), `${b}: same walk, same looks`)
		assert.deepEqual(runs.default, runs.cartoon, 'no body = cartoon')
		assert.deepEqual(runs.cartoon.map((q) => q.body), ['cartoon', 'cartoon', 'cartoon'])
		assert.deepEqual(runs.mixed.map((q) => q.body), ['woman', 'man', 'woman'], 'mixed: by index')
		for (const q of runs.cartoon) assert.ok(q.height >= W.HEIGHT_M[0] && q.height <= W.HEIGHT_M[1], 'cartoon: the WO-1087 height')
		for (const [b, [lo, hi]] of [['woman', WOMAN_M], ['man', MAN_M]])
			for (const [i, q] of runs[b].entries()) {
				assert.ok(q.height >= lo && q.height <= hi, `${b} ${q.height} in ${lo}–${hi}`)
				const u = (runs.cartoon[i].height - W.HEIGHT_M[0]) / (W.HEIGHT_M[1] - W.HEIGHT_M[0])
				assert.ok(Math.abs(q.height - (lo + (hi - lo) * u)) < 0.001, 'mapped from the same draw')
			}
		assert.ok(Math.abs((WOMAN_M[0] + WOMAN_M[1]) / 2 - 1.68) < 0.005 && Math.abs((MAN_M[0] + MAN_M[1]) / 2 - 1.8) < 0.005, 'means ≈ 1.68 / 1.80 m')
		for (const q of runs.man) assert.ok(Number.isFinite(q.heading) && Math.abs(q.heading) <= Math.PI + 1e-9, 'heading in rad')
		const { p, post } = mk()
		assert.equal(post({ body: 'robot' }).status, 400)
		assert.equal(post({ body: 3 }).status, 400)
		assert.equal(post({ walk: 'no' }).status, 400)
		assert.equal(p.status().body, 'cartoon', 'a refusal changes nothing')
		assert.equal(post({ body: 'man' }).status, 200, 'set while off: kept for the next start')
		post({ enabled: true, count: 1, seed: 3 })
		assert.deepEqual([p.status().body, p.persons()[0].body, p.status().people[0].body], ['man', 'man', 'man'])
	})

	it('walk: false stands them where they are, walk: true walks on', () => {
		const { p, post, walk } = mk()
		post({ enabled: true, count: 2, seed: 5, body: 'mixed' })
		walk(200)
		const moving = p.persons()
		assert.ok(moving.some((q) => Math.hypot(q.vx, q.vy) > 0.1), 'walking')
		assert.equal(JSON.parse(post({ walk: false }).body).walk, false)
		walk(1)
		const at = p.persons()
		walk(300)
		const still = p.persons()
		assert.deepEqual(still.map((q) => [q.x, q.y, q.vx, q.vy]), at.map((q) => [q.x, q.y, 0, 0]), 'standing, not moving')
		assert.deepEqual(still.map((q) => q.body), ['woman', 'man'])
		post({ walk: true })
		walk(300)
		assert.notDeepEqual(p.persons().map((q) => [q.x, q.y]), still.map((q) => [q.x, q.y]), 'walking on')
		const rect = W.stageRect(GRID)
		for (const q of p.persons()) assert.ok(W.inside(rect, q.x, q.y), 'still inside the stage')
	})

	it('the shipped bodies: files, "keep" imports, licence manifest, notices, build recipe', () => {
		const man = JSON.parse(read(`${PEOPLE}/LICENSES.json`))
		const shipped = fs.readdirSync(path.join(ROOT, PEOPLE)).filter((f) => /\.(glb|webp)$/.test(f)).sort()
		for (const b of ['woman', 'man']) {
			assert.ok(shipped.includes(`${b}.glb`), `${b}.glb shipped`)
			for (const tone of ['light', 'mid', 'dark']) assert.ok(shipped.includes(`${b}_skin_${tone}.webp`), `${b} skin ${tone}`)
		}
		assert.deepEqual(man.files.map((e) => e.file).sort(), shipped, 'one manifest row per shipped file, no stale rows')
		for (const e of man.files) {
			assert.equal(e.licence, 'CC0-1.0', `${e.file}: CC0`)
			assert.ok(e.from.length >= 1 && e.from.every((s) => s.asset && s.author && /^https?:\/\//.test(s.source)), `${e.file}: sources`)
			assert.equal(read(`${PEOPLE}/${e.file}.import`).trim(), '[remap]\n\nimporter="keep"', `${e.file}: packed as is`)
			assert.ok(fs.statSync(path.join(ROOT, PEOPLE, e.file)).size < 3e6, `${e.file}: small`)
		}
		assert.match(man.licenceQuote, /All core assets are shared under Creative Commons, CC0/)
		assert.match(man.licenceUrl, /^https:\/\/static\.makehumancommunity\.org\/about\/license\.html$/)
		const notices = read('THIRD_PARTY_NOTICES')
		assert.match(notices, /MakeHuman/)
		assert.match(notices, /godot\/client\/assets\/people/)
		for (const f of ['tools/people/build_human.py', 'tools/people/pack_tex.py', 'tools/people/woman.json', 'tools/people/man.json', 'tools/people/README.md'])
			assert.ok(fs.existsSync(path.join(ROOT, f)), `${f}: the recipe is in the repo`)
	})

	it('Godot wiring: the row, the cards, the layer', () => {
		const row = read('godot/client/features/previs/tracking/puppet_people_row.gd')
		assert.match(row, /"Cartoon", "Woman", "Man", "Mixed"/)
		assert.match(row, /\{"body": /)
		assert.match(row, /\{"walk": /)
		const cards = read('godot/client/features/previs/tracking/person_cards_model.gd')
		assert.match(cards, /"body": str\(wp\.get\("body", "cartoon"\)\)/)
		const layer = read('godot/client/features/previs/tracking/person_avatars.gd')
		assert.match(layer, /Human\.wants\(/)
		const human = read('godot/client/features/previs/tracking/person_human.gd')
		assert.doesNotMatch(human, /ImageTexture\.create_from_image\(.*camera|texture_slot|lease/i, 'no camera picture on a puppet')
	})
})
