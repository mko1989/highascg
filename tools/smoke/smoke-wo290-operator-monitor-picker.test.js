'use strict'

/**
 * Smoke — WO-290: the opt-in operator-monitor picker for a fresh / factory-reset box.
 *
 * The risk this locks down is NOT the drawing — it is the trigger. A picker that fires on a
 * configured, playing-out box covers program with a full-screen prompt and eats an operator click.
 * So the bulk of this file hammers `evaluateMonitorPickerTrigger` from both sides.
 *
 * Everything runs with injected resolvers/prompt: NO X server, no python helper, no xrandr, and
 * `persist` is a spy that records whether the config would have been written at all.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	DEFAULT_TIMEOUT_MS,
	resolvePickerOptIn,
	evaluateMonitorPickerTrigger,
	findPinnedOperatorGuiPort,
	formatTriggerLog,
	parseResolution,
	listPickerOutputs,
	outputAtPointer,
	singleOutputShortcut,
	interpretPickerResult,
	applyOperatorMonitorChoice,
	runOperatorMonitorPicker,
} = require('../../src/system/operator-monitor-picker')

/** The live box's shape (xrandr): DP-0 3072x1728+0+0 program, DP-5 1920x1080+3072+0 operator. */
const PROGRAM = { name: 'DP-0', port: 1, x: 0, y: 0, width: 3072, height: 1728 }
const OPERATOR = { name: 'DP-5', port: 3, x: 3072, y: 0, width: 1920, height: 1080 }
const TWO_OUTPUTS = [PROGRAM, OPERATOR]

/** Trigger deps for a box where nothing at all is configured. */
const UNCONFIGURED = { resolveOperatorMonitorRect: () => null, resolveFlagPort: () => null }
/** Trigger deps for a box whose operator monitor IS configured (the WO-279 SSOT resolves). */
const CONFIGURED = {
	resolveOperatorMonitorRect: () => ({ x: 3072, y: 0, width: 1920, height: 1080, sysId: 'DP-5' }),
	resolveFlagPort: () => 3,
}

const noEnv = { env: {} }

function spyLog() {
	const lines = []
	return { lines, log: (level, msg) => lines.push(`${level} ${msg}`) }
}

describe('WO-290 opt-in — the picker is unreachable by accident', () => {
	it('is off by default: no env, no config flag, no explicit invocation', () => {
		assert.deepEqual(resolvePickerOptIn({}, noEnv), { optIn: false, via: 'none' })
	})

	it('opts in via explicit invocation, env var, or config', () => {
		assert.equal(resolvePickerOptIn({}, { ...noEnv, explicit: true }).via, 'explicit_invocation')
		assert.equal(resolvePickerOptIn({}, { env: { HIGHASCG_OPERATOR_MONITOR_PICKER: '1' } }).via, 'env')
		assert.equal(resolvePickerOptIn({ operatorTools: { monitorPicker: true } }, noEnv).via, 'config')
	})

	it('an ordinary boot on an UNCONFIGURED box still does not run it', () => {
		const v = evaluateMonitorPickerTrigger({}, { ...noEnv, ...UNCONFIGURED })
		assert.equal(v.run, false)
		assert.equal(v.reason, 'not_opted_in')
	})
})

