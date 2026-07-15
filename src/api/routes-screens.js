/**
 * Screen label management (WO-222).
 */

'use strict'

/**
 * @param {string} path
 * @param {object} body
 * @param {object} ctx
 * @returns {{ ok?: boolean, error?: string, screenLabels?: string[] }}
 */
function handlePost(path, body, ctx) {
	if (path === '/api/screens/label') {
		return handleScreenLabel(body, ctx)
	}
	return { error: 'Not found' }
}

/**
 * POST /api/screens/label { screenIdx, label }
 * @param {object} body
 * @param {object} ctx
 * @returns {{ ok?: boolean, error?: string, screenLabels?: string[] }}
 */
function handleScreenLabel(body, ctx) {
	if (!ctx || !ctx.config || !ctx.configManager) {
		return { error: 'Config unavailable' }
	}

	const screenIdx = parseInt(String(body?.screenIdx ?? ''), 10)
	const label = String(body?.label ?? '').trim()

	if (!Number.isFinite(screenIdx) || screenIdx < 0) {
		return { error: 'screenIdx must be a non-negative integer' }
	}

	const cfg = ctx.config || {}
	const screenLabels = Array.isArray(cfg.screenLabels) ? [...cfg.screenLabels] : []

	// Ensure array is long enough
	while (screenLabels.length <= screenIdx) {
		screenLabels.push('')
	}

	screenLabels[screenIdx] = label

	// Persist the config
	try {
		ctx.configManager.save({ ...ctx.configManager.get(), screenLabels })
		if (ctx.config) Object.assign(ctx.config, ctx.configManager.get())
		return { ok: true, screenLabels }
	} catch (e) {
		return { error: `Failed to save: ${e.message}` }
	}
}

module.exports = { handlePost }
