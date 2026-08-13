'use strict'

/**
 * WO-500 — meter-null consumers must skip channels that already have a real consumer.
 *
 * `meter-null-consumer.js` exists so channels shipping `<consumers/>` still tick their compositor
 * and publish OSC audio meters (WO-53). It was attaching to EVERY channel on connect, including
 * ones that already carry a screen/decklink consumer, where it buys no OSC and costs a full frame
 * fetch per tick. On the 6144x1536 PGM/PRV pair that measured as a 9.4 Mpixel readback 50x/s,
 * twice — PGM1 playback ran at 72.8 % of realtime with all seven attached and 99.9 % without.
 *
 * The staleness-driven repair path must keep its override: dead OSC is proof a channel is not
 * ticking regardless of what its consumer list says.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** Strip comments so prose about the old behaviour can never satisfy an assertion. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const {
	channelHasNonMeterConsumer,
	ensureMeterNullConsumer,
	ensureMeterNullConsumersForChannels,
	METER_NULL_CONSUMER_INDEX,
	METER_NULL_FORMAT_ARGS,
} = require('../../src/audio/meter-null-consumer.js')

/** INFO XML shaped like the real `INFO <ch>` output ports block. */
function infoXml(ports) {
	const body = ports.map((p) => `<port_${p}><consumer>x</consumer></port_${p}>`).join('')
	return `<?xml version="1.0"?><channel><format>1080p5000</format><output><port>${body}</port></output></channel>`
}

function fakeAmcp(ports) {
	const sent = []
	return {
		sent,
		isConnected: true,
		info: async () => ({ data: infoXml(ports) }),
		raw: async (cmd) => {
			sent.push(cmd)
			return { ok: true }
		},
	}
}

test('WO-500: channelHasNonMeterConsumer sees real consumers, ignores our own index', () => {
	assert.equal(channelHasNonMeterConsumer(infoXml([600])), true, 'a screen consumer counts')
	assert.equal(channelHasNonMeterConsumer(infoXml([301, 601])), true, 'decklink + screen counts')
	assert.equal(
		channelHasNonMeterConsumer(infoXml([METER_NULL_CONSUMER_INDEX])),
		false,
		'our own meter-null consumer must not count as a real consumer',
	)
	assert.equal(channelHasNonMeterConsumer(infoXml([])), false, 'no ports = no consumers')
	assert.equal(channelHasNonMeterConsumer(''), false, 'empty INFO is not a consumer')
})

test('WO-500: a channel that already has a screen consumer gets no meter-null ADD', async () => {
	const amcp = fakeAmcp([600])
	const added = await ensureMeterNullConsumer(amcp, 1)
	assert.equal(added, false, 'must report "not attached"')
	assert.deepEqual(amcp.sent, [], 'no AMCP ADD may be issued for an already-consumed channel')
})

test('WO-500: a channel with no consumers still gets its meter-null ADD', async () => {
	const amcp = fakeAmcp([])
	const added = await ensureMeterNullConsumer(amcp, 6)
	assert.equal(added, true)
	assert.equal(amcp.sent.length, 1, 'exactly one ADD')
	assert.match(amcp.sent[0], /^ADD 6-720 STREAM udp:\/\/127\.0\.0\.1:52006\?localport=62006 -format s16le$/)
})

test('WO-500: the meter consumer uses a muxer that declares NO video codec', () => {
	// ffmpeg_consumer.cpp:543 builds a video stream whenever oformat->video_codec != AV_CODEC_ID_NONE.
	// FFmpeg's `null` muxer declares wrapped_avframe, so it DOES build one, and every frame then pays
	// make_av_video_frame's full-raster alloc + row memcpy (av_util.cpp:323) just to be discarded.
	assert.equal(METER_NULL_FORMAT_ARGS, '-format s16le', 'raw PCM: audio codec only, video codec NONE')
	assert.doesNotMatch(
		code(read('src/audio/meter-null-consumer.js')),
		/-format null/,
		'`-format null` is not videoless — it must not come back',
	)
})

test('WO-500: already-attached meter consumer is idempotent (no duplicate ADD)', async () => {
	const amcp = fakeAmcp([METER_NULL_CONSUMER_INDEX])
	assert.equal(await ensureMeterNullConsumer(amcp, 2), true)
	assert.deepEqual(amcp.sent, [], 'must not re-ADD what is already there')
})

test('WO-500: force overrides the skip (staleness repair path)', async () => {
	const amcp = fakeAmcp([600])
	const added = await ensureMeterNullConsumer(amcp, 1, { force: true })
	assert.equal(added, true, 'forced attach must go through')
	assert.equal(amcp.sent.length, 1, 'forced attach issues the ADD despite the screen consumer')
})

test('WO-500: an INFO failure fails open — meters win over performance', async () => {
	const sent = []
	const amcp = {
		isConnected: true,
		info: async () => {
			throw new Error('amcp timeout')
		},
		raw: async (cmd) => {
			sent.push(cmd)
			return { ok: true }
		},
	}
	assert.equal(await ensureMeterNullConsumer(amcp, 3), true)
	assert.equal(sent.length, 1, 'unknown consumer state must still attach')
})

test('WO-500: batch path attaches only the unconsumed channels and logs the skips', async () => {
	const sent = []
	const logs = []
	const consumers = { 1: [600], 2: [], 3: [301, 601], 6: [], 7: [] }
	const ctx = {
		log: (level, msg) => logs.push(msg),
		amcp: {
			isConnected: true,
			info: async (ch) => ({ data: infoXml(consumers[ch] || []) }),
			raw: async (cmd) => {
				sent.push(cmd)
				return { ok: true }
			},
		},
	}
	const ok = await ensureMeterNullConsumersForChannels(ctx, [1, 2, 3, 6, 7])
	assert.deepEqual(ok, [2, 6, 7], 'only channels without a consumer get one')
	assert.equal(sent.length, 3, 'three ADDs, not five')
	assert.ok(
		logs.some((m) => /skipped 1, 3/.test(m)),
		`skips must be logged, got: ${JSON.stringify(logs)}`,
	)
})

test('WO-500: the staleness repair path passes force through', () => {
	const src = code(read('src/audio/meter-health.js'))
	assert.match(
		src,
		/ensureMeterNullConsumer\(\s*ctx\.amcp\s*,\s*ch\s*,\s*\{\s*force:\s*true\s*\}\s*\)/,
		'repairLiveInputMetersIfStale must force past the WO-500 skip',
	)
})
