/**
 * POST /api/led-test-card — LED test HTML template on a program channel (layer 999).
 * Screens-only mode (default): logo, resolution, LAN IPs, circle + cross — no LED grid.
 * Full grid when `showLedGrid: true` (per-channel preference from Web UI).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getLanIPv4Addresses } = require('../utils/lan-ipv4')

const TEST_LAYER = 999
const TEMPLATE = 'led_test_pattern/index'
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
				await amcp.cg.cgClear(channel, TEST_LAYER)
			} catch {
				/* ignore if nothing on layer */
			}
			await amcp.mixer.mixerCommit(channel)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, enabled: false, channel, layer: TEST_LAYER }) }
		}

		const showLedGrid = b.showLedGrid === true
		const showCircle = b.showCircle !== false && b.showCircle !== 'false'
		const showCross = b.showCross !== false && b.showCross !== 'false'
		let ipLines = b.ipLines
		if (typeof ipLines === 'string') {
			try {
				ipLines = JSON.parse(ipLines)
			} catch {
				ipLines = [ipLines]
			}
		}
		if (!Array.isArray(ipLines)) ipLines = []
		if (ipLines.length === 0) ipLines = getLanIPv4Addresses()

		let resolutionLabel = b.resolutionLabel != null ? String(b.resolutionLabel).trim() : ''
		let resolutionWidth = parseInt(b.resolutionWidth, 10)
		let resolutionHeight = parseInt(b.resolutionHeight, 10)
		const videoMode = b.videoMode != null ? String(b.videoMode) : ''
		const mainIdx = Array.isArray(programChannels) ? programChannels.indexOf(channel) : -1
		let outputRole = ''
		let connectorLabel = mainIdx >= 0 ? `Screen ${mainIdx + 1} (PGM ch ${channel})` : `PGM ch ${channel}`
		const screenSystemId =
			mainIdx >= 0 ? String(ctx?.config?.casparServer?.[`screen_${mainIdx + 1}_system_id`] || '').trim() : ''
		if (screenSystemId) connectorLabel += ` · ${screenSystemId}`
		const cc = st.configComparison?.serverChannels
		if ((!resolutionLabel || !Number.isFinite(resolutionWidth)) && Array.isArray(cc)) {
			const row = cc.find((s) => s.index === channel)
			if (row) {
				if (!resolutionLabel && row.resolutionLabel) resolutionLabel = row.resolutionLabel
				if (!Number.isFinite(resolutionWidth) && row.screenWidth) resolutionWidth = row.screenWidth
				if (!Number.isFinite(resolutionHeight) && row.screenHeight) resolutionHeight = row.screenHeight
				if (row.hasScreen && row.hasDecklinkOutput) outputRole = 'screen+decklink'
				else if (row.hasDecklinkOutput) outputRole = 'decklink'
				else if (row.hasScreen) outputRole = 'screen'
			}
		}
		if (b.connectorLabel != null && String(b.connectorLabel).trim()) {
			connectorLabel = String(b.connectorLabel).trim()
		}
		const modeText = String(videoMode || '').trim()
		if (outputRole) connectorLabel += ` · ${outputRole}`
		if (modeText) connectorLabel += ` · ${modeText}`

		const payload = showLedGrid
			? {
					showLedGrid: true,
					showCircle,
					showCross,
					cols: Math.max(1, parseInt(b.cols, 10) || 4),
					rows: Math.max(1, parseInt(b.rows, 10) || 3),
					panelWidth: Math.max(1, parseInt(b.panelWidth, 10) || 192),
					panelHeight: Math.max(1, parseInt(b.panelHeight, 10) || 108),
					centerLabel: b.centerLabel != null ? String(b.centerLabel) : 'HighAsCG',
					showCenterCharacter: b.showCenterCharacter !== false,
					showPanelLabels: b.showPanelLabels !== false,
					showSpecLine: b.showSpecLine !== false,
					resolutionLabel: resolutionLabel || '',
					resolutionWidth: Number.isFinite(resolutionWidth) ? resolutionWidth : 0,
					resolutionHeight: Number.isFinite(resolutionHeight) ? resolutionHeight : 0,
					videoMode,
					connectorLabel,
					ipLines,
					pattern: b.pattern || 'grid-white',
				}
			: {
					showLedGrid: false,
					showCircle,
					showCross,
					resolutionLabel: resolutionLabel || '',
					resolutionWidth: Number.isFinite(resolutionWidth) ? resolutionWidth : 0,
					resolutionHeight: Number.isFinite(resolutionHeight) ? resolutionHeight : 0,
					videoMode,
					connectorLabel,
					ipLines,
					centerLabel: b.centerLabel != null ? String(b.centerLabel) : 'HighAsCG',
					showCenterCharacter: b.showCenterCharacter !== false,
					cols: Math.max(1, parseInt(b.cols, 10) || 4),
					rows: Math.max(1, parseInt(b.rows, 10) || 3),
					panelWidth: Math.max(1, parseInt(b.panelWidth, 10) || 192),
					panelHeight: Math.max(1, parseInt(b.panelHeight, 10) || 108),
					showPanelLabels: false,
					showSpecLine: false,
					pattern: b.pattern || 'grid-white',
				}

		const data = JSON.stringify(payload)

		try {
			await amcp.cg.cgClear(channel, TEST_LAYER)
		} catch {
			/* replace previous */
		}
		await amcp.cg.cgAdd(channel, TEST_LAYER, HOST_LAYER, TEMPLATE, 1, data)
		await amcp.cg.cgPlay(channel, TEST_LAYER, HOST_LAYER)
		await amcp.cg.cgUpdate(channel, TEST_LAYER, HOST_LAYER, data)
		await amcp.mixer.mixerFill(channel, TEST_LAYER, 0, 0, 1, 1)
		await amcp.mixer.mixerOpacity?.(channel, TEST_LAYER, 1).catch(() => {})
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
