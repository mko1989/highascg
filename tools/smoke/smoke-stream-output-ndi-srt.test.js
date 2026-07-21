'use strict'

/**
 * Owner spec (todos21.07.26):
 *  - "ndi stream is a special case which should not have a start stream but be treated as an sdi
 *     out, it gets added as a screen consumer in the config and is on always without any settings
 *     other than changing the id/label of the stream."
 *  - "srt has its own options in casparcg and should be available as an option for users with
 *     options."
 *
 * SRT viability is a verified fact, not an assumption: the bundled bin/casparcg links
 * libsrt-gnutls.so.1.5 (ldd, 2026-07-21), so ADD … STREAM srt:// runs in Caspar's own ffmpeg.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const defaults = require('../../src/config/defaults')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const {
	buildSrtOutputUrl,
	buildStreamingSrtAddParams,
	buildStreamingRtmpAddParams,
} = require('../../src/streaming/streaming-channel-ffmpeg')

function clone(o) {
	return JSON.parse(JSON.stringify(o))
}

/** Mirror of the owner's live rig: pgm_prv@0, pgm_only@1, NDI output cabled from the pgm_only. */
function rig({ ndiEnabled = true, cabled = true, reversedEdge = false } = {}) {
	const app = clone(defaults)
	app.casparServer = { ...app.casparServer, screen_count: 2, multiview_enabled: false, decklink_input_count: 0 }
	app.streamingChannel = { ...app.streamingChannel, enabled: false }
	app.rtmp = { ...app.rtmp, enabled: false }
	app.screenDestinations = {
		version: 1,
		edidNotes: '',
		destinations: [
			{ id: 'main_a', label: 'PGM 1', mode: 'pgm_prv', mainScreenIndex: 0, videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			{ id: 'main_b', label: 'PGM 2', mode: 'pgm_only', mainScreenIndex: 1, videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
		],
	}
	app.streamOutputs = [
		{ id: 'str_1', label: 'Str1', enabled: true, type: 'rtmp', name: 'Str1' },
		{ id: 'str_2', label: 'NDI out', enabled: ndiEnabled, type: 'ndi', name: 'StudioFeed' },
	]
	const edge = reversedEdge
		? { sourceId: 'str_2', sinkId: 'dst_in_main_b' }
		: { sourceId: 'dst_in_main_b', sinkId: 'str_2' }
	app.deviceGraph = {
		version: 1,
		devices: [],
		connectors: [
			{ id: 'dst_in_main_a', kind: 'destination_in', externalRef: 'main_a' },
			{ id: 'dst_in_main_b', kind: 'destination_in', externalRef: 'main_b' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
			{ id: 'str_2', kind: 'stream_out', index: 1 },
		],
		edges: [{ sourceId: 'dst_in_main_a', sinkId: 'gpu_p0' }, ...(cabled ? [edge] : [])],
	}
	return app
}

function ndiBlocksByChannel(xml) {
	/** @type {Record<string, string[]>} */
	const out = {}
	const chunks = xml.split(/<!-- HighAsCG: Caspar channel /).slice(1)
	for (const chunk of chunks) {
		const label = chunk.slice(0, chunk.indexOf('-->')).trim()
		const names = [...chunk.matchAll(/<ndi>\s*<name>([^<]*)<\/name>/g)].map((m) => m[1])
		if (names.length) out[label] = names
	}
	return out
}

test('a cabled NDI stream output becomes an always-on <ndi> consumer on its screen channel', () => {
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(rig()))
	const byCh = ndiBlocksByChannel(xml)
	const entries = Object.entries(byCh)
	assert.equal(entries.length, 1, `NDI on exactly one channel, got: ${JSON.stringify(byCh)}`)
	const [label, names] = entries[0]
	assert.match(label, /Screen 2 program output \(PGM\)/, 'lands on the CABLED destination screen, not screen 1')
	assert.deepEqual(names, ['StudioFeed'], 'consumer carries the output NAME (the only setting NDI has)')
})

test('edge direction does not matter — operators grab either end first', () => {
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(rig({ reversedEdge: true })))
	assert.match(xml, /<ndi>\s*<name>StudioFeed<\/name>/, 'reversed edge still resolves')
})

test('disabled or uncabled NDI outputs emit nothing', () => {
	for (const opts of [{ ndiEnabled: false }, { cabled: false }]) {
		const xml = buildConfigXml(buildCasparGeneratorFlatConfig(rig(opts)))
		assert.ok(!/StudioFeed/.test(xml), `no consumer for ${JSON.stringify(opts)}`)
	}
})

test('SRT url gets its own options — with ffmpeg microsecond conversion', () => {
	assert.equal(
		buildSrtOutputUrl('srt://10.0.0.5:9000', { latencyMs: 120, streamId: 'pgm one', mode: 'caller' }),
		'srt://10.0.0.5:9000?latency=120000&streamid=pgm%20one&mode=caller',
		'latency is entered in ms but ffmpeg/libsrt wants MICROSECONDS — 120ms must become 120000',
	)
	assert.equal(buildSrtOutputUrl('srt://h:1?x=1', { latencyMs: 100 }), 'srt://h:1?x=1&latency=100000', 'existing query preserved')
	assert.equal(buildSrtOutputUrl('rtmp://nope', {}), null, 'non-srt urls are rejected')
})

// WO-307
test('SRT passphrase is added with pbkeylen, but only inside libsrt\'s valid 10-79 char range', () => {
	const withPass = buildSrtOutputUrl('srt://h:9000', { passphrase: 'a-real-passphrase-here' })
	assert.match(withPass, /passphrase=a-real-passphrase-here/)
	assert.match(withPass, /pbkeylen=16/, 'pbkeylen must accompany a passphrase')

	// Too short (libsrt hard-rejects <10 chars) — omitted rather than sent broken, so the
	// connection fails on an obviously-wrong length instead of a cryptic AMCP/libsrt error.
	const tooShort = buildSrtOutputUrl('srt://h:9000', { passphrase: 'short' })
	assert.ok(!/passphrase=/.test(tooShort), 'a too-short passphrase must not reach the URL at all')

	const tooLong = buildSrtOutputUrl('srt://h:9000', { passphrase: 'x'.repeat(80) })
	assert.ok(!/passphrase=/.test(tooLong), 'a too-long passphrase must not reach the URL at all')

	const empty = buildSrtOutputUrl('srt://h:9000', {})
	assert.equal(empty, 'srt://h:9000', 'no passphrase → no passphrase/pbkeylen params at all')
})

test('SRT streams MPEG-TS; RTMP stays byte-identical FLV', () => {
	const srt = buildStreamingSrtAddParams('srt://h:9000', 'medium', { latencyMs: 120 })
	assert.ok(srt.args.endsWith('-format mpegts'), 'SRT carries TS, not FLV')
	const rtmp = buildStreamingRtmpAddParams('rtmp://a/live', 'key', 'medium', {})
	assert.ok(rtmp.args.endsWith('-format flv'), 'the on-air RTMP path must be unchanged')
	assert.equal(
		srt.args.replace(/-format mpegts$/, ''),
		rtmp.args.replace(/-format flv$/, ''),
		'identical encoder pipeline — only the container differs',
	)
})
