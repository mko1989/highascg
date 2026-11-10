'use strict'

/**
 * WO-1029 phase 2a — the virtual box bed: N HighAsCG boxes on this machine, each = a real sandbox node
 * (sandbox-server.js, its own loopback alias) + its own fake Caspar (fake-caspar.js, its own alias 127.0.2.x) + its
 * own device graph (which destinations are cabled on which of its outputs) + one shared show (destinations, looks).
 * Unlike a plain sandbox run, a master here DOES fan out (HIGHASCG_SANDBOX_FANOUT=1, routes-cluster.js fanoutOf): to
 * the other boxes' fake Caspars, never to :5250, never off loopback. So a test can ask each box's Caspar what is on
 * its screens and who wrote it (the write log), e.g. "zero writes from B's node to A's LED channel after A froze".
 *
 *   const bed = await startVirtualBoxes(root, twoBoxes({ backup: true }))
 *   await bed.linkAll(); await bed.makeMaster('vb-a'); await bed.shareShow(); await bed.waitForwarding('vb-a')
 *   const a = bed.box('vb-a')        → { id, node, caspar, cabled: Set, ch(destId, 'pgm'|'prv') }
 *   bed.onScreen('vb-b', DEST.stream.id)  → visible layers of that destination's PGM channel on vb-b's Caspar
 *   await bed.stop()
 *
 * Names follow tools/e2e/two-box (LED_ID, STREAM_LABEL): box A drives the LED wall, box B streams "Stream PGM".
 * Everything waits with deadlines (waitFor), never a fixed sleep. Limits: tools/e2e/README-virtual-boxes.md.
 */

const assert = require('node:assert/strict')
const path = require('path')
const { startSandboxNodes, waitFor, clusterView } = require('./cluster-nodes')
const { startFakeCaspar } = require('./fake-caspar')
const { LED_ID, STREAM_LABEL, MODE } = require('./two-box/scenario')

const DEST = {
	led: { id: LED_ID, label: 'LED wall' },
	stream: { id: 'dst_stream_pgm', label: STREAM_LABEL },
	backup: { id: 'dst_backup_pgm', label: 'Backup PGM' },
}

const destination = (d, idx) => ({ id: d.id, label: d.label, mainScreenIndex: idx, mode: 'pgm_prv', videoMode: MODE.videoMode, width: MODE.width, height: MODE.height, fps: MODE.fps, caspar: { bus: 'pgm' } })

/** Two looks per destination (clips the fake Caspar lists), scoped to it: `look_<key>_a` / `_b`. */
function looksFor(dests) {
	const out = []
	dests.forEach((d, idx) => {
		for (const [k, clip] of [['a', 'LOOK_A'], ['b', 'LOOK_B']])
			out.push({ id: `look_${d.key}_${k}`, name: `${d.label} ${k.toUpperCase()}`, mainScope: String(idx), layers: [{ layerNumber: 10, source: { type: 'file', value: clip, label: clip }, loop: true, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 }, opacity: 1, volume: 1, muted: false, contentFit: 'stretch' }] })
	})
	return out
}

/** This box's device graph: every destination has its input node; only `cabled` ones have a cable to an output. */
function graphFor(dests, cabled) {
	const connectors = dests.map((d) => ({ id: `dst_in_${d.id}`, deviceId: 'destinations', kind: 'destination_in', label: d.label, externalRef: d.id }))
	const edges = []
	dests.forEach((d, i) => {
		// every output exists on the box; only `cabled` destinations have a cable on theirs (WO-1029 apply: add one later)
		connectors.push({ id: `vb_out_${i + 1}`, deviceId: 'caspar_host', kind: 'gpu_out', label: `Out ${i + 1}`, caspar: { bus: 'pgm', mainIndex: i + 1 } })
		if (!cabled.includes(d.key)) return
		edges.push({ id: `e_${d.id}_out_${i + 1}`, sourceId: `dst_in_${d.id}`, sinkId: `vb_out_${i + 1}` })
	})
	return {
		version: 1,
		devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' }, { id: 'destinations', role: 'destinations', label: 'Screen destinations' }],
		connectors,
		edges,
	}
}

