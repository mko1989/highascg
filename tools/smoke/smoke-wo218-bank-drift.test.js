'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-218: Bank drift — visually-equal layers skip re-staging but bank flips.
 * When a take flips the bank (because other layers have jobs),
 * visually-equal layers must either:
 *   (a) be re-staged on the target bank (PLAY/LOADBG at target), or
 *   (b) be SWAP'd to the target bank with their mixer state moved.
 *
 * Without this fix, the skipped layer's producer stays on the old bank
 * while programLayerBankByChannel points to the new bank → split-brain.
 */

test('WO-218 T218.1: visually-equal layer with bank flip must move producer and mixer to target bank', async () => {
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
		swap: async (ch1, l1, ch2, l2, transforms) => {
			const cmd = `SWAP ${ch1}-${l1} ${ch2}-${l2}${transforms ? ' TRANSFORMS' : ''}`
			sentLines.push(cmd)
		},
	}

	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
		programLayerBankByChannel: { '1': 'a' },
		_playbackMatrix: {},
	}

	// Take 1: from null (empty) to incomingScene1 → plays on bank B (physical 110-111)
	const incomingScene1 = {
		id: 'look-1',
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: 'clip-a.mov' },
				effects: [
					{ type: 'crop', params: { left: 0.278, top: 0.074, right: 0.761, bottom: 1.0 } },
				],
			},
			{ layerNumber: 11, source: { type: 'media', value: 'clip-b.mov' } },
		],
	}

	const result1 = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 1,
		currentScene: null,
		incomingScene: incomingScene1,
		forceCut: true,
	})

	assert.ok(result1 && result1.ok, 'take 1 succeeded')

	// Take 1 should play on bank A (because pointer starts at 'a' in a merge transition from null)
	// Then after take 1 completes, if there's a bank flip, pointer becomes 'b'
	sentLines.length = 0 // clear for next take

	// Take 2: layer 10 is visually identical (clip-a.mov, with new crop effect), layer 11 changes (clip-c.mov)
	// This should:
	// - Flip the bank from 'a' to 'b'
	// - Layer 10 is visually equal but will be skipped in the current buggy version
	// - Layer 11 will get a job (plays on bank B, physical 111)
	// - CRITICAL BUG: layer 10's producer stays at physical 10 (bank A) while pointer says 'b'
	// - CROP effect is applied at physical 10 (or 110 depending on where the producer ended up)
	const incomingScene2 = {
		id: 'look-2',
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: 'clip-a.mov' },
				effects: [
					{ type: 'crop', params: { left: 0.278, top: 0.074, right: 0.761, bottom: 1.0 } },
				],
			},
			{ layerNumber: 11, source: { type: 'media', value: 'clip-c.mov' } }, // different clip
		],
	}

	const result2 = await runSceneTakeLbg(mockAmcp, {
		self,
		channel: 1,
		currentScene: incomingScene1,
		incomingScene: incomingScene2,
		forceCut: false,
	})

	assert.ok(result2 && result2.ok, 'take 2 succeeded')

	// After take 2, pointer should have flipped back
	const pointerAfterTake2 = self.programLayerBankByChannel['1']

	// We started at 'a', went to 'b' after take 1, should be back at 'a' after take 2
	// (because take 2 has jobs that require a flip)
	assert.equal(pointerAfterTake2, 'a', 'pointer flipped back to "a" after take 2 (bank crossfade)')

	// After take 2, the active bank is 'a', so:
	// Layer 10 should be on physical 10 (bank A)
	// Layer 11 should be on physical 11 (bank A)
	const activeBank2 = 'a'
	const inactiveBank2 = 'b'
	const physLayer10Active = 10 // bank a
	const physLayer10Inactive = 110 // bank b (where it was left in take 1)
	const physLayer11Active = 11 // bank a
	const physLayer11Inactive = 111 // bank b

	const swapLines = sentLines.filter((line) => /^SWAP/.test(line))
	const cropLines = sentLines.filter((line) => /MIXER.*CROP/.test(line))
	const loadLines = sentLines.filter((line) => /^LOADBG 1-/.test(line))
	const playLines = sentLines.filter((line) => /^PLAY 1-/.test(line))

	// Layer 11 definitely got re-staged (it changed clip)
	const loadLayer11 = loadLines.some((line) => /LOADBG 1-11/.test(line))
	assert.ok(loadLayer11, 'layer 11 should be LOADBGd at active bank (physical 11)')

	// CRITICAL: Layer 10 was visually equal, so it was skipped in buildTakeJobs
	// But since layer 11 has a job and the take didn't merge, the bank flips
	// After the fix, layer 10 must be either:
	//   (a) SWAP'd from physical 110 to physical 10 (with TRANSFORMS to preserve CROP), OR
	//   (b) Re-staged with LOADBG/PLAY at physical 10 + full mixer state

	const hasSwapLayer10 = swapLines.some((line) => /SWAP 1-110 1-10|SWAP 1-10 1-110/.test(line))
	const hasLoadLayer10 = loadLines.some((line) => /LOADBG 1-10/.test(line))

	assert.ok(
		hasSwapLayer10 || hasLoadLayer10,
		`layer 10 must be SWAP'd or re-staged (LOADBG); ` +
			`swaps: ${JSON.stringify(swapLines)}, loadbg: ${JSON.stringify(loadLines)}`
	)

	// If SWAP was used, verify it includes TRANSFORMS to move the crop
	if (hasSwapLayer10) {
		const swapWithTransforms = swapLines.find((line) => /SWAP 1-110 1-10.*TRANSFORMS|SWAP 1-10 1-110.*TRANSFORMS/.test(line))
		assert.ok(
			swapWithTransforms,
			`SWAP must include TRANSFORMS to preserve mixer state (CROP); got: ${JSON.stringify(swapLines.filter(l => /1-10|1-110/.test(l)))}`
		)
	}

	// If re-staged (LOADBG), verify mixer state is also applied
	if (hasLoadLayer10 && !hasSwapLayer10) {
		const cropAt10 = cropLines.some((line) => /MIXER 1-10.*CROP/.test(line))
		assert.ok(cropAt10, `if layer 10 is re-staged, mixer CROP must be applied at physical 10`)
	}

	// MOST CRITICAL: Ensure no mixer state is stranded on the old bank
	// If we skipped layer 10 and didn't SWAP it, and we applied a CROP, that's the bug
	if (!hasSwapLayer10 && !hasLoadLayer10) {
		const cropAt110 = cropLines.some((line) => /MIXER 1-110.*CROP/.test(line))
		assert.equal(
			cropAt110,
			false,
			`layer 10 was skipped and not moved (no SWAP, no re-stage) — it should NOT have MIXER CROP applied ` +
				`(it would be a split-brain: producer at 110, mixer at 110, but pointer says 'a')`
		)
	}
})