describe('WO-290 trigger predicate — configured vs unconfigured', () => {
	it('RUNS only when opted in AND the WO-279 SSOT resolves nothing', () => {
		const v = evaluateMonitorPickerTrigger({}, { ...noEnv, explicit: true, ...UNCONFIGURED })
		assert.equal(v.run, true)
		assert.equal(v.reason, 'operator_monitor_unconfigured')
	})

	it('REFUSES when resolveOperatorMonitorRect resolves a monitor', () => {
		const v = evaluateMonitorPickerTrigger(
			{},
			{ ...noEnv, explicit: true, resolveOperatorMonitorRect: CONFIGURED.resolveOperatorMonitorRect, resolveFlagPort: () => null },
		)
		assert.equal(v.run, false)
		assert.equal(v.reason, 'operator_monitor_configured')
	})

	it('REFUSES when the screen_N_operator_monitor flag is set even if no rect resolves', () => {
		// Configured but layout-unresolvable (cable moved, xrandr not applied yet) — still "chosen".
		const v = evaluateMonitorPickerTrigger(
			{ casparServer: { screen_2_operator_monitor: true } },
			{ ...noEnv, explicit: true, resolveOperatorMonitorRect: () => null },
		)
		assert.equal(v.run, false)
		assert.equal(v.reason, 'operator_monitor_flag_set')
		assert.equal(v.port, 2)
	})

	it('REFUSES when an operator_gui destination pins an explicit physicalPort', () => {
		const config = { screenDestinations: { destinations: [{ mode: 'operator_gui', physicalPort: 4 }] } }
		assert.equal(findPinnedOperatorGuiPort(config), 4)
		const v = evaluateMonitorPickerTrigger(config, { ...noEnv, explicit: true, ...UNCONFIGURED })
		assert.equal(v.run, false)
		assert.equal(v.reason, 'operator_gui_destination_port')
	})

	it('REFUSES while the box is on air, even unconfigured and opted in', () => {
		const v = evaluateMonitorPickerTrigger({}, { ...noEnv, explicit: true, playoutActive: true, ...UNCONFIGURED })
		assert.equal(v.run, false)
		assert.equal(v.reason, 'playout_active')
	})

	it('a THROWING resolver reads as unconfigured (headless), not as a crash', () => {
		const v = evaluateMonitorPickerTrigger(
			{},
			{
				...noEnv,
				explicit: true,
				resolveFlagPort: () => null,
				resolveOperatorMonitorRect: () => {
					throw new Error('no X server')
				},
			},
		)
		assert.equal(v.run, true)
	})

	it('logs the decision in BOTH directions', () => {
		const run = formatTriggerLog(evaluateMonitorPickerTrigger({}, { ...noEnv, explicit: true, ...UNCONFIGURED }))
		const skip = formatTriggerLog(evaluateMonitorPickerTrigger({}, { ...noEnv, explicit: true, ...CONFIGURED }))
		assert.match(run, /RUN — operator_monitor_unconfigured \(opt-in: explicit_invocation\)/)
		assert.match(skip, /SKIP — operator_monitor_flag_set \(port 3\) \(opt-in: explicit_invocation\)/)
	})
})

describe('WO-290 output enumeration', () => {
	it('parses xrandr resolution strings and rejects junk', () => {
		assert.deepEqual(parseResolution('1920x1080'), { width: 1920, height: 1080 })
		assert.equal(parseResolution('unknown'), null)
		assert.equal(parseResolution('0x0'), null)
	})

	it('takes the port index from the SAME gpu map slotOrder+1 the resolver uses', () => {
		const displays = [
			{ name: 'DP-0', xrandrName: 'DP-0', connected: true, resolution: '3072x1728', x: 0, y: 0 },
			{ name: 'DP-5', xrandrName: 'DP-5', connected: true, resolution: '1920x1080', x: 3072, y: 0 },
			{ name: 'HDMI-0', xrandrName: 'HDMI-0', connected: true, resolution: 'unknown', x: 0, y: 0 },
		]
		const gpuMap = {
			ports: [
				{ slotOrder: 0, runtime: { connected: true, xrandrName: 'DP-0' } },
				{ slotOrder: 2, runtime: { connected: true, xrandrName: 'DP-5' } },
				{ slotOrder: 101, runtime: { connected: true, xrandrName: 'HDMI-0' } },
			],
		}
		const outputs = listPickerOutputs({}, { displays, connectors: [], gpuMap })
		assert.deepEqual(outputs, [PROGRAM, OPERATOR])
	})
})

