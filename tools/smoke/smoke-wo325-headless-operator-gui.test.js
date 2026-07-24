'use strict'

/**
 * WO-325: headless / stream-only operator GUI. A destination with `headless:true` must:
 *  - round-trip through normalization (default false),
 *  - make the generator emit the Caspar channel WITHOUT a <screen> consumer (raster + audio-osc
 *    kept, so route layers 10-49 and the runtime NVENC gui-stream still work),
 *  - resolve to a null physical port (never borrow the multiview's jack),
 *  - suppress the boot Firefox kiosk.
 * Offline-only: pure functions, no X/firefox/spawn.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { shouldAutoLaunchOperatorGui } = require('../../src/system/operator-gui-launcher')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { buildOperatorGuiChannel, resolveOperatorGuiPort } = require('../../src/config/config-generator-operator-gui')

const DIMS = { width: 1920, height: 1080, fps: 50, modeId: '1080p5000', isCustom: false }
const CTX = { cumulativeX: 0, nextDevice: 1, layout: null }

function normDest(raw) {
	return normalizeScreenDestinations({ version: 1, destinations: [raw] }).destinations[0]
}

test('WO-325: headless flag round-trips (default false)', () => {
	const plain = normDest({ id: 'og', mode: 'operator_gui' })
	const headless = normDest({ id: 'og', mode: 'operator_gui', headless: true })
	assert.equal(plain.headless, false, 'default is a real physical output')
	assert.equal(headless.headless, true)
})

test('WO-325: generator omits <screen> for a headless operator GUI but keeps the channel + audio-osc', () => {
	const dest = normDest({ id: 'og', mode: 'operator_gui', headless: true, label: 'Operator GUI' })
	const xml = buildOperatorGuiChannel({}, dest, DIMS, CTX, 5)
	assert.ok(!xml.includes('<screen>'), 'headless channel must NOT emit a <screen> consumer')
	assert.ok(xml.includes('<audio-osc>true</audio-osc>'), 'channel raster/audio-osc must remain for the stream + route layers')
	assert.ok(xml.includes('<video-mode>1080p5000</video-mode>'), 'channel still exists')
	assert.ok(/HEADLESS/i.test(xml), 'comment marks it headless')
})

test('WO-325: a non-headless operator GUI still emits a <screen> consumer (unchanged behaviour)', () => {
	const dest = normDest({ id: 'og', mode: 'operator_gui', physicalPort: 2, label: 'Operator GUI' })
	const xml = buildOperatorGuiChannel({}, dest, DIMS, CTX, 5)
	assert.ok(xml.includes('<screen>'), 'default operator GUI keeps its physical screen consumer')
})

test('WO-325: resolveOperatorGuiPort returns null for headless even when an explicit port is set', () => {
	const headlessWithPort = normDest({ id: 'og', mode: 'operator_gui', headless: true, physicalPort: 3 })
	assert.equal(resolveOperatorGuiPort({}, headlessWithPort), null, 'headless never resolves a port')
	const plainWithPort = normDest({ id: 'og', mode: 'operator_gui', physicalPort: 3 })
	assert.equal(resolveOperatorGuiPort({}, plainWithPort), 3, 'non-headless honors explicit port')
})

test('WO-325: headless suppresses the boot kiosk and takes precedence over the monitor resolver', () => {
	const cfg = { screenDestinations: { version: 1, destinations: [{ id: 'og', mode: 'operator_gui', headless: true }] } }
	const verdict = shouldAutoLaunchOperatorGui(cfg, {
		resolveMonitorPort: () => {
			throw new Error('resolver must not be consulted for a headless operator GUI')
		},
	})
	assert.equal(verdict.launch, false)
	assert.equal(verdict.reason, 'headless')
})
