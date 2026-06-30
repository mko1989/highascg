'use strict'

const ffmpegJpeg = require('../preview/compose-preview-ffmpeg-jpeg')
const activity = require('../preview/compose-preview-activity')
const { isFfmpegJpegComposePreview, isSnapshotComposePreview } = require('../preview/compose-preview-mode')

/**
 * @param {object} opts
 * @param {object} opts.appCtx
 */
function createComposePreviewLifecycle({ appCtx }) {
	function onCasparConnected() {
		if (isFfmpegJpegComposePreview(appCtx.config)) {
			ffmpegJpeg.startFfmpegJpegComposePreview(appCtx)
		}
	}

	function onCasparDisconnected() {
		void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
	}

	function onConfigChange() {
		if (isFfmpegJpegComposePreview(appCtx.config)) {
			ffmpegJpeg.startFfmpegJpegComposePreview(appCtx)
		} else {
			void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
		}
	}

	function onShutdown() {
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
