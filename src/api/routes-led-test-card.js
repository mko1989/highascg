/**
 * POST /api/led-test-card — enable/disable LED wall test HTML template on PGM (first program channel).
 * Uses CasparCG layer 999 so timeline/scene content (layers 10–89 typical) stays below.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const TEST_LAYER = 999
const TEMPLATE = 'led_grid_test'
const HOST_LAYER = 0

/**
 * @param {string} path
 * @param {string} body
 * @param {{ amcp: import('../caspar/amcp-client').AmcpClient, getState?: () => object }} ctx
 */
async function handlePost(path, body, ctx) {
	if (path !== '/api/led-test-card') return null
	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const b = parseBody(body)
	const enabled = !!b.enabled
	const st = typeof ctx.getState === 'function' ? ctx.getState() : {}
	const cm = st.channelMap || {}
	const programChannels = cm.programChannels || [1]
	const channel = b.channel != null ? parseInt(b.channel, 10) : programChannels[0]
	const amcp = ctx.amcp

	try {
		if (!enabled) {
			try {
				await amcp.cg.cgRemove(channel, TEST_LAYER, HOST_LAYER)
			} catch {
				/* ignore if nothing on layer */
			}
			await amcp.mixer.mixerCommit(channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, enabled: false, channel, layer: TEST_LAYER }) }
		}

		const payload = {
			cols: Math.max(1, parseInt(b.cols, 10) || 4),
			rows: Math.max(1, parseInt(b.rows, 10) || 3),
			panelWidth: Math.max(1, parseInt(b.panelWidth, 10) || 192),
			panelHeight: Math.max(1, parseInt(b.panelHeight, 10) || 108),
			centerLabel: b.centerLabel != null ? String(b.centerLabel) : 'HighAsCG',
			showCenterCharacter: b.showCenterCharacter !== false,
			showPanelLabels: b.showPanelLabels !== false,
			showSpecLine: b.showSpecLine !== false,
		}
		const data = JSON.stringify(payload)

		try {
			await amcp.cg.cgRemove(channel, TEST_LAYER, HOST_LAYER)
		} catch {
			/* replace previous */
		}
		await amcp.cg.cgAdd(channel, TEST_LAYER, HOST_LAYER, TEMPLATE, 1, data)
		await amcp.cg.cgPlay(channel, TEST_LAYER, HOST_LAYER)
		await amcp.mixer.mixerFill(channel, TEST_LAYER, 0, 0, 1, 1)
		await amcp.mixer.mixerCommit(channel)

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, enabled: true, channel, layer: TEST_LAYER, ...payload }),
		}
	} catch (e) {
		const msg = e?.message || String(e)
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

module.exports = { handlePost }
