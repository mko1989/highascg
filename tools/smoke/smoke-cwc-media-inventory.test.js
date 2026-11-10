'use strict'

/**
 * WO-1029 plan 07 C10 — media inventories: the scan (ids as looks store them), the digest, the paged wire answer, the
 * asker's cache (digest → `same`, pages, a change between pages), and "unknown, never missing" for an old / offline peer.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const inv = require('../../src/cluster/cluster-media-inventory')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-cwc-inv-'))
const put = (base, rel, bytes = 10) => {
	fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true })
	fs.writeFileSync(path.join(base, rel), Buffer.alloc(bytes))
}

/** A peer served by a local inventory, over a fake `have` call. */
function served(files) {
	let list = files
	const local = inv.createLocalInventory({ scan: async () => ({ files: list }), ttlMs: 0, info: () => ({ free_bytes: 1000, on_air: false, can_throttle: true }) })
	const calls = []
	const have = async (_id, args) => {
		calls.push(args)
		return { ok: true, status: 200, json: await local.answer(args) }
	}
	return { have, calls, set: (l) => (list = l) }
}

const rows = (n, prefix = 'C') => Array.from({ length: n }, (_, i) => ({ p: `${prefix}/clip_${String(i).padStart(5, '0')}.mp4`, id: `${prefix}/CLIP_${String(i).padStart(5, '0')}`, s: 1000 + i, m: 1731000000 + i }))

describe('WO-1029 C10 media inventory', () => {
	it('scan: Caspar ids, sizes, whole-second mtimes; skips dot files, the thumbnail bucket and non-media', async () => {
		const base = tmp()
		put(base, 'TESTOWE/Big_Buck_Bunny_1080p24.Y4M', 77) // owner 10.11: the real clip is a .Y4M
		put(base, 'still.png', 5)
		put(base, '.hidden.mp4')
		put(base, 'tb/thumb.png')
		put(base, 'notes.txt')
		const r = await inv.scanMediaInventory(base)
		assert.deepEqual(r.files.map((f) => f.id).sort(), ['STILL', 'TESTOWE/BIG_BUCK_BUNNY_1080P24'])
		const bb = r.files.find((f) => f.id.startsWith('TESTOWE'))
		assert.equal(bb.p, 'TESTOWE/Big_Buck_Bunny_1080p24.Y4M')
		assert.equal(inv.keyOf('testowe/big_buck_bunny_1080p24.y4m'), inv.keyOf('TESTOWE/BIG_BUCK_BUNNY_1080P24'))
		assert.equal(bb.s, 77)
		assert.ok(Number.isInteger(bb.m))
		assert.equal(r.truncated, false)
		const capped = await inv.scanMediaInventory(base, { maxFiles: 1 })
		assert.equal(capped.files.length, 1)
		assert.equal(capped.truncated, true)
		fs.rmSync(base, { recursive: true, force: true })
	})

	it('digest changes with size or mtime, not with order', () => {
		const a = rows(3)
		assert.equal(inv.digestOf(a), inv.digestOf([...a]))
		assert.notEqual(inv.digestOf(a), inv.digestOf([{ ...a[0], s: 1 }, a[1], a[2]]))
		assert.notEqual(inv.digestOf(a), inv.digestOf([{ ...a[0], m: 1 }, a[1], a[2]]))
	})

	it('wire: pages of at most PAGE_MAX rows; a current digest answers `same` with no rows', async () => {
		const local = inv.createLocalInventory({ scan: async () => ({ files: rows(7000) }), ttlMs: 60000 })
		const p0 = await local.answer({})
		assert.equal(p0.count, 7000)
		assert.equal(p0.files.length, inv.PAGE_MAX)
		const p1 = await local.answer({ offset: inv.PAGE_MAX })
		assert.equal(p1.files.length, 2000)
		const same = await local.answer({ digest: p0.digest })
		assert.equal(same.same, true)
		assert.equal(same.files, undefined)
		assert.ok(JSON.stringify(same).length < 300)
	})

	it('asker: pages through, then a digest round-trip only; refetches on change', async () => {
		const peer = served(rows(6000))
		const remote = inv.createRemoteInventories({ have: peer.have, ttlMs: 0 })
		const e = await remote.refresh('b')
		assert.equal(e.known, true)
		assert.equal(e.files.length, 6000)
		assert.equal(e.head.free_bytes, 1000)
		assert.equal(peer.calls.length, 2)
		peer.calls.length = 0
		await remote.refresh('b')
		assert.equal(peer.calls.length, 1, 'unchanged: one digest call')
		assert.ok(peer.calls[0].digest)
		peer.set(rows(6001))
		peer.calls.length = 0
		const e2 = await remote.refresh('b')
		assert.equal(e2.files.length, 6001)
		assert.equal(peer.calls.length, 2)
	})

	it('a change between pages starts over once', async () => {
		let n = 0
		const lists = [rows(6000), rows(6000, 'D')]
		const local = () => inv.createLocalInventory({ scan: async () => ({ files: lists[Math.min(n, 1)] }), ttlMs: 0 })
		const have = async (_id, args) => {
			const j = await local().answer(args)
			if (args.offset === 0 && n === 0) n = 1 // the next page comes from the changed list
			return { ok: true, status: 200, json: j }
		}
		const e = await inv.createRemoteInventories({ have }).refresh('b')
		assert.equal(e.known, true)
		assert.ok(e.files.every((f) => f.p.startsWith('D/')))
	})

	it('old build / offline / error → known: false with a reason (never an empty "has nothing")', async () => {
		const mk = (r) => inv.createRemoteInventories({ have: async () => r })
		assert.deepEqual(await mk({ ok: false, status: 404, json: { error: 'Not found' } }).refresh('x').then((e) => [e.known, e.reason]), [false, 'old build'])
		assert.deepEqual(await mk({ ok: false, status: 400, json: { error: 'unknown action "media.have"' } }).refresh('x').then((e) => [e.known, e.reason]), [false, 'old build'])
		assert.deepEqual(await mk({ ok: false, status: 0, error: 'timeout' }).refresh('x').then((e) => [e.known, e.reason]), [false, 'offline'])
		const r = mk({ ok: true, status: 200, json: {} })
		await r.refreshAll([{ id: 'y', online: false }])
		assert.equal(r.get('y').known, false)
		assert.equal(r.get('y').reason, 'offline')
		assert.equal(r.get('never').known, false)
	})

	it('10 000 files fit in two pages of a few hundred KB', async () => {
		const files = Array.from({ length: 10000 }, (_, i) => ({ p: `PROJECTS/SHOW_2026/Scene ${i} final_v2.mov`, id: '', s: 1234567890 + i, m: 1731234567 }))
		const local = inv.createLocalInventory({ scan: async () => ({ files }), ttlMs: 60000 })
		const p0 = JSON.stringify(await local.answer({}))
		const p1 = JSON.stringify(await local.answer({ offset: inv.PAGE_MAX }))
		const total = p0.length + p1.length
		assert.ok(total < 1_000_000, `10k rows = ${total} bytes`)
		console.log(`# 10 000 files: ${p0.length} + ${p1.length} bytes in 2 pages`)
	})
})