describe('WO-290 pointer -> output hit-testing', () => {
	it('resolves the output holding the pointer', () => {
		assert.equal(outputAtPointer(TWO_OUTPUTS, 100, 100).name, 'DP-0')
		assert.equal(outputAtPointer(TWO_OUTPUTS, 4000, 500).name, 'DP-5')
	})

	it('is half-open at the seam — the shared edge belongs to the RIGHT output', () => {
		assert.equal(outputAtPointer(TWO_OUTPUTS, 3071, 0).name, 'DP-0')
		assert.equal(outputAtPointer(TWO_OUTPUTS, 3072, 0).name, 'DP-5')
	})

	it('returns null off-screen and for non-finite coordinates', () => {
		assert.equal(outputAtPointer(TWO_OUTPUTS, 9000, 9000), null)
		assert.equal(outputAtPointer(TWO_OUTPUTS, -1, 0), null)
		assert.equal(outputAtPointer(TWO_OUTPUTS, NaN, 0), null)
		assert.equal(outputAtPointer(TWO_OUTPUTS, undefined, undefined), null)
	})
})

describe('WO-290 result interpretation — never guess a monitor', () => {
	it('a left click inside an output selects it', () => {
		const r = interpretPickerResult({ action: 'select', name: 'DP-5', rootX: 4000, rootY: 500 }, TWO_OUTPUTS)
		assert.equal(r.action, 'select')
		assert.equal(r.output.name, 'DP-5')
	})

	it('root coordinates win over the reported window name', () => {
		const r = interpretPickerResult({ action: 'select', name: 'DP-0', rootX: 4000, rootY: 500 }, TWO_OUTPUTS)
		assert.equal(r.output.name, 'DP-5')
	})

	it('falls back to the window name when coordinates are missing', () => {
		const r = interpretPickerResult({ action: 'select', name: 'DP-5' }, TWO_OUTPUTS)
		assert.equal(r.output.name, 'DP-5')
	})

	it('abandons on Esc, on timeout, on garbage and on a click outside every output', () => {
		assert.deepEqual(interpretPickerResult({ action: 'abandon' }, TWO_OUTPUTS), { action: 'abandon', reason: 'escape' })
		assert.deepEqual(interpretPickerResult({ action: 'timeout' }, TWO_OUTPUTS), { action: 'timeout', reason: 'timeout' })
		assert.equal(interpretPickerResult(null, TWO_OUTPUTS).action, 'abandon')
		assert.equal(interpretPickerResult({ action: 'select', rootX: 9999, rootY: 9999 }, TWO_OUTPUTS).reason, 'pointer_outside_outputs')
	})
})

describe('WO-290 persistence shape', () => {
	it('writes the flag the launcher reads, and clears every other port at both levels', () => {
		const before = { screen_1_operator_monitor: true, casparServer: { screen_2_operator_monitor: true, other: 1 } }
		const after = applyOperatorMonitorChoice(before, 3)
		assert.deepEqual(after.casparServer, { other: 1, screen_3_operator_monitor: true })
		assert.equal('screen_1_operator_monitor' in after, false)
		// input untouched
		assert.equal(before.casparServer.screen_2_operator_monitor, true)
	})

	it('the persisted config is what resolveFlagPort reads back', () => {
		const { resolveFlagPort } = require('../../src/utils/operator-monitor-resolve')
		assert.equal(resolveFlagPort(applyOperatorMonitorChoice({}, 2)), 2)
	})

	it('refuses an out-of-range port', () => {
		assert.throws(() => applyOperatorMonitorChoice({}, 0), /out of range/)
		assert.throws(() => applyOperatorMonitorChoice({}, 9), /out of range/)
	})
})

