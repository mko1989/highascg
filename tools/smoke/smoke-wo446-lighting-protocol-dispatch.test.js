'use strict'

/**
 * WO-446 — lighting-input protocol dispatch (completes WO-179 T179.4).
 *
 * The inspector's Art-Net/sACN select saved `lightingProtocol` to the global-border slot and
 * `slotLightingProtocol()` could read it — but index.js constructed ArtnetReceiver
 * unconditionally, so choosing sACN silently kept Art-Net running. These tests drive the
 * LightingInputReceiver facade with the DMX master switch OFF (no sockets bind) and assert
 * the receiver class follows the slot's protocol, plus the two latent field-contract bugs the
 * shared base fixed: sACN lacked `_artnetScreenIndex` (TypeError in applyPatch when a patch
 * had no screenIndex) and stored its transport outside `_socket` (status always "not
 * listening").
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { LightingInputReceiver } = require('../../src/artnet/lighting-input-receiver')
const { ArtnetReceiver } = require('../../src/artnet/artnet-receiver')
const { SacnReceiver } = require('../../src/artnet/sacn-receiver')

/** Master switch off: reconfigure paths run fully but never bind a socket. */
const makeCtx = () => ({ config: { dmx: { artnetInputEnabled: false } }, log: () => {} })

const projectWithProtocol = (lightingProtocol) => ({
	scenes: {
		globalBorders: [{ enabled: true, artnetListenEnabled: false, lightingProtocol }],
	},
})

test('WO-446: facade starts on Art-Net and follows the slot to sACN and back', () => {
	const rx = new LightingInputReceiver(makeCtx())
	rx.reconfigureFromProject(projectWithProtocol('artnet'))
	assert.ok(rx._active instanceof ArtnetReceiver, 'artnet slot → ArtnetReceiver')

	rx.reconfigureFromProject(projectWithProtocol('sacn'))
	assert.ok(rx._active instanceof SacnReceiver, 'sacn slot → SacnReceiver swapped in')
	assert.equal(rx.getInputStatus().protocol, 'sacn', 'status reports the active protocol')

	rx.reconfigureFromProject(projectWithProtocol('artnet'))
	assert.ok(rx._active instanceof ArtnetReceiver, 'switching back re-creates Art-Net')
	rx.stop()
})

test('WO-446: same protocol on reconfigure keeps the same receiver instance', () => {
	const rx = new LightingInputReceiver(makeCtx())
	rx.reconfigureFromProject(projectWithProtocol('sacn'))
	const first = rx._active
	rx.reconfigureFromProject(projectWithProtocol('sacn'))
	assert.equal(rx._active, first, 'no churn when the protocol is unchanged')
	rx.stop()
})

test('WO-446: SacnReceiver inherits the field contract artnet-runtime reads by name', () => {
	const sacn = new SacnReceiver(makeCtx())
	assert.equal(typeof sacn._artnetScreenIndex, 'function', 'applyPatch calls _artnetScreenIndex()')
	assert.equal(sacn._artnetScreenIndex(), 0, 'stub config resolves to screen index 0')
	assert.ok('_socket' in sacn, 'transport handle must live in _socket (status "listening" reads it)')
	assert.ok('_artnetListenEnabled' in sacn, 'unified listen flag (status reads it by name)')
	const status = sacn.getInputStatus()
	assert.equal(status.listening, false, 'no transport bound → not listening')
	assert.equal(status.runtimeArtnetListenEnabled, false, 'flag defined (was undefined pre-WO-446)')
})

test('WO-446: both receivers expose identical protocol defaults', () => {
	const artnet = new ArtnetReceiver(makeCtx())
	const sacn = new SacnReceiver(makeCtx())
	assert.equal(artnet._defaultPort(), 6454)
	assert.equal(sacn._defaultPort(), 5568)
	assert.equal(typeof artnet.handleData, 'function')
	assert.equal(artnet.handleData, sacn.handleData, 'handleData is the shared base implementation')
})
