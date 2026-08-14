/**
 * Layer 999 (the startup LED test card) — clearing it, and knowing whether it is even there.
 *
 * Split out of `startup-led-test-pattern.js` under WO-492 B (500-line CI limit). Kept free of any
 * require back into that module so the pair cannot go circular: the layer constant lives HERE and
 * `startup-led-test-pattern.js` imports it, not the other way round.
 */

'use strict'

/** Same layer as manual LED test card (`routes-led-test-card.js`). */
const STARTUP_LED_TEST_LAYER = 999

/**
 * WO-492 B: is the startup card actually on layer 999 of `ch`?
 *
 * `null` = could not tell (no AMCP, INFO failed/unparseable) — the caller must then fall back to
 * clearing, same "uncertainty fails toward clearing" rule WO-482 applies to the 700-789 band.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number} ch
 * @returns {Promise<boolean|null>}
 */
async function isLedTestLayerOccupied(amcp, ch) {
	if (!amcp || typeof amcp.info !== 'function' || amcp.isConnected === false) return null
	try {
		const { infoResponseToXml, listOccupiedStageLayersInRange } = require('../caspar/channel-info-xml')
		const xml = infoResponseToXml(await amcp.info(ch))
		if (!xml || !String(xml).trim()) return null
		/* `listOccupiedStageLayersInRange`, not `foregroundProducerOnLayer`: the latter returns null
		 * for BOTH "layer is empty" and "XML is unparseable" (its own doc warns not to read that as
		 * absent), which is precisely the distinction this gate turns on. This one returns null only
		 * for unparseable, and [] for a channel we can genuinely see has nothing on 999 — the same
		 * primitive the multiview surgical CLEAR already trusts. */
		const occupied = await listOccupiedStageLayersInRange(xml, STARTUP_LED_TEST_LAYER, STARTUP_LED_TEST_LAYER)
		if (occupied == null) return null
		return occupied.includes(STARTUP_LED_TEST_LAYER)
	} catch {
		return null
	}
}

/**
 * WO-492 B: skip channels whose layer 999 is provably empty.
 *
 * `clearLedTestLayerOnChannels` used to fire CG CLEAR + MIXER CLEAR + COMMIT unconditionally, and
 * multiview apply calls it on every routed PGM/PRV channel on EVERY apply (whenever
 * `_ledTestPatternActive` is false — the steady state). Measured 12.08: the triple
 * `CG 1-999 / CG 3-999 / CG 2-999 CLEAR` ten times in 50 s on an idle box, clearing three layers
 * that had nothing on them. One INFO read per channel replaces three blind writes, and the result
 * is cached per channel so the probe runs once rather than once per apply — the cache is dropped
 * whenever the card is (re)painted ({@link markLedTestLayerPainted}).
 * @param {object} ctx - app ctx, carries the cache
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number[]} channelIndices
 * @param {(s: string, ...a: unknown[]) => void} [log]
 */
async function clearLedTestLayerOnChannelsIfPresent(ctx, amcp, channelIndices, log) {
	if (!amcp?.cg?.cgClear || !channelIndices?.length) return
	const known = ctx && (ctx._ledTest999KnownClear instanceof Set ? ctx._ledTest999KnownClear : (ctx._ledTest999KnownClear = new Set()))
	const todo = []
	for (const ch of channelIndices) {
		if (!Number.isFinite(ch) || ch < 1) continue
		if (known?.has(ch)) continue
		const occupied = await isLedTestLayerOccupied(amcp, ch)
		if (occupied === false) {
			known?.add(ch)
			continue
		}
		todo.push(ch)
	}
	if (todo.length === 0) return
	await clearLedTestLayerOnChannels(amcp, todo, log)
	for (const ch of todo) known?.add(ch)
}

/** WO-492 B: the card is on 999 again — the "provably empty" cache is now stale. */
function markLedTestLayerPainted(ctx) {
	if (ctx) ctx._ledTest999KnownClear = new Set()
}

async function clearLedTestLayerOnChannels(amcp, channelIndices, log) {
	if (!amcp?.cg?.cgClear || !channelIndices?.length) return
	for (const ch of channelIndices) {
		if (!Number.isFinite(ch) || ch < 1) continue
		const cl = `${ch}-${STARTUP_LED_TEST_LAYER}`
		try {
			await amcp.cg.cgClear(ch, STARTUP_LED_TEST_LAYER)
		} catch (e) {
			log?.('debug', `[Startup LED test] CG CLEAR ${cl}: ${e?.message || e}`)
		}
		try {
			if (amcp.mixerClear) await amcp.mixerClear(ch, STARTUP_LED_TEST_LAYER)
		} catch (e) {
			log?.('debug', `[Startup LED test] MIXER CLEAR ${cl}: ${e?.message || e}`)
		}
		try {
			await amcp.mixerCommit(ch)
		} catch (e) {
			log?.('debug', `[Startup LED test] COMMIT ch${ch}: ${e?.message || e}`)
		}
	}
}

module.exports = {
	STARTUP_LED_TEST_LAYER,
	clearLedTestLayerOnChannels,
	clearLedTestLayerOnChannelsIfPresent,
	markLedTestLayerPainted,
}
