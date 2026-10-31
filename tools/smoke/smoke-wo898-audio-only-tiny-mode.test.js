'use strict'

/**
 * WO-898: every audio-only Caspar channel (live ALSA input, default extra-audio output, monitor bus) runs the tiny
 * `64x36` custom video mode registered at EXACTLY the rate of the main channels its audio is routed to/from —
 * cheap (9 KB readback per tick instead of 8.3 MB at 1080p) and route://-safe (a rate mismatch drops or repeats
 * every other frame's audio: the WO-237/WO-406 chop). Fractional rates use Caspar's N*1000/1001 timing with its
 * own cadence lists, or server.cpp rejects the mode and Caspar does not start.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { getChannelMap } = require('../../src/config/routing')
const { clone, addMockGraph, addMainDestinations } = require('./lib/config-generator-routing-fixtures')
const { videoModeTiming, audioOnlyModeDimensions, AUDIO_ONLY_MODE_ID } = require('../../src/config/audio-only-channel-mode')
const { buildChannelResolutionMap } = require('../../src/config/server-info-config')
const { collectComposePreviewChannelsFromMap } = require('../../src/preview/compose-preview-mode')
const { pushCustomMode } = require('../../src/config/config-generator-custom-modes')
const { buildChannelPlan } = require('../../src/config/config-generator-channel-plan')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** Caspar's own check (shell/server.cpp): sum(cadence) * time-scale == 48000 * duration * len(cadence). */
function casparAcceptsCadence(timeScale, duration, cadence) {
	const sum = cadence.reduce((a, b) => a + b, 0)
	return sum * timeScale === 48000 * duration * cadence.length
}

/** Box-shaped fixture: one PGM/PRV main at `mode`, one live ALSA input, one extra-audio channel. */
function fixture(mode, fps) {
	const app = clone(defaults)
	app.screen_count = 1
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		screen_1_mode: mode,
		multiview_enabled: false,
		decklink_input_count: 1,
		live_audio_input_count: 1,
		live_audio_input_1_device: 'alsa://hw:3,0',
		// What both clients save today (no picker; hardcoded fallback) — must not matter.
		live_audio_inputs_channel_mode: '1080p5000',
		live_audio_input_channel_mode: '1080p5000',
		decklink_inputs_host: 'dedicated',
	}
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	addMockGraph(app)
	addMainDestinations(app, 1)
	Object.assign(app.screenDestinations.destinations[0], { videoMode: mode, fps })
	return app
}

/**
 * Extra-audio channels are dormant on real boxes: buildConfigXml's mergeAudioRoutingIntoConfig forces
 * extra_audio_channel_count to 0 ("removed from Settings UI"). Cover their mode at the plan level instead.
 */
function extraAudioPlanDims(flat) {
	const cfg = { ...flat, extra_audio_channel_count: 1 }
	return buildChannelPlan(cfg, getChannelMap(cfg)).extraAudio[0].dims
}

/** @returns {Map<number, string>} channel number → `<video-mode>` id, in emitted order */
function channelModes(xml) {
	const out = new Map()
	const body = xml.match(/<channels>([\s\S]*?)<\/channels>/)[1]
	let n = 0
	for (const m of body.matchAll(/<channel>\s*<video-mode>([^<]+)<\/video-mode>/g)) out.set(++n, m[1])
	return out
}

function registration(xml, id) {
	const re = new RegExp(`<video-mode>\\s*<id>${id}</id>\\s*<width>(\\d+)</width>\\s*<height>(\\d+)</height>\\s*<time-scale>(\\d+)</time-scale>\\s*<duration>(\\d+)</duration>\\s*<cadence>([^<]+)</cadence>`, 'g')
	return [...xml.matchAll(re)].map((m) => ({
		width: +m[1], height: +m[2], timeScale: +m[3], duration: +m[4], cadence: m[5].trim().split(/[ ,]+/).map(Number),
	}))
}

const PROJECTS = [
	{ mode: '1080p5000', fps: 50, timeScale: 50000, duration: 1000, cadence: [960] },
	{ mode: '1080p2500', fps: 25, timeScale: 25000, duration: 1000, cadence: [1920] },
	{ mode: '1080p2997', fps: 29.97, timeScale: 30000, duration: 1001, cadence: [1602, 1601, 1602, 1601, 1602] },
	{ mode: '1080p5994', fps: 59.94, timeScale: 60000, duration: 1001, cadence: [801, 800, 801, 801, 801] },
]

