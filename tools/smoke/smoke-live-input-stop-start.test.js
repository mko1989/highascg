'use strict'

/**
 * Live input stop -> start round trip.
 *
 * The reported bug: an operator stopped a live audio input (inspector "Stop" =
 * `STOP ch-layer` + `MIXER ch-layer CLEAR` on the input's dedicated channel), the mixer strip
 * correctly went to "no signal" — and nothing anywhere could start that one input again. There
 * was no Start control at all: only the whole-rig `/api/audio/live-inputs/apply` (re-PLAYs every
 * slot, glitching inputs still on air) or a Caspar restart.
 *
 * Offline only: pure config -> plan resolution, a fake AMCP recorder for the round trip, pure
 * ESM client modules through import(), and source asserts on the two mixer components and the
 * inspector. No Caspar, no network, no DOM.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const REPO = path.join(__dirname, '../..')

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

function esm(rel) {
	return import(pathToFileURL(path.join(REPO, rel)).href)
}

const startP = esm('client/lib/live-input-start.js')

const {
	resolveInputStartPlan,
	normalizeInputStartRequest,
	inputStartFailureStatus,
	startInputCapture,
} = require('../../src/audio/live-input-start')

/** ALSA slots 1–2 on their own channels + one DeckLink. Bridge off so nothing spawns ffmpeg. */
const CONFIG = {
	casparServer: {
		screen_count: 1,
		decklink_input_count: 1,
		decklink_input_1_device: 1,
		live_audio_input_count: 2,
		live_audio_input_1_device: 'hw:1,0',
		live_audio_input_2_device: 'hw:2,0',
		live_audio_capture_bridge: false,
	},
}

/** INFO text that {@link isLiveAlsaLayerHealthy} accepts as a live ALSA producer. */
const HEALTHY_INFO = '<foreground><producer>ffmpeg</producer><file><name>alsa://hw:1,0</name></file></foreground>'

function fakeCtx({ info = HEALTHY_INFO, failPlay = false } = {}) {
	const sent = []
	return {
		config: CONFIG,
		sent,
		log: () => {},
		amcp: {
			isConnected: true,
			async raw(cmd) {
				sent.push(String(cmd))
				if (failPlay && /^PLAY /.test(String(cmd))) throw new Error('404 PLAY FAILED')
				return 'OK'
			},
			async info() {
				return { data: info }
			},
		},
	}
}

/** What the inspector's Stop button does to the input's dedicated channel. */
function stopInput(ctx, channel, layer) {
	return Promise.all([ctx.amcp.raw(`STOP ${channel}-${layer}`), ctx.amcp.raw(`MIXER ${channel}-${layer} CLEAR`)])
}

// ---------------------------------------------------------------------------
// 1. Start plan resolution (pure)
// ---------------------------------------------------------------------------

describe('input start: plan resolution', () => {
	it('resolves an ALSA slot to its dedicated channel, layer and capture clip', () => {
		const plan = resolveInputStartPlan(CONFIG, { kind: 'live_audio', slot: 2 })
		assert.equal(plan.ok, true)
		assert.equal(plan.kind, 'live_audio')
		assert.equal(plan.slot, 2)
		assert.ok(Number.isFinite(plan.channel) && plan.channel >= 1)
		assert.equal(plan.layer, 10, 'ALSA capture lives on the dedicated live-audio layer')
		assert.match(plan.clip, /^alsa:\/\/hw:2,0/)
	})

	it('resolves a DeckLink slot to its channel, layer and card device', () => {
		const plan = resolveInputStartPlan(CONFIG, { kind: 'decklink', slot: 1 })
		assert.equal(plan.ok, true)
		assert.equal(plan.kind, 'decklink')
		assert.ok(Number.isFinite(plan.channel) && plan.channel >= 1)
		assert.equal(plan.device, 1)
	})

	it('rejects unknown kinds, bad slots and unconfigured slots — with distinguishable statuses', () => {
		assert.deepEqual(normalizeInputStartRequest({ kind: 'v4l2', slot: 1 }), { ok: false, reason: 'unsupported_kind' })
		assert.deepEqual(normalizeInputStartRequest({ kind: 'live_audio', slot: 0 }), { ok: false, reason: 'invalid_slot' })
		assert.deepEqual(normalizeInputStartRequest({ kind: 'live_audio', slot: 'x' }), { ok: false, reason: 'invalid_slot' })
		assert.equal(resolveInputStartPlan(CONFIG, { kind: 'live_audio', slot: 7 }).reason, 'slot_not_configured')
		assert.equal(resolveInputStartPlan(CONFIG, { kind: 'decklink', slot: 6 }).reason, 'slot_not_configured')

		assert.equal(inputStartFailureStatus('unsupported_kind'), 400)
		assert.equal(inputStartFailureStatus('invalid_slot'), 400)
		assert.equal(inputStartFailureStatus('slot_not_configured'), 409)
		assert.equal(inputStartFailureStatus('amcp_disconnected'), 503)
		assert.equal(inputStartFailureStatus('play_failed'), 502)
	})

	it('defaults to live_audio when the caller omits the kind (legacy slot-only callers)', () => {
		const plan = resolveInputStartPlan(CONFIG, { slot: 1 })
		assert.equal(plan.ok, true)
		assert.equal(plan.kind, 'live_audio')
	})
})

