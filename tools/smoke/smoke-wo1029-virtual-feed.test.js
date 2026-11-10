'use strict'

/**
 * WO-1029 plan 07 C9 — the picture relay on the virtual box bed (cwcBoxes: A outputs screen 1, B screens 3 and 4).
 * The fake Caspars have no pictures: every node's video feed sends stamped test JPEGs (tools/e2e/feed-frame-provider.js,
 * HIGHASCG_SANDBOX_FEED_FRAMES = the box id). A client on box A asks ITS node for `pgm3` (screen 3, on B) and must
 * receive frames that B encoded — for the relay tier, at the small size — while A's own Caspar is never asked for a
 * consumer. Auth is on (password): the node-to-node upgrade carries a signed token instead; a stranger's is refused.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const WebSocket = require('ws')
const { startVirtualBoxes, cwcBoxes, DEST } = require('../e2e/virtual-boxes')
const { createRemoteClient } = require('../e2e/remote-client')
const { readStamp } = require('../e2e/feed-frame-provider')
const { waitFor, clusterView } = require('../e2e/cluster-nodes')
const { makeFeedToken } = require('../../src/cluster/feed-relay-auth')
const { fingerprint } = require('../../src/cluster/cluster-media')

const P3 = DEST.pgm3.id
const PW = 'feed-pw'
const consumerLines = (bed, id, m) => bed.box(id).caspar.since(m[id]).filter((e) => /^(ADD|REMOVE)\s.*SHM|^REMOVE\s/i.test(e.line))

describe('WO-1029 C9 virtual boxes: a client on A sees screen 3 (on B) through A\'s node', { timeout: 58000 }, () => {
	const c = {}
	before(async () => {
		c.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1029-vb-feed-'))
		c.bed = await startVirtualBoxes(c.tmp, cwcBoxes({ base: 210, feedFrames: true, password: PW }))
		await c.bed.linkAll()
		await waitFor('A knows B owns screen 3 and relays pictures', async () => {
			const v = await clusterView(c.bed.box('vb-a').node)
			const d = (v?.destinations || []).find((x) => x.id === P3)
			const b = (v?.peers || []).find((p) => p.id === 'vb-b')
			return d?.kind === 'remote' && b?.caps?.includes('feed-relay')
		}, 20000, 300)
		c.client = createRemoteClient({ url: c.bed.box('vb-a').node.url, password: PW, localAddress: '127.0.3.211' })
	})
	after(async () => {
		c.client?.close()
		if (c.bed) await c.bed.stop()
		if (c.tmp) fs.rmSync(c.tmp, { recursive: true, force: true })
	})

	it('A marks pgm3 as a relayed role (transport feed, owner B); its own screen stays shared memory', async () => {
		const r = await c.client.post('/api/video-surfaces/lease', { clientId: 'vb-feed-probe', roles: [] })
		assert.equal(r.status, 200)
		const by = Object.fromEntries(r.data.surfaces.map((s) => [s.role, s]))
		assert.equal(by.pgm3.transport, 'feed')
		assert.equal(by.pgm3.relay.server.id, 'vb-b')
		assert.equal(by.pgm1.transport, undefined, 'screen 1 is here')
	})

	it('frames for pgm3 on A come from B, encoded small for the relay; A\'s Caspar is never asked', async () => {
		const { bed } = c
		const m = bed.mark()
		const lease = () => c.client.post('/api/video-surfaces/lease', { clientId: 'vb-feed-godot', roles: ['pgm3'] })
		assert.equal((await lease()).status, 200)
		const feed = await new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://${new URL(bed.box('vb-a').node.url).host}/api/video-feed?width=960&fps=15`, { headers: { Authorization: `Bearer ${PW}` } })
			ws.on('open', () => resolve(ws))
			ws.on('error', reject)
		})
		const stamps = []
		feed.on('message', (data, bin) => {
			if (!bin) return
			const b = Buffer.from(data)
			stamps.push({ role: b.subarray(1, 1 + b[0]).toString('latin1'), stamp: readStamp(b.subarray(1 + b[0])) })
		})
		feed.send(JSON.stringify({ roles: ['pgm3'] }))
		await waitFor('relayed frames on A', async () => stamps.length >= 3, 10000, 100)
		for (const s of stamps) {
			assert.equal(s.role, 'pgm3', 'served under the plain role name')
			assert.equal(s.stamp?.box, 'vb-b', 'encoded on B')
			assert.equal(s.stamp.role, 'pgm3~relay', 'B encoded it for the relay tier')
			assert.equal(s.stamp.width, 480, 'at the relay size, not the 960 the client asked A for')
			assert.equal(s.stamp.fps, 10)
		}
		assert.deepEqual(consumerLines(bed, 'vb-a', m), [], 'A\'s fake Caspar got no consumer ADD / REMOVE')
		assert.ok(consumerLines(bed, 'vb-b', m).some((e) => /^ADD\s.*SHM.*pgm3/i.test(e.line)), 'B leased its own screen 3 consumer for the relay')
		const st = await c.client.get('/api/video-surfaces')
		assert.equal(st.data.surfaces.find((s) => s.role === 'pgm3').relay.state, 'live')

		// the client lets go: the upstream stops after the linger and B drops its consumer
		feed.close()
		await c.client.post('/api/video-surfaces/lease', { clientId: 'vb-feed-godot', roles: [] })
		await waitFor('A closes the upstream after the linger', async () => (await c.client.get('/api/video-surfaces')).data.surfaces.find((s) => s.role === 'pgm3').relay.state === 'idle', 8000, 200)
		// the REMOVE after the ADD (the one before it is the manager's quiet clean-up of the index)
		await waitFor('B removes its relay consumer', async () => {
			const l = consumerLines(bed, 'vb-b', m)
			const add = l.findIndex((e) => /^ADD\s.*SHM.*pgm3/i.test(e.line))
			return l.slice(add + 1).some((e) => /^REMOVE\s/i.test(e.line))
		}, 8000, 200)
	})

	it('B refuses a relay token from a server it is not linked with, and a malformed one (auth on, no password needed to say no)', async () => {
		const bHost = new URL(c.bed.box('vb-b').node.url).host
		const bKey = (await c.client.get('/api/cluster')).data.peers.find((p) => p.id === 'vb-b')
		const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
		const strangerFp = fingerprint(publicKey.export({ type: 'spki', format: 'pem' }))
		const to = bKey?.fp || '0'.repeat(16)
		const tok = makeFeedToken({ from: strangerFp, to, ts: Date.now(), sign: (t) => crypto.sign(null, Buffer.from(t), privateKey).toString('base64') })
		const tryUp = (q) =>
			new Promise((resolve) => {
				const ws = new WebSocket(`ws://${bHost}/api/video-feed?width=480&fps=10&relay=${q}`)
				ws.on('open', () => (ws.close(), resolve(101)))
				ws.on('unexpected-response', (_r, res) => resolve(res.statusCode))
				ws.on('error', () => resolve(0))
			})
		const s1 = await tryUp(tok)
		assert.ok(bKey?.fp, 'A knows B by its key fingerprint')
		assert.equal(s1, 403, 'a stranger (not linked on B) is refused')
		assert.equal(await tryUp('garbage'), 400)
	})
})