describe('WO-290 full run — shortcut, selection and every abandon path', () => {
	const baseCtx = (over) => ({
		config: {},
		explicit: true,
		env: {},
		...UNCONFIGURED,
		...over,
	})

	it('single-output box selects the only output WITHOUT prompting', async () => {
		const { lines, log } = spyLog()
		let prompted = false
		const saved = []
		const res = await runOperatorMonitorPicker(
			baseCtx({
				log,
				listOutputs: () => [OPERATOR],
				promptForOutput: async () => {
					prompted = true
					return { action: 'select' }
				},
				persist: (cfg) => saved.push(cfg) > 0,
			}),
		)
		assert.equal(prompted, false)
		assert.deepEqual({ ok: res.ok, action: res.action, port: res.port }, { ok: true, action: 'selected', port: 3 })
		assert.equal(saved[0].casparServer.screen_3_operator_monitor, true)
		assert.ok(lines.some((l) => /single output DP-5 — selected without prompting/.test(l)))
	})

	it('a click on the second output persists that output', async () => {
		const saved = []
		const res = await runOperatorMonitorPicker(
			baseCtx({
				listOutputs: () => TWO_OUTPUTS,
				promptForOutput: async () => ({ action: 'select', rootX: 3500, rootY: 200 }),
				persist: (cfg) => saved.push(cfg) > 0,
			}),
		)
		assert.equal(res.output, 'DP-5')
		assert.equal(saved.length, 1)
		assert.equal(saved[0].casparServer.screen_3_operator_monitor, true)
	})

	it('TIMEOUT leaves the system exactly as before — persist is never called', async () => {
		let persisted = 0
		const { lines, log } = spyLog()
		const res = await runOperatorMonitorPicker(
			baseCtx({
				log,
				listOutputs: () => TWO_OUTPUTS,
				promptForOutput: async () => ({ action: 'timeout' }),
				persist: () => (persisted++, true),
			}),
		)
		assert.deepEqual({ ok: res.ok, action: res.action, reason: res.reason }, { ok: false, action: 'timeout', reason: 'timeout' })
		assert.equal(persisted, 0)
		assert.ok(lines.some((l) => /abandoned — timeout; nothing changed/.test(l)))
	})

	it('Esc leaves the system exactly as before — persist is never called', async () => {
		let persisted = 0
		const res = await runOperatorMonitorPicker(
			baseCtx({
				listOutputs: () => TWO_OUTPUTS,
				promptForOutput: async () => ({ action: 'abandon', reason: 'escape' }),
				persist: () => (persisted++, true),
			}),
		)
		assert.deepEqual({ ok: res.ok, action: res.action, reason: res.reason }, { ok: false, action: 'abandon', reason: 'escape' })
		assert.equal(persisted, 0)
	})

	it('the default timeout is the WO-290 two minutes, and is handed to the prompt', async () => {
		assert.equal(DEFAULT_TIMEOUT_MS, 120_000)
		let seen = null
		await runOperatorMonitorPicker(
			baseCtx({
				listOutputs: () => TWO_OUTPUTS,
				promptForOutput: async (_o, opts) => {
					seen = opts.timeoutMs
					return { action: 'timeout' }
				},
				persist: () => true,
			}),
		)
		assert.equal(seen, 120_000)
	})

	it('a configured box never reaches the prompt', async () => {
		let prompted = false
		let persisted = 0
		const res = await runOperatorMonitorPicker(
			baseCtx({
				...CONFIGURED,
				listOutputs: () => TWO_OUTPUTS,
				promptForOutput: async () => ((prompted = true), { action: 'select', rootX: 100, rootY: 100 }),
				persist: () => (persisted++, true),
			}),
		)
		assert.deepEqual({ ok: res.ok, action: res.action, reason: res.reason }, { ok: false, action: 'skipped', reason: 'operator_monitor_flag_set' })
		assert.equal(prompted, false)
		assert.equal(persisted, 0)
	})

	it('an output with no GPU port slot is refused rather than half-persisted', async () => {
		let persisted = 0
		const res = await runOperatorMonitorPicker(
			baseCtx({
				listOutputs: () => [{ ...OPERATOR, port: null }],
				persist: () => (persisted++, true),
			}),
		)
		assert.equal(res.reason, 'unmapped_port')
		assert.equal(persisted, 0)
	})

	it('no connected outputs → skip, nothing changed', async () => {
		let persisted = 0
		const res = await runOperatorMonitorPicker(baseCtx({ listOutputs: () => [], persist: () => (persisted++, true) }))
		assert.deepEqual({ action: res.action, reason: res.reason }, { action: 'skipped', reason: 'no_connected_outputs' })
		assert.equal(persisted, 0)
	})

	it('singleOutputShortcut only fires for exactly one output', () => {
		assert.equal(singleOutputShortcut([]), null)
		assert.equal(singleOutputShortcut(TWO_OUTPUTS), null)
		assert.equal(singleOutputShortcut([OPERATOR]).name, 'DP-5')
	})
})
