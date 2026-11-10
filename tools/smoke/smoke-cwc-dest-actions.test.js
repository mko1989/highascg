'use strict'

/**
 * WO-1029 plan 07 Wave B (C5) — the receiver of node-to-node dest.* calls (src/cluster/dest-actions.js).
 * Fixtures: the two real boxes with `cluster.channelsWhereCabled` on (tools/smoke/lib/cwc-fixtures.js):
 *   highascg5867  screen 2 = ch 2/3 (dst_mw989wyz_1), screen 3 = ch 4/5 (dst_mw9orj4o_1); screens 0 and 1 not here
 *   highascg7579  screen 0 = ch 2/3 (dst_mw7t9epz_1); screens 1..3 not here
 * Each call resolves destId → THIS server's screen and runs its own route; unknown → 404 DEST_UNKNOWN_HERE; not cabled
 * here → 409 NOT_HERE with owners; last press wins by seq; it runs as a remote press (never relayed again); the
 * accept_remote duty locks it out; look.take stays as the alias.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { boxConfig, quiet, clone } = require('./lib/cwc-fixtures')
const { normalizeDeviceGraph } = require('../../src/config/device-graph')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { createDestActions } = require('../../src/cluster/dest-actions')
const { remotePress } = require('../../src/cluster/dest-route')
const { createClusterCall } = require('../../src/cluster/cluster-call')
const { createCallActions } = require('../../src/cluster/cluster-call-actions')

const D = { s0: 'dst_mw7t9epz_1', s1: 'dst_mw96s6pd_1', s2: 'dst_mw989wyz_1', s3: 'dst_mw9orj4o_1' }

function fakeAmcp(log) {
	const make = (path) =>
		new Proxy(() => {}, {
			get: (_t, k) => (k === 'then' ? undefined : make([...path, String(k)])),
			apply: (_t, _s, args) => {
				log.push(`${path.join('.')}(${args.join(',')})`)
				return Promise.resolve({ ok: true, data: [] })
			},
		})
	return make([])
}

/** A box ctx with the other box linked (its device view gives the owners of a 409). */
function ctxOf(box) {
	const cfg = clone(boxConfig(box))
	cfg.cluster = { channelsWhereCabled: true }
	const other = box === '5867' ? '7579' : '5867'
	const peer = boxConfig(other)
	const view = { graph: normalizeDeviceGraph(peer.deviceGraph), screenDestinations: normalizeScreenDestinations(peer.screenDestinations) }
	const calls = []
	const ctx = {
		config: cfg,
		amcp: fakeAmcp(calls),
		log: () => {},
		_wsBroadcast: () => {},
		_cluster: { snapshot: () => ({ peers: [{ id: `p${other}`, name: `highascg${other}`, online: true, caps: ['dest-actions'] }] }), deviceView: async () => ({ status: 200, body: view }) },
	}
	return { ctx, calls }
}

/** Route stubs recording what each action ran with (and whether it ran as a remote press). */
function stubs() {
	const ran = []
	const rec = (name) => async (...a) => (ran.push({ name, args: a, remote: remotePress() }), { status: 200, body: JSON.stringify({ ok: true, ran: name }) })
	const routes = Object.fromEntries(['takeLook', 'previewPush', 'clearProgram', 'clearPreview', 'ftb', 'testcard', 'audioOnlyStop', 'sceneTake', 'layerReload', 'layerScrub', 'nudge', 'timeline'].map((n) => [n, rec(n)]))
	return { ran, routes }
}

const peer = (id) => ({ id, name: `srv-${id}` })

