'use strict'

/**
 * WO-1029 plan 07 (C2, owner decision O3) — the Local use connector: one virtual jack per server that takes any number
 * of destination cables, makes a destination "cabled here" (so it keeps its Caspar channels) and writes NOTHING else.
 * Flag off: no effect anywhere.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const dg = require('../../src/config/device-graph')
const cab = require('../../src/config/destination-cabling')
const { LOCAL_USE_ID } = require('../../src/config/device-graph-local-use')
const { boxConfig, outputs, quiet, sha, clone } = require('./lib/cwc-fixtures')

const ZOOM = 'dst_mw96s6pd_1'
const PGM3 = 'dst_mw989wyz_1'

function graphWithLocalUse(cfg) {
	const sug = dg.suggestConnectorsAndDevicesFromLive({}, cfg)
	return dg.ensureConnectorsFromSuggested(cfg.deviceGraph, [LOCAL_USE_ID], sug)
}

function cable(cfg, ...destIds) {
	let g = graphWithLocalUse(cfg)
	for (const id of destIds) {
		const r = dg.addEdgeToGraph(g, `dst_in_${id}`, LOCAL_USE_ID)
		assert.equal(r.ok, true, r.reason)
		g = r.graph
	}
	return { ...clone(cfg), deviceGraph: g }
}

const on = (cfg) => ({ ...clone(cfg), cluster: { channelsWhereCabled: true } })

describe('WO-1029 Local use connector', () => {
	it('every server suggests exactly one local_use connector on the host device', () => {
		const sug = dg.suggestConnectorsAndDevicesFromLive({}, boxConfig('7579'))
		const lu = sug.connectors.filter((c) => c.kind === 'local_use')
		assert.equal(lu.length, 1)
		assert.deepEqual([lu[0].id, lu[0].deviceId, lu[0].label], [LOCAL_USE_ID, 'caspar_host', 'Local use'])
		assert.equal(dg.suggestConnectorsAndDevicesFromLive({}, {}).connectors.filter((c) => c.kind === 'local_use').length, 1)
	})

	it('takes any number of cables; a Caspar output still takes one; a duplicate is refused', () => {
		const cfg = boxConfig('7579')
		const g = cable(cfg, ZOOM, PGM3).deviceGraph
		assert.equal(g.edges.filter((e) => e.sinkId === LOCAL_USE_ID).length, 2)
		assert.equal(dg.addEdgeToGraph(g, `dst_in_${ZOOM}`, LOCAL_USE_ID).reason, 'duplicate')
		// the rule for real outputs is unchanged
		const gpu = g.connectors.find((c) => c.kind === 'gpu_out')
		const first = dg.addEdgeToGraph(g, `dst_in_${ZOOM}`, gpu.id)
		const second = dg.addEdgeToGraph(first.graph, `dst_in_${PGM3}`, gpu.id)
		assert.equal(second.reason, 'sink_already_connected')
		// not cableable from/to anything but a destination feed or a mapping output
		assert.equal(dg.addEdgeToGraph(g, 'gpu_p0', LOCAL_USE_ID).ok, false)
	})

	it('flag on: a destination cabled only to Local use keeps its channels and gets no consumer', () => {
		const cfg = boxConfig('7579')
		assert.equal(cab.cabledHere(on(cfg), ZOOM), false)
		const withCable = on(cable(cfg, ZOOM))
		assert.equal(cab.cabledHere(withCable, ZOOM), true)
		assert.deepEqual(cab.destinationCabling(withCable, ZOOM).sinks.map((s) => s.kind), ['local_use'])
		const before = quiet(() => outputs(on(cfg)))
		const after = quiet(() => outputs(withCable))
		assert.deepEqual(before.routeMap.programChannels, [2, null, null, null])
		assert.deepEqual(after.routeMap.programChannels, [2, 4, null, null])
		assert.deepEqual(after.routeMap.screenHosts[1].here, true)
		// the zoom channel exists in casparcg.config with an EMPTY consumer list, and nothing else was written for it
		const idx = after.xml.indexOf('Caspar channel 4:')
		assert.match(after.xml.slice(idx, after.xml.indexOf('</channel>', idx)), /<consumers>\s*<\/consumers>/)
		assert.equal(after.xml.match(/<channel>/g).length, before.xml.match(/<channel>/g).length + 1)
		assert.equal((after.xml.match(/<screen>/g) || []).length, (before.xml.match(/<screen>/g) || []).length)
	})

	it('two destinations into one Local use both keep their channels', () => {
		const out = quiet(() => outputs(on(cable(boxConfig('7579'), ZOOM, PGM3))))
		assert.deepEqual(out.routeMap.programChannels, [2, 4, 5, null])
		assert.deepEqual(out.routeMap.screenHosts.map((h) => h.here), [true, true, true, false])
	})

	it('flag off: the jack and its cables change nothing in casparcg.config or the channel map', () => {
		const cfg = boxConfig('7579')
		const plain = quiet(() => outputs(cfg))
		const cabled = quiet(() => outputs(cable(cfg, ZOOM, PGM3)))
		assert.equal(sha(cabled.xml), sha(plain.xml))
		assert.equal(sha(cabled.map), sha(plain.map))
	})
})
