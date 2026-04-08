'use strict'

const { execSync } = require('child_process')
const logger = require('./logger').defaultLogger

/**
 * @param {string} mode
 * @returns {string} xrandr mode name e.g. 1920x1080
 */
function mapCasparModeToXrandrRes(mode) {
	if (!mode) return '1920x1080'
	const s = String(mode)
	if (s === '1080p5000' || s === '1080p50') return '1920x1080'
	if (s === '720p5000' || s === '720p50') return '1280x720'
	const m = s.match(/^(\d+)x(\d+)/)
	return m ? `${m[1]}x${m[2]}` : '1920x1080'
}

/**
 * Applies X11 screen positioning using xrandr.
 * Maps screen_N_system_id (e.g. HDMI-0) to its target resolution and position.
 * Optional screen_N_os_mode / screen_N_os_rate set OS output mode; otherwise derived from casparServer.screen_N_mode.
 * @param {object} config - Unified app config
 */
function applyX11Layout(config) {
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {}
	const screenCount = Math.min(
		4,
		Math.max(1, parseInt(String(config.screen_count ?? cs.screen_count ?? 1), 10) || 1),
	)
	let cumulativeX = 0

	for (let n = 1; n <= screenCount; n++) {
		const sysId = config[`screen_${n}_system_id`]
		const osMode = config[`screen_${n}_os_mode`]
		const osRate = config[`screen_${n}_os_rate`]
		const casparMode = cs[`screen_${n}_mode`]
		let res = (osMode && String(osMode).trim()) || mapCasparModeToXrandrRes(casparMode)

		if (sysId) {
			let cmd = `xrandr --display :0 --output ${sysId} --mode ${res} --pos ${cumulativeX}x0`
			const r = typeof osRate === 'number' ? osRate : parseFloat(String(osRate || ''))
			if (Number.isFinite(r) && r > 0) {
				cmd += ` --rate ${r}`
			}
			logger.info(`[OS-Config] Applying: ${cmd}`)
			try {
				execSync(cmd, { stdio: 'inherit' })
			} catch (e) {
				logger.error(`[OS-Config] Failed to apply layout for ${sysId}: ${e.message}`)
			}
		}

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
	restartDisplayManager,
}
