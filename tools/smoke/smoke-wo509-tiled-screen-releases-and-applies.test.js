'use strict'

/**
 * WO-509 — the tiled-screen carve-out caused BOTH reported generator regressions.
 *
 * Owner 13.08 (`todos13.08.26`):
 *   *"the yuv setting in decklink output doesnt land in the generated caspar config."*
 *   *"the config generator doesnt register that a connection has been changed and tries to run two
 *    channels on the same decklink outputs."*
 *
 * One root cause. A tiled (LED-wall) screen owns its card through `screen_N_decklink_tiles` rather
 * than `screen_N_decklink_device`, and the code special-cased that in two places:
 *
 *  1. `releaseDecklinkDeviceFromOtherTargets` did `continue` on a tiled screen, so it NEVER released.
 *     Move the cable to another screen and both keep the claim — measured on the box as ch1 and ch3
 *     each emitting `<device>1</device>`, which Caspar cannot open twice.
 *  2. `assignDecklinkToScreen` did an early `return` on a tiled screen, BEFORE
 *     `applyDecklinkConsumerSettingsFromConnector` — so `screen_N_decklink_pixel_format` was never
 *     written and the operator's YUV choice had nothing to emit from.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const SRC = code(read('src/config/build-caspar-generator-config-decklink.js'))

const release = /function releaseDecklinkDeviceFromOtherTargets\([\s\S]*?\n\t\}/.exec(SRC)
const assign = /function assignDecklinkToScreen\([\s\S]*?\n\t\}/.exec(SRC)

test('WO-509: the release path exists and no longer skips tiled screens outright', () => {
	assert.ok(release, 'releaseDecklinkDeviceFromOtherTargets must exist')
	assert.doesNotMatch(
		release[0],
		/if \(Array\.isArray\(tiles\) && tiles\.length > 0\) continue/,
		'THE BUG: an unconditional `continue` meant a tiled screen never gave up its card',
	)
})

test('WO-509: release drops only the tiles bound to the moved device', () => {
	assert.match(release[0], /tiles\.filter\(/, 'must filter tiles rather than clear them wholesale')
	assert.match(
		release[0],
		/!==\s*devNum/,
		'a multi-card wall must keep the tiles pointing at its OTHER devices',
	)
})

test('WO-509: emptying the tile list also clears the device keys', () => {
	assert.match(release[0], /kept\.length === 0/, 'a wall with no tiles left must release the key too')
	assert.match(release[0], /decklink_replace_screen`\] = false/, 'and stop replacing the screen consumer')
})

test('WO-509: a tiled screen still receives its consumer settings', () => {
	assert.ok(assign, 'assignDecklinkToScreen must exist')
	const tiledBranch = /if \(Array\.isArray\(existingTiles\) && existingTiles\.length > 0\) \{([\s\S]*?)\n\t\t\}/.exec(
		assign[0],
	)
	assert.ok(tiledBranch, 'the tiled branch must still exist — the device KEY must not be set for tiles')
	assert.match(
		tiledBranch[1],
		/applyDecklinkConsumerSettingsFromConnector\(merged, `screen_\$\{n\}_`, connector\)/,
		'THE BUG: returning early skipped this, so pixel-format was never written for a tiled output',
	)
	assert.match(tiledBranch[1], /applyDecklinkKeyFillFromConnector/, 'key/fill settings belong to it too')
})

test('WO-509: a tiled screen still does NOT take the device key', () => {
	const tiledBranch = /if \(Array\.isArray\(existingTiles\) && existingTiles\.length > 0\) \{([\s\S]*?)\n\t\t\}/.exec(
		assign[0],
	)[1]
	assert.doesNotMatch(
		tiledBranch,
		/merged\[`screen_\$\{n\}_decklink_device`\] = devNum/,
		'tiles own the device; setting the flat key as well would double-claim it',
	)
})

test('WO-509: the flat pixel-format key still reaches the generated XML (end to end)', () => {
	const { buildScreenPairChannels } = require('../../src/config/config-generator-consumer-attach-screen.js')
	const RM = { programCh: () => 1, previewCh: () => 2, programChannels: [1], previewChannels: [2] }
	const CTX = { n: 1, dims: { width: 1920, height: 1080 }, cumulativeX: 0, nextDevice: 1 }
	const cfg = {
		caspar_build_profile: 'custom_live',
		screen_1_decklink_device: 1,
		screen_1_decklink_pixel_format: 'yuv',
	}
	assert.match(JSON.stringify(buildScreenPairChannels(cfg, RM, { ...CTX })), /pixel-format>yuv</)
})

/**
 * WO-514 — a tiled screen must also RELEASE the device from other targets.
 *
 * Owner 13.08, third report: *"ch3 still sets itself to 2160p and has a decklink consumer even
 * nothing like that exists in devices view."* WO-509 made the tiled branch apply consumer settings,
 * but it still returned before `releaseDecklinkDeviceFromOtherTargets`. So when a tiled wall
 * legitimately owns a device, a stale `screen_M_decklink_device` pointing at the same card survived
 * — emitting a second consumer AND dragging the wall's UHD output mode onto a 1080p destination.
 */

test('WO-514: the tiled branch releases the device from other targets', () => {
	const tiled = /if \(Array\.isArray\(existingTiles\) && existingTiles\.length > 0\) \{([\s\S]*?)\n\t\t\}/.exec(
		/function assignDecklinkToScreen\([\s\S]*?\n\t\}/.exec(SRC)[0],
	)[1]
	assert.match(
		tiled,
		/releaseDecklinkDeviceFromOtherTargets\(devNum, n\)/,
		'THE BUG: returning without releasing left a second channel claiming the same card',
	)
})

test('WO-514: end to end — a tiled wall clears another screen stale claim on the same card', () => {
	const { applyDecklinkOverridesToScreens } = require('../../src/config/build-caspar-generator-config-decklink.js')
	const merged = {
		// The wall owns DeckLink 1 through its tiles…
		screen_1_decklink_tiles: [{ device: 1, videoMode: '2160p5000', width: 3840, height: 2160 }],
		// …while a fossil still points screen 2 at the same card, with the wall's UHD mode.
		screen_2_decklink_device: 1,
		screen_2_decklink_replace_screen: true,
	}
	applyDecklinkOverridesToScreens(merged, {
		deviceGraph: {
			connectors: [
				{
					id: 'dlsdi_1',
					kind: 'decklink_io',
					externalRef: '1',
					caspar: { ioDirection: 'out', outputBinding: { type: 'screen', index: 1 }, bindingSource: 'manual' },
				},
			],
			edges: [],
		},
	})
	assert.equal(
		parseInt(String(merged.screen_2_decklink_device || '0'), 10) || 0,
		0,
		'the fossil claim on screen 2 must be gone — one card, one channel',
	)
	assert.deepEqual(merged.screen_1_decklink_tiles, [{ device: 1, videoMode: '2160p5000', width: 3840, height: 2160 }],
		'the wall that legitimately owns the card keeps its tiles')
})
