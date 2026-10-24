'use strict'

/**
 * WO-725 — what a cluster run checks, in order. Each step throws on a failure and returns its measurements. Steps
 * marked `sandbox` freeze / restart servers and only run on throwaway sandbox servers; the rest also run on real
 * servers (`--live`), where they change nothing but the link and the master (the runner restores both).
 *
 * The contracts come from the WOs that built them: WO-670 P2 (link), P3a (master, epoch fencing, auto failover after
 * FAILOVER_MS = 12 s, cluster-master.js), WO-712 R2 (signed calls + allow-list), WO-723 (sender choice in sync).
 */

const assert = require('node:assert/strict')
const { waitFor, clusterView } = require('./cluster-nodes')
const { benchNode } = require('./cluster-bench')

const FAILOVER_MS = 12000
const CLOCK_MAX_MS = 5000
const pct = (a, p) => +a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(1)

/** Every node's view, in node order (null = did not answer). */
const views = (nodes) => Promise.all(nodes.map((n) => clusterView(n)))

/** The master every answering node agrees on → { master: node, epoch } or null. */
async function agreedMaster(nodes, among = nodes) {
	const vs = await views(among)
	if (vs.some((v) => !v)) return null
	const heads = vs.map((v, i) => (v.master.is_master ? among[i].id : v.master.master_id))
	const epochs = vs.map((v) => v.master.epoch)
	if (new Set(heads).size !== 1 || new Set(epochs).size !== 1 || !heads[0] || !(epochs[0] > 0)) return null
	if (vs.filter((v) => v.master.is_master).length !== 1) return null
	return { master: nodes.find((n) => n.id === heads[0]), epoch: epochs[0] }
}

async function allLinkedOnline(nodes) {
	const vs = await views(nodes)
	return vs.every((v, i) => v && nodes.every((o) => o === nodes[i] || v.peers.some((p) => p.id === o.id && p.online)))
}

async function fingerprints(nodes) {
	return Object.fromEntries(await Promise.all(nodes.map(async (n) => [n.id, (await n.get('/api/cluster/identity')).data?.fingerprint])))
}

