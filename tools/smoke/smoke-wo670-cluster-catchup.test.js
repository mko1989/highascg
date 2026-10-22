'use strict'

/**
 * WO-670 P4b — a server that joins mid-show gets what is on air (src/cluster/cluster-air-journal.js replayed by
 * cluster-fanout.js on connect and on a newly cabled destination), and a server whose master is another online
 * server skips its own local PGM takes (amcp-fanout.js setClusterFollowerCheck, routes-cluster.js followsMaster).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createAirJournal } = require('../../src/cluster/cluster-air-journal')
const { createClusterFanout } = require('../../src/cluster/cluster-fanout')
const amcpFanout = require('../../src/replication/amcp-fanout')
const { followsMaster } = require('../../src/api/routes-cluster')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('WO-670 P4b air journal', () => {
	it('keeps the producer, the last mixer value per property and the CG lines, per layer', () => {
		const j = createAirJournal()
		for (const l of [
			'PLAY 1-10 "OLD" LOOP',
			'MIXER 1-10 OPACITY 0.5 DEFER',
			'MIXER 1-10 OPACITY 1 12',
			'MIXER 1-10 FILL 0 0 0.5 0.5',
			'MIXER 1-10 OPACITY',
			'MIXER 1 COMMIT',
			'MIXER 1 MASTERVOLUME 0.8',
			'LOADBG 1-20 "A" MIX 10',
			'PLAY 1-20',
			'LOADBG 1-20 "B"',
			'PLAY 1-20',
			'CG 1-30 ADD 1 "lower" 1 "{}"',
			'CG 1-30 UPDATE 1 "{x}"',
			'PLAY 2-10 "PRV"',
			'PLAY 1-40 "GONE"',
			'STOP 1-40',
		])
			j.record(l)
		assert.deepEqual(j.replay(new Set([1])), [
			'MIXER 1 MASTERVOLUME 0.8',
			'PLAY 1-10 "OLD" LOOP',
			'MIXER 1-10 OPACITY 1 12',
			'MIXER 1-10 FILL 0 0 0.5 0.5',
			'LOADBG 1-20 "B"',
			'PLAY 1-20',
			'CG 1-30 ADD 1 "lower" 1 "{}"',
			'CG 1-30 UPDATE 1 "{x}"',
		])
		assert.deepEqual(j.replay(new Set([2])), ['PLAY 2-10 "PRV"'])
	})

	it('a new clip, CLEAR and MIXER CLEAR reset what they cover', () => {
		const j = createAirJournal()
		for (const l of ['PLAY 1-10 "A"', 'PAUSE 1-10', 'PLAY 1-10 "B"', 'MIXER 1-10 OPACITY 0.2', 'CG 1-10 ADD 1 "t" 1', 'MIXER 1-10 CLEAR'])
			j.record(l)
		assert.deepEqual(j.replay(), ['PLAY 1-10 "B"', 'CG 1-10 ADD 1 "t" 1'])
		j.record('CLEAR 1-10')
		assert.deepEqual(j.replay(), [])
		for (const l of ['PLAY 1-1 "A"', 'PLAY 1-2 "B"', 'MIXER 1-2 OPACITY 0.5', 'MIXER 1 MASTERVOLUME 0.5']) j.record(l)
		j.record('CLEAR 1')
		assert.deepEqual(j.replay(), ['MIXER 1 MASTERVOLUME 0.5', 'MIXER 1-2 OPACITY 0.5'], 'CLEAR keeps the mixer')
		j.record('MIXER 1 CLEAR')
		assert.deepEqual(j.replay(), [])
	})
})

describe('WO-670 P4b catch-up', () => {
	const own = {
		screenDestinations: { destinations: [{ id: 'd', mode: 'pgm_prv', mainScreenIndex: 0 }] },
		live: { caspar: { channelMap: { programChannels: [1], previewChannels: [2] } } },
	}
	const peer = (cabled) => ({
		graph: {
			connectors: [{ id: 'c', kind: 'destination_in', externalRef: 'd' }],
			edges: cabled ? [{ sourceId: 'c', sinkId: 'gpu' }] : [],
		},
		screenDestinations: own.screenDestinations,
		live: { caspar: { port: 5260, channelMap: { programChannels: [11], previewChannels: [12] } } },
	})

	function rig() {
		const st = { view: peer(true) }
		const conns = []
		const f = createClusterFanout({
			isMaster: () => true,
			pairEnabled: () => false,
			members: () => [{ id: 'b', host: '10.0.0.2', name: 'B', online: true }],
			peerView: async () => st.view,
			ownView: async () => own,
			connect: (host, port, onConnected) => {
				const c = { isConnected: false, out: [], onConnected, stop() {}, enqueueSend(l) { this.out.push([l]) },
					enqueueBatchLines(b) { this.out.push(b) } }
				conns.push(c)
				return c
			},
		})
		return { f, st, conns }
	}

	it('replays what is on air when the Caspar connects, before new lines; again after a reconnect', async () => {
		const r = rig()
		r.f.send('PLAY 1-10 "LOOK" LOOP') // before the server is linked: journal only
		r.f.send('BEGIN\r\nMIXER 1-10 OPACITY 0.5\r\nPLAY 2-10 "NEXT"\r\nCOMMIT\r\n')
		await r.f.refresh()
		const c = r.conns[0]
		assert.deepEqual(c.out, [], 'nothing while not connected')
		c.isConnected = true
		c.onConnected()
		assert.deepEqual(c.out, [['PLAY 11-10 "LOOK" LOOP', 'MIXER 11-10 OPACITY 0.5', 'PLAY 12-10 "NEXT"']])
		r.f.send('PLAY 1-20 "NEW"')
		assert.deepEqual(c.out.at(-1), ['PLAY 11-20 "NEW"'], 'a new line is sent once, not replayed too')
		assert.equal(c.out.length, 2)
		c.out = []
		c.onConnected()
		assert.deepEqual(c.out[0], ['PLAY 11-10 "LOOK" LOOP', 'MIXER 11-10 OPACITY 0.5', 'PLAY 11-20 "NEW"', 'PLAY 12-10 "NEXT"'])
		assert.equal(r.f.status().peers.b.caught_up.lines, 4)
	})

	it('a destination cabled later is caught up at the next refresh', async () => {
		const r = rig()
		r.st.view = peer(false)
		r.f.send('PLAY 1-10 "LOOK"')
		await r.f.refresh()
		r.conns[0].isConnected = true
		r.conns[0].onConnected()
		assert.deepEqual(r.conns[0].out, [])
		r.st.view = peer(true)
		await r.f.refresh()
		assert.deepEqual(r.conns[0].out, [['PLAY 11-10 "LOOK"']])
		await r.f.refresh()
		assert.equal(r.conns[0].out.length, 1, 'once')
	})
})

describe('WO-670 P4b local PGM takes on a follower', () => {
	function ctxWith(view, peers, pair = false) {
		return {
			config: { replication: { enabled: pair } },
			_clusterMaster: { view: () => view },
			_cluster: { snapshot: () => ({ self: {}, peers }) },
		}
	}

	it('skipped only while another online server is master (and the hot-backup pair is off)', () => {
		const other = { epoch: 3, master_id: 'a', is_master: false }
		assert.equal(followsMaster(ctxWith(other, [{ id: 'a', online: true }])), true)
		assert.equal(followsMaster(ctxWith(other, [{ id: 'a', online: false }])), false, 'master gone → local takes again')
		assert.equal(followsMaster(ctxWith({ epoch: 3, master_id: 'self', is_master: true }, [])), false)
		assert.equal(followsMaster(ctxWith({ epoch: 0, master_id: '', is_master: false }, [])), false, 'no cluster master')
		assert.equal(followsMaster(ctxWith(other, [{ id: 'a', online: true }], true)), false, 'the pair decides')
	})

	it('the follower check gates PGM only; the take, batch and transport paths use it', () => {
		const ctx = { config: {} }
		amcpFanout.setClusterFollowerCheck(() => true)
		const pgm = require('../../src/config/routing').getChannelMap({}).programChannels[0]
		assert.equal(amcpFanout.shouldFollowerSkipLocalPgmAmcp(ctx, pgm), true)
		assert.equal(amcpFanout.shouldFollowerSkipLocalPgmAmcp(ctx, pgm, { previewOnly: true }), false)
		amcpFanout.setClusterFollowerCheck(() => {
			throw new Error('boom')
		})
		assert.equal(amcpFanout.shouldFollowerSkipLocalPgmAmcp(ctx, pgm), false)
		amcpFanout.setClusterFollowerCheck(null)
		assert.equal(amcpFanout.shouldFollowerSkipLocalPgmAmcp(ctx, pgm), false)
		assert.match(read('src/api/routes-scene-take.js'), /shouldFollowerSkipLocalPgmAmcp\(ctx, channel/)
		assert.match(read('src/caspar/amcp-batch.js'), /shouldFollowerSkipLocalPgmAmcp\(connection, ch/)
		assert.match(read('src/caspar/amcp-client-transport.js'), /shouldBlockLocalPgmAmcpCommand\(self, trimmed\)/)
		assert.match(read('src/api/routes-cluster.js'), /setClusterFollowerCheck\(\(\) => followsMaster\(ctx\)\)/)
		assert.match(read('src/replication/peer-caspar-connection.js'), /this\._onConnected\?\.\(\)/)
	})

	it('a skipped PGM command leaves no waiter behind (the next reply with that verb reaches its own command)', async () => {
		const transport = require('../../src/caspar/amcp-client-transport')
		const map = require('../../src/config/routing').getChannelMap({})
		const [pgm, prv] = [map.programChannels[0], map.previewChannels[0]]
		const sent = []
		const connection = { config: {}, _amcpSendQueue: Promise.resolve(), _amcpBatchDrain: null, response_callback: {},
			socket: { isConnected: true, send: (l) => sent.push(l) }, log() {} }
		const client = Object.assign(Object.create(transport), { _context: connection, isOffline: false })
		amcpFanout.setClusterFollowerCheck(() => true)
		try {
			const skipped = await client._send(`CLEAR ${pgm}-299`)
			assert.equal(skipped.skipped, true)
			assert.deepEqual(sent, [], 'not sent to the local Caspar')
			assert.equal((connection.response_callback.CLEAR || []).length, 0, 'no stale waiter')
			const p = client._send(`CLEAR ${prv}-299`)
			await new Promise((r) => setImmediate(r))
			assert.deepEqual(sent, [`CLEAR ${prv}-299`], 'PRV still goes out')
			connection.response_callback.CLEAR.shift()(null, '202 CLEAR OK')
			assert.equal((await p).ok, true)
		} finally {
			amcpFanout.setClusterFollowerCheck(null)
		}
	})
})
