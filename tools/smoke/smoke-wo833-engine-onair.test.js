'use strict'

/**
 * WO-833 (3e, 3f) — on-air take engine.
 *  3e: the +Animate exit fade targeted the LOGICAL layer; on bank B the removed layer popped instead of fading.
 *  3f: a failed Phase B PLAY batch was only logged — the take flipped the bank, tore down the outgoing look and
 *      returned ok, so scene.live named a look while PGM was black.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildMergeOutgoingOpacityDeferLines } = require('../../src/engine/scene-take-lbg-merge')
const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')
const { physicalProgramLayer } = require('../../src/engine/scene-transition')

test('3e: +Animate exit fade of a removed layer targets phys(ln, activeBank) — bank B -> 1xx', () => {
	const exitMedia = [{ layerNumber: 12, source: { type: 'media', value: 'gone.mp4' } }]
	const args = (bank) => ({
		channel: 1,
		exitMedia,
		takeJobs: [],
		fadeDur: 25,
		fadeTw: 'linear',
		currentSceneLayers: exitMedia,
		fadeWatcher: null,
		activeBank: bank,
		phys: physicalProgramLayer,
	})
	assert.deepEqual(buildMergeOutgoingOpacityDeferLines(args('a')), ['MIXER 1-12 OPACITY 0 25 linear DEFER'])
	assert.deepEqual(buildMergeOutgoingOpacityDeferLines(args('b')), ['MIXER 1-112 OPACITY 0 25 linear DEFER'])
})

function makeAmcp(sent, { failPlay }) {
	const reject = (ls) => {
		sent.push(...ls)
		if (failPlay && ls.some((l) => /^PLAY /.test(l))) throw new Error('amcp down')
	}
	return {
		_context: { config: {}, log() {} },
		batchSendChunked: async (ls) => reject(ls),
		batchSend: async (ls) => void sent.push(...ls),
		mixerCommit: async () => {},
		mixerClear: async () => {},
		stop: async (ch, l) => void sent.push(`STOP ${ch}-${l}`),
		loadbg: async (ch, l, clip) => void sent.push(`LOADBG ${ch}-${l} ${clip}`),
		_send: async (l) => void sent.push(l),
	}
}

function takeOpts(self, hooks) {
	return {
		self,
		channel: 1,
		forceCut: false,
		pgmOnly: true,
		currentScene: { id: 'old', layers: [{ layerNumber: 10, source: { type: 'media', value: 'OLD/clip.mp4' } }] },
		incomingScene: {
			id: 'new',
			defaultTransition: { type: 'MIX', duration: 5, tween: 'linear' },
			layers: [{ layerNumber: 10, source: { type: 'media', value: 'NEW/clip.mp4' } }],
		},
		onProgramPlayCommitted: hooks.onCommitted,
	}
}

test('3f: a failed Phase B PLAY batch rejects the take, keeps the outgoing look and does not flip the bank', async () => {
	const sent = []
	const logs = []
	const self = {
		config: { screen_count: 1 },
		log: (lvl, m) => logs.push(`${lvl} ${m}`),
		programLayerBankByChannel: { 1: 'a' },
		_playbackMatrix: {},
	}
	let hook = 0
	await assert.rejects(
		() => runSceneTakeLbg(makeAmcp(sent, { failPlay: true }), takeOpts(self, { onCommitted: () => void hook++ })),
		/Take failed: PLAY batch was not delivered/,
	)
	assert.equal(self.programLayerBankByChannel[1], 'a', 'bank pointer NOT flipped')
	assert.equal(hook, 0, 'PGM->PRV exchange hook must not run for a take that never played')
	assert.ok(!sent.includes('STOP 1-10'), 'outgoing look (bank A layer 10) must stay on air: ' + sent.join(' | '))
	assert.ok(!sent.some((l) => /^(CLEAR|MIXER 1-10 CLEAR)/.test(l)), 'no clear of the outgoing layer')
	assert.ok(sent.includes('STOP 1-110'), 'half-applied incoming bank is stopped (best effort): ' + sent.join(' | '))
	assert.ok(logs.some((l) => /Phase B \(PLAY\/crossfade\/COMMIT\) failed on ch1/.test(l)), 'failure still logged')
})

test('3f control: a healthy take still resolves ok and flips the bank', async () => {
	const sent = []
	const self = {
		config: { screen_count: 1 },
		log() {},
		programLayerBankByChannel: { 1: 'a' },
		_playbackMatrix: {},
	}
	let hook = 0
	const r = await runSceneTakeLbg(makeAmcp(sent, { failPlay: false }), takeOpts(self, { onCommitted: () => void hook++ }))
	assert.equal(r.ok, true)
	assert.equal(self.programLayerBankByChannel[1], 'b')
	assert.equal(hook, 1)
})
