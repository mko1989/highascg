'use strict'

/**
 * WO-604 — audio mixer console state lives on the server (gains / mutes / solos), and mute is a
 * server action (`POST /api/audio/mute`), so the Godot console and any other client share it.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const persistence = require('../../src/utils/persistence')
const mixerState = require('../../src/audio/mixer-state')
const routesAudio = require('../../src/api/routes-audio')
const routesAudioMixer = require('../../src/api/routes-audio-mixer')

const ROOT = path.join(__dirname, '../..')

function fakeCtx(config = {}) {
	const sent = []
	const broadcasts = []
	return {
		sent,
		broadcasts,
		config,
		_wsBroadcast: (type, data) => broadcasts.push([type, data]),
		amcp: {
			mixer: {
				mixerVolume: async (ch, l, v) => (sent.push(`MIXER ${ch}-${l} VOLUME ${v}`), { ok: true }),
				mixerMastervolume: async (ch, v) => (sent.push(`MIXER ${ch} MASTERVOLUME ${v}`), { ok: true }),
			},
			play: async (ch, l, src) => (sent.push(`PLAY ${ch}-${l} ${src}`), { ok: true }),
			clear: async (ch, l) => (sent.push(`CLEAR ${ch}-${l}`), { ok: true }),
		},
	}
}

const body = (o) => JSON.stringify(o)

describe('WO-604 — server-side audio mixer state', () => {
	beforeEach(() => persistence.set(mixerState.STATE_KEY, null))

	it('only console strip keys are accepted', () => {
		for (const k of ['pgm:1', 'prv:2', 'input:5', 'pgm:1:layer:10']) assert.ok(mixerState.isMixerKey(k), k)
		for (const k of ['pgm', 'pgm:x', 'scene:1', 'pgm:1:layer', 'pgm:1:layer:10:x', 1, null]) assert.ok(!mixerState.isMixerKey(k), String(k))
	})

	it('a keyed volume write records the gain and broadcasts; an unkeyed one does not', async () => {
		const ctx = fakeCtx()
		let r = await routesAudio.handlePost('/api/audio/volume', body({ channel: 1, master: true, volume: 0.5, key: 'pgm:1' }), ctx)
		assert.equal(r.status, 200)
		assert.deepEqual(ctx.sent, ['MIXER 1 MASTERVOLUME 0.5'])
		assert.equal(mixerState.snapshot().gains['pgm:1'], 0.5)
		assert.deepEqual(ctx.broadcasts.at(-1), ['change', { path: 'audioMixer', value: mixerState.snapshot() }])
		r = await routesAudio.handlePost('/api/audio/volume', body({ channel: 1, layer: 10, volume: 0.25 }), ctx)
		assert.equal(r.status, 200)
		assert.deepEqual(Object.keys(mixerState.snapshot().gains), ['pgm:1'], 'a look layer (no key) is not stored')
		const g = JSON.parse(routesAudioMixer.handleGet().body)
		assert.deepEqual(g, { ok: true, gains: { 'pgm:1': 0.5 }, muted: {}, solos: [] })
	})

	it('mute sends 0 and records it; unmute restores the stored gain (or the given volume, or unity)', async () => {
		const ctx = fakeCtx()
		mixerState.setGain(ctx, 'input:5', 0.3)
		let r = await routesAudioMixer.handleMutePost(body({ channel: 5, layer: 1, muted: true, key: 'input:5' }), ctx)
		assert.equal(r.status, 200)
		assert.equal(mixerState.snapshot().muted['input:5'], true)
		r = await routesAudioMixer.handleMutePost(body({ channel: 5, layer: 1, muted: false, key: 'input:5' }), ctx)
		assert.equal(JSON.parse(r.body).volume, 0.3)
		assert.deepEqual(mixerState.snapshot().muted, {})
		await routesAudioMixer.handleMutePost(body({ channel: 1, layer: 10, muted: false, volume: 0.7 }), ctx)
		await routesAudioMixer.handleMutePost(body({ channel: 1, layer: 11, muted: false }), ctx)
		assert.deepEqual(ctx.sent, ['MIXER 5-1 VOLUME 0', 'MIXER 5-1 VOLUME 0.3', 'MIXER 1-10 VOLUME 0.7', 'MIXER 1-11 VOLUME 1'])
	})

	it('mute refuses bad input without touching Caspar', async () => {
		for (const b of [{ channel: 1, layer: 1 }, { channel: 0, layer: 1, muted: true }, { channel: 1, muted: true }]) {
			const ctx = fakeCtx()
			assert.equal((await routesAudioMixer.handleMutePost(body(b), ctx)).status, 400, JSON.stringify(b))
			assert.deepEqual(ctx.sent, [])
		}
		const master = fakeCtx()
		await routesAudioMixer.handleMutePost(body({ channel: 2, master: true, muted: true, key: 'prv:2' }), master)
		assert.deepEqual(master.sent, ['MIXER 2 MASTERVOLUME 0'])
	})

	it('solo by keys: the server derives the targets and keeps the set; an empty set clears it', async () => {
		const ctx = fakeCtx({ casparServer: { screen_count: 1, audio_preview_enabled: true } })
		const r = await routesAudio.handlePost('/api/audio/solo', body({ keys: ['pgm:1:layer:10', 'prv:2', 'junk'] }), ctx)
		assert.equal(r.status, 200, r.body)
		assert.deepEqual(mixerState.snapshot().solos, ['pgm:1:layer:10', 'prv:2'])
		const plays = ctx.sent.filter((c) => c.startsWith('PLAY'))
		assert.equal(plays.length, 2)
		assert.match(plays[0], / route:\/\/1-10$/)
		assert.match(plays[1], / route:\/\/2$/)
		await routesAudio.handlePost('/api/audio/solo', body({ keys: [] }), ctx)
		assert.deepEqual(mixerState.snapshot().solos, [])
	})

	it('is routed', () => {
		const router = fs.readFileSync(path.join(ROOT, 'src/api/router.js'), 'utf8')
		assert.ok(router.includes("routes.get('/api/audio/mixer', () => routesAudioMixer.handleGet(), { requireCaspar: false })"))
		assert.ok(router.includes("routes.post('/api/audio/mute', ({ body, ctx }) => routesAudioMixer.handleMutePost(body, ctx), { requireCaspar: false })"))
	})
})
