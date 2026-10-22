'use strict'

/**
 * WO-670 P4a — the master forwards its takes per destination (src/cluster/cluster-fanout.js): channels are translated
 * by destination id between two boxes whose channel lists differ; a line goes only to servers where its destination
 * is cabled (backup and extension alike); multiview / operator GUI / unknown channels stay local; route:// sources are
 * translated; it runs only while master with the hot-backup pair off; every AMCP send reaches it (amcp-fanout sink).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
	createClusterFanout,
	channelPlan,
	cabledIds,
	rewriteLine,
	payloadLines,
} = require('../../src/cluster/cluster-fanout')
const amcpFanout = require('../../src/replication/amcp-fanout')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

/** Master A: LED wall (screen 0, ch 1/2), side screen (screen 1, ch 3/4), multiview, operator GUI. */
const own = {
	screenDestinations: {
		destinations: [
			{ id: 'dst_led', mode: 'pgm_prv', mainScreenIndex: 0 },
			{ id: 'dst_side', mode: 'pgm_prv', mainScreenIndex: 1 },
			{ id: 'dst_mv', mode: 'multiview' },
			{ id: 'dst_gui', mode: 'operator_gui', mainScreenIndex: 0 },
		],
	},
	live: { caspar: { channelMap: { programChannels: [1, 3], previewChannels: [2, 4] } } },
}

/** Peer B lists the side screen first (screen 0 → ch 1/2), the LED wall second (ch 3/4, no preview). */
function peerView(cabled) {
	const connectors = [
		{ id: 'c_led', kind: 'destination_in', externalRef: 'dst_led' },
		{ id: 'c_side', kind: 'destination_in', externalRef: 'dst_side' },
		{ id: 'c_gui', kind: 'destination_in', externalRef: 'dst_gui' },
	]
	return {
		graph: {
			connectors,
			edges: cabled
				.map((d, i) => ({ id: `e${i}`, sourceId: `c_${d}`, sinkId: `gpu_${i}` }))
				.concat([{ id: 'loose', sourceId: 'c_led', sinkId: '' }]),
		},
		screenDestinations: {
			destinations: [
				{ id: 'dst_side', mode: 'pgm_prv', mainScreenIndex: 0, label: 'Side' },
				{ id: 'dst_led', mode: 'pgm_only', mainScreenIndex: 1, label: 'LED' },
				{ id: 'dst_gui', mode: 'operator_gui', mainScreenIndex: 0 },
			],
		},
		live: {
			caspar: { host: '127.0.0.1', port: 5260, channelMap: { programChannels: [1, 3], previewChannels: [2, null] } },
		},
	}
}

function fakeConn() {
	return {
		isConnected: true,
		lines: [],
		batches: [],
		stopped: false,
		enqueueSend(l) {
			this.lines.push(l)
		},
		enqueueBatchLines(b) {
			this.batches.push(b)
		},
		stop() {
			this.stopped = true
		},
	}
}

describe('WO-670 P4a channel plan', () => {
	it('maps by destination id, only for destinations cabled on the peer', () => {
		assert.deepEqual([...cabledIds(peerView(['side']))], ['dst_side'], 'an edge with no sink is no cable')
		const p = channelPlan(own, peerView(['side', 'led', 'gui']))
		assert.equal(p.map.size, 3)
		assert.equal(p.map.get(3), 1, 'side PGM: master ch 3 → peer ch 1')
		assert.equal(p.map.get(4), 2, 'side PRV: master ch 4 → peer ch 2')
		assert.equal(p.map.get(1), 3, 'LED PGM: master ch 1 → peer ch 3')
		assert.equal(p.map.has(2), false, 'LED has no preview on the peer → master PRV ch 2 stays local')
		assert.deepEqual(
			p.destinations.map((d) => d.id),
			['dst_led', 'dst_side'],
			'operator GUI is never a fan-out destination'
		)
		const ext = channelPlan(own, peerView(['side']))
		assert.deepEqual([...ext.map.keys()].sort(), [3, 4], 'extension: only the side screen goes there')
	})

	it('rewrites the channel and route:// sources; denies what does not go there', () => {
		const map = new Map([
			[1, 3],
			[3, 1],
			[4, 2],
		])
		assert.equal(rewriteLine('PLAY 1-10 "CLIP" MIX 12', map), 'PLAY 3-10 "CLIP" MIX 12')
		assert.equal(rewriteLine('MIXER 4-20 FILL 0 0 1 1 25', map), 'MIXER 2-20 FILL 0 0 1 1 25')
		assert.equal(rewriteLine('CLEAR 3', map), 'CLEAR 1')
		assert.equal(rewriteLine('PLAY 1-5 route://4', map), 'PLAY 3-5 route://2')
		assert.equal(
			rewriteLine('PLAY 1-5 route://9-1', map),
			'PLAY 3-5 route://9-1',
			'a route the peer cannot map is sent as is'
		)
		assert.equal(rewriteLine('PLAY 2-10 "CLIP"', map), null, 'unmapped channel stays local')
		assert.equal(rewriteLine('INFO 1', map), null, 'deny list')
		assert.equal(rewriteLine('ADD 1 SCREEN', map), null, 'consumers stay local')
		assert.deepEqual(payloadLines('BEGIN\r\nPLAY 1-1 "A"\r\nMIXER 1-1 OPACITY 1\r\nCOMMIT\r\n'), [
			'PLAY 1-1 "A"',
			'MIXER 1-1 OPACITY 1',
		])
	})
})

