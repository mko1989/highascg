'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeVirtualCameraConfig, patchVirtualCameraConfig } = require('../../src/virtual-output/v4l2-bridge-config')
const { validateVirtualCameraConfig } = require('../../src/virtual-output/v4l2-bridge-config-validate')
const { alsaLoopbackCardPresent, effectiveAlsaCardId } = require('../../src/virtual-output/v4l2-bridge-audio-sink')
const { writeVcamModulesConf, VCAM_CONF_PATH } = require('../../src/virtual-output/v4l2-kernel-modules')
const fs = require('fs')
const path = require('path')

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
		// WO-836: VCAM_CONF_PATH is the box's root-wrapper input (/run/highascg/vcam-modules.conf) and a fixed const —
		// capture the write instead of letting the smoke overwrite the live CARD_LABEL.
		const realWrite = fs.writeFileSync
		const realMkdir = fs.mkdirSync
		let written = null
		fs.mkdirSync = (p, ...a) => (String(p) === path.dirname(VCAM_CONF_PATH) ? undefined : realMkdir.call(fs, p, ...a))
		fs.writeFileSync = (p, data, ...a) => {
			if (String(p) !== VCAM_CONF_PATH) return realWrite.call(fs, p, data, ...a)
			written = String(data)
		}
		try {
			writeVcamModulesConf({ virtualCamera: { label: 'Virtual cam' } })
		} finally {
			fs.writeFileSync = realWrite
			fs.mkdirSync = realMkdir
		}
		assert.match(written, /CARD_LABEL="Virtual cam"/)
	})
})
