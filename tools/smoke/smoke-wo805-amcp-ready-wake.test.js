'use strict'

/**
 * WO-805 — waitForAmcpReady notices the reconnected AMCP client within ~25 ms instead of after a fixed 400 ms sleep,
 * the Apply polls :5250 every 150 ms (was 400), and the "port up but no client" fallback still waits as long as before
 * (portStableMs). The port probe and the Caspar connection are fakes: nothing here reaches the box's real :5250.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { waitForAmcpReady, sleepUntilConnected } = require('../../src/utils/caspar-amcp-wait')
const restart = require('../../src/utils/caspar-restart')

/** Caspar's AMCP port comes up `portAfterMs` after t0; the client connects `connectLagMs` after a reconnect() nudge. */
function fakeCaspar({ portAfterMs, connectLagMs = 5, neverConnect = false }) {
	const t0 = Date.now()
	const conn = {
		host: '127.0.0.1',
		port: 5250,
		isConnected: false,
		nudges: 0,
		reconnect() {
			this.nudges++
			if (!neverConnect) setTimeout(() => (conn.isConnected = true), connectLagMs)
		},
	}
	return {
		ctx: { casparConnection: conn },
		conn,
		isPortListening: async () => Date.now() - t0 >= portAfterMs,
		t0,
	}
}

test('WO-805: returns within a poll + a few ms of the port coming up (pollMs 150)', async () => {
	const f = fakeCaspar({ portAfterMs: 300 })
	const ok = await waitForAmcpReady(f.ctx, 5000, { pollMs: 150, isPortListening: f.isPortListening })
	const took = Date.now() - f.t0
	assert.equal(ok, true)
	assert.equal(f.conn.nudges, 1)
	assert.ok(took >= 300 && took < 300 + 150 + 100, `back ${took - 300} ms after the port (≤ one poll + wake)`)
})

test('WO-805: the client connecting wakes the wait early, even with a long poll', async () => {
	const f = fakeCaspar({ portAfterMs: 0, connectLagMs: 5 })
	const t = Date.now()
	const ok = await waitForAmcpReady(f.ctx, 5000, { pollMs: 400, isPortListening: f.isPortListening })
	assert.equal(ok, true)
	assert.ok(Date.now() - t < 100, `woke ${Date.now() - t} ms after the nudge (was a fixed 400 ms sleep)`)
})

test('WO-805: port up but no client — the fallback still needs portStableMs, not 3 short polls', async () => {
	const f = fakeCaspar({ portAfterMs: 0, neverConnect: true })
	const t = Date.now()
	const ok = await waitForAmcpReady(f.ctx, 5000, {
		pollMs: 50,
		acceptPortListening: true,
		portStableMs: 600,
		isPortListening: f.isPortListening,
	})
	const took = Date.now() - t
	assert.equal(ok, true)
	assert.ok(took >= 600 && took < 900, `accepted after ${took} ms (port stable ≥ 600 ms)`)
})

test('WO-805: no port, no client — times out false at maxMs', async () => {
	const f = fakeCaspar({ portAfterMs: 1e9 })
	const t = Date.now()
	const ok = await waitForAmcpReady(f.ctx, 300, { pollMs: 100, isPortListening: f.isPortListening })
	assert.equal(ok, false)
	assert.ok(Date.now() - t < 500)
	assert.equal(f.conn.nudges, 0)
})

test('WO-805: sleepUntilConnected returns early on connect and false on timeout', async () => {
	const ctx = { casparConnection: { isConnected: false } }
	setTimeout(() => (ctx.casparConnection.isConnected = true), 30)
	let t = Date.now()
	assert.equal(await sleepUntilConnected(ctx, 1000), true)
	assert.ok(Date.now() - t < 120)
	ctx.casparConnection.isConnected = false
	t = Date.now()
	assert.equal(await sleepUntilConnected(ctx, 80), false)
	assert.ok(Date.now() - t >= 75)
})

test('WO-805: caspar-restart re-exports the helpers and the Apply uses the fast poll + stable window', () => {
	for (const k of ['waitForAmcpReady', 'waitForAmcpDisconnect', 'isAmcpTcpConnected', 'isAmcpPortListening']) {
		assert.equal(typeof restart[k], 'function', k)
	}
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/utils/caspar-restart.js'), 'utf8')
	assert.match(src, /const APPLY_AMCP_POLL_MS = 150\b/)
	assert.match(src, /const APPLY_PORT_STABLE_MS = 2000\b/)
	assert.match(src, /pollMs: APPLY_AMCP_POLL_MS,\s*portStableMs: APPLY_PORT_STABLE_MS/)
})
