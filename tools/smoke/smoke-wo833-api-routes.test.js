'use strict'

/**
 * WO-833 (3g, 3h, 3l, 3m) — API / config one-liners found by the 29.10 sweep.
 *  3g: shader-stack "clear" called ctx.amcp.send (does not exist) -> always 500, shader stayed on air.
 *  3h: POST /api/swap (+ WS swap) called amcp.swap (only basic.swap exists) -> TypeError. Same for /api/load.
 *  3l: the streaming route ignored channel_<N> and played route://1.
 *  3m: malformed JSON parsed to {} -> channel 1 -> POST /api/clear cleared PGM; GET /api/mixer/clear mutated.
 * The AMCP client here is the REAL AmcpClient with its transport stubbed, so a call to a method that does not exist
 * fails the test the same way it fails on the box.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { AmcpClient } = require('../../src/caspar/amcp-client')

function realClient(sent) {
	const c = new AmcpClient({ config: {}, log() {} })
	c._send = async (cmd) => {
		sent.push(cmd)
		return { ok: true }
	}
	c._invokeTyped = async (_m, _p, cmd) => {
		sent.push(cmd)
		return { ok: true }
	}
	c.batchSend = async (ls) => void sent.push(...ls)
	c.batchSendChunked = async (ls) => void sent.push(...ls)
	c.mixerCommit = async () => void sent.push('MIXER COMMIT')
	return c
}

test('3g: shader stack clear uses real AmcpClient methods (mixerOpacity + clear), not ctx.amcp.send', async () => {
	const { handlePost } = require('../../src/api/routes-shader-stack')
	const sent = []
	const ctx = {
		amcp: realClient(sent),
		config: { project: { fps: 50 }, screen_count: 1 },
		programLayerBankByChannel: { 1: 'b' },
		log() {},
	}
	const res = await handlePost(
		JSON.stringify({ mainIndex: 0, layerNumber: 12, clear: true, transition: { type: 'MIX', duration: 2 } }),
		ctx,
	)
	assert.equal(res.status, 200, res.body)
	assert.deepEqual(sent, ['MIXER 1-112 OPACITY 0 2', 'CLEAR 1-112'], 'fade then clear on the bank-B physical layer')
})

test('3h: POST /api/swap and /api/load reach basic.swap / basic.load; the WS swap path dispatches to the same handler', async () => {
	const { handlePost } = require('../../src/api/routes-amcp')
	const sent = []
	const ctx = { amcp: realClient(sent), config: {}, log() {} }
	const sw = await handlePost('/api/swap', JSON.stringify({ channel: 1, layer: 10, channel2: 1, layer2: 20, transforms: true }), ctx)
	assert.equal(sw.status, 200, sw.body)
	assert.deepEqual(sent, ['SWAP 1-10 1-20 TRANSFORMS'])

	const ld = await handlePost('/api/load', JSON.stringify({ channel: 1, layer: 10, clip: 'amb' }), ctx)
	assert.equal(ld.status, 200, ld.body)
	assert.ok(sent.some((l) => /^LOAD 1-10 /.test(l)), sent.join(' | '))

	const { dispatchStructuredAmcp } = require('../../src/server/ws-amcp-dispatch')
	sent.length = 0
	const ws = await dispatchStructuredAmcp(ctx, { type: 'swap', channel: 1, layer: 10, channel2: 1, layer2: 20 })
	assert.equal(ws.ok !== false, true, JSON.stringify(ws))
	assert.deepEqual(sent, ['SWAP 1-10 1-20'])
})

test('3m: malformed JSON is a 400 on every AMCP route and nothing is sent', async () => {
	const { handlePost } = require('../../src/api/routes-amcp')
	const sent = []
	const ctx = { amcp: realClient(sent), config: {}, log() {} }
	for (const p of ['/api/clear', '/api/stop', '/api/play', '/api/pause']) {
		for (const bad of ['{"channel":', 'not json', '[1,2]', 'null']) {
			const res = await handlePost(p, bad, ctx)
			assert.equal(res.status, 400, `${p} ${bad} -> ${res.status}`)
		}
	}
	assert.deepEqual(sent, [], 'no AMCP went out')
})

test('3m: clear / stop require an explicit channel (no default to channel 1)', async () => {
	const { handlePost } = require('../../src/api/routes-amcp')
	const sent = []
	const ctx = { amcp: realClient(sent), config: {}, log() {} }
	for (const p of ['/api/clear', '/api/stop']) {
		for (const body of ['', '{}', '{"layer":10}', '{"channel":null}', '{"channel":""}', '{"channel":0}', '{"channel":"x"}', '{"channel":true}']) {
			const res = await handlePost(p, body, ctx)
			assert.equal(res.status, 400, `${p} ${body} -> ${res.status}`)
		}
	}
	assert.deepEqual(sent, [], 'no AMCP went out')
	const ok = await handlePost('/api/stop', '{"channel":3,"layer":10}', ctx)
	assert.equal(ok.status, 200)
	assert.deepEqual(sent, ['STOP 3-10'])
	// A non-destructive route keeps its documented channel-1 default.
	sent.length = 0
	const pause = await handlePost('/api/pause', '{"layer":10}', ctx)
	assert.equal(pause.status, 200)
	assert.deepEqual(sent, ['PAUSE 1-10'])
})

test('3m: mixer — malformed JSON is 400, mixer clear needs a channel, GET never mutates', async () => {
	const mixer = require('../../src/api/routes-mixer')
	const sent = []
	const ctx = { amcp: realClient(sent), config: {}, log() {} }
	assert.equal((await mixer.handlePost('/api/mixer/opacity', '{"channel":', ctx)).status, 400)
	assert.equal((await mixer.handlePost('/api/mixer/clear', 'garbage', ctx)).status, 400)
	assert.equal((await mixer.handlePost('/api/mixer/clear', '{"layer":10}', ctx)).status, 400)
	for (const cmd of ['clear', 'commit', 'effect']) {
		const res = await mixer.handleGet(`/api/mixer/${cmd}`, { channel: '1' }, ctx)
		assert.equal(res.status, 405, `GET ${cmd}`)
	}
	assert.deepEqual(sent, [], 'nothing sent by any of the above')
	const ok = await mixer.handlePost('/api/mixer/clear', '{"channel":2,"layer":10}', ctx)
	assert.equal(ok.status, 200)
	assert.ok(sent.some((l) => /^MIXER 2-10 CLEAR/.test(l)), sent.join(' | '))
	// A GET query still works for read-only commands.
	sent.length = 0
	const q = await mixer.handleGet('/api/mixer/opacity', { channel: '1', layer: '10' }, ctx)
	assert.equal(q.status, 200)
	assert.ok(sent.some((l) => /^MIXER 1-10 OPACITY$/.test(l)), sent.join(' | '))
})

test('3l: streaming route resolves channel_<N> (and keeps program/preview/multiview + the program-1 fallback)', () => {
	const { resolveStreamingChannelRoute, resolveStreamingChannelRouteForRole } = require('../../src/config/routing-map')
	const cfg = (sc) => ({
		screen_count: 1,
		streamingChannel: { enabled: true, ...sc },
		casparServer: { streaming_enabled: true },
	})
	const base = resolveStreamingChannelRoute(cfg({ videoSource: 'program_1' }))
	assert.ok(base, 'minimal config enables the streaming route')
	assert.match(String(base), /^route:\/\/\d+$/)
	assert.equal(resolveStreamingChannelRoute(cfg({ videoSource: 'channel_7' })), 'route://7')
	assert.equal(resolveStreamingChannelRoute(cfg({ videoSource: 'Channel-7' })), 'route://7')
	assert.equal(resolveStreamingChannelRouteForRole(cfg({ videoSource: 'program_1', audioSource: 'channel_7' }), 'audio'), 'route://7')
	assert.equal(resolveStreamingChannelRouteForRole(cfg({ videoSource: 'channel_7', audioSource: 'follow_video' }), 'audio'), 'route://7')
	assert.equal(resolveStreamingChannelRoute(cfg({ videoSource: 'program_9' })), base, 'out-of-range screen falls back to program 1')
	assert.equal(resolveStreamingChannelRoute(cfg({ videoSource: 'nonsense' })), base, 'unknown name falls back to program 1')
})