describe('WO-898: audio-only channels — tiny mode at the PGM rate', () => {
	it('timing table: exact Caspar rationals, every cadence passes server.cpp', () => {
		for (const p of PROJECTS) {
			const t = videoModeTiming(p.fps)
			assert.deepEqual([t.timeScale, t.duration, t.cadence], [p.timeScale, p.duration, p.cadence], `${p.fps} fps`)
			assert.ok(casparAcceptsCadence(t.timeScale, t.duration, t.cadence), `${p.fps} cadence valid`)
		}
		assert.equal(videoModeTiming(23.98).duration, 1001)
		assert.deepEqual(videoModeTiming(23.98).cadence, [2002])
		assert.equal(videoModeTiming(0), null)
		assert.equal(videoModeTiming(47.3), null, 'no valid cadence → null (caller falls back)')
		const fb = audioOnlyModeDimensions(undefined)
		assert.deepEqual([fb.modeId, fb.width, fb.height, fb.timeScale], [AUDIO_ONLY_MODE_ID, 64, 36, 50000])
	})

	for (const p of PROJECTS) {
		it(`${p.fps} fps project: ALSA input + extra audio on 64x36 registered at ${p.timeScale}/${p.duration}`, () => {
			const flat = buildCasparGeneratorFlatConfig(fixture(p.mode, p.fps))
			const map = getChannelMap(flat)
			const xml = buildConfigXml(flat)
			const modes = channelModes(xml)

			const pgm = map.programCh(1)
			assert.equal(modes.get(pgm), p.mode, 'PGM keeps the project mode')
			const live = map.inputChannels.find((e) => e.kind === 'live_audio')
			assert.equal(live.mode, AUDIO_ONLY_MODE_ID, 'channel map entry (config-compare / clients) says 64x36')
			assert.equal(modes.get(live.channel), AUDIO_ONLY_MODE_ID, 'live ALSA channel emitted at 64x36')
			const dl = map.inputChannels.find((e) => e.kind === 'decklink')
			assert.notEqual(modes.get(dl.channel), AUDIO_ONLY_MODE_ID, 'DeckLink input keeps its full mode')
			const extra = extraAudioPlanDims(flat)
			assert.equal(extra.modeId, AUDIO_ONLY_MODE_ID, 'default extra-audio channel at 64x36')
			assert.equal(extra.timeScale, p.timeScale, 'extra audio at the same rate (one shared registration)')

			const regs = registration(xml, AUDIO_ONLY_MODE_ID)
			assert.equal(regs.length, 1, 'registered exactly once (Caspar throws on a duplicate id)')
			const r = regs[0]
			assert.deepEqual([r.width, r.height, r.timeScale, r.duration, r.cadence], [64, 36, p.timeScale, p.duration, p.cadence])
			assert.ok(casparAcceptsCadence(r.timeScale, r.duration, r.cadence))
			assert.ok(Math.abs(r.timeScale / r.duration - p.fps) < 0.01, 'same rate as PGM — no route:// chop')
		})
	}

	it('the monitor bus shares the one registration (same rate source)', () => {
		const app = fixture('1080p2500', 25)
		app.casparServer.monitor_channel_enabled = true
		app.casparServer.caspar_build_profile = 'custom_live'
		const flat = buildCasparGeneratorFlatConfig(app)
		const xml = buildConfigXml(flat)
		const mon = xml.match(/Monitor \/ headphone mix[\s\S]*?<video-mode>([^<]+)<\/video-mode>/)
		assert.ok(mon, 'monitor channel emitted')
		assert.equal(mon[1], AUDIO_ONLY_MODE_ID)
		const regs = registration(xml, AUDIO_ONLY_MODE_ID)
		assert.equal(regs.length, 1)
		assert.equal(regs[0].timeScale, 25000)
	})

	it('explicit extra_audio_N_video_mode is still honoured', () => {
		const flat = buildCasparGeneratorFlatConfig(fixture('1080p5000', 50))
		flat.extra_audio_1_video_mode = '720p5000'
		assert.equal(extraAudioPlanDims(flat).modeId, '720p5000')
	})

	it('custom screen at 59.94 registers a Caspar-valid cadence (was 59940/1000 + 801 → refused start)', () => {
		const out = []
		pushCustomMode(out, new Set(), { modeId: '3840x1792', width: 3840, height: 1792, fps: 59.94 })
		const r = registration(out[0], '3840x1792')[0]
		assert.deepEqual([r.timeScale, r.duration, r.cadence], [60000, 1001, [801, 800, 801, 801, 801]])
		assert.ok(casparAcceptsCadence(r.timeScale, r.duration, r.cadence))
		const out50 = []
		pushCustomMode(out50, new Set(), { modeId: '3840x1792', width: 3840, height: 1792, fps: 50 })
		assert.match(out50[0], /<time-scale>50000<\/time-scale>\s*<duration>1000<\/duration>\s*<cadence>960<\/cadence>/, 'integer rates unchanged')
	})

	it('INFO CONFIG: a 64x36 channel reports its registered rate, not the WxH default 50', () => {
		const xml = `<configuration><channels><channel><video-mode>1080p2500</video-mode></channel>
			<channel><video-mode>64x36</video-mode><channel-layout>stereo</channel-layout></channel></channels>
			<video-modes><video-mode><id>64x36</id><width>64</width><height>36</height><time-scale>25000</time-scale>
			<duration>1000</duration><cadence>1920</cadence></video-mode></video-modes></configuration>`
		assert.deepEqual(buildChannelResolutionMap(xml)[2], { w: 64, h: 36, fps: 25 })
	})

	it('compose preview never attaches a JPEG consumer to a live ALSA channel', () => {
		const map = getChannelMap(buildCasparGeneratorFlatConfig(fixture('1080p5000', 50)))
		const chans = collectComposePreviewChannelsFromMap(map)
		const live = map.inputChannels.find((e) => e.kind === 'live_audio').channel
		const dl = map.inputChannels.find((e) => e.kind === 'decklink').channel
		assert.ok(!chans.includes(live), 'audio-only input excluded')
		assert.ok(chans.includes(dl), 'DeckLink input still previewed')
	})

	it('source pins: generator wiring', () => {
		const channels = read('src/config/config-generator-channels.js')
		assert.match(channels, /pushCustomMode\(customVideoModes, customModeIds, plan\.audioOnlyDims\)/)
		assert.match(channels, /buildInputChannel\(config, \{ \.\.\.entry, mode: plan\.audioOnlyDims\.modeId \}, customModeIds\)/)
		const plan = read('src/config/config-generator-channel-plan.js')
		assert.match(plan, /audioOnlyModeDimensions\(screens\[0\]\?\.dims\?\.fps \?\? operatorGuis\[0\]\?\.dims\?\.fps\)/)
		const routing = read('src/config/routing-map.js')
		assert.match(routing, /const liveAudioInputMode = require\('\.\/audio-only-channel-mode'\)\.AUDIO_ONLY_MODE_ID/)
	})
})
