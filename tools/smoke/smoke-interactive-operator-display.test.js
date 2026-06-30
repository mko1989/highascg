'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	resolveOperatorDisplayRect,
	isOperatorPointerConfineDesired,
	pointerInConfineAllowance,
	operatorMonitorPortIndex,
	buildOperatorDisplaySessionShellLines,
	buildConfineCursorShellLines,
} = require('../../src/utils/x-display-session')
const { applyPhysicalPortConsumerFlagsToScreens } = require('../../src/config/screen-consumer-port-resolve')
const defaults = require('../../src/config/defaults')

function layoutWithScreens(screens, multiview) {
	return {
		screens: screens || {},
		multiview: multiview || {},
	}
}

describe('interactive operator display', () => {
	it('prefers multiview over interactive PGM screen consumer', () => {
		const config = {
			casparServer: {
				multiview_enabled: true,
				multiview_screen_consumer: true,
				screen_1_screen_consumer: true,
				screen_2_screen_consumer: true,
				screen_2_interactive: true,
			},
		}
		const layout = layoutWithScreens(
			{
				1: { x: 0, y: 0, width: 1920, height: 1080, sysId: 'DP-1' },
				2: { x: 1920, y: 0, width: 1920, height: 1080, sysId: 'HDMI-1' },
			},
			{ 1: { x: 3840, y: 0, width: 1920, height: 1080, sysId: 'DP-2' } },
		)
		const rect = resolveOperatorDisplayRect(config, layout)
		assert.equal(rect?.kind, 'multiview')
		assert.equal(rect?.sysId, 'DP-2')
		assert.equal(rect?.interactive, false)
	})

	it('operator monitor port overrides multiview default', () => {
		const config = {
			screen_2_system_id: 'DP-2',
			casparServer: {
				multiview_enabled: true,
				multiview_screen_consumer: true,
				screen_2_operator_monitor: true,
				multiview_interactive: true,
			},
		}
		const layout = layoutWithScreens(
			{ 2: { x: 1920, y: 0, width: 1920, height: 1080, sysId: 'DP-4' } },
			{ 1: { x: 3840, y: 0, width: 1920, height: 1080, sysId: 'DP-2' } },
		)
		const rect = resolveOperatorDisplayRect(config, layout)
		assert.equal(rect?.sysId, 'DP-2')
		assert.equal(operatorMonitorPortIndex(config), 2)
		assert.equal(isOperatorPointerConfineDesired(config), true)
	})

	it('falls back to first screen consumer when multiview screen consumer is off', () => {
		const config = {
			casparServer: {
				multiview_enabled: true,
				multiview_screen_consumer: false,
				screen_1_screen_consumer: true,
				screen_1_interactive: true,
			},
		}
		const layout = layoutWithScreens(
			{ 1: { x: 0, y: 0, width: 1920, height: 1080, sysId: 'DP-1' } },
			{ 1: { x: 1920, y: 0, width: 1920, height: 1080, sysId: 'HDMI-1' } },
		)
		const rect = resolveOperatorDisplayRect(config, layout)
		assert.equal(rect?.kind, 'screen')
		assert.equal(rect?.index, 1)
		assert.equal(rect?.interactive, true)
	})

	it('enables pointer confine only for operator monitor port (not interactive alone)', () => {
		const config = {
			casparServer: {
				screen_1_screen_consumer: true,
				screen_1_interactive: true,
			},
		}
		assert.equal(isOperatorPointerConfineDesired(config), false)
	})

	it('legacy settings override still enables pointer confine', () => {
		const config = {
			operatorTools: { pointerConfineMultiview: true },
			casparServer: { screen_1_screen_consumer: true },
		}
		assert.equal(isOperatorPointerConfineDesired(config), true)
	})

	it('allows pointer on interactive consumer outside operator monitor when confining', () => {
		const config = {
			screen_2_operator_monitor: true,
			screen_2_system_id: 'DP-2',
			casparServer: {
				screen_2_operator_monitor: true,
				multiview_enabled: true,
				multiview_screen_consumer: true,
				screen_2_screen_consumer: true,
				screen_2_interactive: true,
				multiview_interactive: true,
			},
		}
		const layout = layoutWithScreens(
			{ 2: { x: 1920, y: 0, width: 1920, height: 1080, sysId: 'DP-4' } },
			{ 1: { x: 3840, y: 0, width: 1920, height: 1080, sysId: 'DP-2' } },
		)
		assert.equal(pointerInConfineAllowance(config, layout, 2000, 540), true)
		assert.equal(pointerInConfineAllowance(config, layout, 3900, 540), true)
		assert.equal(pointerInConfineAllowance(config, layout, 100, 540), false)
	})

	it('apply-layout session lines skip primary/confine without operator monitor', () => {
		const config = {
			casparServer: {
				multiview_enabled: true,
				multiview_screen_consumer: true,
			},
		}
		const layout = layoutWithScreens(
			{ 1: { x: 0, y: 0, width: 1920, height: 1080, sysId: 'DP-1' } },
			{ 1: { x: 3840, y: 0, width: 1920, height: 1080, sysId: 'DP-2' } },
		)
		const lines = buildOperatorDisplaySessionShellLines(config, layout)
		assert.equal(isOperatorPointerConfineDesired(config), false)
		assert.ok(!lines.some((l) => l.includes('--primary')))
		assert.ok(lines.some((l) => l.includes("pkill -f 'confine-cursor.py'")))
	})

	it('apply-layout session lines include primary and confine after operator monitor', () => {
		const config = {
			screen_1_system_id: 'DP-1',
			casparServer: { screen_1_operator_monitor: true },
		}
		const layout = layoutWithScreens({ 1: { x: 0, y: 0, width: 1920, height: 1080, sysId: 'DP-1' } })
		const lines = buildOperatorDisplaySessionShellLines(config, layout)
		assert.ok(lines.some((l) => l.includes('xrandr --output DP-1 --primary')))
		const confine = buildConfineCursorShellLines(config, layout)
		assert.ok(confine.some((l) => l.includes('confine-pointer-barriers.py')))
		assert.ok(confine.some((l) => l.includes('unclutter -idle 2')))
	})

	it('physical port interactive=false does not clobber multiview_interactive', () => {
		const merged = {
			...defaults.casparServer,
			multiview_interactive: true,
			screen_2_interactive: false,
		}
		applyPhysicalPortConsumerFlagsToScreens(merged, {
			deviceGraph: defaults.deviceGraph,
			casparServer: merged,
		})
		assert.equal(merged.multiview_interactive, true)
	})
})
