'use strict'

/** WO-976 — a Caspar channel (screen destination PGM/PRV) as the audio-reactive FFT source. */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const M = require('../../src/audio/fft-channel-source')
const { createAudioCaptureLifecycle } = require('../../src/bootstrap/audio-capture-lifecycle')
const { getChannelMap } = require('../../src/config/routing-map')

const cfgOf = (cs, extra = {}) => ({ casparServer: { ...cs }, ...extra })

test('legacy audio_fft_source_slot still reads as a slot source; kind channel wins; kind none clears', () => {
	assert.deepEqual(M.resolveAudioFftSource(cfgOf({})), { kind: 'none' })
	assert.deepEqual(M.resolveAudioFftSource(cfgOf({ audio_fft_source_slot: 2 })), { kind: 'slot', slot: 2 })
	assert.deepEqual(
		M.resolveAudioFftSource(cfgOf({ audio_fft_source_slot: 2, audio_fft_source_kind: 'channel', audio_fft_source_dest: 1, audio_fft_source_bus: 'prv' })),
		{ kind: 'channel', destination: 1, bus: 'prv' }
	)
	assert.deepEqual(M.resolveAudioFftSource(cfgOf({ audio_fft_source_slot: 2, audio_fft_source_kind: 'none' })), { kind: 'none' })
})

test('destination resolves to the Caspar channel through the channel map (renumbered by an operator GUI channel)', () => {
	const pick = { audio_fft_source_kind: 'channel', audio_fft_source_dest: 1, audio_fft_source_bus: 'pgm' }
	const plain = cfgOf({ screen_count: 1, ...pick })
	const plainMap = getChannelMap(plain)
	assert.equal(M.resolveFftSourceChannel(plain), plainMap.programCh(1))
	const prv = cfgOf({ screen_count: 1, ...pick, audio_fft_source_bus: 'prv' })
	assert.equal(M.resolveFftSourceChannel(prv), getChannelMap(prv).previewCh(1))
	assert.equal(M.resolveFftSourceChannel(cfgOf({ screen_count: 1, ...pick, audio_fft_source_dest: 5 })), null, 'screen beyond the map')
	assert.equal(M.resolveFftSourceChannel(cfgOf({ audio_fft_source_slot: 1 })), null, 'slot source has no channel')
})

test('ADD / REMOVE AMCP strings', () => {
	assert.equal(
		M.fftChannelAddCommand(2),
		'ADD 2-9276 STREAM udp://127.0.0.1:52230?pkt_size=1316 -vn -codec:a pcm_s16le -ar 48000 -filter:a pan=stereo|c0=c0|c1=c1 -format s16le'
	)
	assert.equal(M.fftChannelRemoveCommand(2), 'REMOVE 2-9276')
})

test('body → keys: picker ids, slot tick wins over a channel pick, untick keeps it', () => {
	assert.deepEqual(M.applyFftSourceBody({}, { audio_fft_source: 'channel:2:pgm' }), {
		audio_fft_source_kind: 'channel', audio_fft_source_dest: 2, audio_fft_source_bus: 'pgm',
	})
	assert.deepEqual(M.applyFftSourceBody({}, { audio_fft_source: 'bogus' }), { audio_fft_source_kind: 'none', audio_fft_source_slot: 0 })
	const ch = { audio_fft_source_kind: 'channel', audio_fft_source_dest: 1, audio_fft_source_bus: 'pgm' }
	assert.equal(M.applyFftSourceBody({ ...ch }, { audio_fft_source_slot: 3 }).audio_fft_source_kind, 'slot')
	assert.equal(M.applyFftSourceBody({ ...ch }, { audio_fft_source_slot: 0 }).audio_fft_source_kind, 'channel')
})

function fakeAmcp(initial = {}) {
	const consumers = { ...initial } // channel → bool
	const log = []
	return {
		log,
		isConnected: true,
		info: async (ch) => ({ data: consumers[ch] ? `<port_9276>x</port_9276>` : '<port_600>x</port_600>' }),
		raw: async (cmd) => {
			log.push(cmd)
			const m = /^(ADD|REMOVE) (\d+)-9276/.exec(cmd)
			consumers[m[2]] = m[1] === 'ADD'
		},
	}
}

test('sync: ADD on the resolved channel (idempotent), REMOVE when the source moves back to a slot', async () => {
	const cs = { screen_count: 1, audio_fft_source_kind: 'channel', audio_fft_source_dest: 1, audio_fft_source_bus: 'pgm' }
	const ctx = { config: cfgOf(cs), amcp: fakeAmcp() }
	const pgm = getChannelMap(ctx.config).programCh(1)
	let r = await M.syncFftChannelConsumer(ctx)
	assert.equal(r.channel, pgm)
	assert.deepEqual(ctx.amcp.log, [M.fftChannelAddCommand(pgm)])
	await M.syncFftChannelConsumer(ctx)
	assert.equal(ctx.amcp.log.length, 1, 'already present → no second ADD')
	ctx.config = cfgOf({ screen_count: 1, audio_fft_source_slot: 1 })
	r = await M.syncFftChannelConsumer(ctx)
	assert.deepEqual(r.removed, [pgm])
	assert.equal(ctx.amcp.log[1], M.fftChannelRemoveCommand(pgm))
})

test('sync after a Caspar restart (consumer gone) re-ADDs; first sync sweeps a leftover consumer of an earlier process', async () => {
	const cs = { screen_count: 1, audio_fft_source_kind: 'channel', audio_fft_source_dest: 1, audio_fft_source_bus: 'pgm' }
	const ctx = { config: cfgOf(cs), amcp: fakeAmcp() }
	const pgm = getChannelMap(ctx.config).programCh(1)
	await M.syncFftChannelConsumer(ctx)
	ctx.amcp.log.length = 0
	ctx.amcp.raw = async (c) => ctx.amcp.log.push(c)
	ctx.amcp.info = async () => ({ data: '<port_600/>' }) // restarted Caspar
	await M.syncFftChannelConsumer(ctx)
	assert.deepEqual(ctx.amcp.log, [M.fftChannelAddCommand(pgm)])
	const prv = getChannelMap(ctx.config).previewCh(1)
	const fresh = { config: cfgOf({ screen_count: 1, audio_fft_source_slot: 1 }), amcp: fakeAmcp({ [prv]: true }) }
	await M.syncFftChannelConsumer(fresh)
	assert.deepEqual(fresh.amcp.log, [M.fftChannelRemoveCommand(prv)])
})

test('engine follows a channel source on the fixed port; wiring is in place', () => {
	const lines = []
	const config = { casparServer: { screen_count: 1, audio_fft_source_kind: 'channel', audio_fft_source_dest: 1 } }
	const lc = createAudioCaptureLifecycle({ appCtx: {}, config, logger: { info: (m) => lines.push(m), warn: (m) => lines.push(m) } })
	try {
		lc.startAudioCapture()
		assert.ok(lines.some((l) => l.includes('source: Caspar channel') && l.includes('STREAM consumer tee')))
	} finally {
		lc.stopAudioCapture()
	}
	const rd = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	assert.ok(rd('src/config/routing-setup-live-inputs.js').includes('syncFftChannelConsumer'), 'live-audio setup re-adds the consumer')
	assert.ok(rd('src/api/routes-audio.js').includes('applyFftSourceBody'))
	assert.ok(rd('src/api/router.js').includes("'/api/audio/fft-source'"))
})
