'use strict'
/**
 * WO-645 — start-up modes (owner 21.10: autostart is an opt-in; normal operation boots to the desktop with
 * "start operator here, or run headless" on every screen). src/system/boot-screen-assignment.js + run.sh.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const B = require('../../src/system/boot-screen-assignment')

const port = (slot, name) => ({
	physicalPortId: `gpu_p${slot}`,
	slotOrder: slot,
	runtime: { connected: !!name, xrandrName: name || null },
})
const config = (mode) => ({
	...(mode ? { startup: { mode } } : {}),
	casparServer: { screen_1_operator_monitor: true },
	screenDestinations: { destinations: [{ id: 'dst_operator_gui', mode: 'operator_gui' }] },
	deviceGraph: {
		connectors: [
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'dst_in_dst_operator_gui', kind: 'destination_in' },
		],
		edges: [{ id: 'e_op', sourceId: 'dst_in_dst_operator_gui', sinkId: 'gpu_p0' }],
	},
})

function deps(over = {}) {
	const store = new Map()
	const calls = { gate: 0, hold: 0, prestart: 0 }
	let gate = false
	return {
		calls,
		store,
		d: {
			bootId: () => 'linux:boot-a',
			store: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
			gpuMap: () => ({ ports: [port(0, 'DP-0')] }),
			flagPort: (c) => (c?.casparServer?.screen_1_operator_monitor ? 1 : null),
			listOutputs: () => [{ name: 'DP-0', port: 1, x: 0, y: 0, width: 1920, height: 1080 }],
			xrandr: async () => ({ ok: true }),
			gateOpen: () => gate,
			invalidate: () => {},
			openGate: () => ((gate = true), calls.gate++, true),
			holdGate: () => (calls.hold++, true),
			apply: async () => ({ status: 200 }),
			prestart: async () => (calls.prestart++, { status: 200 }),
			relayout: async () => ({ status: 200 }),
			fallbackS: 0.01,
			...over,
		},
	}
}

describe('WO-645 start-up modes', () => {
	it('defaults to ask; unknown values fall back to ask', () => {
		assert.deepEqual(
			['', 'gui', 'HEADLESS', 'kiosk'].map((m) => B.startupMode({ startup: { mode: m } })),
			['ask', 'gui', 'headless', 'ask']
		)
		assert.equal(B.startupMode({}), 'ask')
	})

	it('ask: the launcher even on one screen, no countdown; Caspar held with no backstop and no server fallback', async () => {
		const { d, calls } = deps()
		const st = B.bootStatus(config(), d)
		assert.deepEqual([st.pending, st.launcher, st.timeoutS, st.mode, st.defaultName], [true, true, 0, 'ask', 'DP-0'])
		B.startBootScreenGate({ config: config() }, d)
		await new Promise((r) => setTimeout(r, 50))
		assert.deepEqual([calls.hold, calls.gate], [1, 0], 'held for a person, not released by the fallback timer')
		assert.equal(B.bootStatus(config(), { ...d, gpuMap: () => ({ ports: [port(0)] }) }).reason, 'no_screens')
	})

	it('Run headless: the default operator jack, recorded as headless, Caspar released', async () => {
		const { d, calls, store } = deps()
		const ctx = { config: config(), configManager: { get: () => config(), save: () => {} } }
		const r = await B.resolve(ctx, { how: 'headless' }, d)
		assert.deepEqual([r.ok, r.name, r.how], [true, 'DP-0', 'headless'])
		assert.equal(calls.gate, 1)
		assert.equal(store.get(B.STATE_KEY).how, 'headless')
		const after = B.bootStatus(config(), d)
		assert.deepEqual([after.pending, after.reason, after.headless], [false, 'done_this_boot', true])
		const none = deps({ gpuMap: () => ({ ports: [] }) })
		assert.deepEqual(
			[(await B.resolve(ctx, { how: 'headless' }, none.d)).ok, none.calls.gate],
			[true, 1],
			'no screen at all still starts Caspar'
		)
	})

	it('Start operator here: a click, not headless', async () => {
		const { d } = deps()
		const ctx = { config: config(), configManager: { get: () => config(), save: () => {} } }
		assert.equal((await B.resolve(ctx, { name: 'DP-0' }, d)).how, 'clicked')
		assert.equal(B.bootStatus(config(), d).headless, false)
	})

	it('headless: no question, Caspar released at once, the session client is told to quit', () => {
		const { d, calls } = deps()
		const st = B.startBootScreenGate({ config: config('headless') }, d)
		assert.deepEqual(
			[st.pending, st.reason, st.headless, calls.gate, calls.hold],
			[false, 'autostart_headless', true, 1, 0]
		)
	})

	it('gui: the WO-638 behaviour (one screen asks nothing)', () => {
		const { d, calls } = deps()
		assert.equal(B.startBootScreenGate({ config: config('gui') }, d).reason, 'single_screen')
		assert.equal(calls.gate, 1)
	})

	it('run.sh waits past the backstop while the hold file has this boot id', () => {
		const sh = fs.readFileSync(path.join(__dirname, '../../run.sh'), 'utf8')
		assert.match(sh, /_hold_file="\$\{CASPAR_SCREEN_HOLD_FILE:-\$\(dirname "\$_gate_file"\)\/caspar-screens-hold\}"/)
		assert.match(
			sh,
			/\[ "\$_waited" -lt "\$_gate_sec" \] \|\| \[ "\$\(cat "\$_hold_file" 2>\/dev\/null\)" = "\$_boot_id" \]/
		)
		assert.equal(path.basename(B.HOLD_FILE), 'caspar-screens-hold')
	})
})

describe('WO-645 settings POST persists startup.mode', () => {
	const defaults = require('../../src/config/defaults')
	const { handlePost } = require('../../src/api/settings-post')
	const run = async (startup) => {
		const saved = []
		const ctx = {
			config: { streaming: {}, ...JSON.parse(JSON.stringify(defaults)) },
			configManager: { get: () => JSON.parse(JSON.stringify(defaults)), save: (c) => (saved.push(c), true) },
			log: () => {},
		}
		const res = await handlePost('/api/settings', JSON.stringify({ startup }), ctx)
		return [res.status, saved[0]?.startup?.mode]
	}
	it('saves gui / headless, rejects junk to ask, defaults to ask', async () => {
		assert.deepEqual(await run({ mode: 'gui' }), [200, 'gui'])
		assert.deepEqual(await run({ mode: 'headless' }), [200, 'headless'])
		assert.deepEqual(await run({ mode: 'kiosk' }), [200, 'ask'])
		assert.equal(defaults.startup.mode, 'ask')
	})
})

describe('WO-645 settings GET carries startup.mode', () => {
	it('the default ask, or the stored mode', async () => {
		const { handleGet } = require('../../src/api/settings-get')
		const defaults = require('../../src/config/defaults')
		const get = async (startup) => {
			const config = { streaming: {}, ...JSON.parse(JSON.stringify(defaults)) }
			if (startup) config.startup = startup
			else delete config.startup
			const res = await handleGet('/api/settings', { config, configManager: { get: () => config }, log: () => {} })
			return JSON.parse(res.body).startup?.mode
		}
		assert.equal(await get(null), 'ask')
		assert.equal(await get({ mode: 'headless' }), 'headless')
	})
})
