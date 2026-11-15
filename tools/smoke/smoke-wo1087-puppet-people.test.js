'use strict'

/**
 * WO-1087 — test puppet people (owner 15.11: "show me an avatar with random look. make it a test puppet. make sure the
 * test puppet doesnt leave the stage"). src/tracking/puppet-wander.js walks them, src/tracking/puppet-people.js runs
 * them and src/tracking/register.js adds them to the world persons. Proven here:
 *  - the stage is a HARD bound: long seeded runs with irregular ticks and stalls never put a floor point outside the
 *    stage inset by MARGIN; speed, acceleration and turn rate stay bounded (no teleport); a grid moved or shrunk under
 *    a running puppet has it back inside on the next step; a too-small grid → it stands in the centre;
 *  - looks come from the sidecar's palettes (traits.py — the copies must match), are random per start, repeatable
 *    under a seed, re-rolled by new_look;
 *  - the API: off at creation, count 1–3, refusals, stop, the time limit; the persons' shape (puppet, TEST name, ids
 *    clear of fusion's);
 *  - the wiring: world persons for the previs, pin persons for the Auto director, the route, shutdown, and the Godot
 *    side (puppet_cards for the avatars, the Markers-section row).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const W = require(path.join(ROOT, 'src', 'tracking', 'puppet-wander'))
const { createPuppetPeople, ID_BASE, PATH } = require(path.join(ROOT, 'src', 'tracking', 'puppet-people'))

const GRID = { width: 3, depth: 15, spacing: 1, x_offset: 11.05, y_offset: -3.5, z_offset: 0.639 } // the box's stage, 15.11
const EPS = 1e-9
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

/** Walk one puppet `seconds` on `rect` with irregular ticks (10–120 ms, a 0.2–2 s stall now and then). */
function run(seed, rect, seconds, check) {
	const r = W.rng(seed), jitter = W.rng(seed + 1000)
	const w = W.createWalker(r, rect)
	let t = 0
	while (t < seconds) {
		const dt = jitter() < 0.002 ? 0.2 + jitter() * 1.8 : 0.01 + jitter() * 0.11
		const prev = { x: w.x, y: w.y, h: w.h, v: w.v }
		W.stepWalker(w, r, rect, dt)
		t += dt
		check(w, prev, Math.min(dt, W.MAX_DT), t)
	}
	return w
}