// ---------------------------------------------------------------------------
// 2. The round trip the operator could not complete
// ---------------------------------------------------------------------------

describe('input start: stop -> start round trip', () => {
	it('an ALSA input stopped on its dedicated channel is PLAYed again by start', async () => {
		const ctx = fakeCtx()
		const plan = resolveInputStartPlan(CONFIG, { kind: 'live_audio', slot: 1 })
		const cl = `${plan.channel}-${plan.layer}`

		await stopInput(ctx, plan.channel, plan.layer)
		assert.deepEqual(ctx.sent, [`STOP ${cl}`, `MIXER ${cl} CLEAR`], 'stop kills the capture producer')

		ctx.sent.length = 0
		const res = await startInputCapture(ctx, { kind: 'live_audio', slot: 1 })
		assert.equal(res.ok, true, `start must succeed, got ${JSON.stringify(res)}`)
		assert.equal(res.channel, plan.channel)
		assert.equal(res.layer, plan.layer)
		const played = ctx.sent.filter((c) => c.startsWith(`PLAY ${cl} `))
		assert.equal(played.length, 1, `exactly one PLAY on ${cl}, got ${JSON.stringify(ctx.sent)}`)
		assert.match(played[0], /alsa:\/\/hw:1,0/)
	})

	it('starting one input touches only that input’s channel — inputs on air are never re-PLAYed', async () => {
		const ctx = fakeCtx()
		const other = resolveInputStartPlan(CONFIG, { kind: 'live_audio', slot: 2 })
		await startInputCapture(ctx, { kind: 'live_audio', slot: 1 })
		const strayed = ctx.sent.filter((c) => c.includes(`${other.channel}-${other.layer}`))
		assert.deepEqual(strayed, [], `slot 2 must be untouched, got ${JSON.stringify(ctx.sent)}`)
	})

	it('a DeckLink input clears then re-PLAYs its card on its own channel', async () => {
		const ctx = fakeCtx()
		const plan = resolveInputStartPlan(CONFIG, { kind: 'decklink', slot: 1 })
		const cl = `${plan.channel}-${plan.layer}`
		await stopInput(ctx, plan.channel, plan.layer)
		ctx.sent.length = 0

		const res = await startInputCapture(ctx, { kind: 'decklink', slot: 1 })
		assert.equal(res.ok, true)
		assert.deepEqual(ctx.sent, [`STOP ${cl}`, `MIXER ${cl} CLEAR`, `PLAY ${cl} DECKLINK 1`])
	})

	it('a dead source reports a failure instead of a phantom success', async () => {
		const ctx = fakeCtx({ failPlay: true })
		const res = await startInputCapture(ctx, { kind: 'decklink', slot: 1 })
		assert.equal(res.ok, false)
		assert.equal(res.status, 502)
		assert.match(String(res.reason), /powered off|not cabled|PLAY FAILED/i)
	})

	it('start without Caspar is a 503, not a silent no-op', async () => {
		const res = await startInputCapture({ config: CONFIG }, { kind: 'live_audio', slot: 1 })
		assert.equal(res.ok, false)
		assert.equal(res.reason, 'amcp_disconnected')
		assert.equal(res.status, 503)
	})

	it('a successful start clears that slot from the recorded failure list', async () => {
		const ctx = fakeCtx()
		ctx._liveAudioInputsStatus = { enabled: true, failed: [{ slot: 1, message: 'play_failed' }, { slot: 2, message: 'play_failed' }] }
		await startInputCapture(ctx, { kind: 'live_audio', slot: 1 })
		assert.deepEqual(
			ctx._liveAudioInputsStatus.failed.map((f) => f.slot),
			[2],
			'only the started slot is cleared',
		)
	})
})

