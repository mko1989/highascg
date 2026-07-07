'use strict'

const ffmpegJpeg = require('../preview/compose-preview-ffmpeg-jpeg')
const activity = require('../preview/compose-preview-activity')
const { isFfmpegJpegComposePreview, isSnapshotComposePreview } = require('../preview/compose-preview-mode')

/** @type {NodeJS.Timeout | null} */
let _configRestartTimer = null

/**
 * @param {object} opts
 * @param {object} opts.appCtx
 */
function createComposePreviewLifecycle({ appCtx }) {
	function clearConfigRestartTimer() {
		if (_configRestartTimer) {
			clearTimeout(_configRestartTimer)
			_configRestartTimer = null
		}
	}

	function restartComposePreviewNow() {
		clearConfigRestartTimer()
		if (isFfmpegJpegComposePreview(appCtx.config)) {
			if (!appCtx.amcp?.isConnected) {
				appCtx.log?.(
					'debug',
					'[compose-preview] AMCP not connected — will start on Caspar connect',
				)
				return
			}
			void ffmpegJpeg.startFfmpegJpegComposePreview(appCtx).catch((e) => {
				appCtx.log?.(
					'warn',
					`[compose-preview] restart failed: ${e?.message || e}`,
				)
			})
		} else {
			void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
		}
	}

	/**
	 * Defer restart until config reload + AMCP settle (avoids abort mid-detach when
	 * runtime config is briefly inconsistent during subsystem recycle).
	 */
	function onConfigChange() {
		clearConfigRestartTimer()
		if (!isFfmpegJpegComposePreview(appCtx.config)) {
			void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
			return
		}
		const delayMs = Math.max(
			0,
			parseInt(process.env.HIGHASCG_COMPOSE_PREVIEW_RESTART_MS || '350', 10) || 350,
		)
		_configRestartTimer = setTimeout(restartComposePreviewNow, delayMs)
		if (_configRestartTimer.unref) _configRestartTimer.unref()
	}

	function onCasparConnected() {
		if (isFfmpegJpegComposePreview(appCtx.config)) {
			restartComposePreviewNow()
		}
	}

	function onCasparDisconnected() {
		clearConfigRestartTimer()
		void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
	}

	function onShutdown() {
		clearConfigRestartTimer()
		void ffmpegJpeg.stopFfmpegJpegComposePreview(appCtx)
		activity.reset()
		require('../preview/compose-preview-dirty').reset()
		// WO-144: blocklist is process-scoped — cleared on service shutdown/restart.
		require('../preview/compose-preview-blocklist').resetComposeBlocklist()
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