describe('WO-1087 test puppet people', () => {
	it('never leaves the stage inset, bounded speed / acceleration / turn rate, no teleport (40 seeds × 10 min)', () => {
		const rect = W.stageRect(GRID)
		assert.deepEqual([rect.lo.map((v) => +v.toFixed(3)), rect.hi.map((v) => +v.toFixed(3)), rect.z], [[10, -10.55], [12.1, 3.55], 0.639])
		assert.ok(W.MARGIN >= 0.4, 'at least 0.4 m from every edge')
		let steps = 0, walked = 0, paused = 0, xs = [Infinity, -Infinity], ys = [Infinity, -Infinity]
		for (let seed = 1; seed <= 40; seed++) {
			run(seed, rect, 600, (w, p, dt) => {
				steps++
				assert.ok(W.inside(rect, w.x, w.y, EPS), `seed ${seed}: (${w.x}, ${w.y}) is off the inset stage`)
				const d = Math.hypot(w.x - p.x, w.y - p.y)
				assert.ok(d <= W.V_MAX * dt + 1e-9, `seed ${seed}: moved ${d} m in ${dt} s`)
				assert.ok(Math.abs(wrap(w.h - p.h)) <= W.TURN * dt + 1e-9, `seed ${seed}: turned too fast`)
				assert.ok(Math.abs(w.v - p.v) <= W.ACCEL * dt + 1e-9 && w.v <= W.V_MAX, `seed ${seed}: speed jump`)
				walked += d
				if (w.v === 0) paused++
				xs = [Math.min(xs[0], w.x), Math.max(xs[1], w.x)]
				ys = [Math.min(ys[0], w.y), Math.max(ys[1], w.y)]
			})
		}
		assert.ok(steps > 300000, `${steps} steps`)
		assert.ok(walked / (40 * 600) > 0.3, `it really walks: ${(walked / (40 * 600)).toFixed(2)} m/s on average`)
		assert.ok(paused / steps > 0.05, 'and pauses')
		assert.ok(xs[1] - xs[0] > 1.8 && ys[1] - ys[0] > 12, `it uses the whole stage: x ${xs}, y ${ys}`)
	})

	it('a grid moved or shrunk under it: back inside on the next step; a too-small grid → the centre', () => {
		for (let seed = 1; seed <= 10; seed++) {
			const r = W.rng(seed)
			const w = W.createWalker(r, W.stageRect(GRID))
			for (let i = 0; i < 300; i++) W.stepWalker(w, r, W.stageRect(GRID), 0.033)
			const moved = W.stageRect({ ...GRID, x_offset: 0, y_offset: 2, width: 2, depth: 2 })
			W.stepWalker(w, r, moved, 0.033)
			assert.ok(W.inside(moved, w.x, w.y, EPS), 'pulled back inside the moved stage')
			for (let i = 0; i < 2000; i++) {
				W.stepWalker(w, r, moved, 0.033)
				assert.ok(W.inside(moved, w.x, w.y, EPS))
			}
			const tiny = W.stageRect({ ...GRID, width: 0.6 })
			assert.equal(tiny.degenerate, true)
			W.stepWalker(w, r, tiny, 0.033)
			assert.deepEqual([w.x, w.y, w.v], [GRID.x_offset, GRID.y_offset, 0], 'stands in the stage centre')
		}
		const none = W.stageRect(null)
		assert.deepEqual([none.centre, none.degenerate], [[0, 3], false], 'no grid: the default tracking grid (auto-split)')
		const junk = W.stageRect({ width: 'x', depth: -4, x_offset: NaN })
		assert.ok(junk.lo.every(Number.isFinite) && junk.hi.every(Number.isFinite), 'junk grid values never give NaN bounds')
	})

	it('random looks from the sidecar palettes, repeatable under a seed', () => {
		const py = read('tools/tracking-detect/traits.py')
		const list = (name) => JSON.parse('[' + new RegExp(`^${name} = \\[([\\s\\S]*?)\\]`, 'm').exec(py)[1].replace(/\(/g, '[').replace(/\)/g, ']').replace(/#.*$/gm, '') + ']')
		assert.deepEqual(W.CLOTH, list('CLOTH'), 'CLOTH = traits.py')
		assert.deepEqual(W.HAIR, list('HAIR'), 'HAIR = traits.py')
		assert.deepEqual(W.SKIN, list('SKIN'), 'SKIN = traits.py')
		const has = (pal, c) => pal.some((p) => p.join() === c.join())
		const r = W.rng(5)
		const seen = new Set()
		for (let i = 0; i < 400; i++) {
			const l = W.randomLook(r)
			assert.ok(has(W.CLOTH, l.traits.top) && has(W.CLOTH, l.traits.bottom) && has(W.SKIN, l.traits.skin) && has(W.HAIR, l.traits.hair))
			assert.notDeepEqual(l.traits.top, l.traits.bottom, 'top and bottom differ')
			assert.ok(W.HAIR_LEN.includes(l.traits.hair_len) && l.traits.locked === true)
			assert.ok(l.height >= W.HEIGHT_M[0] && l.height <= W.HEIGHT_M[1], `height ${l.height}`)
			seen.add(l.traits.hair_len)
		}
		assert.equal(seen.size, 3, 'short, long and bald all occur')
		assert.deepEqual(W.randomLook(W.rng(9)), W.randomLook(W.rng(9)), 'same seed, same look')
		assert.notDeepEqual(W.randomLook(W.rng(9)), W.randomLook(W.rng(10)))
	})

	it('API: off at creation, start / count / new look / stop / time limit, world + pin persons', () => {
		let t = 1000, timers = 0
		const stage = () => GRID
		const mk = () => createPuppetPeople({ stage, now: () => t, timers: { setInterval: () => ++timers, clearInterval: () => {} } })
		const p = mk()
		const post = (b) => p.handle('POST', PATH, JSON.stringify(b))
		assert.equal(p.live, false)
		const idle = JSON.parse(p.handle('GET', PATH).body)
		assert.deepEqual([idle.enabled, idle.people, idle.stage.z], [false, [], 0.639], 'off at boot, the stage already read')
		assert.equal(p.persons().length, 0)
		assert.equal(post({ enabled: true, count: 2, seed: 7 }).status, 200)
		for (let i = 0; i < 600; i++) p.step((t += 33))
		const w = p.persons()
		assert.equal(w.length, 2)
		for (const q of w) {
			assert.ok(q.id > ID_BASE && q.puppet === true && q.source === 'puppet' && /^TEST puppet \d$/.test(q.name))
			assert.deepEqual([q.keys, q.cameras, q.age_s], [[], [], 0])
			assert.ok(q.traits.locked && q.height >= 1.55 && q.height <= 1.95)
		}
		assert.deepEqual(p.pinPersons().map((q) => [q.key, q.camera, q.world]), w.map((q) => [`w:${q.id}`, 'world', [q.x, q.y]]))
		// same seed, same walk and looks
		const t0 = t
		const p2 = mk()
		t = 1000
		p2.configure({ enabled: true, count: 2, seed: 7 })
		for (let i = 0; i < 600; i++) p2.step((t += 33))
		assert.deepEqual(p2.persons(), w, 'repeatable under a seed')
		t = t0
		const before = p.persons()
		post({ new_look: true })
		const after = p.persons()
		assert.deepEqual(after.map((q) => [q.x, q.y]), before.map((q) => [q.x, q.y]), 'new look: same place')
		assert.notDeepEqual(after.map((q) => q.traits), before.map((q) => q.traits), 'new look: other clothes')
		assert.equal(post({ count: 4 }).status, 400)
		assert.equal(post({ count: 0 }).status, 400)
		assert.equal(post({ seed: 1.5 }).status, 400)
		assert.equal(p.handle('POST', PATH, '[1]').status, 400)
		assert.equal(p.handle('DELETE', PATH, '').status, 405)
		assert.equal(p.handle('GET', PATH + '/x', ''), null, 'other paths are not ours')
		post({ count: 1 })
		assert.equal(p.persons().length, 1)
		post({ enabled: false })
		assert.deepEqual([p.live, p.persons().length, p.pinPersons().length], [false, 0, 0])
		post({ enabled: true, ttl_min: 1 })
		p.step((t += 61000))
		assert.deepEqual([p.live, p.status().stopped], [false, 'ttl'], 'switches itself off')
		const free = createPuppetPeople({ stage, now: () => t, timers: { setInterval: () => 1, clearInterval: () => {} }, random: () => 0.25 })
		free.configure({ enabled: true })
		assert.equal(free.status().seed, 1073741824, 'no seed: a fresh one per start')
	})

	it('personal space: test people never walk through each other', () => {
		const rect = W.stageRect(GRID)
		const a = { x: 11, y: 0, h: 0, v: 1, target: [12, 0] }, b = { x: 11.2, y: 0, h: Math.PI, v: 1, target: [10.6, 0] }
		W.keepApart([a, b], rect)
		assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - W.SPACE_M) < 1e-9, 'pushed apart to SPACE_M')
		assert.deepEqual([a.target, b.target], [null, null], 'both were heading at the other: new legs')
		const c = { x: rect.lo[0], y: 0, h: 0, v: 0, target: [12, 0] }, d = { x: rect.lo[0], y: 0, h: 0, v: 0, target: [12, 1] }
		W.keepApart([c, d], rect)
		assert.ok(W.inside(rect, c.x, c.y) && W.inside(rect, d.x, d.y), 'still on the stage')
		assert.deepEqual(d.target, [12, 1], 'standing: keeps its leg')
		const far = { x: 10.5, y: -5, h: 0, v: 1, target: [11, -5] }
		W.keepApart([far, { x: 11.5, y: -5, h: Math.PI, v: 1, target: [10.5, -5] }], rect)
		assert.deepEqual([far.x, far.target], [10.5, [11, -5]], 'far enough: untouched')
		let t = 0
		const p = createPuppetPeople({ stage: () => GRID, now: () => t,
			timers: { setInterval: () => 1, clearInterval: () => {} } })
		p.configure({ enabled: true, count: 3, seed: 7 })
		let min = Infinity
		for (let i = 0; i < 6000; i++) {
			p.step((t += 66))
			const ps = p.persons()
			for (let j = 0; j < ps.length; j++) for (let k = j + 1; k < ps.length; k++) min = Math.min(min, Math.hypot(ps[j].x - ps[k].x, ps[j].y - ps[k].y))
		}
		assert.ok(min > W.SPACE_M * 0.8, `closest pair ${min.toFixed(3)} m over 6.6 min of three walkers`)
	})

	it('wiring: register.js world + pin persons, Auto with detection off, route, shutdown; nothing persisted', () => {
		const reg = read('src/tracking/register.js')
		assert.match(reg, /const people = require\('\.\/puppet-people'\)\.createPuppetPeople\(/)
		assert.match(reg, /const world = pose3d\.decorate\(fusion\.persons\(now\), now\)\.concat\(people\.persons\(\)\)/)
		assert.equal((reg.match(/: _detect\.persons\(\)\), \.\.\.people\.pinPersons\(\)\]/g) || []).length, 2, 'pinTick + pick')
		assert.match(reg, /const run = people\.live && !cfg\.enabled \? \{ \.\.\.cfg, enabled: true \} : cfg/)
		assert.match(reg, /auto\.step\(\{ cfg: run, available: _detect\.available \|\| people\.live, persons,/)
		assert.match(reg, /pin\.step\(\{ cfg, available: _detect\.available, persons,/, 'the detect pin keeps the real config')
		assert.match(reg, /\|\| people\.handle\(method, path, body\)/)
		assert.match(reg, /puppet\.stop\('shutdown'\)\n\t\tpeople\.stop\('shutdown'\)/)
		const pp = read('src/tracking/puppet-people.js')
		assert.doesNotMatch(pp, /writeFile|saveProject|project-scenes|autosave/, 'never writes the project or a file')
		const cards = read('godot/client/features/previs/tracking/person_cards.gd')
		assert.match(cards, /avatars\.show_cards\(M\.cards\(snap, _cams\) \+ M\.puppet_cards\(snap\), /)
		assert.match(cards, /\tavatars\.show_cards\(M\.puppet_cards\(snap\), /, 'cut-outs / dummies draw test people as avatars')
		assert.match(read('src/tracking/puppet-people.js'), /W\.keepApart\(people\.map\(\(p\) => p\.walker\), rect\)/)
		assert.match(read('godot/client/features/previs/tracking/person_cards_model.gd'), /static func puppet_cards\(snap: Variant\) -> Array:/)
		assert.match(read('godot/client/features/previs/tracking/person_avatars.gd'), /e\.node\.set_tag\(str\(c\.get\("tag", ""\)\)\)/)
		assert.match(read('godot/client/features/previs/tracking/markers_section.gd'), /add_child\(preload\("res:\/\/features\/previs\/tracking\/puppet_people_row\.gd"\)\.new\(\)\)/)
		assert.match(read('godot/client/features/previs/tracking/puppet_people_row.gd'), /const PATH := "\/api\/tracking\/puppet\/people"/)
	})
})