describe('WO-1029 Wave B dest.* receiver: destId → this server\'s screen, its own route', () => {
	it('every call resolves the destination on two different channel maps', async () => {
		await quiet(async () => {
			for (const [box, destId, idx] of [['5867', D.s2, 2], ['5867', D.s3, 3], ['7579', D.s0, 0]]) {
				const { ctx } = ctxOf(box)
				const { ran, routes } = stubs()
				const a = createDestActions(ctx, { routes }).actions
				const p = peer('X')
				const go = async (name, args) => {
					const r = await a[name]({ destId, ...args }, p, {})
					assert.equal(r.status, 200, `${box} ${name}: ${JSON.stringify(r.body)}`)
					return ran.at(-1)
				}
				let x = await go('dest.take', { sceneId: 'L1', forceCut: true })
				assert.deepEqual(x.args[0], { sceneId: 'L1', mainIdx: idx, target: 'program', relayed: true, forceCut: true })
				assert.equal(x.remote.from, 'X', 'runs as a remote press: never relayed again')
				x = await go('dest.take', { sceneId: 'L1', bus: 'preview' })
				assert.equal(x.args[0].target, 'preview')
				x = await go('dest.preview', { body: { sceneId: 'L1', mainIdx: 9 } })
				assert.deepEqual(x.args[0], { sceneId: 'L1', mainIdx: idx })
				x = await go('dest.clear', { bus: 'preview' })
				assert.deepEqual([x.name, x.args[0]], ['clearPreview', { mainIndex: idx }])
				x = await go('dest.clear', { bus: 'program', cut: false })
				assert.deepEqual([x.name, x.args], ['clearProgram', [idx, false]])
				x = await go('dest.ftb', { body: { durationFrames: 0, screenIdx: 99 } })
				assert.deepEqual([x.args[0], JSON.parse(x.args[1]).screenIdx, JSON.parse(x.args[1]).durationFrames], ['/api/ftb', idx, 0])
				x = await go('dest.testcard', { on: true })
				assert.deepEqual([x.args[0], JSON.parse(x.args[1])], ['channel', { screenIdx: idx, enabled: true }])
				x = await go('dest.media', { op: 'take', body: { channel: 7, sceneId: 'S', takeGroup: { id: 'g', size: 2 } } })
				assert.deepEqual(x.args[0], { sceneId: 'S', screenIdx: idx }, 'raw channel and take group are dropped')
				x = await go('dest.media', { op: 'audio-only-stop', body: {} })
				assert.equal(x.name, 'audioOnlyStop')
				x = await go('dest.layer', { op: 'layer-reload', body: { sceneId: 'S', layerNumber: 10 } })
				assert.deepEqual(x.args[0], { sceneId: 'S', layerNumber: 10, mainIdx: idx })
				x = await go('dest.layer', { op: 'layer-scrub', body: { sceneId: 'S' } })
				assert.equal(x.name, 'layerScrub')
				x = await go('dest.mixer', { op: 'mixer-nudge', body: { sceneId: 'S', layers: [{}] } })
				assert.equal(x.args[0].mainIndex, idx)
				x = await go('dest.timeline', { op: 'play', timelineId: 't1', body: { sendTo: { program: true, screenIdx: 0 } } })
				assert.deepEqual([x.args[0], x.args[1], JSON.parse(x.args[2]).sendTo], ['POST', '/api/timelines/t1/play', { program: true, screenIdx: idx }])
				x = await go('dest.timeline', { op: 'play', timelineId: 't1', all: true, body: { sendTo: { program: true } } })
				assert.equal(JSON.parse(x.args[2]).sendTo.screenIdx, null, '`all`: every screen of this server')
				const bad = await a['dest.layer']({ destId, op: 'rm -rf' }, p, {})
				assert.equal(bad.status, 400)
				const badTl = await a['dest.timeline']({ destId, op: 'delete', timelineId: 't1' }, p, {})
				assert.equal(badTl.status, 400)
			}
		})
	})

	it('real routes: FTB and test card land on THIS box\'s channels for the destination', async () => {
		await quiet(async () => {
			for (const [box, destId, want] of [['5867', D.s3, ['4', '5']], ['7579', D.s0, ['2', '3']]]) {
				const { ctx, calls } = ctxOf(box)
				const a = createDestActions(ctx).actions
				const r = await a['dest.ftb']({ destId, body: { durationFrames: 0 } }, peer('X'), {})
				assert.equal(r.status, 200, JSON.stringify(r.body))
				const chans = new Set(calls.map((c) => (/^[\w.]+\((\d+)/.exec(c) || [])[1]).filter(Boolean))
				assert.deepEqual([...chans].sort(), want, `${box}: ${[...chans]}`)
				calls.length = 0
				const t = await a['dest.testcard']({ destId, on: true }, peer('X'), {})
				assert.ok(t.status === 200 || t.status === 502, JSON.stringify(t.body))
				assert.ok(calls.some((c) => c.includes(`(${want[0]},`)), `card on ${want[0]}: ${calls.slice(0, 3)}`)
			}
		})
	})

	it('unknown destination → 404 DEST_UNKNOWN_HERE; known but not cabled here → 409 NOT_HERE with its owners', async () => {
		await quiet(async () => {
			const { ctx } = ctxOf('5867')
			const { ran, routes } = stubs()
			const a = createDestActions(ctx, { routes }).actions
			const u = await a['dest.take']({ destId: 'dst_nope', sceneId: 'L' }, peer('X'), {})
			assert.equal(u.status, 404)
			assert.equal(u.body.code, 'DEST_UNKNOWN_HERE')
			const n = await a['dest.ftb']({ destId: D.s0 }, peer('X'), {})
			assert.equal(n.status, 409)
			assert.equal(n.body.code, 'NOT_HERE')
			assert.deepEqual(n.body.owners, ['p7579'])
			const none = await a['dest.ftb']({ destId: D.s1 }, peer('X'), {})
			assert.equal(none.status, 409)
			assert.deepEqual(none.body.owners, [])
			assert.equal((await a['dest.take']({ sceneId: 'L' }, peer('X'), {})).status, 400)
			assert.equal(ran.length, 0, 'nothing ran')
		})
	})

	it('last press wins by seq: older from the same sender / a racing older one from another → stale, not run', async () => {
		await quiet(async () => {
			const { ctx } = ctxOf('5867')
			const { ran, routes } = stubs()
			const clock = { t: 1000 }
			const a = createDestActions(ctx, { routes, now: () => clock.t }).actions
			const take = (from, seq) => a['dest.take']({ destId: D.s2, sceneId: 'L' }, peer(from), { seq })
			assert.equal((await take('X', 10)).body.stale, undefined)
			const st = await take('X', 9)
			assert.deepEqual([st.status, st.body.stale], [200, true])
			assert.equal((await take('Y', 5)).body.stale, true, 'another sender, older, raced within the window')
			clock.t += 2500
			assert.equal((await take('Y', 5)).body.stale, undefined, 'outside the window a press always applies (clocks may differ)')
			assert.equal((await take('X', 9)).body.stale, true, 'the same sender\'s older seq stays stale')
			// equal seq from two senders: the higher sender id wins (deterministic)
			assert.equal((await take('X', 50)).body.stale, undefined)
			assert.equal((await take('Y', 50)).body.stale, undefined, 'Y > X: applied')
			assert.equal((await take('X', 60)).body.stale, undefined)
			assert.equal((await take('W', 60)).body.stale, true, 'W < X: stale')
			assert.equal((await a['dest.take']({ destId: D.s3, sceneId: 'L' }, peer('W'), { seq: 1 })).body.stale, undefined, 'per destination')
			assert.equal(ran.length, 6)
		})
	})

	it('a press that arrives after its sender stopped waiting (ttlMs) is dropped: 409 DEST_EXPIRED, not run', async () => {
		await quiet(async () => {
			const { ctx } = ctxOf('5867')
			const { ran, routes } = stubs()
			const w = { t: 1_000_000 }
			const a = createDestActions(ctx, { routes, wall: () => w.t }).actions
			const send = (senderTs) => a['dest.take']({ destId: D.s2, sceneId: 'L', ttlMs: 4000 }, peer('X'), { ts: senderTs })
			// sender clock 10 min ahead: never compared, only the delivery delay counts
			assert.equal((await send(w.t + 600_000 - 5)).status, 200)
			w.t += 1000
			assert.equal((await send(w.t + 600_000 - 3)).status, 200, 'normal delivery')
			w.t += 6000
			const late = await send(w.t + 600_000 - 5000) // sent 5 s ago (frozen receiver)
			assert.deepEqual([late.status, late.body.code], [409, 'DEST_EXPIRED'])
			assert.equal(ran.length, 2)
		})
	})

	it('fanout: only the master runs a backup box\'s press as a local press (it drives the other owners)', async () => {
		await quiet(async () => {
			const { ctx } = ctxOf('5867')
			const { ran, routes } = stubs()
			let master = false
			const a = createDestActions(ctx, { routes, isMaster: () => master }).actions
			await a['dest.take']({ destId: D.s2, sceneId: 'L', fanout: true }, peer('X'), {})
			assert.equal(ran.at(-1).remote.fanout, false)
			master = true
			await a['dest.take']({ destId: D.s2, sceneId: 'L', fanout: true }, peer('X'), {})
			assert.equal(ran.at(-1).remote.fanout, true)
		})
	})

	it('dest.state (info): what that screen shows here, and the last remote press', async () => {
		await quiet(async () => {
			const { ctx } = ctxOf('5867')
			const { routes } = stubs()
			const d = createDestActions(ctx, { routes })
			await d.actions['dest.take']({ destId: D.s3, sceneId: 'L' }, peer('X'), { seq: 7 })
			const s = await d.info['dest.state']({ destId: D.s3 })
			assert.equal(s.status, 200)
			assert.equal(s.body.screen, 3)
			assert.equal(s.body.pgm.channel, 4)
			assert.equal(s.body.prv.channel, 5)
			assert.deepEqual([s.body.holder.from, s.body.holder.seq, s.body.holder.action], ['X', 7, 'dest.take'])
			assert.equal((await d.info['dest.state']({ destId: 'zz' })).status, 404)
		})
	})
})

describe('WO-1029 Wave B dest.* over the signed call transport', () => {
	const keyPair = () => {
		const k = crypto.generateKeyPairSync('ed25519')
		return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: k.privateKey }
	}
	const verify = (pem, msg, sig) => {
		try {
			return crypto.verify(null, Buffer.from(msg), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64'))
		} catch {
			return false
		}
	}
	function pair(actionsB) {
		const keys = { A: keyPair(), B: keyPair() }
		const nodes = {}
		for (const n of ['A', 'B']) {
			const o = n === 'A' ? 'B' : 'A'
			const peers = [{ id: o, host: o, port: 4200, name: `srv-${o}`, device_key: keys[o].pub.trim() }]
			const node = { accept: true }
			node.call = createClusterCall({
				cluster: { saved: (id) => peers.find((p) => p.id === id) || null, list: () => peers },
				selfKey: keys[n].pub,
				sign: (msg) => crypto.sign(null, Buffer.from(msg), keys[n].priv).toString('base64'),
				verify,
				peerCaps: () => ['call-signed'],
				post: async (host, port, p, body) => {
					const r = await nodes[host].call.handle(JSON.parse(JSON.stringify(body)))
					return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body }
				},
				acceptsRemote: () => node.accept,
				masterId: () => '',
				actions: n === 'B' ? actionsB : {},
				log: () => {},
			})
			nodes[n] = node
		}
		return nodes
	}

	it('registered in cluster-call-actions; accept_remote off → 403, nothing runs; look.take alias still works', async () => {
		await quiet(async () => {
			const { ctx } = ctxOf('5867')
			const { ran, routes } = stubs()
			const looks = []
			const actions = createCallActions(ctx, {
				destActions: createDestActions(ctx, { routes }),
				takeLook: async (b) => (looks.push(b), { status: 200, body: '{"ok":true}' }),
				heldFor: () => null,
				isFollower: () => false,
				callMaster: async () => ({ ok: false, status: 0 }),
			})
			for (const k of ['dest.take', 'dest.preview', 'dest.clear', 'dest.ftb', 'dest.testcard', 'dest.media', 'dest.layer', 'dest.mixer', 'dest.timeline', 'look.take'])
				assert.equal(typeof actions[k], 'function', k)
			const nodes = pair(actions)
			const seq = nodes.A.call.nextSeq(D.s2)
			const r = await nodes.A.call.call('B', 'dest.take', { destId: D.s2, sceneId: 'L' }, { seq, quiet: true })
			assert.equal(r.status, 200, JSON.stringify(r.json))
			assert.equal(ran.at(-1).args[0].mainIdx, 2)
			nodes.B.accept = false
			const no = await nodes.A.call.call('B', 'dest.ftb', { destId: D.s2 }, { seq: nodes.A.call.nextSeq(D.s2), quiet: true })
			assert.equal(no.status, 403)
			assert.equal(ran.length, 1)
			nodes.B.accept = true
			const alias = await nodes.A.call.call('B', 'look.take', { sceneId: 'L', mainIdx: 2, relayed: true }, { quiet: true })
			assert.equal(alias.status, 200)
			assert.equal(looks.length, 1)
			// an older seq sent after a newer one is stale on the receiver (arrival order ≠ press order)
			const s1 = nodes.A.call.nextSeq(D.s2)
			const s2 = nodes.A.call.nextSeq(D.s2)
			assert.equal((await nodes.A.call.call('B', 'dest.take', { destId: D.s2, sceneId: 'N' }, { seq: s2, quiet: true })).json.stale, undefined)
			assert.equal((await nodes.A.call.call('B', 'dest.take', { destId: D.s2, sceneId: 'O' }, { seq: s1, quiet: true })).json.stale, true)
		})
	})
})
