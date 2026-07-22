'use strict'

/**
 * WO-319 — the toggle-driven operator live canvas (client glue). The transport (gui-stream-client)
 * and the whole server chain are proven live; this pins the ACTIVATION logic that a browser can't
 * be asked to prove in CI:
 *  - acquire only when enabled AND server-available AND WebCodecs present (each is load-bearing —
 *    a decode session must never start on a client that can't decode or when the operator is off);
 *  - the toggle persists across reloads;
 *  - turning the toggle off releases the stream.
 *
 * Browser globals (WebSocket/VideoDecoder/localStorage/fetch) are stubbed BEFORE importing the ESM
 * module so guiStreamSupported() is true and the acquire path runs without a real socket.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

// --- stub the browser environment the module + transport expect, before import ---
let wsOpened = 0
class FakeWS {
	constructor() {
		wsOpened++
		this.readyState = 1
		this.binaryType = ''
	}
	close() {
		this.readyState = 3
		this.onclose && this.onclose()
	}
	send() {}
}
class FakeDecoder {
	constructor() {
		this.state = 'unconfigured'
	}
	configure() {
		this.state = 'configured'
	}
	decode() {}
	close() {
		this.state = 'closed'
	}
}
const store = new Map()
globalThis.WebSocket = FakeWS
globalThis.VideoDecoder = FakeDecoder
globalThis.EncodedVideoChunk = class {}
globalThis.localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
}
globalThis.location = { protocol: 'http:', host: '127.0.0.1:4200' }
let statusEnabled = true
globalThis.fetch = async (url) => {
	if (String(url).includes('/api/gui-stream/status')) {
		return { ok: true, json: async () => ({ ok: true, enabled: statusEnabled, channel: 4, running: true }) }
	}
	return { ok: false, json: async () => ({}) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('operator live canvas: enabled+available+WebCodecs acquires; off releases', async () => {
	const mod = await import('../../client/components/preview-canvas-live-stream.js')
	const {
		initOperatorLiveCanvas,
		setOperatorLiveCanvasEnabled,
		isOperatorLiveCanvasAvailable,
		operatorLiveCanvasState,
	} = mod

	initOperatorLiveCanvas()
	await sleep(20) // let the status fetch resolve
	assert.equal(isOperatorLiveCanvasAvailable(), true, 'server reported enabled + WebCodecs stubbed present')
	assert.equal(operatorLiveCanvasState().streaming, false, 'not streaming until the operator enables it')

	const before = wsOpened
	setOperatorLiveCanvasEnabled(true)
	await sleep(10)
	assert.equal(operatorLiveCanvasState().streaming, true, 'enabling acquires the stream')
	assert.ok(wsOpened > before, 'a WS was opened')
	assert.equal(store.get('highascg.operatorLiveCanvas'), '1', 'toggle persisted on')

	setOperatorLiveCanvasEnabled(false)
	await sleep(10)
	assert.equal(operatorLiveCanvasState().streaming, false, 'disabling releases the stream')
	assert.equal(store.get('highascg.operatorLiveCanvas'), '0', 'toggle persisted off')
})

test('never acquires while the server reports the feature unavailable', async () => {
	statusEnabled = false
	const mod = await import('../../client/components/preview-canvas-live-stream.js')
	// initOperatorLiveCanvas force-fetches status (bypasses the 60s TTL) → availability flips false.
	mod.initOperatorLiveCanvas()
	await sleep(20)
	assert.equal(mod.isOperatorLiveCanvasAvailable(), false, 'server says disabled')
	mod.setOperatorLiveCanvasEnabled(true)
	await sleep(20)
	assert.equal(mod.operatorLiveCanvasState().streaming, false, 'must not open a decode session with no server stream')
	mod.setOperatorLiveCanvasEnabled(false)
	statusEnabled = true
})

test('drawOperatorLiveCanvas returns false with no frame (caller falls back to JPEG)', async () => {
	const mod = await import('../../client/components/preview-canvas-live-stream.js')
	const fakeCtx = { drawImage: () => {} }
	assert.equal(mod.drawOperatorLiveCanvas(fakeCtx, 320, 180), false, 'no frame → JPEG fallback')
})
