'use strict'

const { execSync } = require('child_process')

/** Same expression as `caspar-ffmpeg-setup` `SCALE_HALF_VF` (avoid circular require). */
const SCALE_HALF_VF = 'scale=w=iw/2:h=ih/2'

/**
 * Detect the effective capture mode based on environment.
 * @param {string} requestedMode - 'auto' | 'local' | 'ndi' | 'udp' | 'srt' (legacy alias for udp)
 * @param {string} casparHost
 * @returns {'local' | 'ndi' | 'udp'}
 */
function resolveCaptureTier(requestedMode, casparHost) {
	if (requestedMode === 'local') return 'local'
	if (requestedMode === 'ndi') return 'ndi'
	/** Caspar STREAM uses MPEG-TS over UDP to go2rtc; older configs used the mislabel "srt". */
	if (requestedMode === 'udp' || requestedMode === 'srt') return 'udp'

	// Auto-detect
	const isLocal = casparHost === '127.0.0.1' || casparHost === 'localhost' || casparHost === '0.0.0.0'
	if (isLocal) {
		// Check if kmsgrab or x11grab is available
		try {
			const out = execSync('ffmpeg -devices 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
			if (out.includes('kmsgrab') || out.includes('x11grab')) {
				return 'local'
			}
		} catch { /* fallthrough */ }
	}

	// Check if NDI is available
	try {
		const out = execSync('ffmpeg -formats 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
		if (out.includes('libndi')) {
			return 'ndi'
		}
	} catch { /* fallthrough */ }

	return 'udp'
}

/**
 * Detect which local capture device to use (kmsgrab preferred when `auto`, unless forced).
 * @param {{ localCaptureDevice?: string }} [config]
 * @returns {'kmsgrab' | 'x11grab'}
 */
function detectLocalCaptureDevice(config = {}) {
	const forced = config.localCaptureDevice || process.env.HIGHASCG_LOCAL_CAPTURE_DEVICE
	if (forced === 'x11grab' || forced === 'kmsgrab') return forced
	try {
		const out = execSync('ffmpeg -devices 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
		if (out.includes('kmsgrab')) return 'kmsgrab'
	} catch { /* ignore */ }
	return 'x11grab'
}

/**
 * Optional verbose go2rtc logging (WebRTC / ffmpeg). Set `streaming.go2rtcLogLevel` in config or
 * env **`HIGHASCG_GO2RTC_LOG_LEVEL`** to `trace` | `debug` | `info` | `warn` | `error`.
 * @param {{ go2rtcLogLevel?: string }} config
 * @param {string[]} yamlLines
 */
function appendGo2rtcLogYaml(config, yamlLines) {
	const level = String(config.go2rtcLogLevel || process.env.HIGHASCG_GO2RTC_LOG_LEVEL || '')
		.trim()
		.toLowerCase()
	if (!level) return

	const allowed = ['trace', 'debug', 'info', 'warn', 'error']
	if (!allowed.includes(level)) {
		console.warn(`[go2rtc] Ignoring invalid go2rtcLogLevel "${level}" (use trace|debug|info|warn|error)`)
		return
	}

	yamlLines.push('')
	yamlLines.push('log:')
	yamlLines.push(`  level: ${level}`)
	if (level === 'trace' || level === 'debug') {
		yamlLines.push('  webrtc: trace')
		yamlLines.push('  exec: debug')
	}
	console.log(`[go2rtc] Verbose logging enabled (level=${level}) — from config or HIGHASCG_GO2RTC_LOG_LEVEL`)
}

module.exports = {
	SCALE_HALF_VF,
	resolveCaptureTier,
	detectLocalCaptureDevice,
	appendGo2rtcLogYaml,
}
