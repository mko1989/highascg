'use strict'

/**
 * WO-284 / WO-293 — audio mixer: DeckLink input strips, per-input VU meters, cross-screen routing.
 *
 * Offline only: pure ESM client modules loaded through import(), plus source asserts on the two
 * mixer components. No Caspar, no OSC socket, no network, no DOM.
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

const inputChannelsP = esm('client/lib/input-channels.js')
const meterMapP = esm('client/lib/audio-input-meter-map.js')
const crossScreenP = esm('client/lib/audio-cross-screen-routing.js')

/** Shape produced by src/config/routing-map.js getChannelMap(): PGM 1/2, DeckLink 4..6, ALSA 7. */
const CHANNEL_MAP = {
	programChannels: [1, 2],
	previewChannels: [3, null],
	decklinkInputChannels: [4, 5, 6],
	liveAudioInputChannels: [7],
	v4l2InputChannels: [8],
	inputChannels: [
		{ kind: 'decklink', slot: 1, channel: 4, layer: 1, route: 'route://4-1', label: 'DeckLink 1' },
		{ kind: 'decklink', slot: 2, channel: 5, layer: 2, route: 'route://5-2', label: 'DeckLink 2' },
		{ kind: 'decklink', slot: 4, channel: 6, layer: 4, route: 'route://6-4', label: 'DeckLink 4' },
		{ kind: 'live_audio', slot: 1, channel: 7, layer: 10, route: 'route://7', label: 'Live audio 1' },
		{ kind: 'v4l2', slot: 1, channel: 8, layer: 1, route: 'route://8-1', label: 'USB video 1' },
		{ kind: 'browser_display', slot: 0, channel: 9, layer: 1, route: 'route://9-1', label: 'Desktop' },
	],
}

// ---------------------------------------------------------------------------
// 1. Input enumeration (WO-293 root cause)
// ---------------------------------------------------------------------------

describe('WO-293: audio-capable input enumeration', () => {
	it('includes DeckLink inputs — the bug was a live_audio-only filter', async () => {
		const { listAudioInputChannels } = await inputChannelsP
		const rows = listAudioInputChannels(CHANNEL_MAP)
		const kinds = rows.map((r) => r.kind)
		assert.ok(kinds.includes('decklink'), `DeckLink inputs must be enumerated, got: ${JSON.stringify(kinds)}`)

		const decklinks = rows.filter((r) => r.kind === 'decklink')
		assert.equal(decklinks.length, 3)
		assert.deepEqual(
			decklinks.map((r) => r.channel),
			[4, 5, 6],
		)
		// Regression fence: the pre-fix filter produced exactly one row.
		const legacy = rows.filter((r) => r.kind === 'live_audio')
		assert.equal(legacy.length, 1)
		assert.notEqual(rows.length, legacy.length, 'enumeration must no longer collapse to live_audio only')
	})

	it('excludes video-only input kinds', async () => {
		const { listAudioInputChannels, inputKindHasAudio } = await inputChannelsP
		const kinds = listAudioInputChannels(CHANNEL_MAP).map((r) => r.kind)
		assert.ok(!kinds.includes('v4l2'), 'v4l2 producer is video-only')
		assert.ok(!kinds.includes('browser_display'), 'screen scrape is video-only')
		assert.equal(inputKindHasAudio('decklink'), true)
		assert.equal(inputKindHasAudio('live_audio'), true)
		assert.equal(inputKindHasAudio('ndi_host'), true)
		assert.equal(inputKindHasAudio('v4l2'), false)
		assert.equal(inputKindHasAudio(null), false)
	})

	it('synthesizes DeckLink inputs from the legacy array map (no inputChannels)', async () => {
		const { listAudioInputChannels } = await inputChannelsP
		const legacyMap = { decklinkCount: 2, decklinkInputChannels: [4, 5], liveAudioCount: 0 }
		const rows = listAudioInputChannels(legacyMap)
		assert.equal(rows.length, 2)
		assert.deepEqual(
			rows.map((r) => r.channel),
			[4, 5],
		)
	})

	it('the mixer row collector enumerates through listAudioInputChannels', () => {
		const rows = src('client/lib/audio-mixer-rows.js')
		assert.ok(rows.includes('listAudioInputChannels'), 'collectLiveInputMeterRows must use the shared enumeration')
		assert.ok(
			!/\.filter\(\s*\(entry\)\s*=>\s*entry\.kind === 'live_audio'\s*\)/.test(rows),
			'the live_audio-only filter must be gone',
		)
	})
})

