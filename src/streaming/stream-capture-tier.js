'use strict'

const { execSync } = require('child_process')

/**
 * @param {string} requestedMode - 'auto' | 'local' | 'ndi' | 'udp' | 'srt'
 * @param {string} casparHost
 * @returns {'local' | 'ndi' | 'udp'}
 */
function resolveCaptureTier(requestedMode, casparHost) {
	if (requestedMode === 'local') return 'local'
	if (requestedMode === 'ndi') return 'ndi'
	if (requestedMode === 'udp' || requestedMode === 'srt') return 'udp'

	const isLocal = casparHost === '127.0.0.1' || casparHost === 'localhost' || casparHost === '0.0.0.0'
	if (isLocal) {
		try {
			const out = execSync('ffmpeg -devices 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
			if (out.includes('kmsgrab') || out.includes('x11grab')) {
				return 'local'
			}
		} catch {}
	}

	try {
		const out = execSync('ffmpeg -formats 2>&1 || true', { encoding: 'utf8', timeout: 3000 })
		if (out.includes('libndi')) {
			return 'ndi'
		}
	} catch {}

	return 'udp'
}

module.exports = { resolveCaptureTier }
