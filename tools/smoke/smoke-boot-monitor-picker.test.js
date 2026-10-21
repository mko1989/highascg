'use strict'

/**
 * Owner (todos21.07.26): "for the gui monitor choice on a fresh boot. can we have a button appear
 * on each screen with press this to run operator gui on this screen."
 *
 * WO-290 built the entire picker; its boot call site lived in the kiosk launcher, deleted with the kiosk (WO-646 —
 * WO-638/645's boot screen gate asks now). The fresh-boot opt-in rules stay. Every WO-290 hard gate (flag set, pinned port, resolvable rect,
 * playout active) still refuses — those tests live in smoke-wo290-operator-monitor-picker.test.js
 * and are untouched.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	resolvePickerOptIn,
	evaluateMonitorPickerTrigger,
} = require('../../src/system/operator-monitor-picker')

describe('fresh-boot opt-in', () => {
	it('is ON by default at the boot call site, OFF everywhere else', () => {
		assert.deepEqual(resolvePickerOptIn({}, { freshBoot: true }), { optIn: true, via: 'fresh_boot_default' })
		assert.equal(resolvePickerOptIn({}, {}).optIn, false, 'an ordinary non-boot evaluation stays opted out')
	})

	it('operatorTools.monitorPicker:false is the opt-out', () => {
		const config = { operatorTools: { monitorPicker: false } }
		assert.equal(resolvePickerOptIn(config, { freshBoot: true }).optIn, false)
	})

	it('fresh-boot opt-in does NOT weaken the configured-box gates', () => {
		// Flag already set → refuse, even at boot.
		const configured = { casparServer: { screen_2_operator_monitor: true } }
		const v = evaluateMonitorPickerTrigger(configured, {
			freshBoot: true,
			resolveFlagPort: () => 2,
			resolveOperatorMonitorRect: () => null,
		})
		assert.equal(v.run, false)
		assert.equal(v.reason, 'operator_monitor_flag_set')

		// On-air box → refuse, even at boot.
		const onAir = evaluateMonitorPickerTrigger({}, { freshBoot: true, playoutActive: true })
		assert.equal(onAir.run, false)
		assert.equal(onAir.reason, 'playout_active')

		// Genuinely fresh → run.
		const fresh = evaluateMonitorPickerTrigger({}, {
			freshBoot: true,
			resolveFlagPort: () => null,
			resolveOperatorMonitorRect: () => null,
		})
		assert.equal(fresh.run, true)
		assert.equal(fresh.reason, 'operator_monitor_unconfigured')
	})
})
