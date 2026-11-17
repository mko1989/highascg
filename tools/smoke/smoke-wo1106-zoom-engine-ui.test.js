'use strict'

/**
 * WO-1106 C13 — the Zoom accessibility reader (fake helper, no python, no Zoom): callers that arrive while a dump runs
 * share it; overlapping auto-joins are one watcher; repeated launches keep ONE camera loop, not one per launch.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createZoomUi } = require('../../src/zoom/zoom-ui')

const S = ['showing', 'enabled']
const c = (role, name) => ({ role, name, states: S, actions: ['Press'] })
const WAITING = [{ name: 'Meeting', states: S, controls: [c('label', 'Waiting for the host to start this meeting'), c('button', 'Leave')] }]
const tick = () => new Promise((r) => setImmediate(r))

function rig({ frames = () => WAITING, gate = null, sleep } = {}) {
	const calls = []
	const exec = async (bin, args) => {
		const a = args.slice(3)
		calls.push(a)
		if (a[0] === 'dump') {
			if (gate) await gate
			return { stdout: JSON.stringify({ ok: true, frames: frames() }) }
		}
		return { stdout: JSON.stringify({ ok: true }) }
	}
	return { ui: createZoomUi({ exec, sleep: sleep || (async () => {}) }), calls, dumps: () => calls.filter((a) => a[0] === 'dump').length }
}

test('C13: overlapping state() calls share one AT-SPI dump', async () => {
	let open
	const gate = new Promise((r) => (open = r))
	const r = rig({ gate })
	const all = Promise.all([r.ui.state(), r.ui.state(), r.ui.state()])
	await tick()
	open()
	const out = await all
	assert.equal(r.dumps(), 1, 'one python dump for three callers')
	for (const s of out) assert.equal(s.waiting, true)
	await r.ui.state()
	assert.equal(r.dumps(), 1, 'a fresh cached read is still shared')
})

test('C13: overlapping auto-joins are one watcher; each launch does not stack another camera loop', async () => {
	let cameraSleeps = 0
	// the camera loop sleeps 3 s between looks: hold those sleeps, so every loop that is running stays visible
	const sleep = (ms) => (ms === 3000 ? (cameraSleeps++, new Promise(() => {})) : Promise.resolve())
	const r = rig({ sleep })
	const a = r.ui.autoJoin(5000)
	const b = r.ui.autoJoin(5000)
	assert.equal(a, b, 'a second auto-join while one runs is the same watcher')
	assert.equal((await a).waiting, true)
	await tick()
	assert.equal(cameraSleeps, 1, 'one camera loop')
	// two more launches with a meeting link while the box still waits to be admitted
	await r.ui.autoJoin(5000)
	await r.ui.autoJoin(5000)
	await tick()
	assert.equal(cameraSleeps, 1, 'still one camera loop')
})