/**
 * Three boxes: A (LED wall) and B (Stream PGM) as in twoBoxes, plus C with nothing cabled — the master in tests where
 * the master and the owner of a screen must be different servers (contract rule 4: master unreachable → the owner).
 */
function threeBoxes(opts = {}) {
	const b = opts.base ?? 60
	const two = twoBoxes({ ...opts, base: b })
	return { ...two, boxes: { ...two.boxes, 'vb-c': { host: `127.0.1.${b + 3}`, caspar: `127.0.2.${b + 3}`, cabled: [] } } }
}

/** Layout (a): one box with the LED wall and the stream destination. */
function oneBox(opts = {}) {
	// `spare`: a third destination (Backup PGM) exists on the show but is not cabled yet — the cable the apply tests add
	return { ...opts, destinations: opts.spare ? ['led', 'stream', 'backup'] : ['led', 'stream'], boxes: { 'vb-a': { host: `127.0.1.${opts.base ?? 41}`, caspar: `127.0.2.${opts.base ?? 41}`, cabled: ['led', 'stream'] } } }
}

/**
 * Layout (b): box A has the LED wall cabled only on A, box B "Stream PGM" only on B; `backup: true` adds a destination
 * cabled on both (hot backup). `base` shifts the aliases so two beds can run side by side.
 */
function twoBoxes(opts = {}) {
	const b = opts.base ?? 50
	const both = opts.backup ? ['backup'] : []
	return {
		...opts,
		destinations: ['led', 'stream', ...(opts.backup || opts.spare ? ['backup'] : [])],
		boxes: {
			'vb-a': { host: `127.0.1.${b + 1}`, caspar: `127.0.2.${b + 1}`, cabled: ['led', ...both] },
			'vb-b': { host: `127.0.1.${b + 2}`, caspar: `127.0.2.${b + 2}`, cabled: ['stream', ...both] },
		},
	}
}

/**
 * @param {string} root  scratch root (one folder per node under it)
 * @param {{ boxes: Record<string, { host: string, caspar: string, cabled: string[] }>, destinations: string[],
 *   password?: string, log?: Function }} spec
 */
