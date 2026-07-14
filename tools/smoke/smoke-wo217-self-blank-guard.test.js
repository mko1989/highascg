'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-217: PGM-only merge take fades out the layer it just played into (screen blanks, sticky opacity 0).
 * Root cause: when currentMap is EMPTY (post-Caspar-restart), exit/orphan-fade logic cannot see that
 * physical layer 10 belongs to the incoming look — it fades out the same layer the PLAY just targeted.
 *
 * Verification:
 * - T217.1: merge take on PGM-only channel with empty currentScene → captured lines contain PLAY at layer L
 *   AND NO `OPACITY 0` targeting the same physical layer
 * - T217.2: layer genuinely exiting (in current, not in incoming) still emits its fade-out
 * - T217.3: incoming layers always get OPACITY reset line (unconditional, not only when != 1)
 */

test('WO-217 T217.1: merge take with empty currentScene does NOT fade the incoming layer', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

	const sentLines = []
	const mockAmcp = {
		lines: sentLines,
		_send: async (line) => {
			sentLines.push(line)
			return { status: 200, response: 'OK' }
		},
		batchSendChunked: async (ls) => {
			sentLines.push(...ls)
		},
		batchSend: async (ls) => {
			sentLines.push(...ls)
		},
		mixerCommit: async () => {
			sentLines.push('MIXER COMMIT')
		},
		stop: async (ch, layer) => {
			sentLines.push(`STOP ${ch}-${layer}`)
		},
		mixerClear: async (ch, layer) => {
			sentLines.push(`MIXER ${ch}-${layer} CLEAR`)
		},
		loadbg: async (ch, layer, clip, opts) => {
			sentLines.push(`LOADBG ${ch}-${layer} "${clip}"`)
		},
		play: async (ch, layer) => {
			sentLines.push(`PLAY ${ch}-${layer}`)
		},
	}

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
		programLayerBankByChannel: { '3': 'a' },
		_playbackMatrix: {},
	}

	// Current scene: EMPTY (post-Caspar-restart scenario)
	const currentScene = null

	// Incoming scene: layer 10 with a look
	const incomingScene = {
		id: 'incoming-look',
		defaultTransition: { type: 'MIX + ANIMATE', duration: 25, tween: 'linear' },
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'test-video.mov' } },
		],
	}

	// Run the take as a merge transition (MIX + ANIMATE)
	const result = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 3,
		currentScene,
		incomingScene,
		forceCut: false,
		pgmOnly: true,
	})

	assert.ok(result && result.ok, 'scene take succeeded')
	assert.equal(result.takeMode, 'lbg', 'take mode is LBG')

	// Verify PLAY line targets layer 10
	const playLines = sentLines.filter((line) => /^PLAY/.test(line))
	const playLayer10 = playLines.find((line) => /3-10\b/.test(line))
	assert.ok(playLayer10, `found PLAY line targeting 3-10; got: ${JSON.stringify(playLines)}`)

	// WO-217 T217.1: Verify NO `OPACITY 0` targeting the same physical layer after the PLAY
	// (i.e., the incoming layer 10 should not be faded out by the same take).
	const opacityZeroLines = sentLines.filter((line) => /MIXER\s+3-10\s+OPACITY\s+0\b/.test(line))
	assert.equal(
		opacityZeroLines.length,
		0,
		`NO OPACITY 0 should fade the incoming layer 3-10 (WO-217 T217.1 guard); got: ${JSON.stringify(opacityZeroLines)}`,
	)
})

