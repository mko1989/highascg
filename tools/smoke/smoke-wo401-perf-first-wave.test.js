'use strict'

/**
 * WO-401 first wave — acceptance guards.
 *
 * F1: OscListener address sampling must be O(1) per message (Set, frozen at 40) — the old
 *     last-40 `includes` ring cost ~1.2 % of a core at the measured 18.6k msg/s.
 * F4: recordAmcpHistory must NEVER touch disk synchronously on the send path; the file is a
 *     debounced async artifact only.
 * F3 (void finding): OscState marks channels dirty per-MESSAGE, so with Caspar's full-copy OSC
 *     every channel is dirty every tick and delta mode ships full-size payloads. The delta test
 *     below pins that semantic: if dirty-marking ever becomes value-aware, it will fail and the
 *     WO-401 F3 flag decision must be revisited (that's intentional).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { OscListener } = require('../../src/osc/osc-listener')
const { OscState } = require('../../src/osc/osc-state')
const { recordAmcpHistory, flushAmcpHistory } = require('../../src/caspar/amcp-client-history')

const OSC_CFG = {
	enabled: true,
	listenPort: 6251,
	listenAddress: '0.0.0.0',
	peakHoldMs: 2000,
	emitIntervalMs: 50,
	staleTimeoutMs: 0,
	layerStaleTimeoutMs: 0,
}

describe('WO-401 F1: OSC listener address sampling', () => {
	it('records stats without scanning, saturates at 40 distinct addresses', () => {
		const l = new OscListener({ ...OSC_CFG }, () => {}, null)
		for (let i = 0; i < 60; i++) l._record(`/channel/1/stage/layer/${i}/frame`)
		for (let i = 0; i < 1000; i++) l._record('/channel/1/mixer/audio/1/dBFS')
		l._record(null)
		const stats = l.getStats()
		assert.equal(stats.received, 1061)
		assert.equal(typeof stats.lastAt, 'number')
		assert.ok(Array.isArray(stats.sampleAddresses))
		assert.equal(stats.sampleAddresses.length, 40)
		// Frozen once saturated: the 41st+ distinct addresses are not admitted.
		assert.ok(!stats.sampleAddresses.includes('/channel/1/mixer/audio/1/dBFS'))
		// The hot-path structure is a Set — no per-message array scan.
		assert.ok(l._sampleAddresses instanceof Set)
	})
})

describe('WO-401 F4: AMCP history stays off the send path', () => {
	it('does not write synchronously; flush writes the capped ring asynchronously', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo401-amcp-'))
		const fp = path.join(dir, 'amcp-last50.txt')
		const ctx = { _amcpHistoryFile: fp }

		for (let i = 1; i <= 75; i++) recordAmcpHistory(ctx, `PLAY 1-10 clip${i}`)

		// Send path must not have touched disk.
		assert.ok(!fs.existsSync(fp), 'recordAmcpHistory wrote synchronously')
		// Ring capped at 50, newest kept.
		assert.equal(ctx._amcpHistory.length, 50)
		assert.ok(ctx._amcpHistory[49].endsWith('PLAY 1-10 clip75'))
		assert.ok(ctx._amcpHistory[0].endsWith('PLAY 1-10 clip26'))
		// A debounced flush timer is armed (and unref'd so it cannot hold the process open).
		assert.ok(ctx._amcpHistoryFlushTimer)
		clearTimeout(ctx._amcpHistoryFlushTimer)
		ctx._amcpHistoryFlushTimer = null

		await flushAmcpHistory(ctx)
		const body = fs.readFileSync(fp, 'utf8').trimEnd().split('\n')
		assert.equal(body.length, 50)
		assert.ok(body[49].endsWith('PLAY 1-10 clip75'))
		fs.rmSync(dir, { recursive: true, force: true })
	})
})

describe('WO-401 F3 void finding: dirty tracking is per-message, not per-change', () => {
	it('delta payload contains a channel whose values did not change (identical message twice)', () => {
		const osc = new OscState(() => {}, { ...OSC_CFG, wsDeltaBroadcast: true })
		// First message past the emit interval flushes synchronously (_scheduleEmit fast path).
		const emitted = []
		osc.on('change', (payload) => emitted.push(payload))
		osc.handleOscMessage({ address: '/channel/3/mixer/audio/nb_channels', args: [2] })
		assert.equal(emitted.length, 1)
		assert.equal(emitted[0].delta, true)
		assert.ok(emitted[0].channels['3'])

		// Same message, same value, within the interval → channel is dirty again. This is WHY WS
		// delta mode saves nothing on a box receiving Caspar's full OSC copy (WO-401 F3).
		// Value-aware marking would flip this.
		osc.handleOscMessage({ address: '/channel/3/mixer/audio/nb_channels', args: [2] })
		const p = osc._buildChangePayload()
		assert.equal(p.delta, true)
		assert.ok(p.channels['3'], 'channel 3 no longer dirty — dirty-marking became value-aware; revisit WO-401 F3')

		// Drained: no traffic → null payload.
		assert.equal(osc._buildChangePayload(), null)
		osc.destroy()
	})
})
