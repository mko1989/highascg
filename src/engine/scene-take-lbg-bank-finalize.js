/**
 * Post-teardown bookkeeping of a program LBG take: skipped-layer bank SWAP, bank pointer flip,
 * vacated-layer cleanup, opposite-bank orphan sweep, preset timer visibility (WO-840).
 * Split out of scene-take-lbg.js (500-line limit) — runs strictly AFTER the teardown wait.
 */

'use strict'

const { PGM_BANK_B_OFFSET, persistProgramLayerBanks } = require('./scene-transition')
const {
	collectOrphanLookPhysicalLayers,
	clearPhysicalLookLayers,
	clearStaleInactiveBankLookLayers,
} = require('./scene-exit-layers')
const { keptLayerMoveLines } = require('./scene-take-carry') // WO-218 / WO-1073 / WO-1126

/**
 * @param {object} amcp
 * @param {{
 *   self: object, channel: number, chKey: string, incoming: object, timersVisibility?: Record<string, boolean>,
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
		timersVisibility,
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
	// WO-1126: without a flip, carried stills still move to this look's layer numbers (chains are ordered there)
	const { swapLines, clearLines } = keptLayerMoveLines({ channel, skipped: skippedVisuallyEqualLayers, flips: shouldFlipBank, phys, inactiveBank })
	if (swapLines.length > 0) {
		try {
			await amcp.batchSend(swapLines)
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] WO-218 SWAP for skipped layers failed: ${e?.message || e}`)
		}
	}

	// WO-209 T209.1: skip pointer flip when banklessTake (pointer must stay 'a' for logical layers).
	if (shouldFlipBank) {
		self.programLayerBankByChannel[chKey] = inactiveBank
	}
	persistProgramLayerBanks(self)

	// WO-218 T218.3: Clean up mixer state on the bank layers we just swapped FROM,
	// so no stale CROP/FILL remains on the vacated layer for the next take.
	if (clearLines.length > 0) {
		try {
			await amcp.batchSendChunked(clearLines, { skipMixerPreCommit: true })
		} catch (e) {
			self.log?.('warn', `[scene-take-lbg] WO-218 MIXER CLEAR for vacated layers failed: ${e?.message || e}`)
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

	// WO-840: timer visibility is per SCREEN, so it comes from the look PRESET item that is being recalled (threaded in
	// as `timersVisibility`), never from the look: a plain take ignores any look-level `timersVisibility` (legacy data).
	// For each assigned timer on this channel whose timerId is in the map, emit MIXER OPACITY.
	try {
		if (timersVisibility && typeof timersVisibility === 'object') {
			const { linesForLookVisibility } = require('./screen-timers')
			const visibilityLines = linesForLookVisibility(channel, timersVisibility)
			if (visibilityLines.length > 0) {
				await amcp.batchSendChunked(visibilityLines, { skipMixerPreCommit: true })
			}
		}
	} catch (e) {
		self.log?.('warn', `[scene-take-lbg] preset timersVisibility apply failed: ${e?.message || e}`)
	}
}

module.exports = { finalizeTakeBankState }
