/**
 * Post-take teardown: STOP/CLEAR exited layers (+ PIP slots), dual global border clear, optional fade wait.
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const {
	buildPipOverlayRemoveLines,
	buildGlobalBorderClearLines,
	sendPipOverlayLinesSerial,
	nextPipContentLayerInScene,
	pipOverlaysFromLayer,
} = require('./pip-overlay')

/**
 * @param {object} ctx
 * @param {object} ctx.amcp
 * @param {object} ctx.self
 * @param {number} ctx.channel
 * @param {object[]} ctx.exitMedia
 * @param {boolean} ctx.needsBorderOnlyTeardown
 * @param {number|null} ctx.fadeClockStart
 * @param {number} ctx.fadeDur
 * @param {number} ctx.fadeMs
 * @param {object[]} ctx.takeJobs
 * @param {boolean} ctx.isMergeTransition
 * @param {object[]|undefined} ctx.currentSceneLayers
 * @param {boolean} ctx.currentGbEnabled
 * @param {boolean} ctx.incomingGbEnabled
 * @param {'a'|'b'} ctx.activeBank
 * @param {(sceneLn: number, bank: 'a'|'b') => number} ctx.phys
 */
async function runSceneTakeLbgTeardown(ctx) {
	const {
		amcp,
		self,
		channel,
		exitMedia,
		needsBorderOnlyTeardown,
		fadeClockStart,
		fadeDur,
		fadeMs,
		takeJobs,
		isMergeTransition,
		currentSceneLayers,
		currentGbEnabled,
		incomingGbEnabled,
		activeBank,
		phys,
	} = ctx

	if (exitMedia.length === 0 && !needsBorderOnlyTeardown) return

	let teardownWait = 0
	if (fadeClockStart != null && fadeDur > 0) {
		teardownWait = Math.max(0, fadeMs - (Date.now() - fadeClockStart))
	}
	if (teardownWait > 0) {
		await new Promise((r) => setTimeout(r, Math.ceil(teardownWait) + 5))
	}

	const takeJobLogicalNums = new Set(takeJobs.map((j) => Number(j.layer.layerNumber)).filter(Number.isFinite))

	const teardownLines = []
	for (const layer of exitMedia) {
		const ln = Number(layer.layerNumber)
		if (isMergeTransition && Number.isFinite(ln)) {
			if (takeJobLogicalNums.has(ln)) {
				const ghost = ln + PGM_BANK_B_OFFSET
				const clg = `${channel}-${ghost}`
				teardownLines.push(`STOP ${clg}`, `MIXER ${clg} CLEAR`)
				try {
					playbackTracker.recordStop(self, channel, ghost)
				} catch (_) {}
				continue
			}
			for (const physLn of [ln, ln + PGM_BANK_B_OFFSET]) {
				const cl = `${channel}-${physLn}`
				teardownLines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
				try {
					const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
					const pipN = pipOverlaysFromLayer(layer).length
					if (pipN > 0 && physLn === ln) {
						teardownLines.push(...buildPipOverlayRemoveLines(channel, physLn, nextL, pipN))
					}
				} catch (_) {}
				try {
					playbackTracker.recordStop(self, channel, physLn)
				} catch (_) {}
			}
		} else {
			const pOut = phys(Number(layer.layerNumber), activeBank)
			const cl = `${channel}-${pOut}`
			teardownLines.push(`STOP ${cl}`, `MIXER ${cl} CLEAR`)
			try {
				const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
				const pipN = pipOverlaysFromLayer(layer).length
				if (pipN > 0) {
					teardownLines.push(...buildPipOverlayRemoveLines(channel, pOut, nextL, pipN))
				}
			} catch (_) {}
			try {
				playbackTracker.recordStop(self, channel, pOut)
			} catch (_) {}
		}
	}

	if (currentGbEnabled && !incomingGbEnabled) {
		teardownLines.push(...buildGlobalBorderClearLines(channel, 998))
		teardownLines.push(...buildGlobalBorderClearLines(channel, 996))
	}

	if (teardownLines.length > 0) {
		try {
			await sendPipOverlayLinesSerial(amcp, teardownLines)
		} catch (_) {}
	}
	try {
		await amcp.mixerCommit(channel)
	} catch (_) {}
}

module.exports = { runSceneTakeLbgTeardown }
