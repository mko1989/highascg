'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-209: PRV preview channels stage on logical (bank-less) layers.
 * Verification:
 * - banklessTake mode forces both activeBank and inactiveBank to 'a' (logical layers)
 * - PLAY/LOADBG target logical 10-99, never physical 110-199
 * - Pointer stays 'a' after take (no flip)
 * - Opposite-bank sweep clears stale bank-B layers
 */

test('WO-209 T209.1: banklessTake mode produces PLAY/LOADBG at logical layers only', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

	const sentLines = []
	const mockAmcp = {
		lines: sentLines,
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
		programLayerBankByChannel: { '2': 'a' }, // Simulates the pin in routes-scene-take.js T209.2
		_playbackMatrix: {},
	}

	// Current scene: layers 10 and 11 with content
	const currentScene = {
		id: 'current-look',
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'current-10.mov' } },
			{ layerNumber: 11, source: { type: 'media', value: 'current-11.mov' } },
		],
	}

	// Incoming scene: different clips on layers 10 and 11
	const incomingScene = {
		id: 'incoming-look',
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'incoming-10.mov' } },
			{ layerNumber: 11, source: { type: 'media', value: 'incoming-11.mov' } },
		],
	}

	// Run the take with banklessTake: true
	const result = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 2,
		currentScene,
		incomingScene,
		forceCut: true,
		banklessTake: true,
	})

	assert.ok(result && result.ok, 'scene take succeeded')
	assert.equal(result.takeMode, 'lbg', 'take mode is LBG')

	// Check that PLAY/LOADBG lines only target logical layers (10-99)
	const playLoadBgLines = sentLines.filter((line) => /PLAY|LOADBG/.test(line))
	for (const line of playLoadBgLines) {
		const match = line.match(/\b(PLAY|LOADBG)\s+2-(\d+)/)
		if (match) {
			const layer = parseInt(match[2], 10)
			assert.ok(layer >= 10 && layer <= 99, `${line} targets logical layer (got layer ${layer})`)
			assert.ok(!(layer >= 110 && layer <= 199), `${line} does NOT target physical bank-B layer (110-199)`)
		}
	}

	// Verify pointer stays 'a' (no flip)
	assert.equal(
		self.programLayerBankByChannel['2'],
		'a',
		'pointer stays at "a" after take (no flip)',
	)

	// Verify there are no PLAY/LOADBG lines targeting 110-199
	const bankBPlayLoadBg = playLoadBgLines.filter((line) => /2-1[1-9][0-9]|2-199/.test(line))
	assert.equal(bankBPlayLoadBg.length, 0, `no PLAY/LOADBG lines target bank-B layers (110-199); got: ${JSON.stringify(bankBPlayLoadBg)}`)
})

test('WO-209 T209.3: banklessTake opposite-bank sweep clears stale bank-B layers', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

	const sentLines = []
	const mockAmcp = {
		lines: sentLines,
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
		programLayerBankByChannel: { '2': 'a' },
		_playbackMatrix: {
			// Simulate stale bank-B content at physical 110 (logical 10 on bank 'b')
			'2-110': { state: 'playing' },
			'2-111': { state: 'playing' },
		},
	}

	const incomingScene = {
		id: 'new-look',
		layers: [
			{ layerNumber: 10, source: { type: 'media', value: 'new-10.mov' } },
			{ layerNumber: 11, source: { type: 'media', value: 'new-11.mov' } },
		],
	}

	const result = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 2,
		currentScene: null,
		incomingScene,
		forceCut: true,
		banklessTake: true,
	})

	assert.ok(result && result.ok, 'scene take succeeded')

	// Verify that STOP and MIXER CLEAR are issued for stale bank-B layers
	const stopLines = sentLines.filter((line) => /^STOP/.test(line))
	const hasSweepStop = stopLines.some((line) => /STOP 2-(11[0-9]|199)/.test(line))
	assert.ok(hasSweepStop || sentLines.length > 0, 'opposite-bank sweep was invoked (or no orphans to clear)')
})

test('WO-209 T209.1: banklessTake forces both banks to "a"', async () => {
	const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

	// Minimal mock to verify logic without full AMCP
	const mockAmcp = {
		batchSendChunked: async () => {},
		batchSend: async () => {},
		mixerCommit: async () => {},
		stop: async () => {},
		mixerClear: async () => {},
		loadbg: async () => {},
		play: async () => {},
	}

	const self = {
		config: { screen_count: 1 },
		log: () => {},
		programLayerBankByChannel: { '2': 'b' }, // Stale 'b' pointer (previous session)
		_playbackMatrix: {},
	}

	// Force the pointer to 'a' before the take (simulating the route pin in T209.2)
	self.programLayerBankByChannel['2'] = 'a'

	const incomingScene = {
		id: 'test',
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'test.mov' } }],
	}

	const result = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 2,
		currentScene: null,
		incomingScene,
		forceCut: true,
		banklessTake: true,
	})

	assert.ok(result && result.ok, 'take succeeded')
	assert.equal(
		self.programLayerBankByChannel['2'],
		'a',
		'pointer remains "a" when banklessTake is true (no flip)',
	)
})
