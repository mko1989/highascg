'use strict'

/**
 * WO-772 — a hot backup that got the show's media AFTER its first catch-up stayed black until the next take (live
 * 25.10: .4 linked, shared show on, fan-out caught up 16 lines while .4 had 0 of 25 files → INFO 1 empty there; the
 * media send finished, still empty). A finished media send now replays the air journal to that server.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createClusterFanout } = require('../../src/cluster/cluster-fanout')
const { sendMedia } = require('../../src/cluster/cluster-media')

const own = {
	screenDestinations: { destinations: [{ id: 'd', mode: 'pgm_prv', mainScreenIndex: 0 }] },
	live: { caspar: { channelMap: { programChannels: [1], previewChannels: [2] } } },
}
const peer = {
	graph: { connectors: [{ id: 'c', kind: 'destination_in', externalRef: 'd' }], edges: [{ sourceId: 'c', sinkId: 'audio_1' }] },
	screenDestinations: own.screenDestinations,
	live: { caspar: { channelMap: { programChannels: [1], previewChannels: [2] } } },
}

function rig() {
	const conns = []
	const f = createClusterFanout({
		isMaster: () => true,
		pairEnabled: () => false,
		members: () => [{ id: 'b', host: '10.0.0.2', name: 'B', online: true }],
		peerView: async () => peer,
		ownView: async () => own,
		connect: (host, port, onConnected) => {
			const c = { isConnected: true, out: [], onConnected, stop() {}, enqueueSend(l) { this.out.push([l]) }, enqueueBatchLines(b) { this.out.push(b) } }
			conns.push(c)
			return c
		},
	})
	return { f, conns }
}

test('resync replays the journal once more to that server only', async () => {
	const { f, conns } = rig()
	f.send('PLAY 1-10 "LOOP czysty" LOOP')
	await f.refresh()
	assert.deepEqual(conns[0].out, [['PLAY 1-10 "LOOP czysty" LOOP']], 'first catch-up (the files were missing there)')
	await f.refresh()
	assert.equal(conns[0].out.length, 1, 'a refresh alone never replays again')
	assert.equal(f.resync('b'), true)
	assert.deepEqual(conns[0].out.at(-1), ['PLAY 1-10 "LOOP czysty" LOOP'], 'replayed after the media arrived')
	assert.equal(f.resync('nobody'), false)
})

test('sendMedia calls onSent only when the rsync succeeded', async () => {
	for (const ok of [true, false]) {
		const sent = []
		let polled
		const done = new Promise((r) => { polled = r })
		const r = await sendMedia('b', {
			cluster: {
				saved: () => ({ id: 'b', name: 'B', host: 'h', port: 4200, device_key: 'KEY' }),
				mediaSend: () => null,
				setMediaSend: () => {},
				poll: async () => polled(),
			},
			selfKey: 'SELF',
			sign: () => 'sig',
			sshKey: () => 'ssh-ed25519 AAAA test',
			post: async () => ({ ok: true, status: 200, json: {} }),
			project: async () => ({}),
			plan: () => ({ relPaths: ['a.mov'], slug: 's' }),
			rsync: async () => (ok ? { ok: true, files: 1 } : { ok: false, error: 'boom' }),
			onSent: (id) => sent.push(id),
		})
		assert.equal(r.status, 202)
		await done
		assert.deepEqual(sent, ok ? ['b'] : [], ok ? 'replay after a good send' : 'never after a failed one')
	}
})

test('routes-cluster wires onSent to the fan-out resync', () => {
	const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/api/routes-cluster.js'), 'utf8')
	assert.match(src, /onSent: \(id\) => ctx\._clusterFanout\?\.resync\(id\)/)
})
