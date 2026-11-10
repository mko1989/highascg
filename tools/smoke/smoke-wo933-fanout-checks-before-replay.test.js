'use strict'

/**
 * WO-933 — the cluster master asks a server's Caspar what is on air before replaying its air journal there
 * (src/cluster/cluster-peer-info.js, cluster-fanout.js check): a Caspar that kept playing is not cut back to frame 0.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

const { createClusterFanout } = require('../../src/cluster/cluster-fanout')
const { expectedLayers, channelOnAir, queryChannels } = require('../../src/cluster/cluster-peer-info')

/** INFO <ch> XML in the shape of this build (Caspar 2.5: `<file><name>`, producer type as text). */
const channelXml = (layers) =>
	`<?xml version="1.0" encoding="utf-8"?>\n<channel>\n<format>1080p5000</format>\n<stage>\n<layer>\n${Object.entries(layers)
		.map(([l, fg]) =>
			fg
				? `<layer_${l}><foreground><file><name>${fg.name || ''}</name></file><paused>false</paused><producer>${fg.type || 'ffmpeg'}</producer></foreground></layer_${l}>`
				: `<layer_${l}><foreground><paused>false</paused><producer>empty</producer></foreground></layer_${l}>`
		)
		.join('\n')}\n</layer>\n</stage>\n</channel>\n`

describe('WO-933 what the journal puts on air', () => {
	it('per layer: the clip, LOADBG + PLAY, STOP, CG; mixer-only layers are not compared', () => {
		const lines = [
			'MIXER 1 MASTERVOLUME 0.8',
			'PLAY 1-10 "projects/a/LOOK" LOOP',
			'LOADBG 1-20 "B" MIX 10',
			'PLAY 1-20',
			'PLAY 1-30 "GONE"',
			'STOP 1-30',
			'MIXER 1-40 OPACITY 0.5',
			'CG 1-50 ADD 1 "lower" 1',
			'PLAY 1-60 route://2',
			'PLAY 2-10 "OTHER CHANNEL"',
		]
		const want = expectedLayers(lines, 1)
		assert.deepEqual([...want.keys()], [10, 20, 50, 60])
		assert.equal(want.get(10).fg, 'projects/a/LOOK')
		assert.equal(want.get(20).fg, 'B')
		assert.equal(want.get(50).cg, true)
	})

	it('a channel is on air when every journal layer shows its clip (any producer for a non-file source)', async () => {
		const lines = ['PLAY 1-10 "projects/a/LOOK" LOOP', 'PLAY 1-60 route://2', 'MIXER 1-10 OPACITY 0.5']
		const xml = channelXml({ 10: { name: 'projects/a/LOOK' }, 60: { type: 'route' }, 70: { name: 'EXTRA' } })
		assert.equal(await channelOnAir(lines, 1, xml), true)
		assert.equal(await channelOnAir(lines, 1, channelXml({ 10: { name: 'projects/a/OTHER' }, 60: { type: 'route' } })), false)
		assert.equal(await channelOnAir(lines, 1, channelXml({ 10: { name: 'projects/a/LOOK' }, 60: null })), false)
		assert.equal(await channelOnAir(lines, 1, ''), false, 'Caspar refused INFO')
		assert.equal(await channelOnAir(['MIXER 1 MASTERVOLUME 1'], 1, ''), true, 'nothing to compare')
	})

	it('queryChannels reads one reply per channel and gives up on a dead Caspar', async () => {
		const srv = net.createServer((s) => {
			let buf = ''
			s.on('data', (d) => {
				buf += d
				let i
				while ((i = buf.indexOf('\r\n')) >= 0) {
					const ch = Number(buf.slice(0, i).split(' ')[1])
					buf = buf.slice(i + 2)
					// the XML ends "\n\r\n" on the wire; the 2nd reply arrives in two pieces
					if (ch === 9) s.write('401 INFO ERROR\r\n')
					else {
						const body = `201 INFO OK\r\n${channelXml({ 10: { name: `CH${ch}` } })}\r\n`
						s.write(body.slice(0, 40))
						setTimeout(() => s.write(body.slice(40)), 5)
					}
				}
			})
		})
		await new Promise((r) => srv.listen(0, '127.0.0.1', r))
		const port = srv.address().port
		const out = await queryChannels('127.0.0.1', port, [2, 9, 3])
		assert.deepEqual([...out.keys()], [2, 9, 3])
		assert.match(out.get(3), /<name>CH3<\/name>[\s\S]*<\/channel>$/)
		assert.equal(out.get(9), '')
		srv.close()
		assert.equal(await queryChannels('127.0.0.1', port, [1], 500), null)
	})
})