describe('WO-670 P4a forwarding', () => {
	function rig({ master = true, pair = false } = {}) {
		const state = {
			master,
			pair,
			members: [{ id: 'b', host: '10.0.0.2', name: 'B', online: true }],
			views: { b: peerView(['side', 'led']) },
		}
		const conns = []
		let changes = 0
		const f = createClusterFanout({
			isMaster: () => state.master,
			pairEnabled: () => state.pair,
			members: () => state.members,
			peerView: async (id) => state.views[id] || null,
			ownView: async () => own,
			connect: (host, port) => {
				const c = fakeConn()
				c.host = host
				c.port = port
				conns.push(c)
				return c
			},
			onChange: () => changes++,
		})
		return { f, state, conns, changes: () => changes }
	}

	it('sends translated lines and batches to the peer Caspar (loopback → the peer host)', async () => {
		const r = rig()
		await r.f.refresh()
		assert.equal(r.conns.length, 1)
		assert.equal(`${r.conns[0].host}:${r.conns[0].port}`, '10.0.0.2:5260')
		r.f.send('PLAY 3-10 "CLIP"')
		r.f.send('PLAY 2-10 "CLIP"')
		r.f.send('BEGIN\r\nPLAY 1-10 "A"\r\nMIXER 1-10 OPACITY 1\r\nPLAY 99-1 "X"\r\nCOMMIT\r\n')
		assert.deepEqual(r.conns[0].lines, ['PLAY 1-10 "CLIP"'])
		assert.deepEqual(r.conns[0].batches, [['PLAY 3-10 "A"', 'MIXER 3-10 OPACITY 1']])
		const st = r.f.status()
		assert.equal(st.active, true)
		assert.equal(st.peers.b.sent, 3)
		assert.equal(st.peers.b.destinations.length, 2)
		const before = r.changes()
		await r.f.refresh()
		assert.equal(r.changes(), before, 'no broadcast when only counters moved')
	})

	it('off when not master or when the hot-backup pair is on; peers that leave are dropped', async () => {
		for (const opts of [{ master: false }, { pair: true }]) {
			const r = rig(opts)
			await r.f.refresh()
			r.f.send('PLAY 1-10 "CLIP"')
			assert.equal(r.conns.length, 0)
			assert.equal(r.f.status().active, false)
		}
		const r = rig()
		await r.f.refresh()
		r.state.members = []
		await r.f.refresh()
		assert.equal(r.conns[0].stopped, true)
		assert.deepEqual(r.f.status().peers, {})
		r.state.members = [{ id: 'b', host: '10.0.0.2', name: 'B', online: true }]
		r.state.views.b = peerView([])
		await r.f.refresh()
		assert.match(r.f.status().peers.b.error, /no shared destination/)
		r.state.master = false
		await r.f.refresh()
		assert.equal(r.conns[1].stopped, true, 'stepping down closes the peer connections')
	})

	it('every AMCP send reaches the cluster sink; routes wire it in', () => {
		const got = []
		amcpFanout.setClusterFanoutSink((p) => got.push(p))
		amcpFanout.fanoutSingleCommand('PLAY 1-1 "A"')
		amcpFanout.fanoutBatchPayload('BEGIN\r\nPLAY 1-1 "A"\r\nCOMMIT\r\n')
		amcpFanout.setClusterFanoutSink(() => {
			throw new Error('boom')
		})
		amcpFanout.fanoutSingleCommand('PLAY 1-1 "A"')
		amcpFanout.setClusterFanoutSink(null)
		assert.equal(got.length, 2)
		const routes = read('src/api/routes-cluster.js')
		assert.match(routes, /await fanoutOf\(ctx\)\.refresh\(\)/)
		assert.match(routes, /fan\.setClusterFanoutSink\(/)
		assert.match(routes, /function startIfLinked\(ctx\) \{\n\tairJournalOf\(ctx\)/, 'P4b: the journal records from boot')
		assert.match(read('src/caspar/amcp-batch.js'), /fanoutBatchPayload\(payload\)/)
		assert.match(read('src/caspar/amcp-client-transport.js'), /fanoutSingleCommand\(trimmed\)/)
	})
})