// ---------------------------------------------------------------------------
// 2. Level → meter mapping, incl. silence vs no-data
// ---------------------------------------------------------------------------

describe('WO-284: level → meter mapping', () => {
	it('silence and no-data are DIFFERENT states', async () => {
		const { mapLevelToMeter, METER_STATE } = await meterMapP

		const noData = mapLevelToMeter({ dbfs: null })
		const silent = mapLevelToMeter({ dbfs: -99, hasData: true })

		assert.equal(noData.state, METER_STATE.NO_DATA)
		assert.equal(silent.state, METER_STATE.SILENT)
		assert.notEqual(noData.state, silent.state)
		// Both draw an empty bar — the STATE is what the strip styles on.
		assert.equal(noData.aim, 0)
		assert.equal(silent.aim, 0)
	})

	it('a live channel whose producer is dead reads no-data even with a level', async () => {
		const { mapLevelToMeter, METER_STATE } = await meterMapP
		const res = mapLevelToMeter({ dbfs: -120, hasData: false })
		assert.equal(res.state, METER_STATE.NO_DATA)
	})

	it('maps levels onto the 0..1 meter scale', async () => {
		const { mapLevelToMeter, METER_STATE, METER_FLOOR_DBFS } = await meterMapP
		assert.equal(METER_FLOOR_DBFS, -60)

		assert.equal(mapLevelToMeter({ dbfs: -70 }).state, METER_STATE.SILENT, 'below floor is silence')
		assert.equal(mapLevelToMeter({ dbfs: -60 }).state, METER_STATE.SILENT, 'exactly at floor is silence')

		const half = mapLevelToMeter({ dbfs: -30 })
		assert.equal(half.state, METER_STATE.SIGNAL)
		assert.ok(Math.abs(half.aim - 0.5) < 1e-12, `expected aim 0.5, got ${half.aim}`)
		assert.equal(half.clip, false)

		const top = mapLevelToMeter({ dbfs: 0 })
		assert.equal(top.aim, 1)
		assert.equal(top.clip, true)

		assert.equal(mapLevelToMeter({ dbfs: -0.5 }).clip, true)
		assert.equal(mapLevelToMeter({ dbfs: -2 }).clip, false)
		assert.equal(mapLevelToMeter({ dbfs: 12 }).aim, 1, 'over-unity clamps')
	})

	it('a muted input reads silent, not dead', async () => {
		const { mapLevelToMeter, METER_STATE } = await meterMapP
		assert.equal(mapLevelToMeter({ dbfs: -6, muted: true }).state, METER_STATE.SILENT)
	})

	it('inputHasAudioData: no OSC record at all is no-data', async () => {
		const { inputHasAudioData } = await meterMapP
		assert.equal(inputHasAudioData({ channelState: null, dbfs: null }), false)
		assert.equal(inputHasAudioData({}), false)
	})

	it('inputHasAudioData: DeckLink 4 with a powered-off camera has no producer layer', async () => {
		const { inputHasAudioData } = await meterMapP
		// Channel exists and Caspar keeps emitting its bus at -inf, but layer 4 is empty.
		const channelState = {
			audio: { nbChannels: 2, levels: [{ dBFS: -120 }, { dBFS: -120 }] },
			layers: { 1: { type: 'decklink' }, 4: { type: 'empty' } },
		}
		assert.equal(inputHasAudioData({ channelState, inputLayer: 4, dbfs: -120 }), false)
		assert.equal(inputHasAudioData({ channelState, inputLayer: 1, dbfs: -120 }), true)
		// Missing layer row entirely is equally dead.
		assert.equal(inputHasAudioData({ channelState, inputLayer: 9, dbfs: -120 }), false)
	})

	it('inputHasAudioData: never judges by layer when OSC reports no layers at all', async () => {
		const { inputHasAudioData } = await meterMapP
		const channelState = { audio: { levels: [{ dBFS: -35 }] }, layers: {} }
		assert.equal(
			inputHasAudioData({ channelState, inputLayer: 10, dbfs: -35 }),
			true,
			'a build that never emits stage/layer OSC must not mark every input dead',
		)
	})

	it('inputHasAudioData: alive producer with no sample yet still counts as data', async () => {
		const { inputHasAudioData } = await meterMapP
		const channelState = {
			audio: { levels: [{ dBFS: -50 }] },
			layers: { 10: { type: 'ffmpeg', file: { path: 'alsa://hw:1' } } },
		}
		assert.equal(inputHasAudioData({ channelState, inputLayer: 10, dbfs: null }), true)
	})

	it('the meter loop consumes the mapping and guards its DOM writes', () => {
		const loop = src('client/lib/audio-mixer-meter-loop.js')
		assert.ok(loop.includes('mapLevelToMeter'), 'loop must use the shared mapping')
		assert.ok(loop.includes('_lastMeterState'), 'meter state must be change-guarded')
		assert.ok(loop.includes('_lastBg'), 'background writes must be change-guarded')
		assert.ok(!loop.includes('getBoundingClientRect'), 'no per-frame layout reads')
		assert.ok(loop.includes('document.hidden'), 'no work while the document is hidden')
	})

	it('levels come from the OSC state already received (no new subscription)', () => {
		const peaks = src('client/lib/audio-mixer-peaks.js')
		assert.ok(peaks.includes('readInputChannelMeterSample'))
		assert.ok(peaks.includes('readBusPeakDbfsOrNull'))
		// Still reading the same oscClient.channels[..].audio.levels snapshot as before.
		assert.ok(peaks.includes('audio?.levels'))
	})
})

