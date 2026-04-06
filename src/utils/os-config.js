'use strict'

const { execSync } = require('child_process')
const logger = require('./logger').defaultLogger

/**
 * Applies X11 screen positioning using xrandr.
 * Maps screen_N_system_id (e.g. HDMI-0) to its target resolution and position.
 * @param {object} config - Unified app config
 */
function applyX11Layout(config) {
	const screenCount = Math.min(4, Math.max(1, parseInt(String(config.screen_count || 1), 10) || 1))
	let cumulativeX = 0

	for (let n = 1; n <= screenCount; n++) {
		const sysId = config[`screen_${n}_system_id`]
		const mode = config[`screen_${n}_mode`] || '1920x1080' // default fallback if not in caspar format
		
		// Map Caspar-style "1080p5000" to xrandr-style "1920x1080" if needed
		// For now we assume the setup CLI or user saves xrandr-compatible modes
		let res = mode
		if (mode === '1080p5000' || mode === '1080p50') res = '1920x1080'
		else if (mode === '720p5000' || mode === '720p50') res = '1280x720'

		if (sysId) {
			const cmd = `xrandr --display :0 --output ${sysId} --mode ${res} --pos ${cumulativeX}x0`
			logger.info(`[OS-Config] Applying: ${cmd}`)
			try {
				execSync(cmd, { stdio: 'inherit' })
			} catch (e) {
				logger.error(`[OS-Config] Failed to apply layout for ${sysId}: ${e.message}`)
			}
		}

		// Calculate next X position (naively assuming horizontal stacking)
		// Try to parse width from resolution string
		const resMatch = res.match(/^(\d+)x(\d+)/)
		const width = resMatch ? parseInt(resMatch[1], 10) : 1920
		cumulativeX += width
	}
}

/**
 * Restarts the Linux display manager (nodm by default).
 * Requires passwordless sudo for the node user.
 */
function restartDisplayManager() {
	const cmd = 'sudo systemctl restart nodm'
	logger.info(`[OS-Config] Executing: ${cmd}`)
	try {
		execSync(cmd, { stdio: 'inherit' })
		return true
	} catch (e) {
		logger.error(`[OS-Config] Failed to restart display manager: ${e.message}`)
		return false
	}
}

module.exports = {
	applyX11Layout,
	restartDisplayManager
}
