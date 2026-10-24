'use strict'

/**
 * WO-730 — linked servers (WO-670): online, same build, clocks, the signed-call path. Read only, except the media
 * copy check (writes then empties media/.highascg-check/ on the peer), which runs only with --peers.
 */

const { get } = require('./sweep-util')
const { runReplicationCheck } = require('../e2e/replication-check')

const CLOCK_WARN_MS = 5000
const CLOCK_FAIL_MS = 60000 // signed calls refuse past ±60 s (cluster-call.js)
const RANK = { pass: 0, warn: 1, fail: 2 }

const peersOf = (cluster) => (cluster?.peers || []).filter((p) => p && p.id)

module.exports = [
	{
		id: 'cluster.peers',
		name: 'linked servers online, same build, clocks agree',
		async run({ cluster, server }) {
			const peers = peersOf(cluster)
			if (!peers.length) return { status: 'skip', summary: 'not linked to another server' }
			const mine = (await server.get('/api/system/version')).data || {}
			const out = []
			let status = 'pass'
			const worse = (s) => {
				if (RANK[s] > RANK[status]) status = s
			}
			for (const p of peers) {
				const base = `http://${p.host}:${p.port || 4200}`
				if (!p.online) {
					worse('fail')
					out.push(`${p.id} (${p.host}) offline`)
					continue
				}
				const t0 = Date.now()
				const ping = await get(`${base}/api/replication/ping`, 5000)
				const mid = (t0 + Date.now()) / 2
				const ver = await get(`${base}/api/system/version`, 5000)
				const off = typeof ping.data?.serverTimeMs === 'number' ? Math.round(ping.data.serverTimeMs - mid) : null
				const bits = [`${p.id}`]
				if (off === null) {
					worse('warn')
					bits.push('no clock')
				} else {
					bits.push(`clock ${off >= 0 ? '+' : ''}${off} ms`)
					if (Math.abs(off) > CLOCK_FAIL_MS) worse('fail')
					else if (Math.abs(off) > CLOCK_WARN_MS) worse('warn')
				}
				const theirs = ver.data || {}
				if (theirs.packageVersion && theirs.packageVersion !== mine.packageVersion) {
					worse('warn')
					bits.push(`package ${theirs.packageVersion} ≠ ${mine.packageVersion}`)
				}
				if (theirs.buildStamp && mine.buildStamp && theirs.buildStamp !== mine.buildStamp) {
					worse('warn')
					bits.push(`build ${theirs.buildStamp} ≠ ${mine.buildStamp}`)
				}
				out.push(bits.join(' · '))
			}
			return { status, summary: out.join(' | ') }
		},
	},
	{
		id: 'cluster.signed-calls',
		name: 'a signed call reaches every linked server (WO-712)',
		async run({ cluster, server }) {
			const peers = peersOf(cluster).filter((p) => p.online)
			if (!peers.length) return { status: 'skip', summary: 'no linked server online' }
			const bad = []
			const ok = []
			for (const p of peers) {
				// a look that cannot exist: the peer verifies the signature, then answers "not found" — nothing plays
				const r = await server.post(
					'/api/cluster/send',
					{ peer: p.id, action: 'look.take', args: { sceneId: 'wo730_sweep_no_such_look', target: 'preview' } },
					10000
				)
				if (r.status === 404 && /not found/.test(String(r.data?.error))) ok.push(`${p.id} ${r.ms} ms`)
				else bad.push(`${p.id}: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`)
			}
			return bad.length
				? { status: 'fail', summary: `${bad.length}/${peers.length} refused`, details: bad }
				: { status: 'pass', summary: ok.join(' · ') }
		},
	},
	{
		id: 'cluster.media-copy',
		name: 'media copy to / from every linked server (writes media/.highascg-check/ there)',
		optIn: 'peers',
		async run({ cluster }) {
			const peers = peersOf(cluster)
			if (!peers.length) return { status: 'skip', summary: 'not linked to another server' }
			const bad = []
			const ok = []
			for (const p of peers) {
				const res = runReplicationCheck({ host: p.host })
				const failed = res.filter((r) => r.status === 'fail')
				if (failed.length) bad.push(`${p.id} (${p.host}): ${failed[0].step} — ${failed[0].error}`)
				else ok.push(`${p.id} ${res.filter((r) => r.status === 'pass').length}/${res.length}`)
			}
			return bad.length
				? { status: 'fail', summary: `${bad.length}/${peers.length} failed`, details: bad }
				: { status: 'pass', summary: ok.join(' · ') }
		},
	},
]
