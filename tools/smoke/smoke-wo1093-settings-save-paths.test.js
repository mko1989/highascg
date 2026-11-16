'use strict'

/**
 * WO-1093 — the compacted Godot Settings tab and the Devices live-audio inspector save through POST /api/settings,
 * whose `newConfig` is HAND-LISTED (WO-619): a section missing there reverts silently on the next config sync. Every
 * section a moved / kept control writes must reach the saved config, and a partial `casparServer` patch (the
 * program-route defaults moved from Settings → Live audio to the Devices inspector) must keep every other key.
 * Also pins the bug that made the old pane useless: POST /api/audio/live-inputs/config drops top-level layer /
 * audio-only / headphone keys (only a nested casparServer is merged).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { handlePost } = require('../../src/api/settings-post')
const audioRoutes = require('../../src/api/routes-audio')

function ctxWith(saved, casparServer = {}) {
	const config = { streaming: {}, ...JSON.parse(JSON.stringify(defaults)) }
	config.casparServer = { ...config.casparServer, ...casparServer }
	return {
		config,
		configManager: {
			get: () => JSON.parse(JSON.stringify(config)),
			save: (c) => {
				saved.push(JSON.parse(JSON.stringify(c)))
				return true
			},
		},
		log: () => {},
	}
}

async function post(body, ctx) {
	const res = await handlePost('/api/settings', JSON.stringify(body), ctx)
	assert.equal(res.status, 200, JSON.stringify(res.body))
}

describe('WO-1093: every section the Godot Settings / Devices controls write is persisted', () => {
	const cases = [
		['Defaults', { editorDefaults: { coordinateOrigin: 'center' } }, (c) => c.editorDefaults.coordinateOrigin, 'center'],
		['Media / USB', { projectScopedMedia: { location: 'exfat' } }, (c) => c.projectScopedMedia.location, 'exfat'],
		['Media / USB', { usbIngest: { verifyHash: true } }, (c) => c.usbIngest.verifyHash, true],
		['Media / USB', { local_media_path: '/tmp/m' }, (c) => c.local_media_path, '/tmp/m'],
		['Companion', { companion: { host: '10.0.0.9', port: 8001 } }, (c) => c.companion.host, '10.0.0.9'],
		['Companion ▸ previews', { composePreview: { mode: 'ffmpeg_jpeg', fps: 12 } }, (c) => c.composePreview.fps, 12],
		['System ▸ start-up', { startup: { mode: 'gui' } }, (c) => c.startup.mode, 'gui'],
		['Nuclear', { ui: { nuclearRequirePassword: true } }, (c) => c.ui.nuclearRequirePassword, true],
	]
	for (const [pane, body, pick, want] of cases) {
		it(`${pane}: ${Object.keys(body)[0]}`, async () => {
			const saved = []
			await post(body, ctxWith(saved))
			assert.equal(saved.length, 1)
			assert.deepEqual(pick(saved[0]), want)
		})
	}
})

describe('WO-1093: the live-audio program-route defaults (Devices inspector) round-trip', () => {
	const before = {
		live_audio_input_count: 1,
		live_audio_input_1_device: 'alsa://hw:3,0',
		live_audio_input_1_pgm_channels: '2',
		live_audio_pgm_always_on: true,
		live_audio_pgm_layer: 2,
		live_audio_pgm_audio_only: true,
	}
	for (const [key, value] of [
		['live_audio_pgm_always_on', false],
		['live_audio_pgm_layer', 4],
		['live_audio_pgm_audio_only', false],
	]) {
		it(`${key} alone is saved and nothing else in casparServer moves`, async () => {
			const saved = []
			const ctx = ctxWith(saved, before)
			await post({ casparServer: { [key]: value } }, ctx)
			const cs = saved[0].casparServer
			assert.equal(cs[key], value)
			for (const [k, v] of Object.entries(before)) if (k !== key) assert.equal(cs[k], v, `${k} kept`)
			assert.equal(ctx.config.casparServer[key], value, 'the running config has it too')
		})
	}

	it('the old Settings → Live audio body lost them: live-inputs/config merges only a nested casparServer', async () => {
		const saved = []
		const ctx = ctxWith(saved, before)
		const flat = { live_audio_input_count: 1, live_audio_input_1_device: 'alsa://hw:3,0', live_audio_pgm_layer: 5,
			live_audio_pgm_audio_only: false, audio_preview_bus: 'multiview' }
		const res = await audioRoutes.handlePost('/api/audio/live-inputs/config', JSON.stringify(flat), ctx)
		assert.equal(res.status, 200)
		const cs = saved.at(-1).casparServer
		assert.equal(cs.live_audio_pgm_layer, 2, 'top-level layer dropped (why the pane is gone, not a fix)')
		assert.equal(cs.live_audio_pgm_audio_only, true, 'top-level audio-only dropped')
	})
})