test('WO-217 T217.2a: genuinely exiting layer still emits fade-out', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

	const sentLines = []
	const mockAmcp = {
		lines: sentLines,
		_send: async (line) => {
			sentLines.push(line)
			return { status: 200, response: 'OK' }
		},
		batchSendChunked: async (ls) => {
			sentLines.push(...ls)
		},
		batchSend: async (ls) => {
			sentLines.push(...ls)
		},
		mixerCommit: async () => {
			sentLines.push('MIXER COMMIT')
		},
		stop: async (ch, layer) => {
			sentLines.push(`STOP ${ch}-${layer}`)
		},
		mixerClear: async (ch, layer) => {
			sentLines.push(`MIXER ${ch}-${layer} CLEAR`)
		},
		loadbg: async (ch, layer, clip, opts) => {
			sentLines.push(`LOADBG ${ch}-${layer} "${clip}"`)
		},
		play: async (ch, layer) => {
			sentLines.push(`PLAY ${ch}-${layer}`)
		},
	}

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
		programLayerBankByChannel: { '3': 'a' },
		_playbackMatrix: {},
	}

	// Current scene: layer 11 (will be exiting)
	const currentScene = {
		id: 'current-look',
		layers: [
			{ layerNumber: 11, source: { type: 'media', value: 'old-video.mov' } },
		],
	}

	// Incoming scene: layer 10 only (layer 11 is exiting)
	const incomingScene = {
		id: 'incoming-look',
		defaultTransition: { type: 'MIX + ANIMATE', duration: 25, tween: 'linear' },
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'new-video.mov' } },
		],
	}

	// Run the merge take
	const result = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 3,
		currentScene,
		incomingScene,
		forceCut: false,
		pgmOnly: true,
	})

	assert.ok(result && result.ok, 'scene take succeeded')

	// Verify that layer 11 (genuinely exiting) still gets faded out
	const opacityLayer11 = sentLines.filter((line) => /MIXER\s+3-11\s+OPACITY\s+0\b/.test(line))
	assert.ok(
		opacityLayer11.length > 0,
		`Layer 11 (genuinely exiting) should still emit OPACITY 0 fade; got: ${JSON.stringify(opacityLayer11)}`,
	)
})

test('WO-217 T217.2b: incoming layers always get OPACITY reset line (unconditional)', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

	const sentLines = []
	const mockAmcp = {
		lines: sentLines,
		_send: async (line) => {
			sentLines.push(line)
			return { status: 200, response: 'OK' }
		},
		batchSendChunked: async (ls) => {
			sentLines.push(...ls)
		},
		batchSend: async (ls) => {
			sentLines.push(...ls)
		},
		mixerCommit: async () => {
			sentLines.push('MIXER COMMIT')
		},
		stop: async (ch, layer) => {
			sentLines.push(`STOP ${ch}-${layer}`)
		},
		mixerClear: async (ch, layer) => {
			sentLines.push(`MIXER ${ch}-${layer} CLEAR`)
		},
		loadbg: async (ch, layer, clip, opts) => {
			sentLines.push(`LOADBG ${ch}-${layer} "${clip}"`)
		},
		play: async (ch, layer) => {
			sentLines.push(`PLAY ${ch}-${layer}`)
		},
	}

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
		programLayerBankByChannel: { '3': 'a' },
		_playbackMatrix: {},
	}

	// Current scene: empty
	const currentScene = null

	// Incoming scene: layer 10 with explicit opacity=1 (should still emit OPACITY line for defensive reset)
	const incomingScene = {
		id: 'incoming-look',
		defaultTransition: { type: 'MIX + ANIMATE', duration: 25, tween: 'linear' },
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'test-video.mov' }, opacity: 1 },
		],
	}

	// Run merge take
	const result = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 3,
		currentScene,
		incomingScene,
		forceCut: false,
		pgmOnly: true,
	})

	assert.ok(result && result.ok, 'scene take succeeded')

	// WO-217 T217.2: Verify that layer 10 gets an OPACITY reset line (even though opacity=1 and was previously conditional).
	// The MIXER OPACITY should be present to reset any stale 0 from previous bugs.
	const opacityLinesForLayer10 = sentLines.filter((line) => /MIXER\s+3-10\s+OPACITY/.test(line))
	assert.ok(
		opacityLinesForLayer10.length > 0,
		`Layer 10 should always emit OPACITY reset (WO-217 T217.2 unconditional); got: ${JSON.stringify(opacityLinesForLayer10)}`,
	)
})
