'use strict'

/**
 * WO-414 smoke — dynamic channel allocation flows AROUND stored host-live pins,
 * and PGM master strips can SOLO to the monitor bus.
 *
 * Live incident 03.08: the stored NDI host source pins hostChannel 5; enabling the
 * WO-406 monitor bus allocated monitorCh = 5 too. Two owners, one channel: the
 * generator's channel table let the monitor block CLOBBER the NDI block, and the
 * mixer's macbook strip metered monitor-bus audio ("when audio was playing on prv
 * it also showed up as meter in macbook ndi input").
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { getChannelMap } = require('../../src/config/routing-map')

const monitorEntry = {
	id: 'audio_monitor_usb',
	type: 'system-audio',
	role: 'monitor',
	deviceName: 'sc60mon',
	enabled: true,
}

function baseConfig(extra) {
	return {
		casparServer: { screen_count: 1 },
		audioOutputs: [monitorEntry],
		...extra,
	}
}

test('WO-414: monitorCh skips a stored host-live pinned channel', () => {
	// Without the pin the monitor bus takes the next free channel…
	const free = getChannelMap(baseConfig())
	assert.ok(Number.isFinite(free.monitorCh) && free.monitorCh > 0)

	// …and with an NDI host pinned EXACTLY there, allocation must flow around it.
	const pinned = free.monitorCh
	const cfg = baseConfig({
		extraLiveSources: [
			{ type: 'ndi', routeType: 'ndi_host', sourceId: 'ndi_test', hostChannel: pinned, hostLayer: 1, value: `route://${pinned}-1`, ndiName: 'ndi://test' },
		],
	})
	const map = getChannelMap(cfg)
	const ndi = (map.inputChannels || []).find((e) => e.kind === 'ndi_host')
	assert.equal(ndi?.channel, pinned, 'stored pin never moves (WO-377/381 design)')
	assert.equal(map.monitorCh, pinned + 1, 'monitor bus allocated around the pin')
})

test('WO-414: no two owners share a channel number in the map', () => {
	const cfg = baseConfig({
		extraLiveSources: [
			{ type: 'ndi', routeType: 'ndi_host', sourceId: 'ndi_a', hostChannel: 5, hostLayer: 1, value: 'route://5-1', ndiName: 'ndi://a' },
			{ type: 'ndi', routeType: 'ndi_host', sourceId: 'ndi_b', hostChannel: 7, hostLayer: 1, value: 'route://7-1', ndiName: 'ndi://b' },
		],
	})
	const map = getChannelMap(cfg)
	const owners = []
	for (const e of map.inputChannels || []) owners.push(e.channel)
	for (const c of [map.monitorCh, map.multiviewCh, map.operatorGuiCh, map.streamingCh]) {
		if (Number.isFinite(c) && c > 0) owners.push(c)
	}
	assert.equal(new Set(owners).size, owners.length, `duplicate channel in ${JSON.stringify(owners)}`)
})

test('WO-414: PGM master strips carry a SOLO button (source pin)', () => {
	const masters = read('client/components/audio-mixer-console-masters.js')
	// The button is no longer gated on isPreview — both PGM and PRV masters solo.
	assert.doesNotMatch(masters, /r\.isPreview \? `<button[^`]*solo-btn/, 'SOLO no longer PRV-only')
	assert.match(masters, /class="audio-mixer-view__solo-btn[^"]*"[^>]*title="Solo this \$\{r\.isPreview \? 'PRV' : 'PGM'\} bus to the monitor output/, 'SOLO on every master strip')
})
