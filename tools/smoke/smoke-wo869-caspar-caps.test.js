'use strict'

/**
 * WO-869 — the screen-slices caps probe. The planner used to assume every Caspar draws slices; on a rollback binary
 * the generator would then write a slice window the binary draws unsliced, and every live edit would be refused.
 * Now: INFO on connect (the fork's screen consumer always reports `<slices>n</slices>`), an APPLY to a consumer index
 * that cannot exist when no channel has a screen consumer, and a refused live APPLY. Never `SLICES SET 0` (it clears a
 * live slice window). The XML below is the real `INFO 2` screen block of the box's fork build (30.10); the rollback
 * binary (`bin/casparcg.pre-wo869`) answered the same block without `<slices>` on a scratch Caspar.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const defaults = require('../../src/config/defaults')
const Caps = require('../../src/config/caspar-caps')
const { probeCasparCaps, isUnknownCommandError } = require('../../src/engine/caspar-caps-probe')
const Plan = require('../../src/config/mapping-slices-plan')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { reapplyAllMappingSlices } = require('../../src/engine/mapping-slices-apply')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const SCREEN_FORK = `<port_600><consumer>screen</consumer><screen>
	<always_on_top>true</always_on_top><dropped_frames>18</dropped_frames><gpu_texture>true</gpu_texture><index>0</index>
	<key_only>false</key_only><name>Screen consumer</name><presented_frames>401022</presented_frames><slices>0</slices>
</screen></port_600>`
const SCREEN_STOCK = SCREEN_FORK.replace('<slices>0</slices>', '')
const chXml = (consumers) => `<?xml version="1.0" encoding="utf-8"?><channel><output><port>${consumers}</port></output></channel>`

/** INFO replies per channel; `apply` answers the fallback APPLY (a string = reject with that message). */
function fakeAmcp(channels, { apply = null } = {}) {
	const sent = []
	return {
		sent,
		async info(ch) {
			if (ch == null) {
				sent.push('INFO')
				return { ok: true, data: Object.keys(channels).map((n) => `${n} 1080p5000 PLAYING`) }
			}
			sent.push(`INFO ${ch}`)
			return { ok: true, data: [chXml(channels[ch])] }
		},
		async raw(line) {
			sent.push(line)
			if (typeof apply === 'string') throw new Error(apply)
			return { ok: true, data: [] }
		},
	}
}

beforeEach(() => Caps.resetCasparCaps())

describe('WO-869 caps: reading INFO', () => {
	it('a screen block with <slices> = supported, without = not, no screen consumer = unknown', () => {
		assert.equal(Caps.screenSlicesFromInfoXml(chXml(SCREEN_FORK)), true)
		assert.equal(Caps.screenSlicesFromInfoXml(chXml(SCREEN_STOCK)), false)
		assert.equal(Caps.screenSlicesFromInfoXml(chXml('<port_700><consumer>decklink</consumer></port_700>')), null)
		assert.equal(Caps.screenSlicesFromInfoXml(''), null)
	})

	it('the 400 reply is recognised in the shapes the client produces (library + legacy transport)', () => {
		assert.ok(isUnknownCommandError(new Error('COMMAND_UNKNOWN_DATA: APPLY 1-65535 SLICES CLEAR')))
		assert.ok(isUnknownCommandError(new Error('400 ERROR')))
		assert.ok(isUnknownCommandError(new Error('Command not understood and data is being returned.')))
		assert.ok(!isUnknownCommandError(new Error('403 APPLY FAILED')))
		assert.ok(!isUnknownCommandError(new Error('AMCP response timeout: APPLY 1-640 …')))
	})
})

