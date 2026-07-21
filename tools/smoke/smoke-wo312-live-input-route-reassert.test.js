'use strict'

/**
 * WO-312 — live-input audio-only routes must survive a Caspar restart.
 *
 * The route matrix is config (`<kind>_input_<slot>_audio_targets`), but the route LAYERS that
 * actually carry the audio are AMCP state on the program channels and die with Caspar. Only the
 * client recreated them, so after a crash or apply-restart the matrix said "routed to Ch3" while
 * nothing played there — and with the kiosk closed, nothing ever fixed it.
 *
 * These tests cover the pure plan builder (targets x policy matrix) and the idempotency
 * primitives. The plan is what decides whether a bus gets a signal, so it is worth pinning hard.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const {
	INPUT_PGM_AUDIO_LAYER_BASE,
	buildLiveInputRouteReassertPlan,
	amcpForPlannedRoute,
	pgmDestLayerForInput,
	isPgmAudioOnly,
} = require('../../src/engine/live-input-route-reassert')
const { foregroundProducerOnLayer, isRouteProducerFrom } = require('../../src/caspar/channel-info-xml')

/**
 * Minimal config the channel map accepts: 2 screens (program channels 1 and 3 in this repo's
 * default map) plus one DeckLink input on its dedicated channel.
 */
function configWith(overrides = {}) {
	return {
		casparServer: {
			screen_count: 2,
			decklink_input_count: 1,
			decklink_input_1_device: 4,
			...overrides,
		},
	}
}

test('an input with no routed targets plans nothing (an unlit matrix must stay silent)', () => {
	const plan = buildLiveInputRouteReassertPlan(configWith())
	assert.deepEqual(plan, [], 'no targets => no routes')
})

test('policy "never" is honoured even when targets are set — replaying would be the doubling the policy prevents', () => {
	const plan = buildLiveInputRouteReassertPlan(
		configWith({ decklink_input_1_audio_targets: [1, 3], decklink_input_1_audio_send: 'never' }),
	)
	assert.deepEqual(plan, [])
})

test('policies "always" and "afv" both replay to every routed target', () => {
	for (const policy of ['always', 'afv']) {
		const plan = buildLiveInputRouteReassertPlan(
			configWith({ decklink_input_1_audio_targets: [1, 3], decklink_input_1_audio_send: policy }),
		)
		assert.equal(plan.length, 2, `policy ${policy} should plan both targets`)
		assert.deepEqual(
			plan.map((p) => p.channel).sort((a, b) => a - b),
			[1, 3],
		)
		for (const p of plan) {
			assert.equal(p.layer, INPUT_PGM_AUDIO_LAYER_BASE + 1, 'slot 1 lands on the 320+slot band')
			assert.match(p.route, /^route:\/\/\d+(-\d+)?$/, 'route comes from the channel map, not hardcoded')
			assert.equal(p.audioOnly, true, 'audio-only by default')
		}
	}
})

test('a target equal to the input source channel is dropped (never route a channel into itself)', () => {
	const base = buildLiveInputRouteReassertPlan(
		configWith({ decklink_input_1_audio_targets: [1, 3], decklink_input_1_audio_send: 'always' }),
	)
	const srcChannel = base[0].srcChannel
	const plan = buildLiveInputRouteReassertPlan(
		configWith({
			decklink_input_1_audio_targets: [srcChannel, 1, 3],
			decklink_input_1_audio_send: 'always',
		}),
	)
	assert.ok(
		!plan.some((p) => p.channel === srcChannel),
		`self-route to ch ${srcChannel} must be dropped`,
	)
	assert.equal(plan.length, 2)
})

test('garbage targets are discarded rather than producing malformed AMCP', () => {
	const plan = buildLiveInputRouteReassertPlan(
		configWith({
			decklink_input_1_audio_targets: [0, -3, 'x', null, undefined, 3],
			decklink_input_1_audio_send: 'always',
		}),
	)
	assert.equal(plan.length, 1)
	assert.equal(plan[0].channel, 3)
})

test('ALSA live_audio slots are NOT replayed (their targets live in localStorage, not config)', () => {
	const plan = buildLiveInputRouteReassertPlan(
		configWith({
			live_audio_input_count: 1,
			live_audio_input_1_audio_targets: [1, 3],
			live_audio_input_1_audio_send: 'always',
		}),
	)
	assert.ok(
		!plan.some((p) => p.kind === 'live_audio'),
		'the server cannot honestly rebuild ALSA targets — WO-312 scopes them out',
	)
})

