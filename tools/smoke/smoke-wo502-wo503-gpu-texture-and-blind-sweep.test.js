'use strict'

/**
 * WO-502 — screen consumers must always emit `<gpu-texture>true</gpu-texture>`, unconditionally.
 * WO-503 — the CG orphan sweep must ask for INFO instead of sweeping a channel blind.
 *
 * WO-502: the owner hand-edited `<gpu-texture>true</gpu-texture>` into the generated
 * `casparcg.config` and measured 93.6 % -> 100.3 % of realtime with GPU 100 % -> 75 %. A hand-edit
 * is erased by the next Apply. It first landed as an opt-in `screen_N_gpu_texture` key (default
 * off); owner decision 21.09.2026 was that it has no known downside on this box and should never
 * have been a toggle — it is now forced on for every screen (program and multiview), with no
 * config key and nothing exposed in the UI.
 *
 * WO-503: owner 13.08 — *"this still happens … making checking logs imposible"*, pasting hundreds
 * of `CG 1-7xx CLEAR` / `CG 3-7xx CLEAR` lines. `gatheredInfo.channelXml` is a snapshot taken when
 * the sweep is scheduled and `periodic-sync` has not populated it yet on the connect path, so the
 * blind branch fired every reconnect: 90 CLEARs per program channel, for layers that are almost
 * always empty.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	buildProgramScreenConsumerInnerXml,
	buildMultiviewScreenConsumerInnerXml,
} = require('../../src/config/config-generator-screen-xml.js')
const { sweepTemplateCgOrphansOnCasparConnected } = require('../../src/engine/template-cg-orphan-sweep.js')

/** isCustomLiveProfile gates the extended tag set (config-generator-utils.js:98). */
const BASE = { caspar_build_profile: 'custom_live' }
const CTX = {
	nextDevice: 1,
	posX: 0,
	posY: 0,
	dims: { width: 1920, height: 1080 },
	stretch: 'none',
	windowed: true,
	vsync: false,
	alwaysOnTop: false,
	borderless: true,
}

test('WO-502: program screen gpu-texture is always true, with no config key involved', () => {
	assert.match(buildProgramScreenConsumerInnerXml({ ...BASE }, 1, CTX), /<gpu-texture>true<\/gpu-texture>/)
	assert.match(buildProgramScreenConsumerInnerXml({ ...BASE }, 2, CTX), /<gpu-texture>true<\/gpu-texture>/)
})

test('WO-502: an explicit screen_N_gpu_texture=false cannot turn it off — there is no toggle', () => {
	const cfg = { ...BASE, screen_1_gpu_texture: false, screen_1_gpu_texture_2: 'false' }
	assert.match(buildProgramScreenConsumerInnerXml(cfg, 1, CTX), /<gpu-texture>true<\/gpu-texture>/)
})

test('WO-502: multiview screen gpu-texture is also always true', () => {
	const xml = buildMultiviewScreenConsumerInnerXml({ ...BASE }, { ...CTX, n: 1 })
	assert.match(xml, /<gpu-texture>true<\/gpu-texture>/)
})

test('WO-502: the default seed has no gpu_texture key — it is not a setting any more', () => {
	const { casparScreenDefaults } = require('../../src/config/defaults-caspar-server.js')
	const seeded = casparScreenDefaults(1)
	assert.equal(seeded.screen_1_gpu_texture, undefined, 'gpu_texture must not exist as a seeded/overridable key')
})

test('WO-502: operator_gui screen consumer gpu-texture is also always true (owner, 21.09.2026)', () => {
	/* Owner: "shouldn't the operator gui (or multiview) screen consumer also have gpu texture
	 * true? i think it should" — operator_gui's <screen> consumer is built inline in
	 * config-generator-operator-gui.js, not through buildProgramScreenConsumerInnerXml, so it
	 * needed its own gpu-texture line rather than inheriting the fix above. It is a real CasparCG
	 * GL window (stacked below the Firefox kiosk, WO-263) on the same single shared GL thread as
	 * every other screen consumer, so the same WO-502 fix applies. */
	const { buildOperatorGuiChannel } = require('../../src/config/config-generator-operator-gui')
	const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
	const dest = normalizeScreenDestinations({
		version: 1,
		destinations: [{ id: 'og', mode: 'operator_gui', physicalPort: 2, label: 'Operator GUI' }],
	}).destinations[0]
	const dims = { width: 1920, height: 1080, fps: 50, modeId: '1080p5000', isCustom: false }
	const xml = buildOperatorGuiChannel({}, dest, dims, { cumulativeX: 0, nextDevice: 1, layout: null }, 5)
	assert.match(xml, /<gpu-texture>true<\/gpu-texture>/)
})

/** Minimal AMCP double recording batched lines and INFO calls. */
function fakeAmcp({ infoXml, infoThrows }) {
	const calls = { info: [], lines: [] }
	return {
		calls,
		isConnected: true,
		info: async (ch) => {
			calls.info.push(ch)
			if (infoThrows) throw new Error('INFO failed')
			return { data: infoXml(ch) }
		},
		batchSendChunked: async (lines) => {
			calls.lines.push(...lines)
			return { ok: true }
		},
	}
}

/** An INFO channel XML where every 7xx host is empty. */
const emptyBandXml = () =>
	'<?xml version="1.0"?><channel><stage><layer>' +
	'<layer_10><foreground><producer>empty</producer></foreground></layer_10>' +
	'</layer></stage></channel>'

test('WO-503: a missing channelXml triggers INFO, not a 90-line blind sweep', async () => {
	const amcp = fakeAmcp({ infoXml: emptyBandXml })
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channelXml: {}, // the connect-path reality: snapshot not populated yet
		channels: [1, 3],
		log: () => {},
	})
	assert.deepEqual(amcp.calls.info, [1, 3], 'each channel without XML must be asked once')
	const clears = amcp.calls.lines.filter((l) => /CG \d+-7\d\d CLEAR/.test(l))
	assert.equal(clears.length, 0, `THE BUG: swept blind. Emitted ${clears.length} CLEARs: ${clears.slice(0, 3)}`)
})

test('WO-503: an occupied host is still cleared', async () => {
	const occupied = () =>
		'<?xml version="1.0"?><channel><stage><layer>' +
		'<layer_705><foreground><producer>html</producer></foreground></layer_705>' +
		'</layer></stage></channel>'
	const amcp = fakeAmcp({ infoXml: occupied })
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channelXml: {},
		channels: [1],
		log: () => {},
	})
	assert.ok(
		amcp.calls.lines.includes('CG 1-705 CLEAR'),
		`an orphan must still be cleared, got ${JSON.stringify(amcp.calls.lines)}`,
	)
	assert.equal(amcp.calls.lines.length, 1, 'and ONLY the occupied host')
})

test('WO-503: a genuine INFO failure still falls back to sweeping (WO-482 intent preserved)', async () => {
	const amcp = fakeAmcp({ infoXml: emptyBandXml, infoThrows: true })
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channelXml: {},
		channels: [1],
		log: () => {},
	})
	const clears = amcp.calls.lines.filter((l) => /CG 1-7\d\d CLEAR/.test(l))
	assert.equal(clears.length, 90, 'uncertainty must still fail toward clearing an orphan off air')
})

test('WO-503: a supplied channelXml is used without an INFO round-trip', async () => {
	const amcp = fakeAmcp({ infoXml: emptyBandXml })
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channelXml: { 1: emptyBandXml() },
		channels: [1],
		log: () => {},
	})
	assert.deepEqual(amcp.calls.info, [], 'no INFO needed when the snapshot already has the XML')
	assert.equal(amcp.calls.lines.length, 0)
})
