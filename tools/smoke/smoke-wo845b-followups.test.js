'use strict'

/**
 * WO-845b smoke — the follow-ups the WO-845 sweep found outside its file scope:
 *  1. applyPatch clamped the sACN universe to the Art-Net 0..15 (sACN is 1..63999)
 *  2. a sACN universe change never re-subscribed (the multicast membership is fixed at construction)
 *  3. a failed Art-Net bind left a dead socket in receiver._socket (no retry, no surfaced error)
 *  4. removing a live-audio slot in the web client kept `routeTargets[s-1]`
 *  5. POST /api/audio/default-device answered 500 for a rejected card/device (validation → 400)
 * Hermetic: stubbed transports / dgram sockets / fetch — nothing is bound, sent or written (no ~/.asoundrc).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const dgram = require('node:dgram')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..', '..')
const quiet = { log() {}, config: { dmx: {} } }

// ---- 1. universe clamp per protocol ---------------------------------------------------------------

test('WO-845b: applyPatch clamps the universe per protocol (sACN 1..63999, Art-Net 0..15)', () => {
	const { SacnReceiver } = require('../../src/artnet/sacn-receiver')
	const { ArtnetReceiver } = require('../../src/artnet/artnet-receiver')
	const sacn = new SacnReceiver(quiet)
	const art = new ArtnetReceiver(quiet)
	const apply = (r, universe) => {
		r._applyPatch({ universe, screenIndex: 0 })
		return r._inputUniverse
	}
	assert.equal(apply(sacn, 100), 100, 'sACN universe 100 was clamped to 15')
	assert.equal(apply(sacn, 63999), 63999)
	assert.equal(apply(sacn, 64000), 63999)
	assert.equal(apply(sacn, 0), 1, 'sACN has no universe 0')
	assert.equal(apply(sacn, 'x'), 1)
	assert.equal(apply(art, 100), 15, 'Art-Net keeps the 4-bit universe nibble')
	assert.equal(apply(art, 0), 0)
	assert.equal(apply(art, 7), 7)
	// a plain stub (no _universeRange) keeps the legacy Art-Net range
	const { applyPatch } = require('../../src/artnet/artnet-runtime')
	const stub = { log() {}, _artnetScreenIndex: () => 0 }
	applyPatch(stub, { universe: 99 })
	assert.equal(stub._inputUniverse, 15)
})

// ---- 2. sACN re-subscribes on a universe change ---------------------------------------------------

function fakeTransports() {
	const made = []
	return {
		made,
		create(opts) {
			const t = new EventEmitter()
			t.opts = opts
			t.closed = 0
			t.close = () => {
				t.closed++
			}
			made.push(t)
			return t
		},
	}
}

function sacnRig() {
	const { SacnReceiver } = require('../../src/artnet/sacn-receiver')
	const r = new SacnReceiver(quiet)
	const f = fakeTransports()
	r._createTransport = (o) => f.create(o)
	r._effectiveListen = () => true
	r._inputPort = 5568
	return { r, f }
}

test('WO-845b: a sACN universe change closes the old receiver and subscribes the new universe', () => {
	const { r, f } = sacnRig()
	r._applyPatch({ universe: 5, screenIndex: 0 })
	r._ensureListening()
	assert.equal(f.made.length, 1)
	assert.deepEqual(f.made[0].opts.universes, [5])
	r._ensureListening()
	assert.equal(f.made.length, 1, 'unchanged patch keeps the receiver')

	r._applyPatch({ universe: 300, screenIndex: 0 })
	r._ensureListening()
	assert.equal(f.made.length, 2)
	assert.deepEqual(f.made[1].opts.universes, [300])
	assert.equal(f.made[0].closed, 1, 'old receiver closed')
	assert.equal(f.made[0].listenerCount('packet'), 0, 'old receiver detached')
	assert.equal(f.made[1].closed, 0)
	assert.equal(r._socket, f.made[1])

	// packets of the new universe reach handleData, a late error on the old one does not throw
	let got = null
	r.handleData = (buf) => (got = buf)
	f.made[1].emit('packet', { universe: 300, payload: {}, payloadAsBuffer: Buffer.from([9, 8]) })
	assert.equal(got[0], 9)
	assert.doesNotThrow(() => f.made[0].emit('error', new Error('late')))

	r.stop()
	assert.equal(f.made[1].closed, 1)
	assert.equal(r._socket, null)
	r._ensureListening()
	assert.equal(f.made.length, 3, 'rebinds after stop()')
})

test('WO-845b: a failed sACN bind drops the dead receiver so the next reconfigure retries', () => {
	const { r, f } = sacnRig()
	r._applyPatch({ universe: 2, screenIndex: 0 })
	r._ensureListening()
	f.made[0].emit('error', Object.assign(new Error('bind EADDRINUSE'), { syscall: 'bind', code: 'EADDRINUSE' }))
	assert.equal(r._socket, null)
	assert.equal(f.made[0].closed, 1)
	assert.match(r._bindError, /EADDRINUSE/)
	r._resolveArtnetPatch = () => ({})
	r._globalBorderSlot = () => null
	assert.match(r.getInputStatus().bindError, /EADDRINUSE/, 'surfaced in the input status')
	r._ensureListening()
	assert.equal(f.made.length, 2)
	assert.equal(r._bindError, null, 'cleared by a successful (re)creation')

	// a constructor that throws leaves no half-state either
	r._closeTransport()
	r._createTransport = () => {
		throw new Error('boom')
	}
	r._ensureListening()
	assert.equal(r._socket, null)
	assert.equal(r._bindError, 'boom')
})

// ---- 3. Art-Net failed bind --------------------------------------------------------------------

function patchDgram(makeSocket) {
	const real = dgram.createSocket
	const made = []
	dgram.createSocket = () => {
		const s = makeSocket(made.length)
		made.push(s)
		return s
	}
	return { made, restore: () => (dgram.createSocket = real) }
}

function fakeUdp(behaviour) {
	const s = new EventEmitter()
	s.closed = 0
	s.bind = () => {
		if (behaviour === 'throw') throw new RangeError('bad port')
		setImmediate(() =>
			behaviour === 'error'
				? s.emit('error', Object.assign(new Error('bind EADDRINUSE 0.0.0.0:6454'), { code: 'EADDRINUSE' }))
				: s.emit('listening')
		)
	}
	s.address = () => ({ address: '0.0.0.0', port: 6454 })
	s.close = () => {
		s.closed++
		setImmediate(() => s.emit('close'))
	}
	return s
}

const tick = () => new Promise((r) => setImmediate(r))

test('WO-845b: a failed Art-Net bind (async error or sync throw) is closed, nulled, surfaced and retryable', async () => {
	const { ArtnetReceiver } = require('../../src/artnet/artnet-receiver')
	const { ensureSocketListening } = require('../../src/artnet/artnet-udp')
	const r = new ArtnetReceiver(quiet)
	r._targetConfigured = true
	r._isMasterDmxEnabled = () => true
	const plan = ['error', 'throw', 'ok']
	const d = patchDgram((i) => fakeUdp(plan[i]))
	try {
		ensureSocketListening(r)
		assert.ok(r._socket, 'bound optimistically until the async error arrives')
		await tick()
		await tick()
		assert.equal(r._socket, null, 'dead socket released')
		assert.equal(d.made[0].closed, 1)
		assert.match(r._bindError, /EADDRINUSE/)

		ensureSocketListening(r) // retry hits the sync-throw path
		assert.equal(r._socket, null)
		assert.equal(d.made[1].closed, 1)
		assert.equal(r._bindError, 'bad port')

		ensureSocketListening(r) // third attempt succeeds
		await tick()
		assert.equal(d.made.length, 3)
		assert.equal(r._socket, d.made[2])
		assert.equal(r._bindError, null)
		d.made[2].close()
		await tick()
		assert.equal(r._socket, null)
	} finally {
		d.restore()
	}
})

// ---- 4. web client drops routeTargets[s-1] ------------------------------------------------------

test('WO-845b: removing a live-audio slot nulls routeTargets[s-1] and sends no pgm_channels for it', async () => {
	const posts = []
	const casparServer = {
		live_audio_input_count: 2,
		live_audio_input_1_device: 'alsa://hw:1,0',
		live_audio_input_2_device: 'alsa://hw:2,0',
		live_audio_input_1_pgm_channels: '1,2',
		live_audio_input_2_pgm_channels: '1',
		live_audio_pgm_layer: 2,
	}
	const json = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body })
	const realFetch = globalThis.fetch
	globalThis.fetch = async (url, init) => {
		if (init?.method === 'POST') {
			posts.push({ url: String(url), body: JSON.parse(init.body) })
			return json({ ok: true })
		}
		return json({ casparServer })
	}
	try {
		const { removeLiveAudioInputSlot } = await import(
			pathToFileURL(path.join(ROOT, 'client/lib/live-audio-remove-input.js')).href
		)
		const { settingsState } = await import(pathToFileURL(path.join(ROOT, 'client/lib/settings-state.js')).href)
		await settingsState.load()
		const r = await removeLiveAudioInputSlot(null, 2)
		assert.equal(r.ok, true)
		const post = posts.find((p) => p.url.endsWith('/api/audio/live-inputs/config'))
		assert.ok(post, 'config POST sent')
		assert.equal(post.body.live_audio_input_2_device, '')
		assert.equal(post.body.live_audio_input_count, 1)
		assert.equal('live_audio_input_2_pgm_channels' in post.body, false, 'removed slot sends no route selection')
		assert.equal(post.body.live_audio_input_1_pgm_channels, '1,2', 'other slots keep theirs')
	} finally {
		globalThis.fetch = realFetch
	}
})

// ---- 5. default-device: validation 400, real failure 500 ----------------------------------------

test('WO-845b: /api/audio/default-device answers 400 for a rejected card/device, 500 for a real write failure', async () => {
	const devices = require('../../src/audio/audio-devices')
	const { handlePost } = require('../../src/api/routes-audio')
	const real = devices.setDefaultAlsaDevice
	const ctx = { config: {}, log() {} }
	const call = (b) => handlePost('/api/audio/default-device', JSON.stringify(b), ctx)
	try {
		// real validation (nothing is written: rejected before any file access)
		for (const b of [
			{ card: 'abc', device: 0 },
			{ card: -1, device: 0 },
			{ card: 0, device: 'x' },
		]) {
			const r = await call(b)
			assert.equal(r.status, 400, JSON.stringify(b))
			assert.match(JSON.parse(r.body).error, /non-negative integers/)
		}
		assert.equal((await call({ card: 1 })).status, 400, 'missing device stays 400')
		// a genuine failure keeps 500
		devices.setDefaultAlsaDevice = () => ({ ok: false, error: 'EACCES: permission denied' })
		const r = await call({ card: 1, device: 0 })
		assert.equal(r.status, 500)
		assert.equal(JSON.parse(r.body).ok, false)
		// success path is untouched
		devices.setDefaultAlsaDevice = () => ({ ok: true, scope: 'user', path: '/x/.asoundrc' })
		assert.equal((await call({ card: 1, device: 0 })).status, 200)
	} finally {
		devices.setDefaultAlsaDevice = real
	}
})