// ---------------------------------------------------------------------------
// 3. Client: the start affordance and the apply-before-persist ordering
// ---------------------------------------------------------------------------

describe('client: start control on a live input strip', () => {
	it('a stopped / no-signal input still exposes a start control', async () => {
		const { shouldShowStartControl } = await startP
		// Metering state is deliberately absent from the decision — the strip that reads
		// "no signal" is exactly the one that needs its Start button.
		for (const row of [
			{ inputKind: 'live_audio', slot: 1, isLiveInput: true },
			{ inputKind: 'decklink', slot: 2, isLiveInput: true },
		]) {
			assert.equal(shouldShowStartControl(row), true, JSON.stringify(row))
			assert.equal(shouldShowStartControl({ ...row, meterState: 'no-data' }), true, 'no signal must not hide start')
			assert.equal(shouldShowStartControl({ ...row, muted: true }), true)
		}
	})

	it('inputs with no restartable capture channel offer no start control', async () => {
		const { shouldShowStartControl, startRequestForRow } = await startP
		assert.equal(shouldShowStartControl({ inputKind: 'v4l2', slot: 1 }), false)
		assert.equal(shouldShowStartControl({ inputKind: 'live_audio' }), false, 'no slot -> nothing to start')
		assert.equal(shouldShowStartControl(null), false)
		assert.equal(startRequestForRow({ inputKind: 'decklink', slot: '3' }).slot, 3)
	})

	it('start applies to air, then restores the saved PGM routes — and persists nothing', async () => {
		const { runInputStart } = await startP
		const calls = []
		const res = await runInputStart(
			{ inputKind: 'live_audio', slot: 1 },
			{
				post: async (p, b) => {
					calls.push(['post', p, b])
					return { ok: true }
				},
				targets: [
					{ channel: 1, layer: 1 },
					{ channel: 2, layer: 1 },
				],
				playRoute: async (ch, ln, route, opts) => calls.push(['play', ch, ln, route, opts.audioOnly]),
				route: 'route://7',
			},
		)
		assert.equal(res.routesRestored, 2)
		assert.deepEqual(calls, [
			['post', '/api/audio/inputs/start', { kind: 'live_audio', slot: 1 }],
			['play', 1, 1, 'route://7', true],
			['play', 2, 1, 'route://7', true],
		])
	})

	it('a failed start throws and puts nothing on air', async () => {
		const { runInputStart } = await startP
		const played = []
		await assert.rejects(
			runInputStart(
				{ inputKind: 'live_audio', slot: 1 },
				{
					post: async () => ({ ok: false, error: 'slot_not_configured' }),
					targets: [{ channel: 1, layer: 1 }],
					playRoute: async (...a) => played.push(a),
					route: 'route://7',
				},
			),
			/slot_not_configured/,
		)
		assert.deepEqual(played, [], 'no route may be applied after a failed start')
	})

	it('a non-route source is never PLAYed as one', async () => {
		const { runInputStart } = await startP
		const played = []
		const res = await runInputStart(
			{ inputKind: 'decklink', slot: 1 },
			{
				post: async () => ({ ok: true }),
				targets: [{ channel: 1, layer: 321 }],
				playRoute: async (...a) => played.push(a),
				route: 'alsa://hw:1,0',
			},
		)
		assert.equal(res.routesRestored, 0)
		assert.deepEqual(played, [])
	})
})

// ---------------------------------------------------------------------------
// 4. The controls are actually wired into the UI the operator uses
// ---------------------------------------------------------------------------

