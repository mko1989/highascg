'use strict'

/**
 * WO-1106 C23 / C24 — the call-floor store (call-replay-guard.js) and the hello floor (cluster-hello.js).
 * C24: floors are bounded PER NAMESPACE and a sender still linked here is never evicted.
 * C23: the hello replay floor survives a restart of the receiver; the live sender gets one 409 and counts on.
 * Temp files only; fake keys (a hash signature, as tools/smoke/lib/cluster-lan.js).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createFloorStore, MAX_PER_NS, PERSIST_AHEAD_MS } = require('../../src/cluster/call-replay-guard')
const { createHello } = require('../../src/cluster/cluster-hello')
const { parseAddress } = require('../../src/cluster/cluster-peers')
const { fingerprint } = require('../../src/cluster/cluster-media')

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-wo1106-floor-')), 'cluster-call-floor.json')
const fp = (i) => crypto.createHash('sha256').update(String(i)).digest('hex').slice(0, 16)

describe('WO-1106 C24 floor store sizing', () => {
	it('one namespace filling up does not push out another namespace\'s floors', () => {
		const file = tmpFile()
		const st = createFloorStore({ file })
		for (const ns of ['call', 'ssh', 'media-call', 'feed-feed']) st.set(`${ns}:${fp('peer')}`, 5)
		for (let i = 0; i < MAX_PER_NS + 10; i++) st.set(`hello:${fp(i)}`, i + 1)
		const again = createFloorStore({ file })
		for (const ns of ['call', 'ssh', 'media-call', 'feed-feed']) assert.equal(again.get(`${ns}:${fp('peer')}`), 5, ns)
		const saved = JSON.parse(fs.readFileSync(file, 'utf8')).floors
		assert.equal(Object.keys(saved).filter((k) => k.startsWith('hello:')).length, MAX_PER_NS)
		assert.equal(saved[`hello:${fp(0)}`], undefined, 'the oldest unlinked one went')
	})

	it('a fingerprint still linked here is never evicted, however old its write', () => {
		const file = tmpFile()
		const st = createFloorStore({ file, linked: () => [fp('linked')] })
		st.set(`call:${fp('linked')}`, 7)
		for (let i = 0; i < 3 * MAX_PER_NS; i++) st.set(`call:${fp(i)}`, i + 1)
		assert.equal(createFloorStore({ file }).get(`call:${fp('linked')}`), 7)
		const saved = JSON.parse(fs.readFileSync(file, 'utf8')).floors
		assert.equal(Object.keys(saved).length, MAX_PER_NS)
	})

	it('the shared store keeps the senders linked in the node\'s peer list', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/cluster/call-replay-guard.js'), 'utf8')
		assert.match(src, /createFloorStore\(\{ log, linked: linkedHere \}\)/)
		assert.match(src, /linkedFingerprints\(require\('\.\.\/utils\/persistence'\)\)/)
	})
})

describe('WO-1106 C23 hello floor survives a restart', () => {
	const sig = (key, msg) => crypto.createHash('sha256').update(`${key}|${msg}`).digest('base64')
	const KEY_A = '-----KEY boxA-----'
	const KEY_B = '-----KEY boxB-----'
	let t = 1_800_000_000_000
	const now = () => t
	/** Receiver B's hello handler on `floorStore`, with A saved at `host`. */
	function receiver(floorStore, host) {
		const peers = new Map([['boxA', { saved: { id: 'boxA', host, port: 4200, name: 'A', device_key: KEY_A }, live: { online: true, via: 'poll' } }]])
		const h = createHello({ peers, selfKey: KEY_B, sign: (m) => sig(KEY_B, m), verify: (k, m, s) => sig(k, m) === s, request: async () => ({}),
			localAddress: async () => '', selfId: () => 'boxB', parseAddress, now, save: () => {}, changed: () => {}, log: () => {}, floorStore })
		return { h, peer: peers.get('boxA') }
	}
	/** Sender A, its hellos delivered to `to()`'s handler. */
	function sender(address, to) {
		const p = { saved: { id: 'boxB', host: '10.0.0.2', port: 4200, name: 'B', device_key: KEY_B }, live: { online: true, via: 'poll' } }
		const h = createHello({ peers: new Map(), selfKey: KEY_A, sign: (m) => sig(KEY_A, m), verify: () => false, localAddress: async () => address,
			request: async (_m, _h, _p, _u, body) => {
				const r = to().h.handle(body)
				return { ok: r.status === 200, status: r.status, json: r.body }
			}, selfId: () => 'boxA', selfPort: () => 4200, parseAddress, now, save: () => {}, changed: () => {}, log: () => {} })
		return { send: () => h.send(p), p }
	}

	it('an old captured hello cannot re-address the server after the receiver restarts; the live sender counts on', async () => {
		const file = tmpFile()
		let rx = receiver(createFloorStore({ file }), '10.0.0.1')
		const captured = []
		const ax = sender('10.0.0.1', () => rx)
		const tap = rx.h.handle
		rx.h.handle = (b) => (captured.push(b), tap(b))
		await ax.send()
		assert.equal(ax.p.hello.status, 200)
		const old = captured[0]
		// A moves; its next hello re-addresses it
		t += 5000
		const moved = sender('10.0.0.36', () => rx)
		await moved.send()
		assert.equal(rx.peer.saved.host, '10.0.0.36')
		const stored = JSON.parse(fs.readFileSync(file, 'utf8')).floors[`hello:${fingerprint(KEY_A)}`]
		assert.equal(stored, old.ts + PERSIST_AHEAD_MS, 'written ahead, once (the second hello stayed under it)')
		// B restarts: a new handler on the same file, A saved at its new address
		rx = receiver(createFloorStore({ file }), '10.0.0.36')
		const replay = rx.h.handle(old)
		assert.equal(replay.status, 409, 'the captured hello is below the restored floor')
		assert.equal(rx.peer.saved.host, '10.0.0.36', 'not sent back to its old address')
		// the live A, clock under the floor: one 409 with `last`, resent above it, taken
		t += 5000
		await moved.send()
		assert.equal(moved.p.hello.status, 200)
		assert.equal(rx.peer.saved.host, '10.0.0.36')
		assert.equal(rx.peer.live.online, true)
	})
})
