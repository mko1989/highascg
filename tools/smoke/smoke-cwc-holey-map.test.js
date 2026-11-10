'use strict'

/**
 * WO-1029 plan 07 (C1a) — the channel map core is safe for HOLES (screens output by another server while
 * `cluster.channelsWhereCabled` is on): programCh / previewCh / the source vocabulary / stream attach / the
 * /api/state channelMap all answer null for a hole — never another screen's channel — and numbers stay dense.
 *
 * Also the regression guard for the consumers still to convert (C1b / C1c): a list of the "screen 1 / fixed-number
 * fallback" patterns in src/, pinned to today's count. Converting one lowers the count: update the pin.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { getChannelMap, resolveStreamOutputCasparChannel, resolveStreamingChannelRouteForRole } = require('../../src/config/routing-map')
const { allocateMainChannels } = require('../../src/config/routing-map-mains')
const { buildChannelMap } = require('../../src/config/channel-map-from-ctx')
const { resolveOutputSourceToChannel } = require('../../src/config/output-source-name')
const sc = require('../../src/config/screen-channels')
const { clone, outputs, quiet } = require('./lib/cwc-fixtures')
const defaults = require('../../src/config/defaults')

/** Three pgm_prv screens; `cabled` = which screen indices have a GPU cable here. */
function threeScreens(cabled, on = true) {
	const cfg = clone(defaults)
	const dests = [0, 1, 2].map((i) => ({ id: `dst_s${i}_1`, label: `S${i + 1}`, mode: 'pgm_prv', mainScreenIndex: i, videoMode: '1080p5000' }))
	cfg.screenDestinations = { version: 1, destinations: dests }
	cfg.deviceGraph = {
		version: 1,
		devices: [{ id: 'caspar_host', role: 'caspar_host' }, { id: 'destinations', role: 'destinations' }],
		connectors: [
			...dests.map((d) => ({ id: `dst_in_${d.id}`, deviceId: 'destinations', kind: 'destination_in', externalRef: d.id })),
			...dests.map((_, i) => ({ id: `gpu_p${i}`, deviceId: 'caspar_host', kind: 'gpu_out' })),
		],
		edges: cabled.map((i) => ({ id: `e${i}`, sourceId: `dst_in_dst_s${i}_1`, sinkId: `gpu_p${i}` })),
	}
	if (on) cfg.cluster = { channelsWhereCabled: true }
	return cfg
}