// ---------------------------------------------------------------------------
// 3. Cross-screen routing validation
// ---------------------------------------------------------------------------

describe('WO-284: cross-screen audio routing validation', () => {
	const BASE = { sourceChannel: 1, sourceLayer: 20, programChannels: [1, 2], channelMap: CHANNEL_MAP }

	it('accepts another program channel and yields a route + dest layer', async () => {
		const { validateCrossScreenAudioTarget } = await crossScreenP
		const res = validateCrossScreenAudioTarget({ ...BASE, targetChannel: 2 })
		assert.equal(res.ok, true)
		assert.equal(res.route, 'route://1-20')
		assert.equal(res.targetChannel, 2)
		assert.equal(typeof res.destLayer, 'number')
		assert.ok(res.destLayer > 300, 'dest layer sits above look/timeline layers')
	})

	it('rejects the host channel', async () => {
		const { validateCrossScreenAudioTarget } = await crossScreenP
		assert.deepEqual(validateCrossScreenAudioTarget({ ...BASE, targetChannel: 1 }), {
			ok: false,
			reason: 'host-channel',
		})
	})

	it('rejects non-program channels and capture/input channels', async () => {
		const { validateCrossScreenAudioTarget } = await crossScreenP
		// Preview channel: real channel, not a program destination.
		assert.equal(validateCrossScreenAudioTarget({ ...BASE, targetChannel: 3 }).reason, 'not-a-program-channel')
		// A DeckLink capture channel is not an audio destination — and is not a program channel
		// either, so the program-membership rule fences it first.
		assert.equal(validateCrossScreenAudioTarget({ ...BASE, targetChannel: 4 }).reason, 'not-a-program-channel')
		// Explicit input-channel fence: a map that (wrongly) lists a capture channel as program.
		const bad = validateCrossScreenAudioTarget({
			...BASE,
			programChannels: [1, 2, 4],
			targetChannel: 4,
		})
		assert.equal(bad.ok, false)
		assert.equal(bad.reason, 'not-an-audio-destination')
	})

	it('rejects malformed source/target', async () => {
		const { validateCrossScreenAudioTarget } = await crossScreenP
		assert.equal(validateCrossScreenAudioTarget({ ...BASE, sourceChannel: 0, targetChannel: 2 }).reason, 'invalid-source-channel')
		assert.equal(validateCrossScreenAudioTarget({ ...BASE, sourceLayer: NaN, targetChannel: 2 }).reason, 'invalid-source-layer')
		assert.equal(validateCrossScreenAudioTarget({ ...BASE, targetChannel: 'x' }).reason, 'invalid-target-channel')
	})

	it('dest layers are deterministic and collision-free across sources', async () => {
		const { crossScreenDestLayer } = await crossScreenP
		assert.equal(crossScreenDestLayer(1, 20), crossScreenDestLayer(1, 20), 'stable across calls')
		const seen = new Set()
		for (let ch = 1; ch <= 12; ch++) {
			for (const ln of [1, 10, 20, 110, 210, 999]) {
				const layer = crossScreenDestLayer(ch, ln)
				assert.ok(layer > 300, 'above look/timeline bands')
				assert.ok(!seen.has(layer), `collision at ch=${ch} layer=${ln}`)
				seen.add(layer)
			}
		}
		assert.equal(crossScreenDestLayer(0, 1), null)
		assert.equal(crossScreenDestLayer(1, 0), null)
		assert.equal(crossScreenDestLayer(1, 1000), null)
	})

	it('target lists normalize, dedupe and sort', async () => {
		const { nextCrossScreenTargets, parseCrossScreenTargets } = await crossScreenP
		assert.deepEqual(parseCrossScreenTargets(null), [])
		assert.deepEqual(parseCrossScreenTargets(['3', 2, 2, 0, -1, 'x']), [2, 3])
		assert.deepEqual(nextCrossScreenTargets([2], 3, true), [2, 3])
		assert.deepEqual(nextCrossScreenTargets([2, 3], 3, true), [2, 3], 'enable is idempotent')
		assert.deepEqual(nextCrossScreenTargets([2, 3], 3, false), [2])
		assert.deepEqual(nextCrossScreenTargets([2], 9, false), [2], 'disabling an absent target is a no-op')
	})

	it('the UI block is gone and the buttons are validated, not hard-disabled', () => {
		for (const rel of [
			'client/components/audio-mixer-panel-input-layers.js',
			'client/components/audio-mixer-console-input-groups.js',
		]) {
			const s = src(rel)
			assert.ok(!s.includes('planned (WO-157)'), `${rel} still carries the placeholder block`)
			assert.ok(s.includes('validateCrossScreenAudioTarget'), `${rel} must validate destinations`)
			assert.ok(s.includes('data-cross-screen'), `${rel} must emit routable buttons`)
		}
	})

	it('routing persists through the same patchLayer path as sibling mixer settings', () => {
		const apply = src('client/lib/audio-cross-screen-apply.js')
		assert.ok(apply.includes('sceneState.patchLayer'), 'must use the scene layer persistence path')
		assert.ok(apply.includes('audioScreens'))
		// Apply-to-air must happen before persistence, so a failed AMCP records nothing.
		const airAt = Math.min(apply.indexOf('playRouteOnChannel('), apply.indexOf('clearRouteFromChannel('))
		assert.ok(airAt > 0)
		assert.ok(apply.indexOf('persistCrossScreenTargets(row') > airAt, 'persist only after the apply')
	})

	it('nothing routes as a side effect of rendering', () => {
		const bind = src('client/components/audio-mixer-cross-screen-bind.js')
		assert.ok(bind.includes("addEventListener('click'"), 'apply is click-driven only')
		assert.ok(bind.includes("dataset.busy"), 'single-flight guard against retry storms')
	})
})
