/**
 * WO-207 T207.3: Startup/reconnect sweep for orphaned template CG hosts.
 * On highascg start or Caspar reconnect, clear the CG host band 700-899 on every program channel
 * EXCEPT hosts declared by the restored live look's template layers (computed from liveSceneState).
 * This kills restart-orphans deterministically without needing manual intervention.
 */

'use strict'

const { resolveTemplateCgHostLayer } = require('./cg-routing')
const { isSceneTemplateLayer } = require('./scene-template-cg')

/**
 * WO-207 T207.3: Clear orphaned template CG hosts on startup/reconnect.
 * @param {object} opts
 * @param {object} opts.amcp — AMCP client
 * @param {object} opts.liveState — live scene state (from live-scene-state.js getAll())
 * @param {number[]} opts.channels — program channel numbers to sweep
 * @param {Function} [opts.log] — logger function (level, msg)
 * @returns {Promise<{ clearedCount: number, declaredCount: number }>}
 */
async function sweepTemplateCgOrphansOnCasparConnected(opts) {
	const { amcp, liveState, channels = [], log } = opts || {}

	if (!amcp || typeof amcp.batchSendChunked !== 'function') {
		return { clearedCount: 0, declaredCount: 0 }
	}

	const declaredHosts = new Set()
	const clearLines = []

	// Compute declared hosts from current live scene layers
	for (const ch of channels) {
		const chKey = String(ch)
		const entry = liveState?.[chKey]
		const layers = entry?.scene?.layers || []

		for (const layer of layers) {
			if (!isSceneTemplateLayer(layer, layer.source?.value)) continue
			const hostLayer = resolveTemplateCgHostLayer(layer.layerNumber, layer.source?.value)
			declaredHosts.add(`${ch}-${hostLayer}`)
		}
	}

	// Clear hosts 700-789 not declared by the restored live look
	for (const ch of channels) {
		for (let host = 700; host <= 789; host++) {
			const key = `${ch}-${host}`
			if (declaredHosts.has(key)) continue
			// This host is not declared — clear it
			clearLines.push(`CG ${ch}-${host} CLEAR`)
		}
	}

	let clearedCount = 0
	if (clearLines.length > 0) {
		try {
			await amcp.batchSendChunked(clearLines, { skipMixerPreCommit: true })
			clearedCount = clearLines.length
		} catch (e) {
			if (typeof log === 'function') {
				log('warn', `[template-cg-orphan-sweep] clear batch failed: ${e?.message || e}`)
			}
		}
	}

	if (typeof log === 'function') {
		log(
			'info',
			`[template-cg-orphan-sweep] ch=${channels.join(',')} cleared=${clearedCount} declared=${declaredHosts.size}`,
		)
	}

	return { clearedCount, declaredCount: declaredHosts.size }
}

module.exports = { sweepTemplateCgOrphansOnCasparConnected }
