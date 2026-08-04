'use strict'

/**
 * WO-237 (updated for the WO-406 follow-up, 03.08.26): the monitor channel uses the
 * CHEAPEST PROGRESSIVE video mode AT THE SCREENS' FRAME RATE — not a fixed 576p2500.
 * A rate-mismatched monitor channel makes route_producer's bounded queue drop every
 * other source frame (and its audio): the owner heard a 50 fps PRV routed into the old
 * 25 fps monitor channel as "weird stuttery noise". Consumer is system-audio (OpenAL),
 * never portaudio (WO-406 §4b: this build's portaudio consumer ignores per-channel params).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { ConfigManager } = require('../../src/config/config-manager')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { getLowestStandardVideoModeIdForFps, STANDARD_VIDEO_MODES } = require('../../src/config/config-modes')
const { inferProjectFpsFromConfig } = require('../../src/config/project-fps')

function loadBoxConfig() {
	const cm = new ConfigManager(path.join(__dirname, '../../config'), {
		info() {},
		warn() {},
		error() {},
	})
	cm.load()
	return cm.get()
}

describe('WO-237/406: monitor channel mode + consumer', () => {
	it('cheapest-mode helper: progressive, rate-matched, 576p2500 fallback', () => {
		assert.equal(getLowestStandardVideoModeIdForFps(50), '720p5000')
		assert.equal(getLowestStandardVideoModeIdForFps(25), '576p2500')
		assert.equal(getLowestStandardVideoModeIdForFps(undefined), '576p2500')
		assert.equal(getLowestStandardVideoModeIdForFps(0), '576p2500')
		// Never an interlaced id (field cadence pops the route queue at half rate again).
		for (const fps of [25, 29.97, 30, 50, 59.94, 60]) {
			assert.doesNotMatch(getLowestStandardVideoModeIdForFps(fps), /\di\d/)
		}
	})

	it('monitor channel block uses the cheapest mode at the screens fps (box config)', () => {
		const cfg = loadBoxConfig()
		cfg.casparServer.monitor_channel_enabled = true
		cfg.casparServer.caspar_build_profile = 'custom_live'
		cfg.casparServer.monitor_portaudio_device = 'sc60mon'

		const flat = buildCasparGeneratorFlatConfig(cfg)
		const xml = buildConfigXml(flat)

		const monitorBlockMatch = xml.match(/<!-- HighAsCG: Caspar channel \d+: Monitor[\s\S]*?<\/channel>/)
		assert.ok(monitorBlockMatch, 'should find monitor channel block')
		const monitorBlock = monitorBlockMatch[0]

		const fps = inferProjectFpsFromConfig(cfg)
		const expectedMode = getLowestStandardVideoModeIdForFps(fps)
		assert.match(
			monitorBlock,
			new RegExp(`<video-mode>${expectedMode}</video-mode>`),
			`monitor channel should use ${expectedMode} for ${fps} fps screens`
		)
		const modeFps = STANDARD_VIDEO_MODES[expectedMode]?.fps
		assert.ok(Math.abs(modeFps - fps) < 0.06, 'monitor mode fps matches the screens fps')

		// system-audio consumer only — no portaudio, no video consumers.
		assert.match(monitorBlock, /<system-audio>/, 'should have system-audio consumer')
		assert.doesNotMatch(monitorBlock, /<portaudio>/, 'must not use portaudio (WO-406 §4b)')
		assert.doesNotMatch(monitorBlock, /<screen>/, 'should not have screen consumer')
		assert.doesNotMatch(monitorBlock, /<decklink>/, 'should not have decklink consumer')
		assert.doesNotMatch(monitorBlock, /<ndi>/, 'should not have ndi consumer')
	})

	it('monitor channel is not emitted when fully disabled', () => {
		const cfg = loadBoxConfig()
		cfg.casparServer.monitor_channel_enabled = false
		cfg.casparServer.caspar_build_profile = 'custom_live'
		// The resolver also enables the bus from a role:'monitor' audioOutputs entry
		// (that is the normal enablement path on this box) — strip those too.
		cfg.audioOutputs = (Array.isArray(cfg.audioOutputs) ? cfg.audioOutputs : []).filter(
			(o) => String(o?.role || '').toLowerCase() !== 'monitor'
		)

		const flat = buildCasparGeneratorFlatConfig(cfg)
		const xml = buildConfigXml(flat)
		assert.doesNotMatch(xml, /Monitor \/ headphone mix/, 'monitor channel should not be present when disabled')
	})

	it('other channels unchanged when monitor channel enabled', () => {
		const cfg = loadBoxConfig()
		cfg.casparServer.caspar_build_profile = 'custom_live'
		cfg.casparServer.monitor_portaudio_device = 'sc60mon'
		cfg.audioOutputs = (Array.isArray(cfg.audioOutputs) ? cfg.audioOutputs : []).filter(
			(o) => String(o?.role || '').toLowerCase() !== 'monitor'
		)

		cfg.casparServer.monitor_channel_enabled = false
		const xml1 = buildConfigXml(buildCasparGeneratorFlatConfig(cfg))

		cfg.casparServer.monitor_channel_enabled = true
		const xml2 = buildConfigXml(buildCasparGeneratorFlatConfig(cfg))

		// NOTE: full byte-equality is impossible here — enabling the monitor bus reallocates
		// the channel index a stored NDI host source had pinned (known WO-406 §5 / WO-377/381
		// renumbering family). The screen channels themselves must be untouched.
		const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const block = (xml, role) => {
			const m = xml.match(new RegExp(`<!-- HighAsCG: Caspar channel \\d+: ${esc(role)}[\\s\\S]*?</channel>`))
			assert.ok(m, `${role} block present`)
			return m[0]
		}
		// Repointed 04.08 (WO-421): the fixed ['Screen 1 program output', 'Screen 1 preview
		// output'] list assumed plain screen mains. A post-produce default config (owner:
		// eggs produce resets config deliberately) has ONLY an operator-GUI main, so the old
		// list made the suite permanently red. Same invariant, asserted on whichever main
		// channel blocks actually exist in the no-monitor XML.
		const mains = [...xml1.matchAll(/<!-- HighAsCG: Caspar channel \d+: ((?:Screen \d+ (?:program|preview) output|Operator GUI)[^\n]*?) -->/g)].map((m) => m[1])
		assert.ok(mains.length > 0, 'at least one main (screen or operator-GUI) channel block present')
		for (const role of mains) {
			assert.equal(block(xml2, role), block(xml1, role), `${role} unchanged by monitor enable`)
		}
	})
})