describe('UI wiring: stop and start live in the same places', () => {
	it('both mixer renderers emit a start control and call the shared start path', () => {
		for (const rel of [
			'client/components/audio-mixer-panel-live-inputs.js',
			'client/components/audio-mixer-console-live-inputs.js',
		]) {
			const s = src(rel)
			assert.ok(s.includes('shouldShowStartControl'), `${rel} must decide the start control centrally`)
			assert.ok(s.includes('data-input-start'), `${rel} must render a start control`)
			assert.ok(s.includes('runInputStart'), `${rel} must use the shared start path`)
			assert.ok(s.includes("dataset.busy"), `${rel} start must be single-flight`)
			assert.ok(!/hidden.*data-input-start/.test(s), `${rel} must not ship the start control hidden`)
		}
	})

	it('the inspector that offers Stop now offers Start next to it', () => {
		const s = src('client/components/inspector-live-audio-input.js')
		assert.ok(s.includes('data-live-audio-stop'), 'Stop still exists')
		assert.ok(s.includes('data-live-audio-start'), 'Start must live in the same place')
		assert.ok(s.includes('runInputStart'), 'Start must use the shared start path')
		assert.ok(
			s.indexOf('data-live-audio-start') < s.indexOf('data-live-audio-stop'),
			'Start is rendered before Stop so it is not hidden past the destructive control',
		)
	})

	it('the start endpoint is registered and is per-input, not a whole-rig re-apply', () => {
		const router = src('src/api/router.js')
		assert.ok(router.includes("routes.post('/api/audio/inputs/start'"), 'endpoint must be routed')
		const routesAudio = src('src/api/routes-audio.js')
		assert.ok(routesAudio.includes("path === '/api/audio/inputs/start'"), 'handler must exist')
		const startSrc = src('src/audio/live-input-start.js')
		assert.ok(!startSrc.includes('setupLiveAudioInputs'), 'must not fall back to the whole-rig apply')
		assert.ok(!startSrc.includes('setupLiveAudioPgmRoutes'), 'must not re-apply every PGM route')
	})
})

// ---------------------------------------------------------------------------
// 5. WO-284 / WO-293 features must survive
// ---------------------------------------------------------------------------

describe('WO-284/293 regression guard', () => {
	it('VU meters, the silence-vs-no-data badge and the DeckLink strips are untouched', () => {
		for (const rel of [
			'client/components/audio-mixer-panel-live-inputs.js',
			'client/components/audio-mixer-console-live-inputs.js',
		]) {
			const s = src(rel)
			assert.ok(s.includes('data-input-nosignal'), `${rel} keeps the no-signal badge`)
			assert.ok(s.includes('meterMetaForInputRow'), `${rel} keeps feeding the VU meter loop`)
			assert.ok(s.includes('meterFills.set'), `${rel} keeps registering its meter fill`)
			assert.ok(s.includes('enableInputPgmRoute'), `${rel} keeps the per-input PGM routing`)
			assert.ok(s.includes('inputRouteForRow'), `${rel} keeps resolving DeckLink/NDI routes`)
		}
	})

	it('the meter still distinguishes a dead producer from a quiet one', async () => {
		const { inputHasAudioData, mapLevelToMeter, METER_STATE } = await esm('client/lib/audio-input-meter-map.js')
		assert.equal(
			inputHasAudioData({ channelState: { layers: { 10: { type: 'empty' } } }, inputLayer: 10, dbfs: -20 }),
			false,
			'stopped capture layer reads as no-data',
		)
		assert.equal(mapLevelToMeter({ dbfs: -20, hasData: false }).state, METER_STATE.NO_DATA)
		assert.equal(mapLevelToMeter({ dbfs: -80, hasData: true }).state, METER_STATE.SILENT)
		assert.equal(mapLevelToMeter({ dbfs: -20, hasData: true }).state, METER_STATE.SIGNAL)
	})

	it('cross-screen routing still applies to air before it persists', () => {
		const apply = src('client/lib/audio-cross-screen-apply.js')
		const airAt = Math.min(apply.indexOf('playRouteOnChannel('), apply.indexOf('clearRouteFromChannel('))
		assert.ok(airAt > 0)
		assert.ok(apply.indexOf('persistCrossScreenTargets(row') > airAt, 'persist only after the apply')
	})
})