test('audio-only can be turned off, and then no OPACITY 0 is emitted', () => {
	assert.equal(isPgmAudioOnly({ casparServer: {} }), true, 'default is audio-only')
	assert.equal(isPgmAudioOnly({ casparServer: { live_audio_pgm_audio_only: false } }), false)

	const withPicture = amcpForPlannedRoute({ channel: 3, layer: 321, route: 'route://5-4', audioOnly: false })
	assert.ok(!withPicture.some((c) => /OPACITY/.test(c)))

	const audioOnly = amcpForPlannedRoute({ channel: 3, layer: 321, route: 'route://5-4', audioOnly: true })
	assert.deepEqual(audioOnly, [
		'STOP 3-321',
		'MIXER 3-321 CLEAR',
		'PLAY 3-321 route://5-4',
		'MIXER 3-321 OPACITY 0',
	])
})

test('the AMCP sequence STOPs and CLEARs before PLAY, so a stale producer releases first', () => {
	const cmds = amcpForPlannedRoute({ channel: 3, layer: 321, route: 'route://5-4', audioOnly: true })
	assert.ok(cmds.indexOf('STOP 3-321') < cmds.indexOf('PLAY 3-321 route://5-4'), 'STOP precedes PLAY')
	assert.ok(cmds.indexOf('MIXER 3-321 CLEAR') < cmds.indexOf('PLAY 3-321 route://5-4'), 'CLEAR precedes PLAY')
})

test('idempotency: a layer already routed from the same source is recognised and left alone', async () => {
	const xml = `<channel><stage><layer><layer_321><foreground>
		<producer>route</producer><route><channel>5</channel><layer>4</layer></route>
		</foreground></layer_321></layer></stage></channel>`
	const fg = await foregroundProducerOnLayer(xml, 321)
	assert.equal(isRouteProducerFrom(fg, 5, 4), true, 'same source => skip the replay')
	assert.equal(isRouteProducerFrom(fg, 5, 9), false, 'different source layer => must replay')
	assert.equal(isRouteProducerFrom(fg, 2, 4), false, 'different source channel => must replay')
})

test('idempotency: a bare route://5 matches only a null source layer, not any layer', async () => {
	const xml = `<channel><stage><layer><layer_321><foreground>
		<producer>route</producer><route><channel>5</channel></route>
		</foreground></layer_321></layer></stage></channel>`
	const fg = await foregroundProducerOnLayer(xml, 321)
	assert.equal(isRouteProducerFrom(fg, 5, null), true)
	assert.equal(isRouteProducerFrom(fg, 5, 4), false, 'route://5 is not route://5-4')
})

test('idempotency: unknown/empty INFO must NOT be read as "already routed"', async () => {
	assert.equal(isRouteProducerFrom(null, 5, 4), false, 'null is UNKNOWN — replay, do not skip')
	const empty = await foregroundProducerOnLayer('', 321)
	assert.equal(isRouteProducerFrom(empty, 5, 4), false)
	// A non-route producer sitting on the band must also not count as satisfied.
	const other = await foregroundProducerOnLayer(
		`<channel><stage><layer><layer_321><foreground><producer>ffmpeg</producer>
		 <file><path>x.mp4</path></file></foreground></layer_321></layer></stage></channel>`,
		321,
	)
	assert.equal(isRouteProducerFrom(other, 5, 4), false)
})

test('the server layer band matches the client constant exactly (drift = an unstoppable duplicate)', () => {
	const clientSrc = fs.readFileSync(
		path.join(__dirname, '../../client/lib/live-audio-routing.js'),
		'utf8',
	)
	const m = /INPUT_PGM_AUDIO_LAYER_BASE\s*=\s*(\d+)/.exec(clientSrc)
	assert.ok(m, 'client must still declare INPUT_PGM_AUDIO_LAYER_BASE')
	assert.equal(
		parseInt(m[1], 10),
		INPUT_PGM_AUDIO_LAYER_BASE,
		'server and client audio-route layer bands have drifted',
	)
	assert.equal(pgmDestLayerForInput('decklink', 2), INPUT_PGM_AUDIO_LAYER_BASE + 2)
})

test('wiring: the reassert runs from setupAllRouting (boot AND every reconnect)', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/config/routing-setup.js'), 'utf8')
	assert.match(src, /reassertLiveInputAudioRoutes\(self\)/, 'must actually be called')
	assert.match(src, /live-input-route-reassert/, 'must require the module')
})
