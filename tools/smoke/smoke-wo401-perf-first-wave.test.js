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

// F9 env knobs must be set BEFORE persistence.js is required (read at module load).
process.env.HIGHASCG_PERSISTENCE_PRETTY = '0'
process.env.HIGHASCG_PERSISTENCE_IMMEDIATE_COALESCE_MS = '25'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { OscListener } = require('../../src/osc/osc-listener')
const { OscState } = require('../../src/osc/osc-state')
const { recordAmcpHistory, flushAmcpHistory } = require('../../src/caspar/amcp-client-history')
const { StateManager } = require('../../src/state/state-manager')
const persistence = require('../../src/utils/persistence')

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

describe('WO-401 F3-revised: dirty tracking is VALUE-aware (delta mode pays)', () => {
	it('unchanged repeats stay clean; value changes dirty; frame counters never dirty', () => {
		const osc = new OscState(() => {}, { ...OSC_CFG, wsDeltaBroadcast: true })
		// First message past the emit interval flushes synchronously (_scheduleEmit fast path).
		const emitted = []
		osc.on('change', (payload) => emitted.push(payload))
		osc.handleOscMessage({ address: '/channel/3/mixer/audio/nb_channels', args: [2] })
		assert.equal(emitted.length, 1)
		assert.equal(emitted[0].delta, true)
		assert.ok(emitted[0].channels['3'])

		// Identical repeat within the interval → channel stays CLEAN. This is the F3-revised
		// contract that makes WS delta mode worthwhile on a box receiving Caspar's full OSC copy.
		osc.handleOscMessage({ address: '/channel/3/mixer/audio/nb_channels', args: [2] })
		assert.equal(osc._buildChangePayload(), null)

		// A real value change dirties…
		osc.handleOscMessage({ address: '/channel/3/mixer/audio/1/dBFS', args: [-12] })
		let p = osc._buildChangePayload()
		assert.equal(p.delta, true)
		assert.ok(p.channels['3'])
		// …and the same value repeated does not.
		osc.handleOscMessage({ address: '/channel/3/mixer/audio/1/dBFS', args: [-12] })
		assert.equal(osc._buildChangePayload(), null)

		// Output frame counters increment forever on every channel — stored, but never dirty.
		osc.handleOscMessage({ address: '/channel/3/output/port/1/frame', args: [100, 200] })
		osc.handleOscMessage({ address: '/channel/3/output/port/1/frame', args: [101, 200] })
		assert.equal(osc._buildChangePayload(), null)
		assert.equal(osc.getSnapshot().channels['3'].outputs['1'].frames, 101)

		// Playing layer: elapsed moves → dirty; a paused layer repeating the same time stays clean.
		osc.handleOscMessage({ address: '/channel/3/stage/layer/10/foreground/file/time', args: [1.0, 10.0] })
		p = osc._buildChangePayload()
		assert.ok(p && p.channels['3'])
		osc.handleOscMessage({ address: '/channel/3/stage/layer/10/foreground/file/time', args: [1.0, 10.0] })
		assert.equal(osc._buildChangePayload(), null)

		// Channel profiler floats are noise (only `healthy` is consumed) — stored, dirty on flip only.
		// Channels default to healthy=true; [10, 20] = actual within budget keeps healthy=true,
		// so no flip and no dirty. (Pre-review-fix the flag was inverted and this message flipped.)
		osc.handleOscMessage({ address: '/channel/3/profiler/time', args: [10, 20] })
		assert.equal(osc._buildChangePayload(), null, 'in-budget message keeps default healthy=true — no flip')
		assert.equal(osc.getSnapshot().channels['3'].profiler.healthy, true, 'meeting frame budget is healthy')
		osc.handleOscMessage({ address: '/channel/3/profiler/time', args: [11, 20] })
		assert.equal(osc._buildChangePayload(), null, 'jittering actual/expected must not dirty')
		// Overrunning the frame budget (dropping frames) flips healthy → false and dirties.
		osc.handleOscMessage({ address: '/channel/3/profiler/time', args: [25, 20] })
		p = osc._buildChangePayload()
		assert.ok(p && p.channels['3'], 'budget overrun flips healthy → dirty')
		assert.equal(osc.getSnapshot().channels['3'].profiler.healthy, false, 'dropping frames is unhealthy')
		osc.destroy()
	})
})

