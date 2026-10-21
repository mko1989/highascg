'use strict'

/**
 * WO-638 — once-per-boot operator screen question (src/system/boot-screen-assignment.js) + the run.sh gate that
 * holds Caspar's first launch until it is answered. All hardware, xrandr, store and apply calls are injected.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const B = require('../../src/system/boot-screen-assignment')
const { handlePost } = require('../../src/api/routes-operator-screen')

/** The owner's box on 21.10 19:04: saved operator on gpu_p1, PGM on gpu_p3, monitors now on gpu_p0 + gpu_p2. */
function boxConfig() {
	return {
		startup: { mode: 'gui' }, // WO-645: the 120 s question is the "autostart Caspar + GUI" mode
		casparServer: { screen_2_operator_monitor: true },
		screenDestinations: {
			destinations: [
				{ id: 'dst_operator_gui', mode: 'operator_gui' },
				{ id: 'dst_pgm', mode: 'pgm_prv' },
			],
		},
		deviceGraph: {
			connectors: ['gpu_p0', 'gpu_p1', 'gpu_p2', 'gpu_p3']
				.map((id) => ({ id, kind: 'gpu_out' }))
				.concat([
					{ id: 'dst_in_dst_operator_gui', kind: 'destination_in' },
					{ id: 'dst_in_dst_pgm', kind: 'destination_in' },
				]),
			edges: [
				{ id: 'e_op', sourceId: 'dst_in_dst_operator_gui', sinkId: 'gpu_p1' },
				{ id: 'e_pgm', sourceId: 'dst_in_dst_pgm', sinkId: 'gpu_p3' },
			],
		},
	}
}

const port = (slot, name) => ({
	physicalPortId: `gpu_p${slot}`,
	slotOrder: slot,
	runtime: { connected: !!name, xrandrName: name || null },
})
const MAP_NOW = { ports: [port(0, 'DP-0'), port(1), port(2, 'DP-4'), port(3)] }
const MAP_SAME = { ports: [port(0), port(1, 'DP-2'), port(2), port(3, 'DP-6')] }

function deps(over = {}) {
	const store = new Map()
	const calls = { apply: 0, prestart: 0, relayout: 0, gate: 0, xrandr: [], invalidate: 0 }
	let gate = false
	const d = {
		bootId: () => 'linux:boot-a',
		store: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
		gpuMap: () => MAP_NOW,
		flagPort: (c) => {
			for (let i = 1; i <= 4; i++) if (c?.casparServer?.[`screen_${i}_operator_monitor`]) return i
			return null
		},
		listOutputs: () => [
			{ name: 'DP-0', port: 1, x: 0, y: 0, width: 1920, height: 1080 },
			{ name: 'DP-4', port: 3, x: 0, y: 0, width: 1920, height: 1080 },
		],
		xrandr: async (args) => (calls.xrandr.push(args), { ok: true }),
		gateOpen: () => gate,
		invalidate: () => calls.invalidate++,
		openGate: () => ((gate = true), calls.gate++, true),
		apply: async () => (calls.apply++, { status: 200 }),
		prestart: async () => (calls.prestart++, { status: 200 }),
		relayout: async () => (calls.relayout++, { status: 200 }),
		...over,
	}
	return { d, calls, store }
}

function makeCtx(config) {
	const saved = []
	const ctx = {
		config,
		log: () => {},
		configManager: { get: () => JSON.parse(JSON.stringify(ctx.config)), save: (c) => saved.push(c) },
	}
	return { ctx, saved }
}

const tick = () => new Promise((r) => setImmediate(r))

