'use strict'

/**
 * WO-597: operator_gui destination `videoOutput: 'screen' | 'shm'`.
 *  - default stays 'screen' (generated casparcg.config unchanged for every existing box),
 *  - 'shm' makes the generator emit the WO-594 <shm> consumer instead of <screen> (raster + audio-osc kept
 *    so route layers 10-49 and the NVENC gui-stream still work),
 *  - shmName is validated (segment /dev/shm/highascg-<shmName>), fallback 'opgui',
 *  - the Firefox kiosk never auto-launches for an shm operator surface (the Godot client owns it).
 * Offline-only: pure functions.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const { buildOperatorGuiChannel } = require('../../src/config/config-generator-operator-gui')
const { shouldAutoLaunchOperatorGui } = require('../../src/system/operator-gui-launcher')

const DIMS = { width: 1920, height: 1080, fps: 50, modeId: '1080p5000', isCustom: false }
const CTX = { cumulativeX: 0, nextDevice: 1, layout: null }

function normDest(raw) {
	return normalizeScreenDestinations({ version: 1, destinations: [raw] }).destinations[0]
}

test('WO-597: videoOutput defaults to screen, shmName to opgui', () => {
	const d = normDest({ id: 'og', mode: 'operator_gui' })
	assert.equal(d.videoOutput, 'screen')
	assert.equal(d.shmName, 'opgui')
})

test('WO-597: videoOutput shm + shmName round-trip; bad names fall back', () => {
	assert.equal(normDest({ id: 'og', mode: 'operator_gui', videoOutput: 'shm', shmName: 'ch5' }).shmName, 'ch5')
	assert.equal(normDest({ id: 'og', mode: 'operator_gui', videoOutput: 'shm' }).videoOutput, 'shm')
	assert.equal(normDest({ id: 'og', mode: 'operator_gui', videoOutput: 'bogus' }).videoOutput, 'screen')
	assert.equal(normDest({ id: 'og', mode: 'operator_gui', shmName: '../etc/passwd' }).shmName, 'opgui')
})

test('WO-597: generator emits <shm> (not <screen>) for videoOutput shm', () => {
	const dest = normDest({ id: 'og', mode: 'operator_gui', videoOutput: 'shm', label: 'Operator GUI' })
	const xml = buildOperatorGuiChannel({}, dest, DIMS, CTX, 5)
	assert.ok(xml.includes('<shm>') && xml.includes('<name>opgui</name>'), 'shm consumer with segment name')
	assert.ok(!xml.includes('<screen>'), 'no screen window in shm mode')
	assert.ok(xml.includes('<audio-osc>true</audio-osc>'), 'audio-osc kept')
	assert.ok(xml.includes('<video-mode>1080p5000</video-mode>'), 'channel raster kept')
})

test('WO-597: default operator GUI XML is unchanged (still <screen>)', () => {
	const dest = normDest({ id: 'og', mode: 'operator_gui', physicalPort: 2, label: 'Operator GUI' })
	const xml = buildOperatorGuiChannel({}, dest, DIMS, CTX, 5)
	assert.ok(xml.includes('<screen>'))
	assert.ok(!xml.includes('<shm>'))
})

test('WO-597: no Firefox kiosk auto-launch when the operator surface is shm', () => {
	const cfg = {
		screenDestinations: { version: 1, destinations: [{ id: 'og', mode: 'operator_gui', videoOutput: 'shm' }] },
	}
	const verdict = shouldAutoLaunchOperatorGui(cfg, {
		resolveMonitorPort: () => {
			throw new Error('resolver must not be consulted for an shm operator surface')
		},
	})
	assert.deepEqual(verdict, { launch: false, reason: 'native_client_shm' })
})

test('WO-597 T4: the web operator_gui inspector offers Video output: Screen | Shared memory', () => {
	const src = require('node:fs').readFileSync(
		require('node:path').join(
			__dirname,
			'../../client/components/device-view-destinations-inspector-operator-gui-fields.js'
		),
		'utf8'
	)
	assert.match(src, /\['screen', 'Screen[^']*'\],\s*\['shm', 'Shared memory[^']*'\]/)
	assert.match(src, /patchDestination\(d\.id, \{ videoOutput: videoOutputIn\.value === 'shm' \? 'shm' : 'screen' \}\)/)
	assert.match(src, /field\('Video output', videoOutputIn\)/)
})
