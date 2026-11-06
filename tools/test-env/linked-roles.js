#!/usr/bin/env node
'use strict'

/**
 * WO-979 — a standing role-split test environment on this box (the half of tools/test-env/linked-roles.sh that holds
 * it): two throwaway node-only sandbox servers (tools/e2e/sandbox-server.js, `--no-caspar`, no Godot, no Xvfb), the
 * MEDIA one (a screen, looks Opener / Closer / Credits) and the TRACKING one (detection on, a fake camera with one
 * walking person, on-air rules), linked node ↔ node with the media server as master — the state the duties scenario
 * proves, left up so a person (or curl) can poke it. Never touches the live :4200 server.
 *
 *   node tools/test-env/linked-roles.js hold <stateDir>   start, link, write <stateDir>/env.json, run until SIGTERM
 *   node tools/test-env/linked-roles.js status <stateDir> one line per server: duties, peers, exchange, air
 */

const fs = require('fs')
const path = require('path')
const { startSandboxNodes, request } = require('../e2e/cluster-nodes')
const fixture = require('../e2e/duties-fixture')

const say = (s) => console.log(`linked-roles: ${s}`)

async function link(media, tracking) {
	const r = await media.post('/api/cluster/peers', { address: tracking.address })
	if (r.status !== 201 && r.status !== 200) throw new Error(`link: ${r.status} ${JSON.stringify(r.data)}`)
	if (r.data.link_back?.pending) {
		const a = await tracking.post(`/api/cluster/invites/${encodeURIComponent(media.id)}/accept`, {})
		if (a.status !== 201 && a.status !== 200) throw new Error(`accept: ${a.status} ${JSON.stringify(a.data)}`)
	}
	const m = await media.post('/api/cluster/master/set', { master: 'self', auto: true })
	if (m.status !== 200) throw new Error(`master: ${m.status} ${JSON.stringify(m.data)}`)
}

async function hold(dir) {
	fs.mkdirSync(dir, { recursive: true })
	const extra = (id, root) => fixture.sandboxOptions(id === 'sb-media' ? 'media' : 'tracking', root)
	const nodes = await startSandboxNodes(path.join(dir, 'sandboxes'), ['sb-media', 'sb-tracking'], { extra, log: say })
	let prep = null
	const stop = async () => {
		if (prep) await prep.stop()
		await Promise.all(nodes.map((n) => n.stop()))
		fs.rmSync(path.join(dir, 'env.json'), { force: true })
		say('down')
		process.exit(0)
	}
	process.on('SIGTERM', stop)
	process.on('SIGINT', stop)
	try {
		prep = await fixture.prepare(nodes, say)
		await link(nodes[0], nodes[1])
	} catch (e) {
		say(`up failed: ${e.message || e}`)
		return stop()
	}
	const env = {
		holder: process.pid,
		media: { id: nodes[0].id, url: nodes[0].url, pid: nodes[0].pid },
		tracking: { id: nodes[1].id, url: nodes[1].url, pid: nodes[1].pid },
		psn: { group: fixture.GROUP, media: prep.ears.media.port, tracking: prep.ears.tracking.port },
		looks: fixture.LOOKS,
	}
	fs.writeFileSync(path.join(dir, 'env.json'), JSON.stringify(env, null, 2))
	say(
		`up — media ${env.media.url} (pid ${env.media.pid}), tracking ${env.tracking.url} (pid ${env.tracking.pid}); holder pid ${process.pid}`
	)
	setInterval(() => {}, 1 << 30)
}

async function status(dir) {
	const file = path.join(dir, 'env.json')
	if (!fs.existsSync(file)) return say('down (no env.json)')
	const env = JSON.parse(fs.readFileSync(file, 'utf8'))
	for (const role of ['media', 'tracking']) {
		const u = env[role].url
		const g = async (p) => (await request('GET', u + p, undefined, 3000)).data
		const d = (await g('/api/server/duties')) || {}
		const c = (await g('/api/cluster')) || { peers: [], master: {} }
		const x = (await g('/api/cluster/exchange')) || {}
		const air = (await g('/api/tracking/zones'))?.on_air?.now || {}
		const does = Object.keys(d)
			.filter((k) => d[k] === true && k !== 'accept_remote')
			.join(',')
		const peers = c.peers.map((p) => `${p.id}${p.online ? '' : ' (offline)'}`).join(',') || 'none'
		const people = x['tracking.auto']?.persons?.length
		console.log(
			`${role.padEnd(8)} ${u}  does=${does || '-'}  peers=${peers}  master=${c.master?.is_master ? 'self' : c.master?.master_id || '-'}` +
				`  exchange.people=${people ?? '-'}  air=${JSON.stringify(air)}`
		)
	}
	console.log(
		`looks on the media server: ${Object.values(env.looks).join(', ')} · PSN ${env.psn.group} ports media ${env.psn.media} / tracking ${env.psn.tracking} (loopback)`
	)
}

const [cmd, dir] = process.argv.slice(2)
if (!dir || !['hold', 'status'].includes(cmd)) {
	console.error('usage: linked-roles.js hold|status <stateDir>')
	process.exit(2)
}
;(cmd === 'hold' ? hold(dir) : status(dir)).catch((e) => {
	console.error(`linked-roles: ${e.message || e}`)
	process.exit(1)
})