describe('WO-638 boot screen assignment', () => {
	it('lit jacks come out in slot order with their flag port', () => {
		assert.deepEqual(B.litPorts(MAP_NOW), [
			{ id: 'gpu_p0', name: 'DP-0', port: 1 },
			{ id: 'gpu_p2', name: 'DP-4', port: 3 },
		])
	})

	it('destination cables on dark jacks move to the free lit jack; the operator jack is never shared', () => {
		const lit = B.litPorts(MAP_NOW)
		const plan = B.planDestinationCables(boxConfig(), lit, 'gpu_p0')
		assert.deepEqual(plan.moves, [{ from: 'gpu_p3', to: 'gpu_p2' }])
		assert.equal(plan.edges.find((e) => e.sourceId === 'dst_in_dst_pgm').sinkId, 'gpu_p2')
		const swapped = B.planDestinationCables(boxConfig(), lit, 'gpu_p2')
		assert.deepEqual(swapped.moves, [{ from: 'gpu_p3', to: 'gpu_p0' }])
	})

	it('a cable already on a lit jack stays; one on the chosen operator jack moves off it', () => {
		const cfg = boxConfig()
		cfg.deviceGraph.edges[1].sinkId = 'gpu_p2'
		const lit = B.litPorts(MAP_NOW)
		assert.deepEqual(B.planDestinationCables(cfg, lit, 'gpu_p0').moves, [])
		assert.deepEqual(B.planDestinationCables(cfg, lit, 'gpu_p2').moves, [{ from: 'gpu_p2', to: 'gpu_p0' }])
	})

	it('no free jack left: the cable stays and is reported', () => {
		const plan = B.planDestinationCables(boxConfig(), [{ id: 'gpu_p0', name: 'DP-0', port: 1 }], 'gpu_p0')
		assert.deepEqual(plan.unplaced, ['gpu_p3'])
		assert.deepEqual(plan.moves, [])
	})

	it('default: the saved operator jack when lit, else the first lit jack no destination keeps', () => {
		const cfg = boxConfig()
		assert.equal(B.defaultOperator(cfg, B.litPorts(MAP_SAME), 2).name, 'DP-2')
		assert.equal(B.defaultOperator(cfg, B.litPorts(MAP_NOW), 2).name, 'DP-0')
		cfg.deviceGraph.edges[1].sinkId = 'gpu_p0'
		assert.equal(B.defaultOperator(cfg, B.litPorts(MAP_NOW), 2).name, 'DP-4')
	})

	it('stacked outputs are detected and laid out left to right', () => {
		assert.equal(
			B.outputsOverlap([
				{ x: 0, y: 0, width: 1920, height: 1080 },
				{ x: 0, y: 0, width: 1920, height: 1080 },
			]),
			true
		)
		assert.equal(
			B.outputsOverlap([
				{ x: 0, y: 0, width: 1920, height: 1080 },
				{ x: 1920, y: 0, width: 1920, height: 1080 },
			]),
			false
		)
		assert.deepEqual(B.spreadArgs(['DP-0', 'DP-4']), [
			'--output',
			'DP-0',
			'--auto',
			'--pos',
			'0x0',
			'--primary',
			'--output',
			'DP-4',
			'--auto',
			'--right-of',
			'DP-0',
		])
	})

	it('asks only once per boot, never on one screen, never when turned off', () => {
		const { d, store } = deps()
		const cfg = boxConfig()
		assert.deepEqual([B.bootStatus(cfg, d).pending, B.bootStatus(cfg, d).defaultName], [true, 'DP-0'])
		store.set(B.STATE_KEY, { bootId: 'linux:boot-a' })
		assert.equal(B.bootStatus(cfg, d).reason, 'done_this_boot')
		store.set(B.STATE_KEY, { bootId: 'linux:boot-old' })
		assert.equal(B.bootStatus(cfg, d).pending, true)
		assert.equal(B.bootStatus(cfg, { ...d, gpuMap: () => ({ ports: [port(0, 'DP-0')] }) }).reason, 'single_screen')
		assert.equal(B.bootStatus({ ...cfg, operatorTools: { bootScreenPicker: false } }, d).reason, 'off')
	})

	it('prepare unstacks only when outputs overlap', async () => {
		const { d, calls } = deps()
		assert.equal((await B.prepare({ config: boxConfig() }, d)).spread, true)
		assert.deepEqual(calls.xrandr[0].slice(0, 2), ['--output', 'DP-0'])
		assert.equal(calls.invalidate, 1, 'the spread must reach the canvas check (stale cache → nodm restart, box 21.10)')
		const apart = deps({
			listOutputs: () => [
				{ name: 'DP-0', x: 0, y: 0, width: 10, height: 10 },
				{ name: 'DP-4', x: 10, y: 0, width: 10, height: 10 },
			],
		})
		assert.equal((await B.prepare({ config: boxConfig() }, apart.d)).spread, false)
		assert.equal(apart.calls.xrandr.length, 0)
	})

	it('a click while Caspar is held: flag + cables saved, config written before Caspar starts, gate opened', async () => {
		const { d, calls } = deps()
		const { ctx, saved } = makeCtx(boxConfig())
		const r = await B.resolve(ctx, 'DP-4', d)
		await tick()
		assert.deepEqual([r.ok, r.name, r.port, r.how, r.casparHeld], [true, 'DP-4', 3, 'clicked', true])
		const cs = saved[0].casparServer
		assert.deepEqual([cs.screen_3_operator_monitor, cs.screen_2_operator_monitor], [true, undefined])
		const edges = saved[0].deviceGraph.edges
		assert.equal(edges.find((e) => e.sourceId === 'dst_in_dst_operator_gui').sinkId, 'gpu_p2')
		assert.equal(edges.find((e) => e.sourceId === 'dst_in_dst_pgm').sinkId, 'gpu_p0')
		assert.deepEqual([calls.prestart, calls.apply, calls.gate], [1, 0, 1])
		const again = await B.resolve(ctx, 'DP-0', d)
		assert.deepEqual([again.already, again.name, saved.length], [true, 'DP-4', 1])
	})

	it('the client says why the default was taken', async () => {
		const { d } = deps()
		const { ctx } = makeCtx(boxConfig())
		assert.equal((await B.resolve(ctx, { name: null, how: 'now' }, d)).how, 'default_now')
		const other = deps()
		assert.equal((await B.resolve(makeCtx(boxConfig()).ctx, { how: 'bogus' }, other.d)).how, 'timeout')
	})

	it('picking the jack the PGM cable is on moves that cable, never deletes it', async () => {
		// box 21.10 19:32: operator DP-0 (gpu_p0) + PGM DP-4 (gpu_p2); clicking DP-4 dropped the PGM cable
		const { d } = deps()
		const cfg = boxConfig()
		cfg.casparServer = { screen_1_operator_monitor: true }
		cfg.deviceGraph.edges = [
			{ id: 'e_op', sourceId: 'dst_in_dst_operator_gui', sinkId: 'gpu_p0' },
			{ id: 'e_pgm', sourceId: 'dst_in_dst_pgm', sinkId: 'gpu_p2' },
			{ id: 'e_prv', sourceId: 'dst_in_dst_pgm', sinkId: 'gpu_p2', note: { outputLayer: 2 } },
		]
		const { ctx, saved } = makeCtx(cfg)
		const r = await B.resolve(ctx, 'DP-4', d)
		assert.deepEqual(r.moves, [{ from: 'gpu_p2', to: 'gpu_p0' }])
		const edges = saved[0].deviceGraph.edges
		assert.deepEqual(edges.map((e) => `${e.sourceId}>${e.sinkId}`).sort(), [
			'dst_in_dst_operator_gui>gpu_p2',
			'dst_in_dst_pgm>gpu_p0',
			'dst_in_dst_pgm>gpu_p0',
		])
		assert.deepEqual(edges.find((e) => e.note)?.note, { outputLayer: 2 }, 'edge properties ride along')
	})

	it('same hardware as last boot: nothing saved, but X is still laid out per the plan before Caspar starts', async () => {
		const { d, calls } = deps({ gpuMap: () => MAP_SAME })
		const cfg = boxConfig()
		cfg.deviceGraph.edges[1].sinkId = 'gpu_p3'
		const { ctx, saved } = makeCtx(cfg)
		const r = await B.resolve(ctx, null, d)
		await tick()
		assert.deepEqual([r.name, r.how, r.applying, saved.length], ['DP-2', 'timeout', false, 0])
		// box 21.10 19:29: "nothing changed" skipped the layout, the prepare spread stayed, PGM opened on the operator monitor
		assert.deepEqual([calls.prestart, calls.apply, calls.gate], [1, 0, 1])
	})

	it('Caspar up and nothing moved: X laid out per the plan, no Caspar restart', async () => {
		const { d, calls } = deps({ gpuMap: () => MAP_SAME, gateOpen: () => true })
		const cfg = boxConfig()
		const { ctx } = makeCtx(cfg)
		const r = await B.resolve(ctx, 'DP-2', d)
		await tick()
		assert.deepEqual([r.applying, calls.relayout, calls.apply, calls.prestart], [false, 1, 0, 0])
	})

	it('Caspar already up (gate timed out): a change runs the full apply instead', async () => {
		const { d, calls } = deps({ gateOpen: () => true })
		const { ctx } = makeCtx(boxConfig())
		await B.resolve(ctx, null, d)
		await tick()
		assert.deepEqual([calls.relayout, calls.apply, calls.prestart], [1, 1, 0])
	})

	it('Caspar up without the gate file (run.sh backstop, or started before this code): full apply, not a pre-start write', async () => {
		const { d, calls } = deps()
		const { ctx } = makeCtx(boxConfig())
		ctx._casparStatus = { connected: true }
		const r = await B.resolve(ctx, 'DP-4', d)
		await tick()
		assert.deepEqual([r.casparHeld, calls.apply, calls.prestart, calls.gate], [false, 1, 0, 1])
	})

	it('start-up: nothing to ask releases Caspar at once; a question holds it', () => {
		const one = deps({ gpuMap: () => ({ ports: [port(0, 'DP-0')] }) })
		assert.equal(B.startBootScreenGate({ config: boxConfig() }, one.d).pending, false)
		assert.equal(one.calls.gate, 1)
		const two = deps()
		assert.equal(B.startBootScreenGate({ config: boxConfig() }, { ...two.d, fallbackS: 3600 }).pending, true)
		assert.equal(two.calls.gate, 0)
	})

	it('the gate file holds the raw kernel boot id run.sh compares', () => {
		const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo638-')), 'run', 'ready')
		assert.equal(B.gateOpen('linux:abc', f), false)
		assert.equal(B.openGate('linux:abc', null, f), true)
		assert.equal(fs.readFileSync(f, 'utf8'), 'abc\n')
		assert.equal(B.gateOpen('linux:abc', f), true)
		assert.equal(B.openGate('linux:abc', null, f), false)
	})

	it('route: boot prepare / resolve reach the module; anything else is a 400', async () => {
		const seen = []
		const boot = {
			prepare: async () => (seen.push('prepare'), { ok: true, spread: false }),
			resolve: async (_c, p) => (
				seen.push(`resolve:${p.name}:${p.how}`),
				{ ok: true, status: 200, name: p.name || 'DP-0' }
			),
		}
		const confine = { isActive: () => false, stop: () => {}, sync: () => {} }
		const { ctx } = makeCtx(boxConfig())
		assert.equal((await handlePost({ boot: 'prepare' }, ctx, { boot, confine })).status, 200)
		assert.equal(
			JSON.parse((await handlePost({ boot: 'resolve', how: 'timeout' }, ctx, { boot, confine })).body).name,
			'DP-0'
		)
		await handlePost({ boot: 'resolve', name: 'DP-4' }, ctx, { boot, confine })
		assert.equal((await handlePost({ boot: 'nope' }, ctx, { boot, confine })).status, 400)
		assert.deepEqual(seen, ['prepare', 'resolve:null:timeout', 'resolve:DP-4:'])
	})

	it('run.sh holds only the first launch of a boot, on the file node writes, with a backstop', () => {
		const run = fs.readFileSync(path.join(__dirname, '..', '..', 'run.sh'), 'utf8')
		assert.match(
			run,
			/_gate_file="\$\{CASPAR_SCREEN_GATE_FILE:-\$\{HOME:-\/home\/casparcg\}\/\.highascg\/run\/caspar-screens-ready\}"/
		)
		assert.match(run, /_gate_sec="\$\{CASPAR_SCREEN_GATE_SEC:-240\}"/)
		assert.ok(run.indexOf('boot screen gate') < run.indexOf('while :; do'), 'the gate sits before the relaunch loop')
		assert.ok(B.GATE_FILE.endsWith(path.join('.highascg', 'run', 'caspar-screens-ready')))
		assert.ok(B.SERVER_FALLBACK_S > B.TIMEOUT_S && B.SERVER_FALLBACK_S < 240)
	})
})
