'use strict'

const playbackTracker = require('../state/playback-tracker')
const { isSceneTemplateLayer } = require('./scene-template-cg')

/**
 * @param {object} self
 * @param {number} channel
 * @param {object[]} takeJobs
 * @param {object} fadeWatcher
 * @param {number} framerate
 */
async function scheduleFadeOnEndForTakeJobs(self, channel, takeJobs, fadeWatcher, framerate) {
	for (const job of takeJobs) {
		if (job.templateCg) continue
		try {
			playbackTracker.recordPlay(self, channel, job.pLayer, job.clip, { loop: !!job.layer.loop })
		} catch (_) {}

		const foe = job.layer.fadeOnEnd
		const clipIsTemplate = isSceneTemplateLayer(job.layer, job.clip, self)
		if (fadeWatcher && foe?.enabled && !job.layer.loop && !clipIsTemplate) {
			const fadeFr = foe.frames || 12
			let durationMs = playbackTracker.resolveClipDurationMs(self, job.clip)
			if (!durationMs || durationMs <= 0) {
				durationMs = await playbackTracker.resolveClipDurationMsWithDiskProbe(self, job.clip)
			}
			if (durationMs && durationMs > 0) {
				fadeWatcher.schedule(channel, job.pLayer, durationMs, fadeFr, framerate)
			} else {
				const oscDelay = playbackTracker.getOscClipEndFadeDelayMs(
					self,
					channel,
					job.pLayer,
					job.clip,
					fadeFr,
					framerate,
				)
				if (oscDelay != null && Number.isFinite(oscDelay)) {
					fadeWatcher.scheduleMidPlayback(channel, job.pLayer, oscDelay, fadeFr, framerate)
				} else {
					fadeWatcher.scheduleWithOscFallback(
						self,
						channel,
						job.pLayer,
						job.clip,
						fadeFr,
						framerate,
						() =>
							playbackTracker.getOscClipEndFadeDelayMs(
								self,
								channel,
								job.pLayer,
								job.clip,
								fadeFr,
								framerate,
							),
					)
				}
			}
		}
	}
}

module.exports = { scheduleFadeOnEndForTakeJobs }