const steps = [
	{
		name: 'each server alone: API timing, one by one',
		async run({ nodes, benchN = 100 }) {
			const out = {}
			for (const n of nodes) {
				out[n.id] = await benchNode(n, { n: benchN })
				const errors = Object.values(out[n.id]).reduce((a, r) => a + r.errors, 0)
				assert.equal(errors, 0, `${n.id}: ${errors} failed requests`)
			}
			return out
		},
	},
	{
		// WO-728: .4 and this box ran 17 s apart with NTP off (WO-724); signed calls refuse past ±60 s
		name: `clocks: every server within ${CLOCK_MAX_MS / 1000} s of the others`,
		async run({ nodes }) {
			const off = {}
			for (const n of nodes) {
				const t0 = Date.now()
				const r = await n.get('/api/replication/ping')
				assert.equal(typeof r.data?.serverTimeMs, 'number', `${n.id}: no serverTimeMs`)
				off[n.id] = Math.round(r.data.serverTimeMs - (t0 + Date.now()) / 2)
			}
			const spread = Math.max(...Object.values(off)) - Math.min(...Object.values(off))
			assert.ok(spread <= CLOCK_MAX_MS, `clocks ${spread} ms apart (${JSON.stringify(off)}): turn NTP on (Settings → System → System time)`)
			return { offsetMs: off, spreadMs: spread }
		},
	},
	{
		name: 'link every pair once: the other server accepts the invite (WO-732, WO-739)',
		async run({ nodes }) {
			const ms = []
			let accepted = 0
			for (const [i, a] of nodes.entries())
				for (const b of nodes.slice(i + 1)) {
					const r = await a.post('/api/cluster/peers', { address: b.address })
					assert.ok(r.status === 201 || r.status === 200, `${a.id} → ${b.id}: ${r.status} ${JSON.stringify(r.data)}`)
					assert.equal(r.data.peer.id, b.id, `${a.id} lists ${b.address} under its own id`)
					if (r.data.link_back?.pending) {
						// WO-739: an invite there (no auto-accept) — its operator accepts
						const inv = (await b.get('/api/cluster')).data?.invites || []
						assert.ok(inv.some((x) => x.id === a.id), `${b.id} shows ${a.id}'s invite: ${JSON.stringify(inv)}`)
						const acc = await b.post(`/api/cluster/invites/${encodeURIComponent(a.id)}/accept`, {})
						assert.ok(acc.status === 201 || acc.status === 200, `${b.id} accepts ${a.id}: ${acc.status} ${JSON.stringify(acc.data)}`)
						assert.equal(acc.data.link_back?.ok, true, `${a.id} already lists ${b.id}: ${JSON.stringify(acc.data.link_back)}`)
						accepted++
					} else assert.equal(r.data.link_back?.ok, true, `${b.id} linked ${a.id} back: ${JSON.stringify(r.data.link_back)}`)
					ms.push(r.ms)
				}
			const online = await waitFor('every server sees every other online', () => allLinkedOnline(nodes), 10000)
			return { links: ms.length, accepted, linkMsMax: +Math.max(...ms).toFixed(1), allOnlineMs: online.ms }
		},
	},
	{
		name: 'linked: the same API timing while linked',
		async run({ nodes, benchN = 100 }) {
			const out = {}
			for (const n of nodes) {
				out[n.id] = await benchNode(n, { n: benchN })
				const errors = Object.values(out[n.id]).reduce((a, r) => a + r.errors, 0)
				assert.equal(errors, 0, `${n.id}: ${errors} failed requests`)
			}
			return out
		},
	},
	{
		name: 'link refusals (itself, not a HighAsCG server)',
		async run({ nodes }) {
			const self = await nodes[0].post('/api/cluster/peers', { address: nodes[0].address })
			assert.equal(self.status, 400, JSON.stringify(self.data))
			const none = await nodes[0].post('/api/cluster/peers', { address: '127.0.0.1:9' })
			assert.equal(none.status, 404, JSON.stringify(none.data))
			return { self: self.data.error, none: none.data.error }
		},
	},
	{
		name: 'master: set on one, every server agrees (epoch fencing)',
		async run({ nodes }) {
			const out = {}
			let epoch = (await agreedMaster(nodes))?.epoch || 0
			// every server takes the master role once, then the first one again (ends where the later steps expect)
			for (const n of [...nodes, nodes[0]]) {
				const r = await n.post('/api/cluster/master/set', { master: 'self', auto: true })
				assert.equal(r.status, 200, JSON.stringify(r.data))
				assert.ok(r.data.epoch > epoch, `epoch grows: ${r.data.epoch} > ${epoch}`)
				epoch = r.data.epoch
				const seen = await waitFor(`every server follows ${n.id}`, async () => {
					const m = await agreedMaster(nodes)
					return m && m.master === n && m.epoch === epoch && m
				}, 5000, 20)
				out[`${n.id}@${epoch}`] = seen.ms
				// a sandbox master never forwards takes: its peers' Caspar would be this box's live one (routes-cluster.js)
				if (n.kind === 'sandbox') assert.equal((await clusterView(n)).fanout.active, false, `${n.id} forwards takes`)
			}
			return { agreeMs: out }
		},
	},
	{
		name: 'signed calls: a look take reaches the other server, the allow-list holds',
		async run({ nodes, calls = 30 }) {
			const out = {}
			for (let i = 0; i < nodes.length; i++) {
				const a = nodes[i]
				const b = nodes[(i + 1) % nodes.length]
				const take = { peer: b.id, action: 'look.take', args: { sceneId: 'wo725_no_such_look', target: 'preview' } }
				const ms = []
				for (let k = 0; k < calls; k++) {
					const r = await a.post('/api/cluster/send', take)
					assert.equal(r.status, 404, `${a.id} → ${b.id}: ${r.status} ${JSON.stringify(r.data)}`)
					assert.match(String(r.data?.error), /not found/)
					ms.push(r.ms)
				}
				ms.sort((x, y) => x - y)
				const bad = await a.post('/api/cluster/send', { peer: b.id, action: 'system.shutdown', args: {} })
				assert.equal(bad.status, 400, `not allow-listed: ${bad.status}`)
				assert.match(String(bad.data?.error), /unknown action/)
				const nobody = await a.post('/api/cluster/send', { ...take, peer: 'wo725-nobody' })
				assert.equal(nobody.status, 404)
				out[`${a.id}→${b.id}`] = { p50: pct(ms, 50), p95: pct(ms, 95), max: pct(ms, 100) }
			}
			return out
		},
	},
	{
		name: 'sender choice: one server picked, every server agrees; Auto = the master',
		async run({ nodes }) {
			const fp = await fingerprints(nodes)
			const pick = nodes[nodes.length - 1]
			const here = async (kind) => Promise.all(nodes.map(async (n) => (await n.get('/api/server/senders')).data?.senders?.[kind]))
			const r = await nodes[0].post('/api/server/senders', { kind: 'lighting', by: fp[pick.id] })
			assert.equal(r.status, 200, JSON.stringify(r.data))
			const picked = await waitFor(`lighting on ${pick.id} everywhere`, async () => {
				const s = await here('lighting')
				return s.every((e, i) => e && e.by === fp[pick.id] && e.here === (nodes[i] === pick)) && s
			}, 8000)
			await nodes[0].post('/api/server/senders', { kind: 'lighting', by: '' })
			const master = (await agreedMaster(nodes)).master
			const auto = await waitFor(`Auto lighting on the master (${master.id}) everywhere`, async () => {
				const s = await here('lighting')
				return s.every((e, i) => e && e.by === '' && e.here === (nodes[i] === master)) && s
			}, 8000)
			const artnet = await here('artnet_in')
			assert.ok(artnet.every((e) => e && e.here), 'Auto artnet_in = every server')
			return { pickedMs: picked.ms, autoMs: auto.ms }
		},
	},
	{
		name: 'master restart: the others keep it (no failover inside 12 s)',
		sandbox: true,
		async run({ nodes }) {
			const before = await agreedMaster(nodes)
			assert.ok(before, 'a master to start from')
			const t0 = Date.now()
			await before.master.restart()
			const back = await waitFor('master back, same epoch everywhere', async () => {
				const m = await agreedMaster(nodes)
				return m && m.master === before.master && m.epoch === before.epoch && m
			}, 10000)
			return { restartMs: Date.now() - t0 - back.ms, agreeAfterMs: back.ms, epoch: before.epoch }
		},
	},
	{
		name: 'failover: the master freezes, the next takes over, the old one stands down on waking',
		sandbox: true,
		async run({ nodes }) {
			const before = await agreedMaster(nodes)
			const old = before.master
			const rest = nodes.filter((n) => n !== old)
			old.freeze()
			let promoted
			try {
				promoted = await waitFor('one of the others claims a higher epoch', async () => {
					const m = await agreedMaster(nodes, rest)
					return m && m.epoch > before.epoch && m
				}, FAILOVER_MS + 8000, 100)
			} finally {
				old.thaw()
			}
			assert.ok(promoted.ms >= FAILOVER_MS - 2000, `not before the failover time (${promoted.ms} ms)`)
			const down = await waitFor(`${old.id} stands down`, async () => {
				const m = await agreedMaster(nodes)
				return m && m.master === promoted.value.master && m
			}, 6000, 50)
			return { promotedMs: promoted.ms, newMaster: promoted.value.master.id, epoch: promoted.value.epoch, standDownMs: down.ms }
		},
	},
	{
		name: 'a follower restarts: links and master come back from its own store',
		sandbox: true,
		async run({ nodes }) {
			const m = await agreedMaster(nodes)
			const f = nodes.find((n) => n !== m.master)
			const t0 = Date.now()
			await f.restart()
			const up = Date.now() - t0
			const back = await waitFor(`${f.id} online + following again`, async () => (await allLinkedOnline(nodes)) && (await agreedMaster(nodes))?.epoch === m.epoch, 10000)
			return { restartMs: up, rejoinMs: back.ms }
		},
	},
	{
		name: 'unlink each pair once: both sides drop it (WO-732), no master',
		async run({ nodes }) {
			for (const [i, a] of nodes.entries())
				for (const b of nodes.slice(i + 1)) {
					const r = await a.del(`/api/cluster/peers/${encodeURIComponent(b.id)}`)
					assert.equal(r.status, 200, `${a.id} drops ${b.id}: ${r.status}`)
					assert.equal(r.data.link_back?.ok, true, `${b.id} dropped ${a.id} too: ${JSON.stringify(r.data.link_back)}`)
				}
			const vs = await views(nodes)
			vs.forEach((v, i) => {
				assert.deepEqual(v.peers, [], `${nodes[i].id} peers`)
				assert.equal(v.master.epoch, 0, `${nodes[i].id} forgot the master`)
			})
			return {}
		},
	},
]

/** Run the steps that fit these nodes; a failed step is recorded and the run goes on (later steps may skip). */
async function runScenario(nodes, opts = {}) {
	const kind = nodes[0].kind
	const results = []
	for (const s of steps) {
		if (s.sandbox && kind !== 'sandbox') {
			results.push({ step: s.name, status: 'skip', reason: 'sandbox only' })
			continue
		}
		const t0 = Date.now()
		try {
			const metrics = await s.run({ nodes, ...opts })
			results.push({ step: s.name, status: 'pass', ms: Date.now() - t0, metrics })
		} catch (e) {
			results.push({ step: s.name, status: 'fail', ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) })
		}
		opts.onStep?.(results[results.length - 1])
	}
	return results
}

module.exports = { steps, runScenario, agreedMaster, allLinkedOnline }
