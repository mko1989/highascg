'use strict'

/**
 * WO-746 — N linked servers in one process for the shared-show gates: each has its own ed25519 key, store, project
 * "on disk" and operator, and they talk through the REAL signed-call layer (cluster-call.js: trust = links, `to`,
 * clock, nonce, signature, accept_remote, allow-list) over a fake network that can drop any pair. The master claim is
 * set by the test (cluster-master.js has its own tests and the WO-725 run); everything from the claim on is real.
 *
 *   const c = createShowCluster(['a', 'b', 'c'])
 *   c.link()                      // every pair
 *   c.master('a')                 // epoch 1, every server holds it
 *   c.node('b').edit((p) => { p.scenes.scenes[0].name = 'x' })   // an operator save on b (the persist hook fires)
 *   await c.settle()              // run the polls until nothing moves
 *   c.cut('a', 'b') / c.heal()    // the network
 */

const crypto = require('crypto')
const { createClusterCall } = require('../../src/cluster/cluster-call')
const { createSharedShow, HEARTBEAT_MS } = require('../../src/cluster/shared-show')
const { fingerprint } = require('../../src/cluster/cluster-media')
const M = require('../../src/cluster/show-merge')

/** A project like the live ones: looks in scenes.scenes, timelines, device-local slices, a stream key. */
function sampleProject(name, looks = ['look_1', 'look_2', 'look_3'], box = 'box') {
	return {
		version: 1,
		name,
		rev: 1,
		savedAt: '2026-10-25T00:00:00.000Z',
		scenes: { scenes: looks.map((id, i) => ({ id, name: `Look ${i + 1}`, layers: [{ id: `${id}_l1`, clip: `clip_${i + 1}.mov` }] })), liveSceneId: null },
		timelines: { timelines: [{ id: 'tl_1', name: 'Timeline 1', clips: [] }], activeId: 'tl_1' },
		multiview: { cells: [], showOverlay: true },
		hardwareConfig: {
			version: 1,
			screenDestinations: [{ id: 'dst_pgm1', label: 'PGM/PRV 1' }],
			deviceGraph: { box, cables: [{ from: `${box}_gpu_dp0`, to: 'dst_pgm1' }] },
			casparServer: { box },
		},
		streaming: { credentials: { streamingChannel: { streamKey: `key-of-${box}` } } },
	}
}

