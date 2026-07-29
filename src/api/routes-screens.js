/**
 * Screen naming (WO-222, reworked by WO-385).
 *
 * A screen's name is the name of the destination that owns it — one field, edited in the Devices
 * inspector, used by the looks selector, multiview, panels and Companion
 * (`screenLabelsFromConfig`, src/config/screen-destinations.js). This endpoint stays for API
 * callers and writes THAT: it renames the owning destination, falling back to the legacy
 * `config.screenLabels` array only when no destination owns the index.
 *
 * Two defects fixed here, each of which alone made every save a no-op that answered a
 * success-looking empty 200 (owner: "ive changed the labels before, now i cant write anything"):
 *   - routes receive the request body as a RAW STRING (router-dispatch.js `@param {string} body`)
 *     — this handler read `body.screenIdx` off that string, got undefined, and bailed on validation;
 *   - it returned a bare `{ ok }` object instead of the `{ status, headers, body }` shape the route
 *     registry passes to the HTTP layer, so nothing reached the client either.
 * The WO-222 test missed both by calling the handler with an already-parsed object.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const { isMainBusDestinationMode, normalizeScreenDestinations } = require('../config/screen-destinations')

/**
 * @param {string} path
 * @param {string} body raw request body
 * @param {object} ctx
 * @returns {{ status: number, headers: object, body: string } | null}
 */
function handlePost(path, body, ctx) {
	if (path !== '/api/screens/label') return null
	return handleScreenLabel(body, ctx)
}

/**
 * POST /api/screens/label { screenIdx, label }
 * @param {string} body raw request body
 * @param {object} ctx
 */
function handleScreenLabel(body, ctx) {
	if (!ctx || !ctx.config || !ctx.configManager) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Config unavailable' }) }
	}

	const parsed = parseBodyStrict(body)
	if (!parsed.ok) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Invalid JSON body', detail: parsed.error }),
		}
	}
	const payload = parsed.value || {}

	const screenIdx = parseInt(String(payload.screenIdx ?? ''), 10)
	const label = String(payload.label ?? '').trim()
	if (!Number.isFinite(screenIdx) || screenIdx < 0) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'screenIdx must be a non-negative integer' }),
		}
	}

	const cfg = ctx.config
	const sd = normalizeScreenDestinations(cfg.screenDestinations)
	const owner = sd.destinations.find(
		(d) => d && isMainBusDestinationMode(d.mode) && (parseInt(String(d.mainScreenIndex ?? 0), 10) || 0) === screenIdx,
	)

	let nextConfig
	if (owner) {
		// The screen IS its destination — rename that one, so every reader agrees.
		const destinations = sd.destinations.map((d) => (d === owner ? { ...d, label: label || d.id } : d))
		nextConfig = { ...ctx.configManager.get(), screenDestinations: { ...sd, destinations } }
	} else {
		// Nothing owns this index — keep the legacy array as the fallback store.
		const screenLabels = Array.isArray(cfg.screenLabels) ? [...cfg.screenLabels] : []
		while (screenLabels.length <= screenIdx) screenLabels.push('')
		screenLabels[screenIdx] = label
		nextConfig = { ...ctx.configManager.get(), screenLabels }
	}

	try {
		ctx.configManager.save(nextConfig)
		Object.assign(ctx.config, ctx.configManager.get())
		const { getChannelMap } = require('../config/routing')
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				screenIdx,
				label,
				renamedDestination: owner ? owner.id : null,
				screenLabels: getChannelMap(ctx.config).screenLabels,
			}),
		}
	} catch (e) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: `Failed to save: ${e.message}` }) }
	}
}

module.exports = { handlePost }
