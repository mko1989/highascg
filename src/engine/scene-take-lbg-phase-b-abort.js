/**
 * WO-833 (3f): what a take does when its Phase B (PLAY / crossfade / COMMIT) batch FAILED.
 *
 * Before: the failure was only logged; the take carried on, flipped the bank pointer, STOPped the outgoing look
 * (the fade clock was never started, so teardown ran immediately) and returned `{ok:true}` — the route then wrote
 * `scene.live` naming a look while PGM was black.
 *
 * Now: the outgoing look is NEVER torn down (no PGM black from a half-sent take), the bank pointer is not flipped,
 * the incoming bank layers are best-effort STOPped so a half-applied batch cannot leave the new look creeping in
 * over the old one, and the take REJECTS — routes-scene-take.js turns that into an error response and never
 * touches `scene.live`. Worst case after a failure: the previous look is still on air and the operator is told.
 */

'use strict'

/**
 * @param {object} amcp
 * @param {{ self: object, channel: number, takeJobs: object[], isMergeTransition: boolean, activeBank: string, inactiveBank: string, error: Error }} c
 * @returns {Promise<Error>} the error to throw
 */
async function abortFailedTake(amcp, c) {
	const { self, channel, takeJobs, isMergeTransition, activeBank, inactiveBank, error } = c
	// +Animate plays on the SAME physical layer as the outgoing look, and a bankless (PRV) take shares its layers
	// with whatever is there — STOP there would kill the very look we are trying to keep on air.
	const separateBank = !isMergeTransition && activeBank !== inactiveBank
	if (separateBank) {
		const lines = []
		for (const j of takeJobs) {
			if (Number.isFinite(Number(j?.pLayer))) lines.push(`STOP ${channel}-${j.pLayer}`)
		}
		if (lines.length > 0) {
			try {
				await amcp.batchSend(lines)
			} catch (e) {
				self.log?.('warn', `[scene-take-lbg] WO-833 failed-take cleanup STOP on ch${channel} failed: ${e?.message || e}`)
			}
		}
	}
	self.log?.(
		'error',
		`[scene-take-lbg] take on ch${channel} ABORTED after Phase B failure — outgoing look kept on air, bank pointer not flipped`,
	)
	const err = new Error(`Take failed: PLAY batch was not delivered to Caspar (${error?.message || error})`)
	err.cause = error
	return err
}

module.exports = { abortFailedTake }
