'use strict'

/**
 * WO-496 — Apply must emit what is actually cabled.
 *
 * Owner 12.08: "yes, cabling can change dynamically, but when hitting apply caspar config it needs
 * to read what is actually connected."
 *
 * The generator's `!incomingEdge` fallback honoured `connector.caspar.outputBinding` unconditionally,
 * so a binding left behind by a removed cable (or by a deleted mapping node, or synthesized by
 * `handleUpdateConnector` when an SDI port was merely SAVED as an output) still produced a
 * `<decklink>` consumer. That is the config disagreeing with the graph.
 *
 * Fixed by provenance rather than by releasing on every unplug — cabling is allowed to change
 * dynamically, and a transient unplug must not destroy configuration:
 *   - `cable`  — a cable created it; real only while that cable exists.
 *   - `auto`   — synthesized from bus/mainIndex because the port was saved as an output with no
 *                binding at all; same rule (this is what invents a screen_1 binding when the
 *                operator does something unrelated, e.g. picks a pixel format).
 *   - `manual` — the operator dropped a DeckLink on a destination's output dot. That flow creates
 *                NO edge by design, so it must keep working with no cable.
 *   - absent   — pre-WO-496 config. Honoured: unknown provenance must never blank a live SDI.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')

/** @param {{ bindingSource?: string, cabled?: boolean }} spec */
function appWith(spec) {
	const caspar = { ioDirection: 'out', outputBinding: { type: 'screen', index: 1 } }
	if (spec.bindingSource) caspar.bindingSource = spec.bindingSource

	const app = JSON.parse(JSON.stringify(defaults))
	app.casparServer = {
		...app.casparServer,
		screen_count: 1,
		multiview_enabled: false,
		decklink_input_count: 0,
		live_audio_input_count: 0,
		screen_1_decklink_device: 3,
	}
	app.streamingChannel = { enabled: false }
	app.rtmp = { enabled: false }
	app.screenDestinations = {
		version: 1,
		destinations: [
			{ id: 'dst_a', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
	}
	app.deviceGraph = {
		version: 1,
		devices: [
			{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' },
			{ id: 'destinations', role: 'destinations', label: 'Screen destinations' },
		],
		connectors: [
			{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
			{ id: 'dlsdi_3', deviceId: 'caspar_host', kind: 'decklink_io', externalRef: '3', caspar },
		],
		edges: spec.cabled ? [{ id: 'e1', sourceId: 'dst_in_dst_a', sinkId: 'dlsdi_3' }] : [],
	}
	return app
}

const devicesInConsumers = (app) =>
	[...buildConfigXml(buildCasparGeneratorFlatConfig(app)).matchAll(/<decklink>[\s\S]*?<\/decklink>/g)]
		.map((m) => m[0])
		.flatMap((b) => [...b.matchAll(/<device>(\d+)<\/device>/g)].map((d) => parseInt(d[1], 10)))

test('WO-496: a cable-made binding emits while the cable is there', () => {
	assert.deepEqual(devicesInConsumers(appWith({ bindingSource: 'cable', cabled: true })), [3])
})

test('WO-496: the same binding stops emitting once the cable is pulled', () => {
	assert.deepEqual(
		devicesInConsumers(appWith({ bindingSource: 'cable', cabled: false })),
		[],
		'Apply must describe the graph, not a cable that was removed',
	)
})

test('WO-496: pulling and re-plugging is non-destructive — the consumer comes back', () => {
	// Same persisted connector, only the edge differs: unplug is a view of reality, not a mutation.
	const unplugged = appWith({ bindingSource: 'cable', cabled: false })
	const replugged = appWith({ bindingSource: 'cable', cabled: true })
	assert.deepEqual(devicesInConsumers(unplugged), [])
	assert.deepEqual(devicesInConsumers(replugged), [3], 'cabling may change dynamically')
})

test('WO-496: an auto-synthesized binding needs a cable too', () => {
	// This is the one that appears when an SDI port is saved as an output with no binding —
	// e.g. choosing a pixel format (WO-493) on a port nothing is cabled to.
	assert.deepEqual(devicesInConsumers(appWith({ bindingSource: 'auto', cabled: false })), [])
	assert.deepEqual(devicesInConsumers(appWith({ bindingSource: 'auto', cabled: true })), [3])
})

test('WO-496: a MANUAL binding keeps working with no cable (drop-on-output-dot has no edge)', () => {
	assert.deepEqual(
		devicesInConsumers(appWith({ bindingSource: 'manual', cabled: false })),
		[3],
		'dropping a DeckLink on a destination output dot creates no edge by design',
	)
})

test('WO-496: a pre-existing binding with no recorded provenance is still honoured', () => {
	assert.deepEqual(
		devicesInConsumers(appWith({ cabled: false })),
		[3],
		'unknown provenance must never silently blank a live SDI output',
	)
})

test('WO-496: provenance is stamped when a cable creates the binding', () => {
	const { applyDecklinkOutputOnDestinationEdge } = require('../../src/api/device-view-decklink-wiring')
	const app = appWith({ cabled: false })
	const ctx = { config: app, configManager: null, log: () => {} }
	const res = applyDecklinkOutputOnDestinationEdge(ctx, app.deviceGraph, 'dst_in_dst_a', 'dlsdi_3')
	assert.equal(res.changed, true)
	const dl = res.graph.connectors.find((c) => c.id === 'dlsdi_3')
	assert.equal(dl.caspar.bindingSource, 'cable')
})

test('WO-496: an explicit outputBinding in the patch is recorded as manual, a synthesized one as auto', () => {
	const CRUD = require('../../src/api/device-view-crud')
	const mk = () => {
		const app = appWith({ cabled: false })
		delete app.deviceGraph.connectors[1].caspar.outputBinding
		let store = JSON.parse(JSON.stringify(app))
		return { config: app, configManager: { get: () => store, save: (n) => { store = n } }, log: () => {} }
	}

	const manualCtx = mk()
	CRUD.handleUpdateConnector(
		// Real payload shape: `updateConnector: { id, patch }` (see client device-view-actions.js).
		{ updateConnector: { id: 'dlsdi_3', patch: { caspar: { ioDirection: 'out', outputBinding: { type: 'screen', index: 1 } } } } },
		manualCtx,
		{},
	)
	const manual = manualCtx.config.deviceGraph.connectors.find((c) => c.id === 'dlsdi_3')
	assert.equal(manual.caspar.bindingSource, 'manual', 'the operator supplied the binding')

	const autoCtx = mk()
	CRUD.handleUpdateConnector({ updateConnector: { id: 'dlsdi_3', patch: { caspar: { ioDirection: 'out' } } } }, autoCtx, {})
	const auto = autoCtx.config.deviceGraph.connectors.find((c) => c.id === 'dlsdi_3')
	assert.equal(auto.caspar.bindingSource, 'auto', 'nothing was supplied — this binding was invented')
})

test('WO-496: re-saving settings on a cabled port does not downgrade its cable provenance', () => {
	const CRUD = require('../../src/api/device-view-crud')
	const app = appWith({ bindingSource: 'cable', cabled: true })
	let store = JSON.parse(JSON.stringify(app))
	const ctx = { config: app, configManager: { get: () => store, save: (n) => { store = n } }, log: () => {} }

	// What the SDI inspector sends when the operator changes any setting.
	CRUD.handleUpdateConnector(
		{ updateConnector: { id: 'dlsdi_3', patch: { caspar: { ioDirection: 'out', decklinkPixelFormat: 'yuv' } } } },
		ctx,
		{},
	)
	const dl = ctx.config.deviceGraph.connectors.find((c) => c.id === 'dlsdi_3')
	assert.equal(dl.caspar.bindingSource, 'cable', 'still cable-made; a settings save must not rewrite provenance')
	assert.deepEqual(devicesInConsumers(ctx.config), [3], 'and it still emits')
})
