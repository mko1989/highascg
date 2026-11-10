'use strict'

/**
 * WO-1029 plan 06 S3 / S4 / S13 — the combined Devices view (cluster-device-view.js): every part tagged with its
 * server, the last view of an offline server kept as `stale` with its age, `editable` / `degraded`, ETag → 304, WS
 * `cluster:devices` on change; a relayed 2xx write drops the cached view and refreshes the owners before the relay
 * answers (cluster-relay.js onAnswered); a cable to a destination this server does not know → 409 DEST_UNKNOWN_HERE;
 * the stable live input key (live-input-key.js).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createClusterDeviceView, relayWrote } = require('../../src/cluster/cluster-device-view')
const { createRelay } = require('../../src/cluster/cluster-relay')
const CRUD = require('../../src/api/device-view-crud')
const K = require('../../src/config/live-input-key')

function viewOf(box, { cabled = [], gpuLabel = 'DP-0' } = {}) {
	return {
		ok: true,
		graph: {
			devices: [{ id: 'map_1', role: 'pixel_mapping', label: 'Pixel Mapping 1' }],
			connectors: [
				{ id: 'gpu_p0', deviceId: 'caspar_host', kind: 'gpu_out', label: gpuLabel },
				{ id: 'dlsdi_3', deviceId: 'caspar_host', kind: 'decklink_io', label: 'DeckLink 3', caspar: { ioDirection: 'in' } },
				{ id: 'pm_in_1', deviceId: 'map_1', kind: 'pixel_map_in' },
				...cabled.map((d) => ({ id: `dst_in_${d}`, deviceId: 'destinations', kind: 'destination_in', externalRef: d })),
			],
			edges: cabled.map((d) => ({ id: `e_${d}`, sourceId: `dst_in_${d}`, sinkId: 'gpu_p0' })),
			orphanEdges: [],
		},
		screenDestinations: { destinations: [{ id: 'dst_operator_gui', mode: 'operator_gui', label: `GUI ${box}` }, { id: 'dst_led_1', mode: 'pgm_prv', label: 'LED' }, { id: `host_ndi_${box}`, mode: 'host_channel', label: 'NDI cam' }] },
		extraLiveSources: [{ routeType: 'ndi_host', sourceId: 'cam1', label: 'Cam 1', hostChannel: 5, hostLayer: 1 }],
		live: { caspar: { channelMap: { inputChannels: [{ kind: 'decklink', slot: 3, channel: 7, layer: 1, label: 'DeckLink 3' }] } } },
	}
}

function bed() {
	const st = { now: 1e12, peers: [{ id: 'b', name: 'box-b', online: true, caps: ['unified-devices'] }, { id: 'c', name: 'box-c', online: true, caps: [] }], views: { b: viewOf('b'), c: viewOf('c') }, fetches: 0, dropped: [], owners: 0, ws: [] }
	st.v = createClusterDeviceView({
		selfId: () => 'a', selfName: () => 'box-a', peers: () => st.peers, masterId: () => 'a',
		ownView: async () => viewOf('a', { cabled: ['dst_led_1'] }),
		peerView: async (id) => {
			st.fetches++
			const p = st.peers.find((x) => x.id === id)
			return p.online && !p.silent ? { status: 200, body: st.views[id] } : { status: 502, body: { error: 'no answer' } }
		},
		dropPeerView: (id) => st.dropped.push(id),
		refreshOwners: async () => void st.owners++,
		broadcast: (type, data) => st.ws.push({ type, data }),
		now: () => st.now,
	})
	return st
}

describe('WO-1029 S3: GET /api/cluster/device-view — one view, tagged per server', () => {
	it('every connector / cable / mapping node / host channel / operator GUI / live input carries its server', async () => {
		const st = bed()
		const r = await st.v.get()
		assert.equal(r.status, 200)
		const [a, b, c] = r.body.servers
		assert.deepEqual([a.id, a.self, a.master, b.id, c.id], ['a', true, true, 'b', 'c'])
		assert.deepEqual(a.connectors.map((x) => x.key), ['a/gpu_p0', 'a/dlsdi_3', 'a/pm_in_1'], 'same ids on every box, told apart by key')
		assert.ok(b.connectors.every((x) => x.server === 'b'))
		assert.deepEqual(a.cables.map((x) => [x.server, x.destId, x.sinkId]), [['a', 'dst_led_1', 'gpu_p0']])
		assert.deepEqual(a.mappingNodes.map((m) => [m.key, m.connectors]), [['a/map_1', ['pm_in_1']]])
		assert.deepEqual(b.hostChannels.map((h) => h.key), ['b/host_ndi_b'])
		assert.deepEqual(b.operatorGui.map((g) => [g.server, g.label]), [['b', 'GUI b']], 'each server\'s operator GUI, inside the one view')
		assert.deepEqual(a.operatorGui[0].cabledTo, [])
		assert.deepEqual(b.liveInputs.map((i) => [i.server, i.input]), [['b', 'decklink:3'], ['b', 'ndi_host:cam1']])
		assert.deepEqual(r.body.destinations.list.map((d) => d.id), ['dst_led_1'], 'the shared column: no GUI, no host channel')
		assert.deepEqual([b.degraded, c.degraded, b.editable], [false, true, true])
	})

	it('an offline / silent server keeps its last view: stale, with its age, not editable', async () => {
		const st = bed()
		await st.v.get()
		st.now += 42000
		st.peers[0].online = false
		st.peers[1].silent = true
		const r = await st.v.get()
		const [, b, c] = r.body.servers
		assert.deepEqual([b.stale, b.editable, b.error, b.age_ms], [true, false, 'offline', 42000])
		assert.equal(b.connectors.length, 3, 'its rear panel is still shown')
		assert.deepEqual([c.stale, c.editable, c.error], [true, false, 'no answer'])
	})

	it('ETag: unchanged → 304; a change → 200 and WS cluster:devices for that server', async () => {
		const st = bed()
		const first = await st.v.get()
		st.now += 5000
		assert.equal((await st.v.get({ ifNoneMatch: first.etag })).status, 304, 'the age alone does not change the ETag')
		st.views.b = viewOf('b', { cabled: ['dst_led_1'] })
		const r = await st.v.get({ ifNoneMatch: first.etag })
		assert.equal(r.status, 200)
		assert.deepEqual(st.ws.filter((w) => w.type === 'cluster:devices').map((w) => w.data.id), ['b'])
	})

	it('fresh=1 drops the cached peer views first', async () => {
		const st = bed()
		await st.v.get({ fresh: true })
		assert.deepEqual(st.dropped.sort(), ['b', 'c'])
	})
})

describe('WO-1029 S4: a write through the relay refreshes that server at once', () => {
	function relayBed(status) {
		const calls = []
		const ctx = {
			_cluster: {}, // the combined view exists once the cluster runs
			_clusterDeviceView: { invalidate: async (id) => calls.push(['invalidate', id]) },
		}
		const relay = createRelay({
			cluster: { saved: (id) => (id === 'b' ? { host: '127.0.0.9', port: 1, name: 'box-b' } : null) },
			request: async () => ({ status, contentType: 'application/json', body: Buffer.from('{}') }),
			onAnswered: (id, m, p, st) => relayWrote(ctx, id, m, p, st),
		})
		return { relay, calls }
	}
	it('a 2xx POST to /api/device-view invalidates that server before the relay answers', async () => {
		const { relay, calls } = relayBed(200)
		await relay({ method: 'POST', id: 'b', tail: 'api/device-view', body: '{"addEdge":{}}' })
		assert.deepEqual(calls, [['invalidate', 'b']])
	})
	it('a GET, a refused write or an unrelated path changes nothing', async () => {
		for (const [st, method, tail] of [[200, 'GET', 'api/device-view'], [409, 'POST', 'api/device-view'], [200, 'POST', 'api/scene/take-look']]) {
			const { relay, calls } = relayBed(st)
			await relay({ method, id: 'b', tail, body: '{}' })
			assert.deepEqual(calls, [], `${method} ${tail} ${st}`)
		}
	})
	it('invalidate drops the peer cache, refreshes the owners, then tells the clients', async () => {
		const st = bed()
		await st.v.invalidate('b')
		assert.deepEqual([st.dropped, st.owners, st.ws.map((w) => [w.type, w.data.id])], [['b'], 1, [['cluster:devices', 'b']]])
	})
})

describe('WO-1029 S4: a cable to a destination unknown here → 409 DEST_UNKNOWN_HERE', () => {
	const ctxWith = (dests) => {
		const config = { screenDestinations: { version: 1, destinations: dests }, deviceGraph: { version: 1, devices: [{ id: 'caspar_host', role: 'caspar_host' }], connectors: [{ id: 'gpu_p0', deviceId: 'caspar_host', kind: 'gpu_out' }], edges: [] } }
		return { config, configManager: { get: () => config, save: (n) => Object.assign(config, n) }, log: () => {} }
	}
	it('refused with the destination id, nothing written', () => {
		const ctx = ctxWith([{ id: 'dst_led_1', mode: 'pgm_prv' }])
		const r = CRUD.handleAddEdge({ addEdge: { sourceId: 'dst_in_dst_new_9', sinkId: 'gpu_p0' } }, ctx, {})
		assert.deepEqual([r.status, r.code, r.destId], [409, 'DEST_UNKNOWN_HERE', 'dst_new_9'])
		assert.equal(ctx.config.deviceGraph.edges.length, 0)
	})
	it('a known destination is cabled as before', () => {
		const ctx = ctxWith([{ id: 'dst_led_1', mode: 'pgm_prv' }])
		const r = CRUD.handleAddEdge({ addEdge: { sourceId: 'dst_in_dst_led_1', sinkId: 'gpu_p0' } }, ctx, {})
		assert.equal(r.ok, true, JSON.stringify(r))
	})
})

describe('WO-1029 S13: live input keys', () => {
	it('sources, routing rows and DeckLink connectors name the same input the same way', () => {
		assert.equal(K.inputKeyOfSource({ routeType: 'decklink', decklinkSlot: 3 }), 'decklink:3')
		assert.equal(K.inputKeyOfEntry({ kind: 'decklink', slot: 3, channel: 9 }), 'decklink:3')
		assert.equal(K.inputKeyOfConnector({ id: 'dlsdi_3', kind: 'decklink_io', caspar: { ioDirection: 'in' } }), 'decklink:3')
		assert.equal(K.inputKeyOfConnector({ id: 'dlsdi_3', kind: 'decklink_io', caspar: { ioDirection: 'out' } }), null)
		assert.equal(K.inputKeyOfSource({ routeType: 'ndi_host', sourceId: 'cam1' }), 'ndi_host:cam1')
		assert.deepEqual(K.parseInputKey('ndi_host:cam1'), { kind: 'ndi_host', sourceId: 'cam1' })
		assert.equal(K.parseInputKey('route://9-3'), null, 'never a channel number')
		const map = { inputChannels: [{ kind: 'decklink', slot: 4, channel: 7, route: 'route://7-1' }] }
		assert.equal(K.entryForInputKey('decklink:4', map).route, 'route://7-1')
	})
})
