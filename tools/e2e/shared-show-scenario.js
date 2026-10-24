'use strict'

/**
 * WO-746 — the shared show on real servers over HTTP (sandbox only: it replaces every server's show). Operators are
 * API clients doing what the Godot client does — GET /api/project, change it, POST /api/project/save — on several
 * servers at once. Runs after WO-725's link + master steps (cluster-scenario.js) and unlinks at the end.
 *
 *   node tools/e2e/run-cluster-e2e.js --scenario=show
 */

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const cluster = require('./cluster-scenario')
const { waitFor } = require('./cluster-nodes')

const step = (prefix) => cluster.steps.find((s) => s.name.startsWith(prefix))
const show = async (n) => (await n.get('/api/cluster')).data?.show
const project = async (n) => (await n.get('/api/project')).data
const looks = (p) => p.scenes.scenes

/** One operator edit through the client's own path; 409 (a stale client) is retried on the newer project once. */
async function edit(n, fn) {
	for (let i = 0; i < 2; i++) {
		const p = await project(n)
		fn(p)
		const r = await n.post('/api/project/save', { project: p })
		if (r.status === 200) return r
		if (r.status !== 409) throw new Error(`${n.id}: save → ${r.status} ${JSON.stringify(r.data)}`)
	}
	throw new Error(`${n.id}: save refused twice`)
}

/** Every node has the same show hash and every follower holds it → { ms }. */
const converged = (nodes, what, ms = 15000) =>
	waitFor(what, async () => {
		const vs = await Promise.all(nodes.map(show))
		const hashes = new Set(vs.map((v) => v?.hash))
		return hashes.size === 1 && vs[0].hash && vs.every((v) => v.role === 'master' || v.in_sync) && vs
	}, ms, 100)

const everyLook = (nodes, test) => Promise.all(nodes.map(async (n) => test(looks(await project(n)), n)))

const steps = [
	step('link every pair'),
	step('master: set on one'),
	{
		name: 'each server saves its own show (different looks, different cables)',
		async run({ nodes }) {
			for (const n of nodes) {
				const r = await n.post('/api/project/save', { project: { version: 1, name: `Show of ${n.id}`, scenes: { scenes: [1, 2, 3].map((i) => ({ id: `${n.id}_look_${i}`, name: `${n.id} look ${i}`, layers: [] })) }, timelines: { timelines: [], activeId: null } } })
				assert.equal(r.status, 200, `${n.id}: ${JSON.stringify(r.data)}`)
			}
			return {}
		},
	},
	{
		name: 'G1 + G8 + G9: sharing on — followers take the master\'s show, keep theirs as a file and their own cables',
		async run({ nodes, master }) {
			const followers = nodes.filter((n) => n !== master)
			const graphs = Object.fromEntries(await Promise.all(followers.map(async (n) => [n.id, JSON.stringify((await project(n)).hardwareConfig?.deviceGraph ?? null)])))
			for (const n of [...followers, master]) assert.equal((await n.post('/api/cluster/show', { on: true })).status, 200)
			const c = await converged(nodes, 'every server holds the master\'s show')
			for (const n of followers) {
				const v = await show(n)
				assert.match(v.before_share, /^projects\/_cluster\/.*\.before-share-/, `${n.id} backed its show up`)
				const kept = JSON.parse(fs.readFileSync(path.join(n.sb.root, v.before_share), 'utf8'))
				assert.equal(kept.name, `Show of ${n.id}`)
				const p = await project(n)
				assert.equal(p.name, `Show of ${master.id}`)
				assert.equal(JSON.stringify(p.hardwareConfig?.deviceGraph ?? null), graphs[n.id], `${n.id} kept its own cables`)
			}
			return { convergeMs: c.ms }
		},
	},
	{
		name: 'an edit on the master reaches every server',
		async run({ nodes, master }) {
			await edit(master, (p) => { looks(p)[0].name = 'edited on the master' })
			const c = await converged(nodes, 'master edit everywhere')
			await everyLook(nodes, (l, n) => assert.equal(l[0].name, 'edited on the master', n.id))
			return { ms: c.ms }
		},
	},
	{
		name: 'an edit on a follower reaches the master and the other servers',
		async run({ nodes, master }) {
			const f = nodes.find((n) => n !== master)
			await edit(f, (p) => { looks(p)[1].name = `edited on ${f.id}` })
			const c = await converged(nodes, 'follower edit everywhere')
			await everyLook(nodes, (l, n) => assert.equal(l[1].name, `edited on ${f.id}`, n.id))
			return { ms: c.ms }
		},
	},
	{
		name: 'G7: every operator edits a different look at the same moment — every edit stays',
		async run({ nodes }) {
			await Promise.all(nodes.map((n, i) => edit(n, (p) => { looks(p).push({ id: `added_by_${n.id}`, name: `added ${i}`, layers: [] }) })))
			const c = await converged(nodes, 'all concurrent edits everywhere')
			await everyLook(nodes, (l, n) => assert.deepEqual(nodes.map((o) => l.some((x) => x.id === `added_by_${o.id}`)), nodes.map(() => true), n.id))
			for (const n of nodes) assert.equal((await show(n)).conflict, null, `${n.id}: no conflict`)
			return { ms: c.ms }
		},
	},
	{
		name: 'G7: two operators on the same look — the master\'s stays; the follower is told and keeps its version',
		async run({ nodes, master }) {
			const f = nodes.find((n) => n !== master)
			await Promise.all([edit(master, (p) => { looks(p)[2].name = 'the master\'s' }), edit(f, (p) => { looks(p)[2].name = 'the follower\'s' })])
			const c = await converged(nodes, 'one version everywhere')
			await everyLook(nodes, (l, n) => assert.equal(l[2].name, 'the master\'s', n.id))
			const v = await show(f)
			if (v.conflict) {
				// the two saves can also arrive one after the other (no overlap): then the later one simply wins
				const kept = JSON.parse(fs.readFileSync(path.join(f.sb.root, v.conflict.file), 'utf8'))
				assert.equal(looks(kept)[2].name, 'the follower\'s')
			}
			return { ms: c.ms, conflict: v.conflict?.paths || 'none (saves did not overlap)' }
		},
	},
	{
		name: 'G1: a server that switches sharing off keeps the show and takes nothing more',
		async run({ nodes, master }) {
			const off = nodes.find((n) => n !== master)
			assert.equal((await off.post('/api/cluster/show', { on: false })).status, 200)
			const before = (await show(off)).hash
			await edit(master, (p) => { looks(p)[0].name = 'after one left' })
			await converged(nodes.filter((n) => n !== off), 'the rest converge')
			assert.equal((await show(off)).hash, before)
			assert.notEqual(looks(await project(off))[0].name, 'after one left')
			return {}
		},
	},
	step('unlink each pair'),
]

/** The WO-725 runner's contract: run every step, record pass / fail, go on. */
async function runShowScenario(nodes, opts = {}) {
	if (nodes[0].kind !== 'sandbox') throw new Error('the shared-show run replaces every server\'s show: sandbox servers only')
	const results = []
	for (const s of steps) {
		const t0 = Date.now()
		try {
			const ctx = { nodes, ...opts, master: (await cluster.agreedMaster(nodes))?.master || nodes[0] }
			const metrics = await s.run(ctx)
			results.push({ step: s.name, status: 'pass', ms: Date.now() - t0, metrics })
		} catch (e) {
			results.push({ step: s.name, status: 'fail', ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) })
		}
		opts.onStep?.(results[results.length - 1])
	}
	return results
}

module.exports = { steps, runShowScenario }
