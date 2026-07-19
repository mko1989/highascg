'use strict'

/**
 * WO-264: operator GUI auto-start decision + fresh-system factory default.
 * Offline-only — the monitor resolver is injected, NODE_TEST_CONTEXT blocks any spawn path,
 * no X/xdotool/firefox is touched.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
	shouldAutoLaunchOperatorGui,
	maybeAutoLaunchOperatorGui,
} = require('../../src/system/operator-gui-launcher')
const defaults = require('../../src/config/defaults')
const { finalizeScreenDestinationsConfig, normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { buildFactoryModularConfig } = require('../../src/config/factory-starter')
const { getChannelMap } = require('../../src/config/routing-map')

function configWithDestinations(destinations) {
	return { screenDestinations: { version: 1, destinations } }
}

const OPERATOR_DEST = { id: 'dst_operator_gui', mode: 'operator_gui', guiUrl: 'http://127.0.0.1:4200/?operatorGui=1' }

const resolverStub = (mode, port = 1) => () => ({ port: mode === 'none' ? null : port, mode })

test('WO-264 T264.1: no operator_gui destination → no launch', () => {
	const verdict = shouldAutoLaunchOperatorGui(configWithDestinations([{ id: 'dst_pgm_1', mode: 'pgm_only' }]), {
		resolveMonitorPort: resolverStub('auto-single'),
	})
	assert.equal(verdict.launch, false)
	assert.equal(verdict.reason, 'no_operator_gui_destination')
})

test('WO-264 T264.1: autoLaunch:false disables', () => {
	const verdict = shouldAutoLaunchOperatorGui(
		configWithDestinations([{ ...OPERATOR_DEST, autoLaunch: false }]),
		{ resolveMonitorPort: resolverStub('auto-single') },
	)
	assert.equal(verdict.launch, false)
	assert.equal(verdict.reason, 'auto_launch_disabled')
})

test('WO-264 T264.1: monitor mode none (multi-display, no flag) → no launch', () => {
	const verdict = shouldAutoLaunchOperatorGui(configWithDestinations([{ ...OPERATOR_DEST }]), {
		resolveMonitorPort: resolverStub('none'),
	})
	assert.equal(verdict.launch, false)
	assert.equal(verdict.reason, 'no_monitor_resolved')
})

test('WO-264 T264.1: auto-single / flag / fallback-flag all launch', () => {
	for (const mode of ['auto-single', 'flag', 'fallback-flag']) {
		const verdict = shouldAutoLaunchOperatorGui(configWithDestinations([{ ...OPERATOR_DEST }]), {
			resolveMonitorPort: resolverStub(mode),
		})
		assert.equal(verdict.launch, true, `mode ${mode} should launch`)
		assert.equal(verdict.reason, mode)
	}
})

test('WO-264 T264.1: explicit physicalPort launches without consulting the resolver', () => {
	const verdict = shouldAutoLaunchOperatorGui(
		configWithDestinations([{ ...OPERATOR_DEST, physicalPort: 2 }]),
		{
			resolveMonitorPort: () => {
				throw new Error('resolver must not be called for explicit ports')
			},
		},
	)
	assert.equal(verdict.launch, true)
	assert.equal(verdict.reason, 'explicit_port')
})

test('WO-264 T264.2: never spawns in test context', () => {
	// node --test sets NODE_TEST_CONTEXT for this process; assert the guard holds so the
	// launch-eligible config below cannot reach the firefox spawn path.
	assert.ok(process.env.NODE_TEST_CONTEXT, 'test must run under node --test for the env guard to apply')
	const logs = []
	maybeAutoLaunchOperatorGui({
		config: configWithDestinations([{ ...OPERATOR_DEST, physicalPort: 1 }]),
		log: (lvl, msg) => logs.push(`${lvl}:${msg}`),
	})
	assert.equal(logs.length, 0, 'guard must return before any logging or spawning')
})

test('WO-264 T264.3: factory default is one operator_gui screen that auto-launches', () => {
	const factory = buildFactoryModularConfig(defaults, finalizeScreenDestinationsConfig, normalizeScreenDestinations)
	const dests = factory.screenDestinations?.destinations || []
	assert.equal(dests.length, 1)
	assert.equal(dests[0].mode, 'operator_gui')
	assert.equal(dests[0].id, 'dst_operator_gui')
	assert.equal(dests[0].autoLaunch, true)
	assert.equal(dests[0].guiUrl, 'http://127.0.0.1:4200/?operatorGui=1')
	assert.equal(factory.screen_count, 1)

	const map = getChannelMap(factory)
	assert.equal(map.operatorGuiEnabled, true, 'routing map must derive operatorGuiEnabled from the factory default')

	const verdict = shouldAutoLaunchOperatorGui(factory, { resolveMonitorPort: resolverStub('auto-single') })
	assert.equal(verdict.launch, true, 'fresh single-display box must auto-launch')
})

test('WO-264: normalization defaults autoLaunch true and round-trips false', () => {
	const norm = normalizeScreenDestinations({
		version: 1,
		destinations: [{ ...OPERATOR_DEST }, { id: 'dst_og2', mode: 'operator_gui', autoLaunch: false }],
	})
	assert.equal(norm.destinations[0].autoLaunch, true)
	assert.equal(norm.destinations[1].autoLaunch, false)
})
