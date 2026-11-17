'use strict'
/**
 * WO-1088: the keeping-up service glue — a client report becomes a shared check, its start / end are journal lines,
 * a status change is broadcast as `health:keeping-up` (and a steady state is not), the routes answer, preshow is calm.
 * Also pins the wiring: router registration, index.js start, the OscState hook, the follow-engine timing.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { startKeepingUp } = require('../../src/health/keeping-up-service')
const routes = require('../../src/health/routes-keeping-up')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// WO-1106 D6: fixed machine readings — the real /proc CPU, the CPU thermal-throttle counter (rise 1: one event between
// two samples starts an incident) and the event-loop histogram move under a loaded box and broke "no broadcast"
const calm = { readHost: () => ({ cpuPct: 12, memPct: 40, gpu: null, cpuThrottleDelta: 0 }), readLoop: () => ({ maxMs: 2, p99Ms: 1, meanMs: 0.5 }) }

function fakeCtx(extra = {}) {
	const logs = []
	const sent = []
	const ctx = { config: { osc: { enabled: true } }, _casparStatus: { connected: true }, log: (l, m) => logs.push([l, m]),
		_wsBroadcast: (t, d) => sent.push([t, d]), ...extra }
	return { ctx, logs, sent }
}

describe('WO-1088 keeping-up service', () => {
	it('a client fps report: shared check, one journal line per start / end, broadcast only on change', () => {
		const { ctx, logs, sent } = fakeCtx()
		const svc = startKeepingUp(ctx, { autostart: false, gpu: false, wsClients: [], ...calm })
		try {
			const body = { client: 'abc', key: 'fps', name: 'Operator client', level: 1, label: 'Operator client at 61 of 100 fps', text: '61 / 100 fps' }
			assert.equal(routes.handleReport(JSON.stringify(body), ctx).status, 200)
			svc.sampleOnce()
			const s = JSON.parse(routes.handleGet(ctx).body)
			assert.equal(s.label, 'Operator client at 61 of 100 fps')
			assert.equal(s.status, 'behind')
			assert.ok(logs.some(([l, m]) => l === 'warn' && m === '[keeping-up] behind: Operator client at 61 of 100 fps (61 / 100 fps)'))
			assert.equal(sent.at(-1)[0], 'health:keeping-up')
			const n = sent.length
			svc.sampleOnce()
			assert.equal(sent.length, n, 'nothing moved → no broadcast')
			routes.handleReport(JSON.stringify({ ...body, level: 0, text: '100 / 100 fps' }), ctx)
			svc.sampleOnce()
			assert.equal(svc.summary().level, 0)
			assert.ok(logs.some(([, m]) => /^\[keeping-up\] recovered after \d+ s: Operator client at 61 of 100 fps — worst behind, 61 \/ 100 fps$/.test(m)))
			assert.equal(svc.summary().incidents[0].ended, 'recovered')
			assert.equal(routes.handleReport('{"key":"fps"}', ctx).status, 400, 'client id required')
			routes.handleReport(JSON.stringify({ ...body, client: 'odd', level: 7 }), ctx)
			svc.sampleOnce()
			assert.equal(svc.summary().checks.find((c) => c.key === 'client:odd:fps').status, 'failing', 'a level out of range is clamped to failing')
		} finally {
			svc.stop()
		}
	})
	it('preshow: no checks at all, mode preshow; no watch → 503', () => {
		const { ctx } = fakeCtx({ config: { offline_mode: true } })
		const svc = startKeepingUp(ctx, { autostart: false, gpu: false, ...calm })
		try {
			const s = svc.sampleOnce()
			assert.equal(s.mode, 'preshow')
			assert.equal(s.checks.length, 0)
			assert.equal(s.level, 0)
		} finally {
			svc.stop()
		}
		assert.equal(routes.handleGet({}).status, 503)
	})
	it('a backed-up WS client is named; Caspar down is the one failing check', () => {
		const ws = { bufferedAmount: 3 * 1024 * 1024, _socket: { remoteAddress: '::ffff:10.0.0.5' } }
		const { ctx } = fakeCtx({ _casparStatus: { connected: false } })
		const svc = startKeepingUp(ctx, { autostart: false, gpu: false, wsClients: [ws], ...calm })
		try {
			svc.sampleOnce()
			svc.sampleOnce()
			const s = svc.summary()
			assert.equal(s.label, 'Caspar not connected — outputs unwatched')
			assert.ok(s.checks.some((c) => c.label === 'Updates to client 10.0.0.5 backing up'))
		} finally {
			svc.stop()
		}
	})
	it('WO-1106 D6: the machine readings are injectable — a throttle event or a stalled loop comes from readHost / readLoop', () => {
		let host = calm.readHost()
		let loop = calm.readLoop()
		const { ctx, sent } = fakeCtx()
		const svc = startKeepingUp(ctx, { autostart: false, gpu: false, wsClients: [], readHost: () => host, readLoop: () => loop })
		try {
			svc.sampleOnce()
			const n = sent.length
			for (let i = 0; i < 5; i++) svc.sampleOnce()
			assert.equal(sent.length, n, 'fixed calm readings → no broadcast, however loaded the box is')
			const c = svc.summary().checks
			assert.equal(c.find((x) => x.key === 'cpu').measured, 12, 'CPU is the injected reading')
			assert.equal(c.find((x) => x.key === 'ram').measured, 40, 'RAM is the injected reading')
			assert.equal(c.find((x) => x.key === 'server-loop').measured, 2, 'the loop is the injected reading')
			host = { ...host, cpuThrottleDelta: 3 }
			svc.sampleOnce()
			assert.equal(sent.length, n + 1, 'one throttle event (rise 1) starts an incident → one broadcast')
			assert.equal(svc.summary().checks.find((x) => x.key === 'cpu-thermal').text, '3 throttle events')
			loop = { maxMs: 900, p99Ms: 900, meanMs: 10 }
			svc.sampleOnce()
			assert.equal(svc.summary().label, 'Server stalled 900 ms')
		} finally {
			svc.stop()
		}
	})
	it('is wired: route, boot, shutdown, OSC hook, follow timing, detect accessor', () => {
		assert.match(read('src/api/router.js'), /require\('\.\.\/health\/routes-keeping-up'\)\.register\(routes\)/)
		assert.match(read('index.js'), /startKeepingUp\(appCtx, \{ wsClients: wsHandle\.clients \}\)/)
		assert.match(read('src/bootstrap/shutdown.js'), /appCtx\._stopKeepingUp\(\)/)
		assert.match(read('src/osc/osc-state.js'), /this\.health\.note\(ch, rest, /)
		assert.match(read('src/fixtures/follow-engine.js'), /takeTiming\(\) \{/)
		assert.match(read('src/tracking/register.js'), /ctx\.detectService = _detect/)
	})
})
