'use strict'

/**
 * WO-308 — split "operator monitor" from "confine pointer to it". That coupling caused a real
 * mouse lockout (2026-07-21, a35c245 auto-set screen_N_operator_monitor from cabling, which
 * silently switched pointer confinement on with it; the stale-rect watchdog then dragged the
 * pointer off-screen until e2ab1a8 fixed the geometry-follow bug). This does not touch that fix —
 * it adds an escape hatch so a resolved operator monitor no longer FORCES confinement.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	isOperatorPointerConfineDesired,
	evaluateOperatorPointerConfineDesire,
} = require('../../src/utils/x-display-session-layout')

describe('evaluateOperatorPointerConfineDesire — the reason a decision was made', () => {
	it("'off' refuses even with a resolvable operator monitor port", () => {
		const config = { casparServer: { screen_2_operator_monitor: true }, operatorTools: { pointerConfine: 'off' } }
		const v = evaluateOperatorPointerConfineDesire(config)
		assert.equal(v.desired, false)
		assert.equal(v.reason, 'pointerConfine_off')
	})

	it("'on' forces confinement even with nothing resolved", () => {
		const config = { operatorTools: { pointerConfine: 'on' } }
		const v = evaluateOperatorPointerConfineDesire(config)
		assert.equal(v.desired, true)
		assert.equal(v.reason, 'pointerConfine_on')
	})

	it("'auto' (default) reproduces the pre-WO-308 rule exactly, with a reason attached", () => {
		const withPort = { casparServer: { screen_3_operator_monitor: true } }
		const v1 = evaluateOperatorPointerConfineDesire(withPort)
		assert.equal(v1.desired, true)
		assert.equal(v1.reason, 'operator_monitor_port_3')

		const multiviewOnly = { operatorTools: { pointerConfineMultiview: true } }
		const v2 = evaluateOperatorPointerConfineDesire(multiviewOnly)
		assert.equal(v2.desired, true)
		assert.equal(v2.reason, 'pointerConfineMultiview')

		const nothing = {}
		const v3 = evaluateOperatorPointerConfineDesire(nothing)
		assert.equal(v3.desired, false)
		assert.equal(v3.reason, 'no_operator_monitor_and_multiview_off')
	})

	it('an unrecognized pointerConfine value falls back to auto rather than failing closed/open', () => {
		const config = { casparServer: { screen_1_operator_monitor: true }, operatorTools: { pointerConfine: 'bogus' } }
		assert.equal(evaluateOperatorPointerConfineDesire(config).desired, true, 'falls back to auto, not to off')
	})
})

describe('isOperatorPointerConfineDesired stays a byte-identical boolean wrapper', () => {
	it('agrees with evaluateOperatorPointerConfineDesire.desired in every mode', () => {
		const cases = [
			{},
			{ casparServer: { screen_1_operator_monitor: true } },
			{ operatorTools: { pointerConfineMultiview: true } },
			{ casparServer: { screen_1_operator_monitor: true }, operatorTools: { pointerConfine: 'off' } },
			{ operatorTools: { pointerConfine: 'on' } },
		]
		for (const config of cases) {
			assert.equal(
				isOperatorPointerConfineDesired(config),
				evaluateOperatorPointerConfineDesire(config).desired,
				`diverged for ${JSON.stringify(config)}`,
			)
		}
	})

	it("default 'auto' behaviour is unchanged from before WO-308 (no config key at all)", () => {
		// The exact pre-WO-308 body, re-derived here so a regression in the new function is caught
		// even if this file is the only thing that still remembers what "before" looked like.
		function legacyIsDesired(config) {
			const { resolveOperatorMonitorPort } = require('../../src/utils/operator-monitor-resolve')
			if (resolveOperatorMonitorPort(config).port != null) return true
			if (config?.operatorTools?.pointerConfineMultiview === true) return true
			return false
		}
		const samples = [
			{},
			{ casparServer: { screen_1_operator_monitor: true } },
			{ casparServer: { screen_4_operator_monitor: true } },
			{ operatorTools: { pointerConfineMultiview: true } },
			{ operatorTools: { pointerConfineMultiview: false } },
		]
		for (const config of samples) {
			assert.equal(isOperatorPointerConfineDesired(config), legacyIsDesired(config), JSON.stringify(config))
		}
	})
})

describe('settings-post whitelists operatorTools.pointerConfine', () => {
	it('accepts auto/on/off and rejects anything else back to auto', async () => {
		const { handlePost } = require('../../src/api/settings-post')
		const logs = []
		const defaults = require('../../src/config/defaults')
		async function save(patch) {
			const cfg = JSON.parse(JSON.stringify(defaults))
			const ctx = {
				config: cfg,
				configManager: { get: () => cfg, save: (next) => Object.assign(cfg, next) },
				persistence: { get: () => null, set: () => {} },
				log: (level, msg) => logs.push([level, msg]),
			}
			const res = await handlePost('/api/settings', JSON.stringify(patch), ctx)
			assert.equal(res.status, 200, res.body)
			return cfg.operatorTools.pointerConfine
		}
		assert.equal(await save({ operatorTools: { pointerConfine: 'off' } }), 'off')
		assert.equal(await save({ operatorTools: { pointerConfine: 'ON' } }), 'on', 'case-insensitive')
		assert.equal(await save({ operatorTools: { pointerConfine: 'yolo' } }), 'auto', 'invalid value falls back')
	})
})

describe('pointer-confine.js logs one line per decision', () => {
	const fs = require('fs')
	const path = require('path')
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'system', 'pointer-confine.js'), 'utf8')

	it('the skip and run paths both log through evaluateOperatorPointerConfineDesire\'s reason', () => {
		assert.match(src, /evaluateOperatorPointerConfineDesire/, 'must use the reason-carrying verdict, not the plain boolean')
		assert.match(src, /\[Pointer confine\] SKIP — \$\{verdict\.reason\}/)
		assert.match(src, /\[Pointer confine\] RUN — \$\{verdict\.reason\}/)
	})

	it('the RUN log sits OUTSIDE the steady-state "unchanged" branch, so an 8s watchdog recheck does not spam it', () => {
		const runIdx = src.indexOf('[Pointer confine] RUN')
		const unchangedIdx = src.indexOf("mode: 'unchanged'")
		assert.ok(runIdx > 0 && unchangedIdx > 0, 'both markers present')
		assert.ok(runIdx > unchangedIdx, 'RUN must be logged AFTER the unchanged early-return, not before it')
	})
})