describe('WO-933 catch-up checks before it replays', () => {
	const own = {
		screenDestinations: { destinations: [{ id: 'd', mode: 'pgm_prv', mainScreenIndex: 0 }] },
		live: { caspar: { channelMap: { programChannels: [1], previewChannels: [2] } } },
		// WO-1029 2a: cabled on the master too → a BACKUP screen, caught up from the air journal as before
		graph: { connectors: [{ id: 'm', kind: 'destination_in', externalRef: 'd' }], edges: [{ sourceId: 'm', sinkId: 'gpu' }] },
	}
	const peerView = {
		graph: { connectors: [{ id: 'c', kind: 'destination_in', externalRef: 'd' }], edges: [{ sourceId: 'c', sinkId: 'gpu' }] },
		screenDestinations: own.screenDestinations,
		live: { caspar: { port: 5260, channelMap: { programChannels: [11], previewChannels: [12] } } },
	}

	/** onAir: peer channel → its layers; `gate` holds the INFO answer until released. */
	function rig(onAir) {
		const conns = []
		const asked = []
		let release = () => {}
		const st = { gate: null }
		const f = createClusterFanout({
			isMaster: () => true,
			pairEnabled: () => false,
			members: () => [{ id: 'b', host: '10.0.0.2', name: 'B', online: true }],
			peerView: async () => peerView,
			ownView: async () => own,
			connect: (host, port, onConnected) => {
				const c = { isConnected: false, out: [], onConnected, stop() {}, enqueueSend(l) { this.out.push([l]) },
					enqueueBatchLines(b) { this.out.push(b) } }
				conns.push(c)
				return c
			},
			queryInfo: async (host, port, chs) => {
				asked.push({ host, port, chs })
				if (st.gate) await new Promise((r) => (release = r))
				if (onAir === null) return null
				return new Map(chs.map((ch) => [ch, onAir[ch] ? channelXml(onAir[ch]) : channelXml({})]))
			},
		})
		return { f, conns, asked, st, release: () => release() }
	}
	const settle = () => new Promise((r) => setImmediate(r))
	async function connected(r) {
		await r.f.refresh()
		r.conns[0].isConnected = true
		r.conns[0].onConnected()
		for (let i = 0; i < 5; i++) await settle()
		return r.conns[0]
	}

	it('a Caspar that kept playing gets only the mixer lines; a channel that differs is replayed', async () => {
		const r = rig({ 11: { 10: { name: 'LOOK' } }, 12: { 10: { name: 'STALE' } } })
		r.f.send('PLAY 1-10 "LOOK" LOOP')
		r.f.send('MIXER 1-10 OPACITY 0.5')
		r.f.send('PLAY 2-10 "NEXT"')
		const c = await connected(r)
		assert.deepEqual(r.asked, [{ host: '10.0.0.2', port: 5260, chs: [11, 12] }])
		assert.deepEqual(c.out, [['MIXER 11-10 OPACITY 0.5'], ['PLAY 12-10 "NEXT"']])
		assert.deepEqual(r.f.status().peers.b.caught_up.kept, [1])
		r.f.send('PLAY 1-20 "NEW"')
		assert.deepEqual(c.out.at(-1), ['PLAY 11-20 "NEW"'], 'synced: new lines go straight through')
	})

	it('a restarted (empty) Caspar, or one that does not answer, is replayed as before', async () => {
		for (const onAir of [{}, null]) {
			const r = rig(onAir)
			r.f.send('PLAY 1-10 "LOOK" LOOP')
			const c = await connected(r)
			assert.deepEqual(c.out, [['PLAY 11-10 "LOOK" LOOP']])
		}
	})

	it('lines sent while the check runs are held and land after the decision, once', async () => {
		const r = rig({ 11: { 10: { name: 'LOOK' } } })
		r.st.gate = true
		r.f.send('PLAY 1-10 "LOOK" LOOP')
		await r.f.refresh()
		const c = r.conns[0]
		c.isConnected = true
		c.onConnected()
		await settle()
		r.f.send('PLAY 1-20 "NEW"')
		await r.f.refresh()
		assert.deepEqual(c.out, [], 'nothing before the answer')
		assert.equal(r.asked.length, 1, 'one check at a time')
		r.release()
		for (let i = 0; i < 5; i++) await settle()
		assert.deepEqual(c.out, [['PLAY 11-20 "NEW"']])
	})

	it('a reconnect during the check discards the old answer; the new connection decides', async () => {
		const r = rig({})
		r.st.gate = true
		r.f.send('PLAY 1-10 "LOOK" LOOP')
		await r.f.refresh()
		const c = r.conns[0]
		c.isConnected = true
		c.onConnected()
		await settle()
		const first = r.release
		r.st.gate = null
		c.onConnected()
		for (let i = 0; i < 5; i++) await settle()
		assert.deepEqual(c.out, [['PLAY 11-10 "LOOK" LOOP']])
		first()
		for (let i = 0; i < 5; i++) await settle()
		assert.equal(c.out.length, 1, 'the stale answer sends nothing')
	})
})
