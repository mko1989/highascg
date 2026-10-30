'use strict'

/**
 * WO-869 — the slice editor's server side through the real POST /api/device-view handler (raw JSON body):
 * `updateMappingSlices` persists slices + the legacy mirror, decides restart vs live APPLY, and the APPLY line /
 * `<slices>` XML carry the 21-number contract (src, dst ul ur lr ll, opacity, feather l t r b, clip).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const defaults = require('../../src/config/defaults')
const { handlePost, handleGet } = require('../../src/api/routes-device-view')
const W = require('../../src/config/mapping-slices-windows')
const { applyLineFor, reapplyAllMappingSlices } = require('../../src/engine/mapping-slices-apply')

const NODE = 'mapping_x1'
const gpu = (id, ref) => ({ id, deviceId: 'caspar_host', kind: 'gpu_out', externalRef: ref })

function makeCtx({ mappings = [], slices, sinks = [gpu('gpu_a', 'DP-0'), gpu('gpu_b', 'DP-2')] } = {}) {
	const config = JSON.parse(JSON.stringify(defaults))
	config.screenDestinations = { version: 1, destinations: [
		{ id: 'dst_a', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 3840, height: 1080, fps: 50 }] }
	const outputs = [{ id: 'out_1', mode: '1080p5000', label: 'A' }, { id: 'out_2', mode: '1080p5000', label: 'B' }]
	config.deviceGraph = {
		version: 1,
		devices: [
			{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' },
			{ id: 'destinations', role: 'destinations', label: 'Screen destinations' },
			{ id: NODE, role: 'pixel_mapping', label: 'Pixel Mapping 1',
				settings: { numOutputs: 2, outputs, mappings, ...(slices ? { slices } : {}) } },
		],
		connectors: [
			{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
			{ id: `${NODE}_in`, deviceId: NODE, kind: 'pixel_map_in', label: 'Input Feed' },
			...outputs.map((o, i) => ({ id: `${NODE}_${o.id}`, deviceId: NODE, kind: 'pixel_map_out', index: i, label: o.label })),
			...sinks,
		],
		edges: [
			{ id: 'e0', sourceId: 'dst_in_dst_a', sinkId: `${NODE}_in` },
			...sinks.map((s, i) => ({ id: `e${i + 1}`, sourceId: `${NODE}_${outputs[i].id}`, sinkId: s.id })),
		],
	}
	const sent = []
	const raw = []
	return {
		sent,
		raw,
		config,
		configManager: { get: () => config, save: (next) => Object.assign(config, next) },
		_wsBroadcast: (type, data) => sent.push({ type, data }),
		amcp: { raw: async (line) => { raw.push(line); return { ok: true } } },
		log: () => {},
	}
}

const node = (ctx) => ctx.config.deviceGraph.devices.find((d) => d.id === NODE)
const body = (r) => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body)
const slice = (id, outputId, src, dst, extra = {}) => ({ id, name: id, outputId, src, dst: { rect: dst }, ...extra })

test('legacy node: GET shows the migration; first save persists slices + mirror and changes the config', async () => {
	const ctx = makeCtx({ mappings: [
		{ id: 'map_a', outputId: 'out_1', rect: { x: 0, y: 0, w: 1920, h: 1080 }, rotation: 15 },
		{ id: 'map_b', outputId: 'out_2', rect: { x: 1920, y: 0, w: 1920, h: 1080 } }] })
	const g = body(await handleGet('/api/device-view', ctx, {}))
	const n = g.graph.devices.find((d) => d.id === NODE)
	assert.deepEqual(n.settings.slices.map((s) => [s.id, s.outputId, s.src.x]), [['map_a', 'out_1', 0], ['map_b', 'out_2', 1920]])
	assert.equal(g.mappingSlicePlans[0].outputs.map((o) => o.backend).join(), 'direct,direct')

	// Two slices on out_1 → out_1 becomes a slice window (config change → restart, no live APPLY).
	const r = await handlePost(JSON.stringify({ updateMappingSlices: { nodeId: NODE, slices: [
		slice('a', 'out_1', { x: 0, y: 0, w: 960, h: 1080 }, { x: 0, y: 0, w: 960, h: 1080 }),
		slice('b', 'out_1', { x: 960, y: 0, w: 960, h: 1080 }, { x: 960, y: 0, w: 960, h: 1080 }, { dst: { rect: { x: 960, y: 0, w: 960, h: 1080 }, flipH: true } }),
		slice('c', 'out_2', { x: 1920, y: 0, w: 1920, h: 1080 }, { x: 0, y: 0, w: 1920, h: 1080 })] } }), ctx)
	assert.equal(r.status, 200, JSON.stringify(r))
	const j = body(r)
	assert.equal(j.ok, true)
	assert.equal(j.casparRestartNeeded, true)
	assert.equal(j.live.applied, false)
	assert.equal(j.plan.outputs[0].backend, 'screen-slices')
	assert.equal(node(ctx).settings.slices.length, 3)
	assert.deepEqual(node(ctx).settings.mappings.map((m) => m.id), ['a', 'c'], 'mirror = first slice per output')
	assert.equal(ctx.raw.length, 0)
})

test('geometry edit inside a window → no restart, one live APPLY with the whole set', async () => {
	const two = [
		slice('a', 'out_1', { x: 0, y: 0, w: 960, h: 1080 }, { x: 0, y: 0, w: 960, h: 1080 }),
		slice('b', 'out_1', { x: 960, y: 0, w: 960, h: 1080 }, { x: 960, y: 0, w: 960, h: 1080 })]
	const ctx = makeCtx({ slices: two })
	two[1].dst.rect = { x: 900, y: 10, w: 960, h: 1000 }
	two[1].opacity = 0.5
	const j = body(await handlePost(JSON.stringify({ updateMappingSlices: { nodeId: NODE, slices: two } }), ctx))
	assert.equal(j.casparRestartNeeded, false)
	assert.equal(j.live.applied, true, JSON.stringify(j.live))
	assert.equal(ctx.raw.length, 1)
	assert.match(ctx.raw[0], /^APPLY 1-640 SLICES SET 2 /)
	const nums = ctx.raw[0].split(' ').slice(5)
	assert.equal(nums.length, 42)
	assert.deepEqual(nums.slice(21, 33), ['960', '0', '960', '1080', '900', '10', '1860', '10', '1860', '1010', '900', '1010'])
	assert.equal(nums[33], '0.5')
})

test('moving a window output (outputPos) changes the config; bad bodies are refused', async () => {
	const ctx = makeCtx({ slices: [
		slice('a', 'out_1', { x: 0, y: 0, w: 960, h: 1080 }, { x: 0, y: 0, w: 960, h: 1080 }),
		slice('b', 'out_1', { x: 960, y: 0, w: 960, h: 1080 }, { x: 960, y: 0, w: 960, h: 1080 })] })
	const slices = node(ctx).settings.slices
	const j = body(await handlePost(JSON.stringify({ updateMappingSlices: { nodeId: NODE, slices, outputPos: { out_1: { x: 100, y: 0 } } } }), ctx))
	assert.equal(j.casparRestartNeeded, true)
	assert.deepEqual(node(ctx).settings.outputs[0].pos, { x: 100, y: 0 })
	for (const bad of [{}, { nodeId: NODE }, { nodeId: 'nope', slices: [] }]) {
		const r = await handlePost(JSON.stringify({ updateMappingSlices: bad }), ctx)
		assert.notEqual(r.status, 200, JSON.stringify(bad))
	}
})

test('APPLY / XML formatting, empty window, consumer index range, reconnect re-apply', async () => {
	assert.equal(W.screenConsumerIndex(41), 640)
	assert.equal(W.amcpNum(-0.0001), '0')
	assert.equal(W.amcpNum(1 / 3), '0.333')
	assert.equal(W.slicesSetParams({ slices: [] }), 'SLICES CLEAR')
	const s = { src: { x: 1, y: 2, w: 3, h: 4 }, dst: [[0, 0], [10, 0], [10, 10], [0, 10]], opacity: 1, feather: { l: 5 }, clip: { x: 0, y: 0, w: 0, h: 0 } }
	assert.equal(W.sliceNumbers(s).length, 21)
	const xml = W.slicesXml({ slices: [s] }, '')
	assert.match(xml, /<src>1 2 3 4<\/src>/)
	assert.match(xml, /<dst>0 0 10 0 10 10 0 10<\/dst>/)
	assert.match(xml, /<feather>5 0 0 0<\/feather>/)
	assert.match(xml, /<clip>0 0 0 0<\/clip>/)

	const ctx = makeCtx({ slices: [
		slice('a', 'out_1', { x: 0, y: 0, w: 960, h: 1080 }, { x: 0, y: 0, w: 960, h: 1080 }),
		slice('b', 'out_1', { x: 960, y: 0, w: 960, h: 1080 }, { x: 960, y: 0, w: 960, h: 1080 })] })
	const ws = W.sliceWindowsFromConfig(ctx.config)
	assert.equal(ws.length, 1)
	assert.equal(ws[0].consumerIndex, 640)
	assert.match(applyLineFor(ctx, ws[0]), /^APPLY 1-640 SLICES SET 2 /)
	const res = await reapplyAllMappingSlices(ctx)
	assert.equal(res.length, 1)
	assert.equal(res[0].ok, true)
	// A refused APPLY (old Caspar: 400) is reported, never thrown.
	ctx.amcp.raw = async () => { throw new Error('400 APPLY ERROR') }
	const bad = await reapplyAllMappingSlices(ctx)
	assert.equal(bad[0].ok, false)
})

test('routing-setup re-applies slices on (re)connect', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/config/routing-setup.js'), 'utf8')
	assert.match(src, /reapplyAllMappingSlices\(self\)/)
})