describe('WO-1029 C1a hole-safe map', () => {
	it('allocateMainChannels: isLocal leaves null holes and keeps the numbers dense', () => {
		const a = allocateMainChannels({
			useVirtual: false, virtualMainChannels: [], screenCount: 3, previewEnabledByMain: [true, true, false], firstCh: 2,
			isLocal: (i) => i !== 0,
		})
		assert.deepEqual(a.programChannels, [null, 2, 4])
		assert.deepEqual(a.previewChannels, [null, 3, null])
		assert.deepEqual(a.switcherBus1Channels, [null, 3, null])
		const off = allocateMainChannels({ useVirtual: false, virtualMainChannels: [], screenCount: 2, previewEnabledByMain: [true, true] })
		assert.deepEqual(off.programChannels, [1, 3], 'no isLocal = legacy numbering')
	})

	it('programCh / previewCh return null for a hole and out of range; the legacy fallback stays only with the flag off', () => {
		const m = getChannelMap(threeScreens([0, 2]))
		assert.deepEqual(m.programChannels, [1, null, 3])
		assert.deepEqual(m.previewChannels, [2, null, 4])
		assert.equal(m.programCh(2), null, 'screen 2 is a hole — never screen 1')
		assert.equal(m.previewCh(2), null)
		assert.equal(m.programCh(4), null, 'out of range with the rule on')
		assert.equal(m.programCh(3), 3)
		const off = getChannelMap(threeScreens([0, 2], false))
		assert.deepEqual(off.programChannels, [1, 3, 5], 'flag off: every destination gets channels')
		assert.equal(off.programCh(9), 1, 'flag off keeps the legacy out-of-range fallback (no holes can exist)')
		assert.equal(off.channelsWhereCabled, undefined)
		assert.equal(off.screenHosts, undefined, 'the off map stays key-for-key the legacy one')
	})

	it('screenHosts names each screen and whether it is here', () => {
		const m = getChannelMap(threeScreens([1]))
		assert.deepEqual(m.screenHosts.map((h) => [h.idx, h.destId, h.here]), [[0, 'dst_s0_1', false], [1, 'dst_s1_1', true], [2, 'dst_s2_1', false]])
	})

	it('screen-channels helpers on both map shapes (getChannelMap and /api/state channelMap)', () => {
		const m = getChannelMap(threeScreens([0, 2]))
		const api = buildChannelMap({ config: threeScreens([0, 2]) })
		for (const map of [m, api]) {
			assert.deepEqual(sc.screenChannels(map, 1), { idx: 1, here: false, pgm: null, prv: null })
			assert.deepEqual(sc.screenChannels(map, 2), { idx: 2, here: true, pgm: 3, prv: 4 })
			assert.deepEqual(sc.screenChannels(map, 7), { idx: 7, here: false, pgm: null, prv: null })
			assert.equal(sc.isScreenHere(map, 0), true)
			assert.deepEqual(sc.localScreens(map), [0, 2])
			assert.deepEqual(sc.localProgramChannels(map), [1, 3])
			assert.deepEqual(sc.localPreviewChannels(map), [2, 4])
			assert.deepEqual(sc.screenOfChannel(map, 4), { idx: 2, bus: 'prv' })
			assert.equal(sc.screenOfChannel(map, 9), null)
			assert.equal(sc.screenHost(map, 1).here, false)
			assert.equal(sc.hasHoles(map), true)
		}
		const offMap = getChannelMap(threeScreens([0], false))
		assert.equal(sc.hasHoles(offMap), false)
		assert.deepEqual(sc.screenHost(offMap, 1), { idx: 1, destId: null, here: true, pgm: true, prv: true })
		assert.equal(sc.channelsWhereCabledEnabled({ cluster: { channelsWhereCabled: true } }), true)
		assert.equal(sc.channelsWhereCabledEnabled({ cluster: {} }), false)
		assert.equal(typeof sc.makeBusAccessors, 'function')
	})

	it('/api/state channelMap: holes are null, their resolutions null, screenHosts only while on', () => {
		const api = buildChannelMap({ config: threeScreens([0, 2]) })
		assert.deepEqual(api.programChannels, [1, null, 3])
		assert.equal(api.programResolutions[1], null)
		assert.equal(api.channelsWhereCabled, true)
		assert.equal(api.screenHosts.length, 3)
		const off = buildChannelMap({ config: threeScreens([0, 2], false) })
		assert.equal('screenHosts' in off, false)
	})

	it('source vocabulary: program_N / preview_N of a hole is null', () => {
		const m = getChannelMap(threeScreens([0, 2]))
		assert.equal(resolveOutputSourceToChannel(m, 'program_2'), null)
		assert.equal(resolveOutputSourceToChannel(m, 'preview_2'), null)
		assert.equal(resolveOutputSourceToChannel(m, 'program_3'), 3)
		assert.equal(resolveOutputSourceToChannel(m, 'channel_2'), 2, 'a named channel is not a screen')
	})

	it('stream attach reads the hole: only where the stream screen is local', () => {
		const cfg = threeScreens([0])
		cfg.screenDestinations.destinations.push({ id: 'dst_st_1', label: 'Stream', mode: 'stream', mainScreenIndex: 1 })
		cfg.streamingChannel = { ...cfg.streamingChannel, enabled: true }
		const m = getChannelMap(cfg)
		assert.equal(m.programCh(2), null)
		assert.deepEqual(resolveStreamOutputCasparChannel(cfg, m, { enabled: true }), { kind: 'attach', ch: null })
		assert.equal(m.streamingCh, null, 'no stream on this server — not screen 1')
		assert.equal(m.streamingAttachToChannel, null)
		// the stream destination cabled here (str_1) makes its screen local
		cfg.deviceGraph.connectors.push({ id: 'dst_in_dst_st_1', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_st_1' })
		cfg.deviceGraph.connectors.push({ id: 'str_1', deviceId: 'caspar_host', kind: 'stream_out' })
		cfg.deviceGraph.edges.push({ id: 'es', sourceId: 'dst_in_dst_st_1', sinkId: 'str_1' })
		const m2 = getChannelMap(cfg)
		assert.deepEqual(m2.programChannels, [1, 3, null])
		assert.equal(m2.streamingCh, 3)
		// videoSource naming a hole, screen 1 a hole too: no route://null
		const holeOnly = threeScreens([2])
		holeOnly.streamingChannel = { ...holeOnly.streamingChannel, enabled: true, videoSource: 'program_1' }
		assert.equal(resolveStreamingChannelRouteForRole(holeOnly, 'video'), null)
	})

	it('the generator emits no <channel> for a hole; Caspar numbering = the map', () => {
		quiet(() => {
			const o = outputs(threeScreens([0, 2]))
			assert.equal((o.xml.match(/<channel>/g) || []).length, 4)
			assert.doesNotMatch(o.xml, /Screen 2 program output/)
			assert.match(o.xml, /Caspar channel 3: Screen 3 program output \(PGM\)/)
			assert.doesNotMatch(o.xml, /Placeholder/)
		})
	})
})

/** WO-1029 C1a: fallbacks that would land a hole on another screen's channel — the C1b / C1c to-do list. */
const FALLBACK_PATTERNS = [
	['programChannels[0] as screen-1 default', /programChannels\??\.?\[0\]/],
	['programCh(1) as default', /programCh\(1\)/],
	['(idx + 1) * 2 fixed numbering', /\(\s*[\w.]+\s*\+\s*1\s*\)\s*\*\s*2/],
]
/** Hole-safe by construction: programCh returns null for a hole while the rule is on. */
const HOLE_SAFE = new Set(['src/config/routing-map.js', 'src/config/screen-channels.js'])
/** Today's count (10.11.2026, after C1a). Converting a consumer lowers it: update the pin, never raise it. */
const FALLBACK_PIN = 13

function walk(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name)
		if (e.isDirectory()) walk(p, out)
		else if (e.name.endsWith('.js')) out.push(p)
	}
	return out
}

describe('WO-1029 C1a fallback report', () => {
	it(`lists the screen-1 / fixed-number fallbacks in src/ (pinned at ${FALLBACK_PIN})`, () => {
		const root = path.join(__dirname, '../..')
		const hits = []
		for (const file of walk(path.join(root, 'src'))) {
			const rel = path.relative(root, file).split(path.sep).join('/')
			if (HOLE_SAFE.has(rel)) continue
			fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
				const t = line.trim()
				if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return
				for (const [what, re] of FALLBACK_PATTERNS) if (re.test(line)) hits.push(`${rel}:${i + 1}  ${what}`)
			})
		}
		console.log(`[WO-1029 C1a] ${hits.length} hole-unsafe fallbacks still in src/:\n  ${hits.join('\n  ')}`)
		assert.equal(hits.length, FALLBACK_PIN, 'a new fallback appeared (or one was converted: lower the pin)')
	})
})