async function startVirtualBoxes(root, spec) {
	const dests = spec.destinations.map((k) => ({ key: k, ...DEST[k] }))
	const destList = dests.map((d, i) => destination(d, i))
	const ids = Object.keys(spec.boxes)
	const pidOwner = new Map() // pid → box id, kept across restarts (a write by an old process still names its box)
	let nodes = []
	const pids = () => {
		for (const n of nodes) if (n.pid) pidOwner.set(n.pid, n.id)
		return [...pidOwner.keys()]
	}
	const identify = (pid) => pidOwner.get(pid) || ''
	const casparOf = {}
	try {
		for (const id of ids) casparOf[id] = await startFakeCaspar({ host: spec.boxes[id].caspar, channels: 8, pids, identify, log: spec.log, configFile: path.join(root, id, 'casparcg.config'), ...spec.fake })
		nodes = await startSandboxNodes(root, ids, {
			hosts: Object.fromEntries(ids.map((id) => [id, spec.boxes[id].host])),
			token: spec.password || '',
			log: spec.log,
			extra: (id) => ({
				caspar: { host: casparOf[id].host, port: casparOf[id].port },
				// the graph is the virtual box's, not this machine's GPU (the boot hardware sync would swap in its DP ports)
				env: { HIGHASCG_SANDBOX_FANOUT: '1', HIGHASCG_BOOT_DEVICE_GRAPH_SYNC: '0', HIGHASCG_SANDBOX_CASPAR_RESTART_URL: casparOf[id].control.url, HIGHASCG_SANDBOX_MEDIA_LOOPBACK: '1' }, // WO-1029: the apply's "restart Caspar" calls this box's fake; C10: the media Spread copies between the boxes' temp media folders, never ssh
				config: {
					screenDestinations: { version: 1, destinations: destList },
					deviceGraph: graphFor(dests, spec.boxes[id].cabled),
					security: spec.password ? { enforceAuth: true, exposeToNetwork: true, apiToken: spec.password } : { enforceAuth: false, exposeToNetwork: false },
				},
			}),
		})
	} catch (e) {
		await Promise.all(Object.values(casparOf).map((c) => c.close()))
		throw e
	}
	pids()

	const boxes = new Map()
	for (const n of nodes) {
		const box = { id: n.id, node: n, caspar: casparOf[n.id], cabled: new Set(spec.boxes[n.id].cabled.map((k) => DEST[k].id)), chans: new Map() }
		box.ch = (destId, bus = 'pgm') => {
			const c = box.chans.get(destId)
			if (!c) throw new Error(`${box.id}: no channels for ${destId}`)
			return c[bus]
		}
		boxes.set(n.id, box)
	}
	const box = (id) => {
		const b = boxes.get(id)
		if (!b) throw new Error(`no virtual box ${id}`)
		return b
	}

	/** destination id → { pgm, prv } on that box, from its own device view (channel numbers are never assumed). */
	async function readChannels(b) {
		const r = await b.node.get('/api/device-view')
		assert.equal(r.status, 200, `${b.id} device view: ${r.status}`)
		const cm = r.data.live?.caspar?.channelMap || {}
		for (const d of r.data.screenDestinations?.destinations || []) {
			const i = Number(d.mainScreenIndex) || 0
			b.chans.set(d.id, { pgm: cm.programChannels?.[i], prv: cm.previewChannels?.[i], mainIdx: i })
		}
	}
	await waitFor('every box connected to its fake Caspar', async () => {
		const ok = await Promise.all(nodes.map(async (n) => (await n.get('/api/device-view')).data?.live?.caspar?.connected === true))
		return ok.every(Boolean)
	}, 15000, 200)
	for (const b of boxes.values()) await readChannels(b)

	const show = { version: 1, name: 'Virtual show', scenes: { scenes: looksFor(dests) }, timelines: { timelines: [], activeId: null } }
	for (const n of nodes) {
		const r = await n.post('/api/project/save', { project: show })
		assert.equal(r.status, 200, `${n.id} seeds the show: ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`)
	}

	const bed = {
		dests,
		boxes,
		box,
		ids,
		nodes,
		looks: show.scenes.scenes,
		/** The look of destination `key` ('led' | 'stream' | 'backup'), variant 'a' | 'b'. */
		look: (key, v = 'a') => `look_${key}_${v}`,

		/**
		 * Link every pair, both directions explicitly (cluster-nodes.js: the loopback link-back names 127.0.0.1).
		 * `through: { 'vb-b>vb-a': forwarder }` = vb-b reaches vb-a only through that forwarder (bed.forwarder), so the
		 * path can be cut one way (forwarder.pause()).
		 */
		async linkAll({ through = {} } = {}) {
			for (const [i, a] of nodes.entries())
				for (const b of nodes.slice(i + 1)) {
					for (const [x, y] of [[a, b], [b, a]]) {
						const r = await x.post('/api/cluster/peers', { address: through[`${x.id}>${y.id}`]?.address || y.address })
						assert.ok(r.status === 200 || r.status === 201, `${x.id} → ${y.id}: ${r.status} ${JSON.stringify(r.data)}`)
					}
				}
			await waitFor('every box sees every other online', async () => {
				const vs = await Promise.all(nodes.map((n) => clusterView(n)))
				return vs.every((v, i) => v && nodes.every((o) => o === nodes[i] || v.peers.some((p) => p.id === o.id && p.online)))
			}, 15000, 200)
		},

		/** Make master on `id` (an operator press), wait until every answering box follows it → epoch. */
		async makeMaster(id, among = nodes) {
			const m = box(id).node
			const r = await m.post('/api/cluster/master/set', { master: 'self', auto: true })
			assert.equal(r.status, 200, `${id} make master: ${JSON.stringify(r.data)}`)
			await bed.waitMaster(id, r.data.epoch, among)
			return r.data.epoch
		},

		/** Every box in `among` agrees `id` is master (at `epoch` or above). */
		waitMaster: (id, epoch = 1, among = nodes, ms = 20000) =>
			waitFor(`every box follows ${id}`, async () => {
				const vs = await Promise.all(among.map((n) => clusterView(n)))
				return vs.every((v, i) => v && v.master.epoch >= epoch && (among[i].id === id ? v.master.is_master : v.master.master_id === id)) && vs[0].master.epoch
			}, ms, 200),

		/** Show sharing on everywhere, wait until every box holds the same show. */
		async shareShow() {
			for (const n of nodes) assert.equal((await n.post('/api/cluster/show', { on: true })).status, 200, `${n.id} sharing on`)
			await waitFor('one show on every box', async () => {
				const vs = await Promise.all(nodes.map(async (n) => (await n.get('/api/cluster')).data?.show))
				return new Set(vs.map((v) => v?.hash)).size === 1 && vs[0]?.hash && vs.every((v) => v.role === 'master' || v.in_sync)
			}, 20000, 200)
		},

		/** The master forwards to every other online box: connected to its Caspar, with the destinations cabled there. */
		waitForwarding: (masterId, to = ids.filter((x) => x !== masterId), ms = 20000) =>
			waitFor(`${masterId} forwards to ${to.join(', ')}`, async () => {
				const v = await clusterView(box(masterId).node)
				return v?.fanout?.active && to.every((id) => v.fanout.peers?.[id]?.connected && (v.fanout.peers[id].destinations || []).length === box(id).cabled.size) && v.fanout
			}, ms, 200),

		/** Visible layers (fg or CG) of destination `destId`'s channel on box `id`'s Caspar. */
		onScreen: (id, destId, bus = 'pgm') => box(id).caspar.visible(box(id).ch(destId, bus)),

		/** Wait until `pred(visible layers)` holds on that screen → the layers. */
		waitScreen: (id, destId, pred, what, ms = 8000, bus = 'pgm') =>
			waitFor(`${id} ${destId} ${bus}: ${what}`, async () => {
				const v = bed.onScreen(id, destId, bus)
				return pred(v) && (v.length ? v : true)
			}, ms, 50).then((r) => r.value),

		/** One mark per box's Caspar write log. */
		mark: () => Object.fromEntries([...boxes.values()].map((b) => [b.id, b.caspar.mark()])),

		/** A tcp-forwarder in front of box `id` (cluster-nodes.js linkVia): link another box through it to cut one way. */
		forwarder: (id) => box(id).node.linkVia(),

		/**
		 * Settled: forces a poll on every answering box (GET /api/cluster polls, and the poll runs the fan-out refresh and
		 * its catch-up), then waits until no fake Caspar got a write for `quietMs`. Event-driven, not a fixed sleep: a
		 * "nothing must be written" window ends when the boxes have had their chance to write.
		 */
		async settle({ quietMs = 700, ms = 12000, polls = 2 } = {}) {
			for (let i = 0; i < polls; i++) await Promise.all(nodes.map((n) => clusterView(n, 2000).catch(() => null)))
			let last = -1
			let since = Date.now()
			await waitFor('the fake Caspars go quiet', async () => {
				const total = [...boxes.values()].reduce((a, b) => a + b.caspar.mark(), 0)
				if (total !== last) {
					last = total
					since = Date.now()
				}
				return Date.now() - since >= quietMs
			}, ms, 100)
		},

		/** Box `id`'s own node is (again) connected to its fake Caspar: an open connection from it + its device view says so. */
		waitOwnCaspar: (id, ms = 15000) =>
			waitFor(`${id} reconnected to its own Caspar`, async () =>
				box(id).caspar.connections().some((x) => x.who === id && !x.closed) && (await box(id).node.get('/api/device-view')).data?.live?.caspar?.connected === true, ms, 200),

		async restart(id) {
			await box(id).node.restart()
			pids()
			await waitFor(`${id} back and connected to its Caspar`, async () => (await box(id).node.get('/api/device-view')).data?.live?.caspar?.connected === true, 20000, 200)
		},

		async stop() {
			await Promise.all(nodes.map((n) => n.stop().catch(() => {})))
			await Promise.all(Object.values(casparOf).map((c) => c.close()))
		},
	}
	Object.assign(bed, require('./virtual-boxes-apply').applyHelpers(bed)) // WO-1029: cable / dirty / plan / apply / screens
	return bed
}

/** The look whose name is shown for destination `id` in a bed (for messages). */
const destKey = (id) => Object.keys(DEST).find((k) => DEST[k].id === id)

module.exports = { startVirtualBoxes, oneBox, twoBoxes, threeBoxes, DEST, destKey, graphFor, looksFor, ROOT: path.resolve(__dirname, '../..') }
