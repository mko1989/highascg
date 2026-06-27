'use strict'

const composeTick = require('../preview/compose-preview-tick')
const ffmpegJpeg = require('../preview/compose-preview-ffmpeg-jpeg')
const activity = require('../preview/compose-preview-activity')
const {
	isCasparImageComposePreview,
	isFfmpegJpegComposePreview,
	isSnapshotComposePreview,
} = require('../preview/compose-preview-mode')

/**
 * @param {object} opts
 * @param {object} opts.appCtx
 */
function createComposePreviewLifecycle({ appCtx }) {
	let timelineWired = false

	function wireTimelineTicks() {
		const eng = appCtx.timelineEngine
		if (!eng || timelineWired) return
		timelineWired = true
		eng.on('playback', (pb) => {
			if (!isCasparImageComposePreview(appCtx.config)) return
			const channels = typeof eng._channels === 'function' ? eng._channels() : []
			if (pb?.playing) activity.onTimelinePlaying(channels)
			else activity.onTimelinePaused(appCtx, channels)
		})
	}

	function onCasparConnected() {
		wireTimelineTicks()
		if (isCasparImageComposePreview(appCtx.config)) {
			const channels = composeTick.resolveMonitoredChannels(appCtx.config)
			activity.requestInitialCapture(channels)
			composeTick.startComposePreviewTick(appCtx)
		} else if (isFfmpegJpegComposePreview(appCtx.config)) {
			ffmpegJpeg.startFfmpegJpegComposePreview(appCtx)
		}
	}

	function onCasparDisconnected() {
		composeTick.stopComposePreviewTick(appCtx)
		void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
	}

	function onConfigChange() {
		composeTick.restartComposePreviewTick(appCtx)
		void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
		if (isFfmpegJpegComposePreview(appCtx.config)) {
			ffmpegJpeg.startFfmpegJpegComposePreview(appCtx)
		}
	}

	function onShutdown() {
		composeTick.stopComposePreviewTick(appCtx)
		void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
		activity.reset()
		require('../preview/compose-preview-dirty').reset()
	}

	return {
		onCasparConnected,
		onCasparDisconnected,
		onConfigChange,
		onShutdown,
		isSnapshotComposePreview: () => isSnapshotComposePreview(appCtx.config),
	}
}

module.exports = { createComposePreviewLifecycle }