describe('WO-869 caps: the connect probe', () => {
	it('fork: the first channel with a screen consumer answers; nothing but INFO is sent', async () => {
		const amcp = fakeAmcp({ 1: '', 2: SCREEN_FORK, 3: SCREEN_STOCK })
		const caps = await probeCasparCaps({ amcp })
		assert.equal(caps.screenSlices, true)
		assert.equal(caps.source, 'info:2')
		assert.deepEqual(amcp.sent, ['INFO', 'INFO 1', 'INFO 2'])
	})

	it('stock binary: the screen block has no <slices> → not supported', async () => {
		const amcp = fakeAmcp({ 1: SCREEN_STOCK })
		assert.equal((await probeCasparCaps({ amcp })).screenSlices, false)
		assert.equal(Caps.getCasparCaps().screenSlices, false)
	})

	it('no screen consumer: APPLY to index 65535 (cannot exist) — 400 = no slices, 403 = still unknown', async () => {
		const stock = fakeAmcp({ 1: '', 2: '' }, { apply: 'COMMAND_UNKNOWN_DATA: APPLY 1-65535 SLICES CLEAR' })
		assert.equal((await probeCasparCaps({ amcp: stock })).screenSlices, false)
		assert.deepEqual(stock.sent.slice(-1), ['APPLY 1-65535 SLICES CLEAR'])
		const fork = fakeAmcp({ 1: '' }, { apply: '403 APPLY FAILED' })
		const caps = await probeCasparCaps({ amcp: fork })
		assert.equal(caps.screenSlices, null)
		assert.equal(caps.source, 'no-screen-consumer')
	})

	it('never sends SLICES SET (the WO-proposed `SLICES SET 0` would clear a live slice window)', () => {
		const code = read('src/engine/caspar-caps-probe.js').replace(/\/\*[\s\S]*?\*\//g, '')
		assert.ok(!code.includes('SLICES SET'))
	})

	it('not connected → null, caps untouched', async () => {
		assert.equal(await probeCasparCaps({}), null)
		assert.equal(Caps.getCasparCaps().source, 'unprobed')
	})

	it('runs on every connect, before the slice re-apply', () => {
		const src = read('src/config/routing-setup.js')
		const fn = src.slice(src.indexOf('async function setupMappingChannels'))
		const iProbe = fn.indexOf("require('../engine/" + "caspar-caps-probe').probeCasparCaps(self)")
		assert.ok(iProbe > 0 && iProbe < fn.indexOf('reapplyAllMappingSlices(self)'))
	})
})

/* The generator smoke's one-screen fixture: node `mapping_x1` fed by Screen 1 (3840x1080), two GPU heads. */
const NODE = 'mapping_x1'
const gpu = (id, ref) => ({ id, deviceId: 'caspar_host', kind: 'gpu_out', externalRef: ref })
function appConfig() {
	const config = JSON.parse(JSON.stringify(defaults))
	config.screenDestinations = { version: 1, destinations: [
		{ id: 'dst_a', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 3840, height: 1080, fps: 50 }] }
	const outputs = [{ id: 'out_1', mode: '1080p5000', label: 'A' }, { id: 'out_2', mode: '1080p5000', label: 'B' }]
	const sinks = [gpu('gpu_a', 'DP-0'), gpu('gpu_b', 'DP-2')]
	const slices = [
		{ id: 'a', outputId: 'out_1', src: { x: 960, y: 0, w: 960, h: 1080 }, dst: { rect: { x: 0, y: 0, w: 960, h: 1080 }, flipH: true } },
		{ id: 'c', outputId: 'out_2', src: { x: 1920, y: 0, w: 1920, h: 1080 }, dst: { rect: { x: 0, y: 0, w: 1920, h: 1080 } } },
	]
	config.deviceGraph = {
		version: 1,
		devices: [
			{ id: 'caspar_host', role: 'caspar_host' },
			{ id: 'destinations', role: 'destinations' },
			{ id: NODE, role: 'pixel_mapping', label: 'PM', settings: { numOutputs: 2, outputs, mappings: [], slices } },
		],
		connectors: [
			{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
			{ id: `${NODE}_in`, deviceId: NODE, kind: 'pixel_map_in' },
			...outputs.map((o, i) => ({ id: `${NODE}_${o.id}`, deviceId: NODE, kind: 'pixel_map_out', index: i })),
			...sinks,
		],
		edges: [
			{ id: 'e0', sourceId: 'dst_in_dst_a', sinkId: `${NODE}_in` },
			...sinks.map((s, i) => ({ id: `e${i + 1}`, sourceId: `${NODE}_${outputs[i].id}`, sinkId: s.id })),
		],
	}
	return config
}

describe('WO-869 caps: every planner caller follows the probe', () => {
	it('not probed / supported → slice window; not supported → refused with the reason, heads placed the legacy way', () => {
		const node = appConfig().deviceGraph.devices[2]
		const graph = appConfig().deviceGraph
		assert.equal(Plan.planMappingNode(node, { graph }).outputs[0].backend, 'screen-slices')
		Caps.setCasparCaps({ screenSlices: true, source: 'test' })
		assert.equal(Plan.planMappingNode(node, { graph }).outputs[0].backend, 'screen-slices')
		Caps.setCasparCaps({ screenSlices: false, source: 'test' })
		const p = Plan.planMappingNode(node, { graph })
		assert.equal(p.outputs[0].backend, 'refused')
		assert.equal(p.outputs[0].reason, Plan.REASONS.NO_SCREEN_SLICES)
		assert.deepEqual(p.outputs[0].direct, { src: { x: 960, y: 0, w: 960, h: 1080 }, destX: 0, destY: 0 })
		assert.equal(p.window, null)
		assert.equal(Plan.planMappingNode(node, { graph, caps: { screenSlices: true } }).outputs[0].backend, 'screen-slices', 'explicit caps win')
	})

	it('the generator writes no slice window for a binary without slices', () => {
		assert.ok(Array.isArray(buildCasparGeneratorFlatConfig(appConfig()).screen_1_slice_windows))
		Caps.setCasparCaps({ screenSlices: false, source: 'test' })
		assert.equal(buildCasparGeneratorFlatConfig(appConfig()).screen_1_slice_windows, undefined)
	})

	it('re-apply sends nothing then; a 400 to a live APPLY flips the caps (a rollback swapped in after connect)', async () => {
		const sent = []
		const ctx = {
			config: appConfig(),
			amcp: { raw: async (l) => { sent.push(l); throw new Error('COMMAND_UNKNOWN_DATA: ' + l) } },
		}
		const r = await reapplyAllMappingSlices(ctx)
		assert.equal(r.length, 1)
		assert.match(sent[0], /^APPLY 1-640 SLICES SET 2 /)
		assert.equal(Caps.getCasparCaps().screenSlices, false)
		assert.equal(Caps.getCasparCaps().source, 'apply-refused')
		sent.length = 0
		assert.deepEqual(await reapplyAllMappingSlices(ctx), [])
		assert.equal(sent.length, 0)
	})

	it('a 403 (bad slice set) leaves the caps alone', async () => {
		Caps.setCasparCaps({ screenSlices: true, source: 'info:1' })
		await reapplyAllMappingSlices({ config: appConfig(), amcp: { raw: async () => { throw new Error('403 APPLY FAILED') } } })
		assert.equal(Caps.getCasparCaps().screenSlices, true)
	})

	it('GET device-view carries the caps next to the plans', () => {
		assert.match(read('src/api/routes-device-view.js'), /\n\t\tcasparCaps: getCasparCaps\(\), \/\/ WO-869/)
	})
})
