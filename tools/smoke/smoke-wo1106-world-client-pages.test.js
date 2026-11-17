'use strict'

/**
 * WO-1106 — Game World pages (modules/game-world/client world-logic.js, world-spectate.js, world-host.js, world.js):
 *  - A8  the spectator follows `board`'s house / scene (no reconnect needed) and shows a paused game as paused with a
 *        clock that does not count down; an older board without them changes nothing;
 *  - A34 a Presenter-safe click while a house-lights post is in flight is not dropped;
 *  - A37 a failed start is retried with a back-off, then the page reloads itself.
 * world-spectate.js / world.js need three.js + a DOM: their wiring is checked as source text, the logic behaviourally.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIR = path.join(__dirname, '..', '..', 'modules', 'game-world', 'client')
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

let W, H

before(async () => {
	W = await import(pathToFileURL(path.join(DIR, 'world-logic.js')).href)
	H = await import(pathToFileURL(path.join(DIR, 'world-host.js')).href)
})

describe('WO-1106 A8 — board carries house, scene and paused', () => {
	it('boardRoom: house + scene when present, nothing from an older board', () => {
		const scene = { json: '/api/game/rc/scene', glb: '/api/game/rc/scene.glb' }
		assert.deepEqual(W.boardRoom({ t: 'board', games: [], house: 0.25, scene }), { house: 0.25, scene })
		assert.deepEqual(W.boardRoom({ t: 'board', games: [], house: 0 }), { house: 0 })
		assert.deepEqual(W.boardRoom({ t: 'board', games: [] }), {})
		assert.deepEqual(W.boardRoom({ t: 'board', house: NaN, scene: 'x' }), {})
		assert.deepEqual(W.boardRoom(null), {})
	})

	it('a paused game reads "Paused" (no raw phase id) and shows no running clock', () => {
		const g = W.normGame({ id: 'rc', title: 'RC', enabled: true, phase: 'race', paused: true, endsAt: 70000, top: [] })
		assert.equal(g.paused, true)
		assert.equal(W.boardLine(g, 10000), 'RC · Racing · Paused')
		assert.equal(W.boardLine(g, 20000), 'RC · Racing · Paused', 'the clock does not count down')
		const p = W.normGame({ id: 'sk', title: 'SK', enabled: true, phase: 'paused', endsAt: 70000, top: [] })
		assert.equal(p.paused, true, 'phase paused maps to paused')
		assert.equal(W.boardLine(p, 10000), 'SK · Paused')
		assert.equal(W.phaseName('paused'), 'Paused')
		const run = W.normGame({ id: 'rc', title: 'RC', enabled: true, phase: 'race', endsAt: 70000, top: [] })
		assert.equal(run.paused, false)
		assert.equal(W.boardLine(run, 10000), 'RC · Racing · 1:00', 'unchanged without paused')
	})

	it('world-spectate.js applies board house / scene through applyState, a changed house only', () => {
		const s = read('world-spectate.js')
		assert.match(s, /else if \(m\.t === 'board'\) \{[\s\S]{0,200}applyState\(boardRoom\(m\)\)/)
		assert.match(s, /st\.house !== S\.house\) world\.setHouse\(\(S\.house = st\.house\)\)/)
		assert.match(s, /boardLine\(g, sNow\)/)
	})
})

describe('WO-1106 A34 — the host gate', () => {
	it('house posts never block or free the flag; one other action at a time', () => {
		const g = H.createActGate()
		const house = { action: 'house', level: 0.5 }
		const safe = { action: 'safe', on: true }
		assert.equal(g.enter(house), true)
		assert.equal(g.enter(safe), true, 'Presenter safe goes through while a house post is in flight')
		assert.equal(g.enter(house), true, 'the slider keeps posting')
		g.leave(house)
		assert.equal(g.enter({ action: 'start' }), false, 'a house post finishing does not free the safe action\'s flag')
		g.leave(safe)
		assert.equal(g.enter({ action: 'start' }), true)
		assert.equal(g.enter({ action: 'stop' }), false, 'no double post')
	})

	it('world-host.js act() goes through the gate', () => {
		const s = read('world-host.js')
		assert.match(s, /if \(!gate\.enter\(body\)\) return\n\t\tconst r = await postHost\(body\)\n\t\tgate\.leave\(body\)/)
		assert.doesNotMatch(s.slice(0, s.indexOf('export function createActGate')), /\bbusy\b/, 'no shared busy flag left in startHost')
	})
})

describe('WO-1106 A37 — the world pages retry their start', () => {
	it('bootDelay: 2 s doubling to 30 s', () => {
		assert.deepEqual([1, 2, 3, 4, 5, 6, 50].map(W.bootDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000])
	})

	it('retryBoot: failures are retried after the back-off until start works', async () => {
		let n = 0
		const waits = []
		const fails = []
		const ok = await W.retryBoot(
			async () => {
				if (++n < 3) throw new Error('kit import failed')
			},
			{ sleep: async (ms) => waits.push(ms), onFail: (e, i, ms) => fails.push([e.message, i, ms]) }
		)
		assert.equal(ok, true)
		assert.equal(n, 3)
		assert.deepEqual(waits, [2000, 4000])
		assert.deepEqual(fails, [['kit import failed', 1, 2000], ['kit import failed', 2, 4000]])
	})

	it('retryBoot: after maxTries → false (the page reloads), the last failure reported with ms null', async () => {
		const fails = []
		const ok = await W.retryBoot(() => Promise.reject(new Error('x')), { sleep: async () => {}, maxTries: 3, onFail: (e, i, ms) => fails.push([i, ms]) })
		assert.equal(ok, false)
		assert.deepEqual(fails, [[1, 2000], [2, 4000], [3, null]])
	})

	it('world.js awaits the spectator start, retries and finally reloads', () => {
		const s = read('world.js')
		assert.match(s, /await \(await import\('\.\/world-spectate\.js'\)\)\.startSpectate\(root\)/)
		assert.match(s, /await retryBoot\(start, \{/)
		assert.match(s, /if \(!ok\) setTimeout\(\(\) => window\.location\.reload\(\), RELOAD_MS\)/)
		assert.doesNotMatch(s, /Reload in a moment/)
	})
})
