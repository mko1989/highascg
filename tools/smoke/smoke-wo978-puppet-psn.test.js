'use strict'

/**
 * WO-978 — tracking → lighting desk test environment: the test puppet (src/tracking/puppet.js: paths, speed the hub
 * derives, time limit, never stealing a live marker, the HTTP route through register.js), the PSN sniffer's collector
 * (tools/test-env/psn-sniff.js) on real encoded packets, and the project helper's output edit
 * (tools/test-env/tracking-desk-project.js).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { MarkerHub } = require('../../src/tracking/marker-hub')
const { createPuppet, normalizeConfig, buildPath, sampleAt, DEFAULTS } = require('../../src/tracking/puppet')
const { encodeData, encodeInfo } = require('../../src/fixtures/psn')
const { createCollector, formatTracker } = require('../test-env/psn-sniff')
const { withOutput, testOutput } = require('../test-env/tracking-desk-project')

const ROOT = path.join(__dirname, '..', '..')

/** A puppet on a hand-driven clock and timer. */
function rig(opts = {}) {
	let t = 1000
	let fn = null
	const clock = () => t
	const hub = new MarkerHub({ now: clock })
	const timers = { setInterval: (f) => ((fn = f), { id: 1 }), clearInterval: () => (fn = null) }
	const p = createPuppet({ hub, now: clock, timers, ...opts })
	const step = (ms) => {
		t += ms
		fn?.()
	}
	return { hub, p, step, ticking: () => fn !== null }
}

test('config: defaults, clamping, unknown values keep the previous ones', () => {
	assert.deepStrictEqual(normalizeConfig({}), DEFAULTS)
	const c = normalizeConfig({ pattern: 'line', speed: 99, size: -1, hz: 10, id: 0, name: '  ' })
	assert.strictEqual(c.pattern, 'line')
	assert.strictEqual(c.speed, 5, 'speed clamped to 5 m/s')
	assert.strictEqual(c.size, 0.1)
	assert.strictEqual(c.hz, 30, 'rate 30..60 Hz')
	assert.strictEqual(c.id, 1, 'bad id keeps the previous one')
	assert.strictEqual(c.name, 'Puppet')
	assert.strictEqual(normalizeConfig({ pattern: 'moonwalk' }, c).pattern, 'line', 'unknown pattern ignored')
})

test('paths: circle radius / lap, line ping-pong stage right ↔ left, walk square, hold', () => {
	const cfg = { ...DEFAULTS, x: 1, y: 3, size: 2, speed: 1 }
	const circle = buildPath('circle', 2)
	assert.ok(Math.abs(circle.length - 4 * Math.PI) < 1e-3, 'lap = 2πr')
	for (const s of [0, 1, 2.5, 7]) {
		const q = sampleAt({ ...cfg, pattern: 'circle' }, circle, s)
		assert.ok(Math.abs(Math.hypot(q.x - 1, q.y - 3) - 2) < 1e-3, 'on the circle')
		assert.ok(Math.abs(Math.hypot(q.vx, q.vy) - 1) < 1e-3, 'speed = 1 m/s along the path')
		assert.strictEqual(q.z, cfg.z)
	}
	const start = sampleAt({ ...cfg, pattern: 'circle' }, circle, 0)
	assert.deepStrictEqual([start.x, start.y, start.vx > -0.01, start.vy > 0.99], [3, 3, true, true], 'starts stage left, heads upstage (CCW)')
	const line = buildPath('line', 2)
	assert.ok(Math.abs(line.length - 8) < 1e-3, 'there and back = 4 size')
	const l0 = sampleAt({ ...cfg, pattern: 'line' }, line, 0)
	const l1 = sampleAt({ ...cfg, pattern: 'line' }, line, 4)
	assert.deepStrictEqual([l0.x, l0.y, l1.x, l1.y], [-1, 3, 3, 3], 'from stage right (x − size) to stage left (x + size)')
	assert.strictEqual(sampleAt({ ...cfg, pattern: 'line' }, line, 1).vx, 1, 'moving stage left')
	assert.strictEqual(sampleAt({ ...cfg, pattern: 'line' }, line, 5).vx, -1, 'and back')
	const walk = buildPath('walk', 1)
	assert.ok(Math.abs(walk.length - 8) < 1e-3, 'square side 2·size')
	const w = [0, 2, 4, 6].map((s) => sampleAt({ ...cfg, size: 1, pattern: 'walk' }, walk, s))
	assert.deepStrictEqual(w.map((q) => [q.x, q.y]), [[0, 2], [0, 4], [2, 4], [2, 2]], 'DS right → US right → US left → DS left')
	const f8 = buildPath('figure8', 2)
	const mid = sampleAt({ ...cfg, pattern: 'figure8' }, f8, f8.length / 4)
	assert.ok(Math.abs(mid.x - 3) < 0.01 && Math.abs(mid.y - 3) < 0.01, 'figure 8 reaches x + size at y')
	assert.deepStrictEqual(sampleAt({ ...cfg, pattern: 'hold' }, buildPath('hold', 2), 5), { x: 1, y: 3, z: 1.7, vx: 0, vy: 0, vz: 0 })
})

