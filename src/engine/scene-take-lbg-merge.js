/**
 * Merge-transition opacity defer lines + global border layer index + AMCP plan logging for scene-take-lbg.
 */

'use strict'

const { param, deferMixerAmcpLine, amcpVerboseTrace } = require('../caspar/amcp-utils')
const { describeClipCommandPlan } = require('../caspar/amcp-command-plan')
const {
	buildPipOverlayOpacityFadeDeferLines,
	nextPipContentLayerInScene,
	pipOverlaysFromLayer,
	buildGlobalBorderOpacityFadeLine,
} = require('./pip-overlay')
const { PGM_BANK_B_OFFSET } = require('./scene-transition')

function resolveGlobalBorderPhysicalLayer(gb) {
	return Number(gb?.activePgmLayer) === 996 ? 996 : 998
}

/**
 * Merge transition: outgoing-only logical layers (still on PGM, not replaced by a takeJob on this beat)
 * fade to opacity 0 on the **same** Caspar layer index as the look (no bank B / +100).
 * @param {{ channel: number, exitMedia: object[], takeJobs: object[], fadeDur: number, fadeTw?: string, currentSceneLayers: object, fadeWatcher: object|null }} p
 * @returns {string[]}
 */
function buildMergeOutgoingOpacityDeferLines(p) {
	const { channel, exitMedia, takeJobs, fadeDur, fadeTw, currentSceneLayers, fadeWatcher } = p
	const lines = []
	const takeJobNums = new Set(takeJobs.map((j) => Number(j.layer.layerNumber)).filter(Number.isFinite))
	for (const layer of exitMedia) {
		const ln = Number(layer.layerNumber)
		if (!Number.isFinite(ln) || takeJobNums.has(ln)) continue
		if (fadeWatcher) {
			fadeWatcher.cancel(channel, ln)
			fadeWatcher.cancel(channel, ln + PGM_BANK_B_OFFSET)
		}
		const cl = `${channel}-${ln}`
		let tail = `0 ${fadeDur}`
		if (fadeTw) tail += ` ${param(fadeTw)}`
		lines.push(deferMixerAmcpLine(`MIXER ${cl} OPACITY ${tail}`))
		try {
			const nextL = nextPipContentLayerInScene(currentSceneLayers, layer.layerNumber)
			const pipN = pipOverlaysFromLayer(layer).length
			if (pipN > 0) {
				lines.push(...buildPipOverlayOpacityFadeDeferLines(channel, ln, tail, nextL, pipN))
			}
		} catch (_) {}
	}
	return lines
}

function logPlannedCommand(self, phase, sceneLayer, plan) {
	if (!amcpVerboseTrace() || typeof self?.log !== 'function' || !plan) return
	const d = describeClipCommandPlan(plan)
	self.log(
		'debug',
		`AMCP plan ${phase} sceneLayer=${sceneLayer} ch=${d.channel} layer=${d.layer} cmd=${d.commandName}` +
			(d.clip ? ` clip=${d.clip}` : '') +
			(d.transition ? ` transition=${d.transition} duration=${d.duration || 0} tween=${d.tween || 'linear'}` : '') +
			(d.seek != null ? ` seek=${d.seek}` : '') +
			(d.length != null ? ` length=${d.length}` : ''),
	)
}

/**
 * @param {object} p
 * @returns {string[]}
 */
function buildMergeMixerExtrasForTake(p) {
	const {
		isMergeTransition,
		fadeDur,
		forceCut,
		channel,
		exitMedia,
		takeJobs,
		fadeTw,
		currentSceneLayers,
		fadeWatcher,
		gbWillFadeIn,
		gbWillFadeOut,
		incomingGbLayer,
		currentGbLayer,
	} = p
	if (!isMergeTransition || fadeDur <= 0 || forceCut) return []
	return [
		...buildMergeOutgoingOpacityDeferLines({
			channel,
			exitMedia,
			takeJobs,
			fadeDur,
			fadeTw,
			currentSceneLayers,
			fadeWatcher,
		}),
		...(gbWillFadeIn
			? [
					deferMixerAmcpLine(
						buildGlobalBorderOpacityFadeLine(
							channel,
							incomingGbLayer,
							1,
							fadeDur,
							fadeTw ? param(fadeTw) : undefined,
						),
					),
				]
			: []),
		...(gbWillFadeOut
			? [
					deferMixerAmcpLine(
						buildGlobalBorderOpacityFadeLine(
							channel,
							currentGbLayer,
							0,
							fadeDur,
							fadeTw ? param(fadeTw) : undefined,
						),
					),
				]
			: []),
	]
}

module.exports = {
	resolveGlobalBorderPhysicalLayer,
	buildMergeOutgoingOpacityDeferLines,
	logPlannedCommand,
	buildMergeMixerExtrasForTake,
}
