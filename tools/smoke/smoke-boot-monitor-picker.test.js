'use strict'

/**
 * Owner (todos21.07.26): "for the gui monitor choice on a fresh boot. can we have a button appear
 * on each screen with press this to run operator gui on this screen."
 *
 * WO-290 built the entire picker but deliberately shipped NO boot call site. This wires it:
 * operator-gui-launcher's auto-start, on `no_monitor_resolved`, runs the picker with a
 * fresh-boot default opt-in. Every WO-290 hard gate (flag set, pinned port, resolvable rect,
 * playout active) still refuses — those tests live in smoke-wo290-operator-monitor-picker.test.js
 * and are untouched.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

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

describe('launcher boot hook', () => {
	/** Stub the picker module in require.cache BEFORE the launcher lazily requires it. */
	function stubPicker(impl) {
		const resolved = require.resolve('../../src/system/operator-monitor-picker')
		const original = require.cache[resolved]
		require.cache[resolved] = {
			id: resolved,
			filename: resolved,
			loaded: true,
			exports: { runOperatorMonitorPicker: impl },
		}
		return () => {
			if (original) require.cache[resolved] = original
			else delete require.cache[resolved]
		}
	}

	it('passes freshBoot + a working configManager persist hook, and is single-flight', async () => {
		const calls = []
		const restore = stubPicker(async (opts) => {
			calls.push(opts)
			// Exercise the persist hook exactly as a click would.
			const saved = opts.persist({ casparServer: { screen_2_operator_monitor: true } })
			return saved ? { ok: true, action: 'selected', reason: 'clicked', output: 'DP-5', port: 2 } : { ok: false }
		})
		try {
			delete require.cache[require.resolve('../../src/system/operator-gui-launcher')]
			const launcher = require('../../src/system/operator-gui-launcher')

			let stored = null
			const ctx = {
				config: {},
				configManager: {
					save: (next) => {
						stored = next
					},
					get: () => stored || {},
				},
				log: () => {},
			}
			launcher.maybeRunBootMonitorPicker(ctx)
			launcher.maybeRunBootMonitorPicker(ctx) // second call while first is in flight
			await new Promise((r) => setTimeout(r, 30))

			assert.equal(calls.length, 1, 'single-flight: one prompt per process, never a re-prompt storm')
			assert.equal(calls[0].freshBoot, true, 'boot call site must identify itself')
			assert.equal(typeof calls[0].persist, 'function')
			assert.equal(stored?.casparServer?.screen_2_operator_monitor, true, 'a click persists the flag via configManager')
			assert.equal(ctx.config?.casparServer?.screen_2_operator_monitor, true, 'and the live ctx.config is synced')
		} finally {
			restore()
			delete require.cache[require.resolve('../../src/system/operator-gui-launcher')]
		}
	})

	it('reports playoutActive from live scene state', async () => {
		const { setChannel, clearChannel } = require('../../src/state/live-scene-state')
		const launcher = require('../../src/system/operator-gui-launcher')
		await clearChannel(7)
		assert.equal(launcher.anyLiveLookOnAir(), false, 'fresh box: nothing on air')
		// setChannel is runSerialized — the write lands on the returned promise, so await it.
		await setChannel(7, { scene: { layers: [{ layerNumber: 10, source: { type: 'media', value: 'x.mov' } }] } })
		assert.equal(launcher.anyLiveLookOnAir(), true, 'a restored live look counts as on air')
		await clearChannel(7)
	})
})