test('running: writes marker 1 (source puppet) at the rate, the hub derives the real speed; stop removes it', () => {
	const { hub, p, step, ticking } = rig()
	assert.strictEqual(p.live, false, 'off until asked')
	assert.deepStrictEqual(p.configure({ enabled: true, pattern: 'circle', speed: 1.5, hz: 50 }), { ok: true })
	assert.strictEqual(hub.list()[0].source, 'puppet')
	for (let i = 0; i < 10; i++) step(20)
	const m = hub.list()[0]
	assert.deepStrictEqual([m.id, m.name, m.source, m.status, m.stale], [1, 'Puppet', 'puppet', 1, false])
	assert.ok(Math.abs(Math.hypot(m.vx, m.vy) - 1.5) < 0.01, `hub speed ${Math.hypot(m.vx, m.vy)} ≈ 1.5 m/s`)
	assert.strictEqual(p.status().writes, 11)
	p.configure({ enabled: false })
	assert.strictEqual(ticking(), false)
	assert.strictEqual(hub.list().length, 0, 'its marker leaves the hub')
	assert.strictEqual(p.status().stopped, 'api')
})

test('safety: switches itself off after ttl_min; refuses a marker id another source keeps live', () => {
	const { hub, p, step } = rig()
	p.configure({ enabled: true, ttl_min: 1 })
	step(59000)
	assert.strictEqual(p.live, true)
	step(1001)
	assert.strictEqual(p.live, false, 'off after 1 min')
	assert.strictEqual(p.status().stopped, 'ttl')
	assert.strictEqual(hub.list().length, 0)
	hub.set({ id: 1, x: 0, y: 0, source: 'detect' })
	const r = p.configure({ enabled: true })
	assert.strictEqual(r.ok, false)
	assert.match(r.error, /marker 1 is live from "detect"/)
	assert.strictEqual(hub.list()[0].source, 'detect', 'the real marker is untouched')
	assert.strictEqual(p.configure({ enabled: true, id: 9 }).ok, true, 'another id works')
	step(1500)
	assert.ok(hub.list().find((m) => m.id === 1).stale, 'detect went quiet')
	assert.strictEqual(p.configure({ id: 1 }).ok, true, 'a stale marker can be taken')
	assert.strictEqual(hub.markers.has(9), false, 'id change removed the old marker')
})

test('HTTP: GET status, POST a JSON string body (as the router passes it), 400 / 405', () => {
	const { p } = rig()
	assert.strictEqual(p.handle('GET', '/api/tracking/markers', ''), null, 'other paths fall through')
	const g = p.handle('GET', '/api/tracking/puppet', '')
	assert.strictEqual(g.status, 200)
	assert.strictEqual(JSON.parse(g.body).enabled, false)
	const r = p.handle('POST', '/api/tracking/puppet', JSON.stringify({ enabled: true, pattern: 'walk' }))
	const b = JSON.parse(r.body)
	assert.deepStrictEqual([r.status, b.enabled, b.pattern, b.lap_m > 0], [200, true, 'walk', true])
	assert.strictEqual(p.handle('POST', '/api/tracking/puppet', 'nope').status, 400)
	assert.strictEqual(p.handle('DELETE', '/api/tracking/puppet', '').status, 405)
})

test('register.js routes it after the auto director and stops it on shutdown; off at boot', () => {
	const reg = fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8')
	assert.match(reg, /\|\| handleAuto\(auto, \{ method, path, body \}\) \|\| puppet\.handle\(method, path, body\)/)
	assert.match(reg, /puppet\.stop\('shutdown'\)/)
	assert.match(reg, /require\('\.\/puppet'\)\.createPuppet\(/)
	assert.doesNotMatch(reg, /puppet\.(start|configure)\(/, 'nothing switches it on at boot')
})

test('sniffer: decodes DATA + INFO, keeps per-tracker position / speed / status and the rate', () => {
	let t = 0
	const col = createCollector(() => t)
	const m = { id: 1, name: 'Puppet', x: 1, y: 2, z: 1.7, vx: 0.5, vy: 0, vz: 0, status: 1 }
	col.feed(encodeInfo([m])[0], '10.0.0.13')
	for (let i = 0; i < 60; i++) {
		t += 1000 / 60
		col.feed(encodeData([{ ...m, x: 1 + i * 0.01 }], { axes: 'y_up' })[0], '10.0.0.13')
	}
	assert.strictEqual(col.feed(Buffer.from('garbage!'), 'x'), null)
	const s = col.snapshot()
	assert.strictEqual(s.system, 'HighAsCG')
	assert.strictEqual(s.bad, 1)
	const r = s.trackers[0]
	assert.deepStrictEqual([r.id, r.name, r.status, r.from], [1, 'Puppet', 1, '10.0.0.13'])
	assert.ok(r.hz >= 59 && r.hz <= 61, `rate ${r.hz} Hz`)
	assert.deepStrictEqual(r.pos.map((v) => Math.round(v * 100) / 100), [1.59, 1.7, -2], 'y_up wire: x, height, −upstage')
	assert.match(formatTracker(r), /#1 +Puppet .* Hz +from 10\.0\.0\.13/)
	t += 5000
	assert.strictEqual(col.snapshot().trackers[0].hz, 0, 'rate falls to 0 when it stops')
})

test('project helper: PSN on keeps group / name, off restores exactly the previous output (or none)', () => {
	const on = testOutput({ enabled: false, protocol: 'artnet', psn: { group: '236.10.10.11', system_name: 'X' } }, { iface: '10.0.0.13' })
	assert.deepStrictEqual(on, { enabled: true, protocol: 'psn', psn: { group: '236.10.10.11', system_name: 'X', iface: '10.0.0.13', axes: 'y_up' } })
	assert.deepStrictEqual(withOutput(undefined, on), { output: on }, 'a project without fixtures gets just the output')
	assert.deepStrictEqual(withOutput({ output: on, patch: [1] }, undefined), { patch: [1] }, 'off: a patch added meanwhile survives')
	assert.deepStrictEqual(withOutput({ output: on }, undefined), {}, 'never null (Godot reads a Dictionary)')
	assert.deepStrictEqual(withOutput({ output: on }, { enabled: false }), { output: { enabled: false } })
})
