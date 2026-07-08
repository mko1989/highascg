'use strict'

const fs = require('fs')
const { normalizeVirtualCameraConfig } = require('./v4l2-bridge-config')
const { V4L2_BRIDGE_MODES } = require('./v4l2-bridge-args')

/**
 * @param {unknown} raw
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateVirtualCameraConfig(raw) {
	const src = raw && typeof raw === 'object' ? raw : {}
	const vc = normalizeVirtualCameraConfig(raw)
	const errors = []
	const warnings = []

	if (!/^\/dev\/video\d+$/.test(vc.device)) {
		errors.push(`device must match /dev/videoN (got ${vc.device})`)
	}

	// Normalization silently falls back to 'jpeg'; reject explicit unknown modes instead of masking typos.
	if (src.mode != null && !V4L2_BRIDGE_MODES.includes(String(src.mode).trim().toLowerCase())) {
		errors.push(`mode must be one of ${V4L2_BRIDGE_MODES.join('/')} (got ${src.mode})`)
	}

	if (src.streamPort != null) {
		const port = parseInt(String(src.streamPort), 10)
		if (!Number.isFinite(port) || port < 1024 || port > 65535) {
			errors.push(`streamPort must be 1024–65535 (got ${src.streamPort})`)
		}
	}

	const nr = parseInt(String(vc.device).replace('/dev/video', ''), 10)
	if (Number.isFinite(nr) && (nr < 0 || nr > 63)) {
		warnings.push(`device video_nr ${nr} is outside typical range 0–63`)
	}

	if (vc.width < 640 || vc.height < 360) {
		warnings.push('resolution below 640×360 may look poor in conferencing apps')
	}

	if (vc.fps > 60) {
		warnings.push('fps above 60 may not be supported by v4l2loopback consumers')
	}

	if (!/^[A-Za-z0-9_-]+$/.test(vc.alsaLoopbackCardId)) {
		errors.push('alsaLoopbackCardId must be alphanumeric/underscore/dash')
	}

	if (vc.audioEnabled && !fs.existsSync('/proc/asound/cards')) {
		warnings.push('ALSA not available — virtual mic audio will fail')
	}

	return { ok: errors.length === 0, errors, warnings, config: vc }
}

module.exports = { validateVirtualCameraConfig }
