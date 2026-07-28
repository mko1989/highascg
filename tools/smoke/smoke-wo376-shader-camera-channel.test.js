'use strict'

/**
 * WO-376 — todos28.07.26 (owner):
 *
 *   "some shaders allow camera input. make it possible to route the virtual cam output to the
 *    shaders."
 *   "i need to be able to choose camera from a drop down in shader channels the same way audio is
 *    now implemented. maybe a tick in the virtual camera output inspector to send to shaders as
 *    camera."
 *
 * `camera` is therefore a channel exactly like `audio` — chosen per pass in the modal, fed at
 * runtime by player.js — and it is gated behind an opt-in tick on the virtual camera
 * (`virtualCamera.shaderCamera`), so a shader never silently opens a capture device.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

const { normalizeShaderConfig } = require('../../src/shaderfx/shader-store.js')
const { buildShaderTemplateHtml } = require('../../src/shaderfx/shader-template-export.js')
const { normalizeVirtualCameraConfig } = require('../../src/virtual-output/v4l2-bridge-config.js')

const camShader = (channels) => ({
	id: 'sh-cam',
	name: 'cam',
	passes: { image: { source: 'void mainImage(out vec4 f, in vec2 c){ f = texture(iChannel0, c); }', channels } },
	audio: { enabled: false },
})

test('WO-376 camera survives save/export exactly like audio', async (t) => {
	await t.test('the channel value is not normalised away', () => {
		const cfg = normalizeShaderConfig(camShader(['camera', null, null, null]))
		assert.deepEqual(cfg.passes.image.channels, ['camera', null, null, null])
	})

	await t.test('it reaches the exported template, which is what Caspar plays', () => {
		const html = buildShaderTemplateHtml(normalizeShaderConfig(camShader(['camera', null, null, null])))
		assert.ok(/"channels":\["camera"/.test(html))
	})

	await t.test('camera and audio coexist on different channels', () => {
		const cfg = normalizeShaderConfig({ ...camShader(['camera', null, null, null]), audio: { enabled: true } })
		// WO-375 auto-binds audio to the first FREE image channel — it must not evict camera.
		assert.equal(cfg.passes.image.channels[0], 'camera')
		assert.equal(cfg.passes.image.channels[1], 'audio')
	})

	await t.test('the dropdown offers it (same list the operator picks audio from)', () => {
		const modal = read('client/components/shader-fx-modal.js')
		assert.ok(/CHANNEL_OPTIONS = \['', 'A', 'B', 'C', 'D', 'audio', 'camera'\]/.test(modal))
	})
})

test('WO-376 the virtual camera decides whether shaders may see it', () => {
	assert.equal(normalizeVirtualCameraConfig({}).shaderCamera, false, 'opt-in: OFF by default')
	assert.equal(normalizeVirtualCameraConfig({ shaderCamera: true }).shaderCamera, true)
	assert.equal(normalizeVirtualCameraConfig({ shaderCamera: 1 }).shaderCamera, false, 'strictly true — it opens a device')

	const insp = read('client/components/device-view-inspector-virtual-cam.js')
	assert.ok(/Send to shaders as camera/.test(insp), 'the tick the owner asked for')
	assert.ok(/shaderCamera: !!shaderCamCb\.checked/.test(insp), 'and it is saved')
})

test('WO-376 the player opens a device only behind BOTH gates, and fails soft', () => {
	const player = read('template/shaders/player.js')
	const cam = read('template/shaders/player-camera.js')

	// Gate 1: no pass binds 'camera' → the companion is never even fetched.
	assert.ok(/function usesCameraChannel\(\)/.test(player))
	assert.ok(/if \(usesCameraChannel\(\)\) \{/.test(player))
	// Gate 2: the owner's tick, read from the live virtual-camera config.
	assert.ok(/vc\.shaderCamera === true/.test(cam))
	assert.ok(/if \(!enabled\) return false/.test(cam))
	// Thumbnails have no capture device (WO-344).
	assert.ok(/if \(THUMB_MODE\) return false/.test(cam))

	// Fail-soft: registered black up-front so the pass compiles and renders with no device.
	assert.ok(/new Uint8Array\(\[0, 0, 0, 255\]\)/.test(cam))
	assert.ok(/toy\.addTexture\(cameraTexture, 'camera', 1, 1\)/.test(cam))
	assert.ok(/return false \/\/ denied \/ busy \/ absent/.test(cam))

	// Per-frame upload alongside the audio one, and iChannelResolution kept truthful.
	assert.ok(/updateAudio\(\)\s*\n\s*if \(cameraFeed\) cameraFeed\.update\(\)/.test(player))
	assert.ok(/toy\.addTexture\(cameraTexture, 'camera', cameraSize\[0\], cameraSize\[1\]\)/.test(cam))
	assert.ok(/UNPACK_FLIP_Y_WEBGL/.test(cam), 'video textures are y-flipped vs GL')

	// The split must not break already-exported templates: lazy, relative, and null-safe.
	assert.ok(/el\.src = 'player-camera\.js'/.test(player))
	assert.ok(/el\.onerror = \(\) => resolve\(null\)/.test(player), 'a missing companion is not an error')
	assert.ok(/if \(!mod\) return/.test(player))
	assert.ok(!/\bconfig\.passes\b/.test(cam), 'the companion must not reference player.js scope')
})
