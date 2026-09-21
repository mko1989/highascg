/**
 * Post-teardown bookkeeping of a program LBG take: skipped-layer bank SWAP, bank pointer flip,
 * vacated-layer cleanup, opposite-bank orphan sweep, look timer visibility.
 * Split out of scene-take-lbg.js (500-line limit) — runs strictly AFTER the teardown wait.
 */

'use strict'

const { PGM_BANK_B_OFFSET, persistProgramLayerBanks } = require('./scene-transition')
const {
	collectOrphanLookPhysicalLayers,
	clearPhysicalLookLayers,
	clearStaleInactiveBankLookLayers,
} = require('./scene-exit-layers')

/**
 * @param {object} amcp
 * @param {{
 *   self: object, channel: number, chKey: string, incoming: object, incomingSceneOpt?: object,
 *   takeJobs: object[], mergeMixerExtras: object[], isMergeTransition: boolean, banklessTake: boolean,
 *   skippedVisuallyEqualLayers: object[], phys: (layer: number, bank: string) => number, inactiveBank: string
 * }} c
 */
async function finalizeTakeBankState(amcp, c) {
	const {
		self,
		channel,
		chKey,
		incoming,
		incomingSceneOpt,
		takeJobs,
		mergeMixerExtras,
		isMergeTransition,
		banklessTake,
		skippedVisuallyEqualLayers,
		phys,
		inactiveBank,
	} = c

	// WO-218 T218.2: When the bank flips, move visually-equal skipped layers to the target bank
	// to avoid split-brain (producer on old bank, mixer state on new bank).
	// This MUST run BEFORE the pointer flip and BEFORE clearStaleInactiveBankLookLayers.
	const shouldFlipBank = !isMergeTransition && (takeJobs.length > 0 || mergeMixerExtras.length > 0) && !banklessTake
	if (shouldFlipBank && skippedVisuallyEqualLayers.length > 0) {
		const swapLines = []
		for (const skipped of skippedVisuallyEqualLayers) {
			const fromPhys = skipped.physicalLayerNow // old bank, currently active
			const toPhys = phys(skipped.layerNumber, inactiveBank) // new bank (inactive), target
			if (fromPhys !== toPhys) {
				// SWAP <ch>-<from> <ch>-<to> TRANSFORMS (TRANSFORMS preserves mixer state across the swap)
				const swapCmd = `SWAP ${channel}-${fromPhys} ${channel}-${toPhys} TRANSFORMS`
				swapLines.push(swapCmd)
			}
		}
		if (swapLines.length > 0) {
			try {
				await amcp.batchSend(swapLines)
			} catch (e) {
				self.log?.('warn', `[scene-take-lbg] WO-218 SWAP for skipped layers failed: ${e?.message || e}`)
			}
		}
	}

	// WO-209 T209.1: skip pointer flip when banklessTake (pointer must stay 'a' for logical layers).
	if (shouldFlipBank) {
		self.programLayerBankByChannel[chKey] = inactiveBank
	}
	persistProgramLayerBanks(self)

	// WO-218 T218.3: Clean up mixer state on the bank layers we just swapped FROM,
	// so no stale CROP/FILL remains on the vacated layer for the next take.
	if (shouldFlipBank && skippedVisuallyEqualLayers.length > 0) {
		const clearLines = []
		for (const skipped of skippedVisuallyEqualLayers) {
			const fromPhys = skipped.physicalLayerNow // old bank (now inactive after flip)
			const toPhys = phys(skipped.layerNumber, inactiveBank) // new bank (now active after flip)
			if (fromPhys !== toPhys) {
				// Clear mixer state on the old bank layer (now inactive)
				clearLines.push(`MIXER ${channel}-${fromPhys} CLEAR`)
			}
		}
		if (clearLines.length > 0) {
			try {
				await amcp.batchSendChunked(clearLines, { skipMixerPreCommit: true })
			} catch (e) {
				self.log?.('warn', `[scene-take-lbg] WO-218 MIXER CLEAR for vacated layers failed: ${e?.message || e}`)
			}
		}
	}

	if (isMergeTransition && incoming) {
		try {
			await clearStaleInactiveBankLookLayers(amcp, channel, inactiveBank, incoming, self)
		} catch (_) {}
	}

	// WO-209 T209.3: when banklessTake, sweep opposite bank for orphaned look layers (not in incoming).
	// This cleans up stale bank-B physical layers (110-199) that aren't targeted by this take.
	if (banklessTake && !isMergeTransition && takeJobs.length > 0) {
		try {
			const incomingPhys = takeJobs.map((j) => j.pLayer)
			const stalePhys = collectOrphanLookPhysicalLayers(self, channel, incomingPhys)
			// Filter to bank-B layers only (110-199)
			const staleBankB = stalePhys.filter((layer) => layer >= PGM_BANK_B_OFFSET && layer <= 199)
			if (staleBankB.length > 0) {
				await clearPhysicalLookLayers(amcp, channel, staleBankB, self)
			}
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] bankless-take opposite-bank sweep failed: ${e?.message || e}`)
		}
	}

	// WO-210 T210.5: apply timersVisibility map from the look (if present).
	// For each assigned timer on this channel whose timerId is in the map, emit MIXER OPACITY.
	try {
		const timersVisibilityMap = incoming?.timersVisibility || incomingSceneOpt?.timersVisibility
		if (timersVisibilityMap && typeof timersVisibilityMap === 'object') {
			const { linesForLookVisibility } = require('./screen-timers')
			const visibilityLines = linesForLookVisibility(channel, timersVisibilityMap)
			if (visibilityLines.length > 0) {
				await amcp.batchSendChunked(visibilityLines, { skipMixerPreCommit: true })
			}
		}
	} catch (e) {
		self.log?.('warn', `[scene-take-lbg] timersVisibility apply failed: ${e?.message || e}`)
	}
}

module.exports = { finalizeTakeBankState }