describe('WO-401 F2: OSC mirror takes the snapshot by reference, no dead emits', () => {
	it('stores snapshot/audio/oscLayers without cloning and emits no per-tick change paths', () => {
		const sm = new StateManager()
		const snap = {
			updatedAt: Date.now(),
			channels: {
				1: {
					format: '1080p5000',
					audio: { nbChannels: 2, levels: [{ dBFS: -12, peak: -6, peakAge: 0 }] },
					layers: { 10: { file: { name: 'clip' } } },
					outputs: {},
					profiler: { actual: 1, expected: 2, healthy: true },
				},
			},
		}
		const changesBefore = sm._changes.length
		sm.updateFromOscSnapshot(snap)
		// By reference — the per-tick JSON round-trips are gone.
		assert.equal(sm._state.osc, snap)
		assert.equal(sm._state.audio['1'].levels, snap.channels[1].audio.levels)
		const entry = sm._state.channels.find((c) => c.id === 1)
		assert.equal(entry.oscLayers, snap.channels[1].layers)
		// No osc/audio/channels.N change entries queued (getDelta() is caller-less; WS clients
		// never read those paths — client OSC rides the dedicated 'osc' broadcast).
		assert.equal(sm._changes.length, changesBefore)
	})
})

describe('WO-401 client tranche: paced meter loop, stable live-source rows', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8')

	it('F12: audio meter loop is interval-paced, not free-running rAF', () => {
		const loop = read('client/lib/audio-mixer-meter-loop.js')
		assert.ok(!loop.includes('requestAnimationFrame'), 'meter loop must not free-run at display rate')
		assert.ok(loop.includes('setInterval(tick, TICK_MS)'), 'meter loop paced by interval')
		assert.ok(loop.includes('SMOOTH_FALL = 0.45'), 'fall smoothing re-derived for 20 Hz')
		// WO-284 guards must survive the rewrite.
		assert.ok(loop.includes('_lastBg') && loop.includes('_lastMeterState') && loop.includes('document.hidden'))
	})

	it('todos30.07.26 item 6: live-tab render key excludes volatile status objects', () => {
		const rendr = read('client/components/sources-panel-live-render.js')
		assert.ok(!rendr.includes('status: decklinkInputsStatus'), 'raw status object (updatedAt churn) must not key the render')
		assert.ok(!rendr.includes('liveAudioStatus: liveAudioInputsStatus'), 'raw status object must not key the render')
		assert.ok(rendr.includes('slotMsg: slotMsgForSource(s)'), 'render keyed on the displayed slot message instead')
	})
})

describe('WO-401 F5-revised: virtual-camera fps derives from the source rate', () => {
	const { resolveV4l2BridgeFps } = require('../../src/virtual-output/v4l2-bridge-args')

	it('halves the source rate only while the result stays ≥ 25', () => {
		assert.equal(resolveV4l2BridgeFps({ machineProfile: { defaultProjectFps: 50 } }), 25)
		assert.equal(resolveV4l2BridgeFps({ machineProfile: { defaultProjectFps: 60 } }), 30)
		// Owner 30.07.26: "if the input is 25 it shouldn't half to 12,5".
		assert.equal(resolveV4l2BridgeFps({ machineProfile: { defaultProjectFps: 25 } }), 25)
		assert.equal(resolveV4l2BridgeFps({ machineProfile: { defaultProjectFps: 30 } }), 30)
		// No config at all → canonical 50 source → 25 out.
		assert.equal(resolveV4l2BridgeFps({}), 25)
	})

	it('explicit virtualCamera.fps wins un-halved; native = full source rate', () => {
		const src50 = { machineProfile: { defaultProjectFps: 50 } }
		assert.equal(resolveV4l2BridgeFps({ ...src50, virtualCamera: { fps: 50 } }), 50)
		assert.equal(resolveV4l2BridgeFps({ ...src50, virtualCamera: { fps: 'native' } }), 50)
		assert.equal(resolveV4l2BridgeFps({ ...src50, virtualCamera: { fps: 10 } }), 10)
	})
})

describe('WO-401 F9: immediate persistence keys coalesce into one write', () => {
	it('does not write synchronously, lands compact JSON within the window', async () => {
		const stateFile = path.join(os.tmpdir(), `highascg-state-test-${process.pid}.json`)
		fs.rmSync(stateFile, { force: true })
		persistence.set('scene_deck', { a: 1 })
		persistence.set('screenTimers', { b: 2 })
		assert.ok(!fs.existsSync(stateFile), 'immediate key wrote synchronously despite coalesce window')
		await new Promise((r) => setTimeout(r, 80))
		assert.ok(fs.existsSync(stateFile), 'coalesced write never landed')
		const raw = fs.readFileSync(stateFile, 'utf8')
		assert.ok(!raw.includes('\n'), 'HIGHASCG_PERSISTENCE_PRETTY=0 should produce compact JSON')
		const parsed = JSON.parse(raw)
		assert.equal(parsed.scene_deck.a, 1)
		assert.equal(parsed.screenTimers.b, 2)
		// flushSync stays synchronous for shutdown paths.
		persistence.set('scene_deck', { a: 3 })
		persistence.flushSync()
		assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).scene_deck.a, 3)
		fs.rmSync(stateFile, { force: true })
	})
})