function createShowCluster(names, opts = {}) {
	let clock = Date.parse('2026-10-25T00:00:00Z')
	const now = () => clock
	const cuts = new Set()
	const links = new Set()
	const nodes = new Map()
	const pairKey = (a, b) => [a, b].sort().join('|')
	const reachable = (a, b) => !cuts.has(pairKey(a, b))
	const linked = (a, b) => links.has(pairKey(a, b))
	const wire = [] // every call that crossed: { from, to, action, args, status }

	for (const name of names) {
		const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
		const pem = publicKey.export({ type: 'spki', format: 'pem' })
		const n = {
			name, id: name, pem, fp: fingerprint(pem), claim: null, acceptRemote: true, pair: false,
			project: sampleProject(opts.sameProject ? 'Show' : `${name} own show`, undefined, name),
			slug: opts.sameProject ? 'show' : `${name}_own_show`,
			store: new Map(), backups: [], events: [], log: [],
		}
		n.sign = (msg) => crypto.sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('base64')
		nodes.set(name, n)
	}

	const peerRec = (n) => ({ id: n.id, name: n.name, host: n.id, port: 0, device_key: n.pem })

	function boot(n) {
		const others = () => [...nodes.values()].filter((o) => o !== n && linked(n.name, o.name))
		const masterNode = () => [...nodes.values()].find((o) => o.fp === n.claim?.master)
		n.call = createClusterCall({
			cluster: { saved: (id) => (others().find((o) => o.id === id) ? peerRec(nodes.get(id)) : null), list: () => others().map(peerRec) },
			selfKey: n.pem,
			sign: n.sign,
			verify: (pem, msg, sig) => crypto.verify(null, Buffer.from(msg, 'utf8'), crypto.createPublicKey(pem), Buffer.from(sig, 'base64')),
			post: async (host, _port, _path, body) => {
				await new Promise((r) => setImmediate(r)) // let other work interleave, as a socket would
				const to = nodes.get(host)
				if (!to || !reachable(n.name, host)) return { ok: false, status: 0, json: null, error: 'unreachable' }
				const r = await to.call.handle(body)
				wire.push({ from: n.name, to: host, action: body.action, args: body.args, status: r.status })
				return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.body }
			},
			masterId: () => (masterNode() && masterNode() !== n ? masterNode().id : ''),
			acceptsRemote: () => n.acceptRemote,
			info: { get 'show.push'() { return n.show.info['show.push'] } },
			actions: { get 'show.propose'() { return n.show.actions['show.propose'] } },
			now,
			log: (lvl, msg) => n.log.push(`${lvl} ${msg}`),
		})
		n.show = createSharedShow({
			store: { get: (k) => structuredClone(n.store.get(k)), set: (k, v) => n.store.set(k, structuredClone(v)) },
			isMaster: () => !!n.claim && n.claim.master === n.fp,
			claim: () => n.claim,
			fpOf: (peer) => fingerprint(peer.device_key),
			peers: () => others().map((o) => ({ id: o.id, name: o.name, online: reachable(n.name, o.name) })),
			call: (id, action, args, o) => n.call.call(id, action, args, o),
			callMaster: (action, args, o) => n.call.callMaster(action, args, o),
			current: () => ({ slug: n.slug, project: n.project }),
			commit: (project, slug) => persist(n, project, slug),
			backup: (slug, project, tag) => {
				n.backups.push({ slug, tag, project: structuredClone(project) })
				return `projects/_cluster/${slug}.${tag}-${n.backups.length}.json`
			},
			pairEnabled: () => n.pair,
			casparApply: () => false,
			broadcast: (type, data) => n.events.push({ type, data }),
			now,
			log: (lvl, msg) => n.log.push(`${lvl} ${msg}`),
		})
	}

	/** persistProject in short: rev + 1, stamped, then the write hook (as project-scenes.js calls it). */
	function persist(n, project, slug) {
		n.slug = slug || n.slug
		n.project = { ...structuredClone(project), rev: (Number(n.project?.rev) || 0) + 1, savedAt: new Date(clock).toISOString() }
		n.show.written()
	}

	for (const n of nodes.values()) {
		boot(n)
		n.edit = (fn) => {
			const p = structuredClone(n.project)
			fn(p)
			persist(n, p, n.slug)
		}
		n.hash = () => M.hashShow(M.showOf(n.project))
		n.restart = () => boot(n) // a new process: memory gone, store + project on disk kept
	}

	const c = {
		nodes: [...nodes.values()],
		node: (name) => nodes.get(name),
		wire,
		now,
		advance: (ms) => (clock += ms),
		link(...pairs) {
			const ns = [...nodes.keys()]
			const all = pairs.length ? pairs : ns.flatMap((a, i) => ns.slice(i + 1).map((b) => [a, b]))
			for (const [a, b] of all) links.add(pairKey(a, b))
		},
		unlink: (a, b) => links.delete(pairKey(a, b)), // WO-802
		cut: (a, b) => cuts.add(pairKey(a, b)),
		heal: () => cuts.clear(),
		/** Every server in `among` (default all) holds the claim: `name` is master at `epoch` (default: the highest held + 1). */
		master(name, epoch, among = [...nodes.keys()]) {
			const e = epoch || Math.max(0, ...[...nodes.values()].map((n) => n.claim?.epoch || 0)) + 1
			for (const k of among) nodes.get(k).claim = { epoch: e, master: nodes.get(name).fp }
			return e
		},
		share(on = true, among = [...nodes.keys()]) {
			for (const k of among) nodes.get(k).show.setOn(on)
		},
		/** Polls (each server's afterPoll tick, 1 s apart) until nothing crossed the wire for longer than a heartbeat
		 *  (a refused peer is retried at HEARTBEAT_MS, not every poll). */
		async settle(rounds = 60) {
			let quiet = 0
			for (let i = 0; i < rounds && quiet <= HEARTBEAT_MS / 1000 + 1; i++) {
				const before = wire.length
				for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r))
				await Promise.all([...nodes.values()].map((n) => n.show.tick()))
				for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r))
				c.advance(1000)
				quiet = wire.length === before ? quiet + 1 : 0
			}
		},
		/** Let in-flight calls finish without the clock moving (no poll, no heartbeat). */
		async flush() {
			for (let k = 0; k < 50; k++) await new Promise((r) => setImmediate(r))
		},
		/** The servers whose show hash equals `name`'s. */
		inSyncWith: (name) => c.nodes.filter((n) => n.hash() === nodes.get(name).hash()).map((n) => n.name),
	}
	return c
}

module.exports = { createShowCluster, sampleProject }
