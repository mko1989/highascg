'use strict'

/**
 * WO-1029 plan 07 (C3) — Caspar channels only where a destination is cabled, behind the device-local flag
 * `cluster.channelsWhereCabled`.
 *
 * Flag off (absent, false, factory default): the generated casparcg.config and the channel map are BYTE-IDENTICAL to
 * the output captured before this code existed (tools/smoke/fixtures/cwc/flag-off-golden.json, every fixture below).
 * Flag on: PGM/PRV only for screens cabled here (plan 07 table 2.2), null holes at the other indices, no <channel>
 * for a hole; operator GUI, inputs, host channels unchanged; a destination cabled nowhere gets no channel.
 *
 * The two real boxes (fixtures from GET /api/device-view, 10.11) against the plan's table 7.1:
 *   highascg7579  opgui → P3, PGM/PRV 1 → P1, "to zoom" cabled nowhere, PGM/PRV 3 + Stream PGM not cabled.
 *     today 1 opgui, 2/3 PGM/PRV 1, 4 to zoom, 5/6 + 7/8 copies, 9/10 DeckLink 1/2.
 *     on, as cabled today: 1 opgui, 2/3 PGM/PRV 1, 4/5 DeckLink 1/2 — programChannels [2,null,null,null].
 *     on, with the Local use cable the plan's migration gives "to zoom" (O3): 1 opgui, 2/3 PGM/PRV 1, 4 to zoom,
 *     5/6 DeckLink 1/2 — programChannels [2,4,null,null], previewChannels [3,null,null,null] = plan 7.1.
 *     (The plan's "After" row assumes that Local use cable; without it "to zoom" has no channel, as O3 says.)
 *   highascg5867  opgui → P1, PGM/PRV 3 → mapping node → P0 + P3, Stream PGM → stream + record.
 *     on: 1 opgui, 2/3 PGM/PRV 3, 4/5 Stream PGM (streamingCh 4), 6/7 DeckLink 3/4 —
 *     programChannels [null,null,2,4], previewChannels [null,null,3,5] = plan 7.1.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { boxConfig, goldenFixtures, outputs, sha, quiet, clone } = require('./lib/cwc-fixtures')
const defaults = require('../../src/config/defaults')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { classifyConfigKey, splitConfigForReplication } = require('../../src/config/config-classify')

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cwc/flag-off-golden.json'), 'utf8'))
const on = (cfg) => ({ ...cfg, cluster: { channelsWhereCabled: true } })
const channelCount = (xml) => (xml.match(/<channel>/g) || []).length
const inputs = (m) => m.inputChannels.map((i) => [i.kind, i.slot, i.channel])

describe('WO-1029 C3 flag off = byte-identical', () => {
	for (const [name, cfg] of goldenFixtures()) {
		it(`${name}: absent, false and the factory default reproduce the pre-plan output`, () => {
			quiet(() => {
				const absent = clone(cfg)
				delete absent.cluster
				for (const [how, c] of [['absent', absent], ['false', { ...clone(cfg), cluster: { channelsWhereCabled: false } }], ['as given', cfg]]) {
					const o = outputs(c)
					assert.equal(sha(o.xml), GOLDEN[name].xml, `${name} ${how}: casparcg.config`)
					assert.equal(sha(o.map), GOLDEN[name].map, `${name} ${how}: channel map`)
				}
			})
		})
	}
})

describe('WO-1029 C3 the rule on the two real boxes (plan 7.1)', () => {
	it('highascg7579 as cabled today: only PGM/PRV 1 is here; "to zoom" cabled nowhere gets no channel', () => {
		quiet(() => {
			const o = outputs(on(boxConfig('7579')))
			const m = o.routeMap
			assert.deepEqual(m.operatorGuiChannels, [1])
			assert.deepEqual(m.programChannels, [2, null, null, null])
			assert.deepEqual(m.previewChannels, [3, null, null, null])
			assert.deepEqual(inputs(m), [['decklink', 1, 4], ['decklink', 2, 5]])
			assert.equal(m.streamingCh, null)
			assert.equal(m.screenCount, 4, 'the screen count stays the shared one')
			assert.equal(channelCount(o.xml), 5)
			assert.doesNotMatch(o.xml, /Screen [234] (program|preview) output/)
		})
	})

	it('highascg7579 with a Local use cable on "to zoom" (O3): the plan table', () => {
		quiet(() => {
			const cfg = on(boxConfig('7579'))
			cfg.deviceGraph.connectors.push({ id: 'local_use_1', deviceId: 'caspar_host', kind: 'local_use', label: 'Local use' })
			cfg.deviceGraph.edges.push({ id: 'e_zoom_local', sourceId: 'dst_in_dst_mw96s6pd_1', sinkId: 'local_use_1' })
			const o = outputs(cfg)
			const m = o.routeMap
			assert.deepEqual(m.programChannels, [2, 4, null, null])
			assert.deepEqual(m.previewChannels, [3, null, null, null], 'to zoom is pgm_only')
			assert.deepEqual(inputs(m), [['decklink', 1, 5], ['decklink', 2, 6]])
			assert.equal(channelCount(o.xml), 6)
		})
	})

	it('highascg5867: PGM/PRV 3 (through the mapping node) and Stream PGM (stream + record) only', () => {
		quiet(() => {
			const o = outputs(on(boxConfig('5867')))
			const m = o.routeMap
			assert.deepEqual(m.operatorGuiChannels, [1])
			assert.deepEqual(m.programChannels, [null, null, 2, 4])
			assert.deepEqual(m.previewChannels, [null, null, 3, 5])
			assert.deepEqual(inputs(m), [['decklink', 3, 6], ['decklink', 4, 7]])
			assert.equal(m.streamingCh, 4, 'the stream attaches to Stream PGM\'s own PGM')
			assert.deepEqual(m.screenHosts.map((h) => h.here), [false, false, true, true])
			assert.equal(channelCount(o.xml), 7)
			assert.match(o.xml, /Caspar channel 2: Screen 3 program output \(PGM\)/)
			assert.match(o.xml, /Caspar channel 5: Screen 4 preview output \(PRV\)/)
			assert.doesNotMatch(o.xml, /Placeholder/)
		})
	})
})

function mini(dests, edges, connectors = []) {
	const cfg = clone(defaults)
	cfg.cluster = { channelsWhereCabled: true }
	cfg.screenDestinations = { version: 1, destinations: dests }
	cfg.deviceGraph = {
		version: 1,
		devices: [{ id: 'caspar_host', role: 'caspar_host' }, { id: 'destinations', role: 'destinations' }],
		connectors: [
			...dests.map((d) => ({ id: `dst_in_${d.id}`, deviceId: 'destinations', kind: 'destination_in', externalRef: d.id })),
			{ id: 'gpu_p0', deviceId: 'caspar_host', kind: 'gpu_out' },
			{ id: 'gpu_p1', deviceId: 'caspar_host', kind: 'gpu_out' },
			...connectors,
		],
		edges: edges.map(([s, t], i) => ({ id: `e${i}`, sourceId: `dst_in_${s}`, sinkId: t })),
	}
	return cfg
}

describe('WO-1029 C3 per destination kind (plan 2.2)', () => {
	it('operator GUI keeps its channel cabled or not; a multiview gets its channel only where cabled', () => {
		quiet(() => {
			const dests = [
				{ id: 'dst_operator_gui', mode: 'operator_gui', mainScreenIndex: 0, videoMode: '1080p5000' },
				{ id: 'dst_a_1', mode: 'pgm_prv', mainScreenIndex: 0, videoMode: '1080p5000' },
				{ id: 'dst_mv1_1', mode: 'multiview', videoMode: '1080p5000' },
				{ id: 'dst_mv2_1', mode: 'multiview', videoMode: '1080p5000' },
			]
			const o = outputs(mini(dests, [['dst_a_1', 'gpu_p0'], ['dst_mv2_1', 'gpu_p1']]))
			const m = o.routeMap
			assert.deepEqual(m.programChannels, [1])
			assert.deepEqual(m.multiviewChannels, [3], 'only the cabled multiview')
			assert.deepEqual(m.multiviewIndices, [1], 'it keeps its own ordinal (multiview_2_* settings)')
			assert.deepEqual(m.operatorGuiChannels, [4], 'uncabled operator GUI is unchanged')
			assert.equal(channelCount(o.xml), 4)
		})
	})

	it('pgm_only gets PGM only; pixelmap needs an explicit sender (Art-Net cable); host_channel stays local', () => {
		const dests = [
			{ id: 'dst_a_1', mode: 'pgm_only', mainScreenIndex: 0, videoMode: '1080p5000' },
			{ id: 'dst_p_1', mode: 'pixelmap', mainScreenIndex: 1, videoMode: '1080p5000' },
			{ id: 'dst_h_1', mode: 'host_channel', mainScreenIndex: 2, videoMode: '1080p5000' },
		]
		const m = quiet(() => outputs(mini(dests, [['dst_a_1', 'gpu_p0']])).routeMap)
		assert.deepEqual(m.programChannels, [1, null, 2])
		assert.deepEqual(m.previewChannels, [null, null, 3])
		const withArtnet = mini(dests, [['dst_a_1', 'gpu_p0'], ['dst_p_1', 'artnet_1']], [{ id: 'artnet_1', deviceId: 'caspar_host', kind: 'artnet_out' }])
		assert.deepEqual(quiet(() => outputs(withArtnet).routeMap).programChannels, [1, 2, 3])
	})

	it('a destination cabled nowhere gets no channel; a PRV-only cable still gives PGM + PRV', () => {
		const dests = [
			{ id: 'dst_a_1', mode: 'pgm_prv', mainScreenIndex: 0, videoMode: '1080p5000' },
			{ id: 'dst_b_1', mode: 'pgm_prv', mainScreenIndex: 1, videoMode: '1080p5000' },
		]
		assert.deepEqual(quiet(() => outputs(mini(dests, [])).routeMap).programChannels, [null, null])
		const prvOnly = mini(dests, [['dst_b_1', 'gpu_p0']])
		prvOnly.deviceGraph.edges[0].note = '{"outputLayer":2}'
		const m = quiet(() => outputs(prvOnly).routeMap)
		assert.deepEqual([m.programChannels, m.previewChannels], [[null, 1], [null, 2]])
	})
})

describe('WO-1029 C3 the flag is device-local and survives saves', () => {
	it('classified device-local, never in the shared split; factory default off; carried into the generator config', () => {
		assert.equal(classifyConfigKey('cluster'), 'device')
		const split = splitConfigForReplication({ cluster: { channelsWhereCabled: true }, screenDestinations: {} })
		assert.deepEqual(Object.keys(split.shared), ['screenDestinations'])
		assert.deepEqual(split.deviceLocal.cluster, { channelsWhereCabled: true })
		assert.deepEqual(defaults.cluster, { channelsWhereCabled: false })
		assert.deepEqual(quiet(() => buildCasparGeneratorFlatConfig(on(boxConfig('5867')))).cluster, { channelsWhereCabled: true })
	})

	it('the settings saves start from the stored config, so an unlisted `cluster` is kept', () => {
		const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
		assert.match(read('src/api/settings-post.js'), /const newConfig = \{ \.\.\.cur, /)
		assert.match(read('src/api/settings-os.js'), /const newConfig = \{ \.\.\.cur, /)
		assert.match(read('src/api/routes-device-snapshot.js'), /const newConfig = \{\n\t\t\.\.\.cur,/)
	})
})
