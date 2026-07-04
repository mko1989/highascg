'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeVirtualCameraConfig, patchVirtualCameraConfig } = require('../../src/virtual-output/v4l2-bridge-config')
const { validateVirtualCameraConfig } = require('../../src/virtual-output/v4l2-bridge-config-validate')
const { alsaLoopbackCardPresent, effectiveAlsaCardId } = require('../../src/virtual-output/v4l2-bridge-audio-sink')
const { writeVcamModulesConf, VCAM_CONF_PATH } = require('../../src/virtual-output/v4l2-kernel-modules')
const fs = require('fs')

describe('virtual-camera config', () => {
	it('defaults enabled false', () => {
		const vc = normalizeVirtualCameraConfig({})
		assert.equal(vc.enabled, false)
		assert.equal(vc.device, '/dev/video10')
		assert.equal(vc.audioEnabled, true)
	})

	it('validates device path', () => {
		const bad = validateVirtualCameraConfig({ device: '/tmp/not-video' })
		assert.equal(bad.ok, false)
		assert.ok(bad.errors.some((e) => e.includes('/dev/video')))
	})

	it('patches and normalizes fps/resolution', () => {
		const next = patchVirtualCameraConfig({}, { fps: 50, width: 1920, height: 1080, channel: 2 })
		assert.equal(next.channel, 2)
		assert.equal(next.fps, 50)
		assert.equal(next.width, 1920)
	})

	it('detects ALSA loopback card with underscore-normalized id', () => {
		assert.equal(effectiveAlsaCardId('HighAsCG_VCam'), 'HighAsCGVCam')
		// Live box may or may not have the card loaded — function must not throw.
		assert.equal(typeof alsaLoopbackCardPresent('HighAsCG_VCam'), 'boolean')
	})

	it('quotes CARD_LABEL with spaces for shell conf', () => {
		writeVcamModulesConf({ virtualCamera: { label: 'Virtual cam' } })
		const body = fs.readFileSync(VCAM_CONF_PATH, 'utf8')
		assert.match(body, /CARD_LABEL="Virtual cam"/)
	})
})
