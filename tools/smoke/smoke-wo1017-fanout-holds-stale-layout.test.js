'use strict'

/**
 * WO-1017 — a screen destination rendered on a linked server is forwarded only while both Caspars run its channels.
 * Live case 09.11: the owner's new shared "PGM/PRV 3" (7680x2160, mapping → the peer's DeckLinks) maps to this box's
 * channel 5 in the generated layout, while its running Caspar still uses channel 5 for DeckLink input 1. Before the
 * guard the fan-out translated channel 5 to the peer's PGM channel and replayed the input commands there.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { channelPlan, createClusterFanout } = require('../../src/cluster/cluster-fanout')
const { staleLayout, runningSizes } = require('../../src/cluster/remote-destination')

const R = (w, h) => ({ w, h, fps: 50 })
const DESTS = [
	{ id: 'dst_gui', mode: 'operator_gui', mainScreenIndex: 0, label: 'Operator GUI' },
	{ id: 'dst_p1', mode: 'pgm_prv', mainScreenIndex: 0, label: 'PGM/PRV 1', width: 3072, height: 1024 },
	{ id: 'dst_zoom', mode: 'pgm_only', mainScreenIndex: 1, label: 'to zoom', width: 1920, height: 1080 },
	{ id: 'dst_p3', mode: 'pgm_prv', mainScreenIndex: 2, label: 'PGM/PRV 3', width: 7680, height: 2160 },
]

/** This box as found 09.11: generated map ch 2/3, 4, 5/6; running Caspar ch 5/6 = 1080p DeckLink inputs. */
function ownView(p3 = R(1920, 1080)) {
	return {
		screenDestinations: { destinations: DESTS },
		live: {
			caspar: {
				channelMap: {
					programChannels: [2, 4, 5],
					previewChannels: [3, null, 6],
					programResolutions: [R(3072, 1024), R(1920, 1080), p3],
					previewResolutions: [R(3072, 1024), R(1920, 1080), p3],
				},
			},
		},
	}
}

/** The peer after the shared show + its Apply: its own numbers, PGM/PRV 3 cabled to its mapping node. */
function peerView(cabled = ['dst_p3'], p3 = R(7680, 2160)) {
	return {
		graph: {
			connectors: DESTS.map((d) => ({ id: `in_${d.id}`, kind: 'destination_in', externalRef: d.id })),
			edges: cabled.map((id) => ({ sourceId: `in_${id}`, sinkId: 'mapping_1_in' })),
		},
		screenDestinations: { destinations: DESTS },
		live: {
			caspar: {
				host: '127.0.0.1',
				port: 5250,
				channelMap: {
					programChannels: [2, 4, 5],
					previewChannels: [3, null, 6],
					programResolutions: [R(3072, 1024), R(1920, 1080), p3],
					previewResolutions: [R(3072, 1024), R(1920, 1080), p3],
				},
			},
		},
	}
}

describe('WO-1017 stale channel layout holds a destination', () => {
	it('runningSizes reads each destination’s running PGM/PRV size; a PGM-only screen has no PRV', () => {
		const s = runningSizes(ownView())
		assert.deepEqual(s.get('dst_p3').pgm, R(1920, 1080))
		assert.equal(s.get('dst_zoom').prv, null)
	})

	it('holds the destination this box has not applied yet (the live case) and says why', () => {
		const p = channelPlan(ownView(), peerView(), 'highascg5867')
		assert.equal(p.map.size, 0, 'master ch 5 (a DeckLink input here) must not map to the peer’s LED channel')
		assert.deepEqual(p.destinations, [])
		assert.equal(p.held.length, 1)
		assert.match(p.held[0].why, /PGM\/PRV 3 \(7680x2160\): PGM runs 1920x1080 here, 7680x2160 on highascg5867/)
	})

	it('holds it when the PEER has not applied yet', () => {
		const p = channelPlan(ownView(R(7680, 2160)), peerView(['dst_p3'], R(6144, 1024)), 'B')
		assert.equal(p.map.size, 0)
		assert.match(p.held[0].why, /on B; Apply the Caspar config where it differs/)
	})

	it('forwards once both Caspars run it (extension: PGM and PRV)', () => {
		const p = channelPlan(ownView(R(7680, 2160)), peerView(), 'B')
		assert.deepEqual([...p.map], [
			[5, 5],
			[6, 6],
		])
		assert.deepEqual(p.held, [])
		assert.equal(staleLayout(ownView(R(7680, 2160)), peerView(), 'dst_p3'), '')
	})

	it('only the stale destination is held; the others still forward', () => {
		const p = channelPlan(ownView(), peerView(['dst_p1', 'dst_p3']), 'B')
		assert.deepEqual([...p.map.keys()].sort(), [2, 3])
		assert.deepEqual(p.held.map((h) => h.id), ['dst_p3'])
	})

	it('views without running sizes (older servers, WO-670 tests) are not judged', () => {
		const own = ownView()
		delete own.live.caspar.channelMap.programResolutions
		delete own.live.caspar.channelMap.previewResolutions
		assert.equal(channelPlan(own, peerView(), 'B').map.size, 2)
	})

	it('the forwarder reports the hold as the server’s error and in status().held; nothing is sent there', async () => {
		const conn = { isConnected: true, lines: [], batches: [], enqueueSend(l) { this.lines.push(l) }, enqueueBatchLines(b) { this.batches.push(b) }, stop() {} }
		const f = createClusterFanout({
			isMaster: () => true,
			pairEnabled: () => false,
			members: () => [{ id: 'b', host: '10.0.0.4', name: 'highascg5867' }],
			peerView: async () => peerView(),
			ownView: async () => ownView(),
			connect: () => conn,
		})
		await f.refresh()
		f.send('PLAY 5-1 DECKLINK DEVICE 1')
		const st = f.status().peers.b
		assert.match(st.error, /^PGM\/PRV 3 \(7680x2160\): PGM runs 1920x1080 here/)
		assert.deepEqual(st.held.map((h) => h.id), ['dst_p3'])
		assert.deepEqual([conn.lines, conn.batches], [[], []], 'the input command stays on this box')
	})

	it('pin: channelPlan consults staleLayout before mapping a destination', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/cluster/cluster-fanout.js'), 'utf8')
		assert.match(src, /const why = staleLayout\(own, peer, id, peerName\)/)
		assert.match(src, /channelPlan\(own, view, m\.name \|\| m\.id\)/)
	})
})
