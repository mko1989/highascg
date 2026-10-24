#!/usr/bin/env node
'use strict'

/**
 * WO-725 — the cluster end-to-end run (tools/e2e/cluster-scenario.js): link, master + epoch fencing, signed calls,
 * sender choice, restarts, failover, unlink, with API timing per server alone and linked.
 *
 *   node tools/e2e/run-cluster-e2e.js                     # 3 throwaway sandbox servers on this box (every step)
 *   node tools/e2e/run-cluster-e2e.js --servers=2
 *   node tools/e2e/run-cluster-e2e.js --live=192.168.0.23:4200,192.168.0.4:4200 --yes
 *   node tools/e2e/run-cluster-e2e.js --scenario=show     # WO-746 shared show, several operators (sandbox only)
 *
 * --live drives REAL servers: they must not be linked to anything yet. While it runs they link, every one is master
 * in turn (a follower skips its local PGM takes, kiosks follow the master), and at the end they are unlinked and
 * their sender choices put back. Freeze / restart steps never run live. Not for a box on air.
 *
 * Output: <out>/results.json, <out>/report.md (sandbox roots under <out>/sandboxes with --keep). Exit code = failed
 * steps (0 = all green).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { startSandboxNodes, liveNodes } = require('./cluster-nodes')
const { runScenario } = require('./cluster-scenario')
const { runShowScenario } = require('./shared-show-scenario')

const arg = (k, d) => {
	const hit = process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
	if (!hit) return d
	return hit.includes('=') ? hit.split('=').slice(1).join('=') : '1'
}
const KINDS = ['lighting', 'ptz', 'artnet_in']

function report(results, meta) {
	const short = (o) => (o ? JSON.stringify(o).replace(/"/g, '').slice(0, 300) : '')
	const lines = [`# Cluster e2e — ${meta.mode}, ${meta.nodes.join(', ')}`, '', `${meta.at} · ${meta.commit}`, '',
		'| step | result | ms | measured / error |', '|---|---|---|---|']
	for (const r of results) lines.push(`| ${r.step} | ${r.status} | ${r.ms ?? ''} | ${short(r.status === 'fail' ? r.error : r.metrics || r.reason)} |`)
	return lines.join('\n') + '\n'
}

async function liveGuard(nodes) {
	for (const n of nodes) {
		const v = await n.get('/api/cluster')
		if (v.status !== 200) throw new Error(`${n.address}: GET /api/cluster → ${v.status}`)
		if (v.data.peers.length) throw new Error(`${n.address} is already linked (${v.data.peers.map((p) => p.id).join(', ')}): unlink first, this run would change that cluster`)
	}
	return Promise.all(nodes.map(async (n) => {
		const s = (await n.get('/api/server/senders')).data?.senders || {}
		return Object.fromEntries(KINDS.map((k) => [k, s[k]?.by || '']))
	}))
}

/** Unlink whatever is still linked between the nodes (after a failed step), then put the sender choices back. */
async function liveRestore(nodes, senders) {
	for (const a of nodes) for (const b of nodes) if (a !== b) await a.del(`/api/cluster/peers/${encodeURIComponent(b.id)}`)
	for (let i = 0; i < nodes.length; i++)
		for (const k of KINDS) {
			const now = (await nodes[i].get('/api/server/senders')).data?.senders?.[k]?.by || ''
			if (now !== senders[i][k]) await nodes[i].post('/api/server/senders', { kind: k, by: senders[i][k] })
		}
}

async function main() {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const out = path.resolve(arg('out', path.join(os.tmpdir(), 'highascg-cluster-e2e', stamp)))
	fs.mkdirSync(out, { recursive: true })
	const live = arg('live', '')
	const scenario = arg('scenario', 'cluster')
	if (live && scenario === 'show') throw new Error('--scenario=show replaces every server\'s show: sandbox servers only')
	let nodes
	let senders = null
	if (live) {
		if (arg('yes', '') !== '1') throw new Error('--live changes the real servers while it runs (see the header): add --yes')
		const addrs = live.split(',').map((s) => s.trim()).filter(Boolean)
		// each server links the others by these addresses: a loopback one would point every other server at itself
		const loop = addrs.find((a) => /^(127\.|localhost|\[?::1)/.test(a))
		if (loop) throw new Error(`--live ${loop}: give every server by an address the others reach (its LAN address)`)
		nodes = await liveNodes(addrs)
		if (nodes.length < 2) throw new Error('--live needs at least two servers')
		senders = await liveGuard(nodes)
	} else {
		const count = Math.max(2, Number(arg('servers', '3')) || 3)
		const ids = Array.from({ length: count }, (_, i) => `sb-${String.fromCharCode(97 + i)}`)
		nodes = await startSandboxNodes(path.join(out, 'sandboxes'), ids, { log: (s) => console.log(`[cluster-e2e] ${s}`) })
	}
	let results
	try {
		results = await (scenario === 'show' ? runShowScenario : runScenario)(nodes, {
			benchN: Number(arg('bench', '100')) || 100,
			onStep: (r) => console.log(`[cluster-e2e] ${r.status.toUpperCase().padEnd(4)} ${r.step}${r.ms !== undefined ? ` (${r.ms} ms)` : ''}${r.error ? ` — ${r.error}` : ''}`),
		})
	} finally {
		if (senders) await liveRestore(nodes, senders)
		await Promise.all(nodes.map((n) => n.stop()))
		if (!live && arg('keep', '') !== '1') fs.rmSync(path.join(out, 'sandboxes'), { recursive: true, force: true })
	}
	let commit = ''
	try {
		commit = require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }).trim()
	} catch {
		/* not a checkout */
	}
	const meta = { mode: live ? 'live' : 'sandbox', nodes: nodes.map((n) => `${n.id} (${n.address})`), at: new Date().toISOString(), commit }
	fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ ...meta, results }, null, 1))
	fs.writeFileSync(path.join(out, 'report.md'), report(results, meta))
	const failed = results.filter((r) => r.status === 'fail').length
	const n = (st) => results.filter((r) => r.status === st).length
	console.log(`[cluster-e2e] ${n('pass')} pass, ${n('skip')} skipped, ${failed} failed · ${path.join(out, 'report.md')}`)
	return failed
}

main().then(
	(failed) => process.exit(Math.min(failed, 100)),
	(e) => {
		console.error(`[cluster-e2e] ${e instanceof Error ? e.message : e}`)
		process.exit(101)
	},
)
