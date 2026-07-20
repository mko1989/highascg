/**
 * POST /api/pgm/capture — WO-272 operator-GUI capture button: snapshot the on-air PGM channel.
 *
 * Sends CasparCG `PRINT <channel>` for the resolved PGM channel — Caspar writes a timestamped
 * PNG into its media folder on the Caspar host (kept there on purpose: this is an operator
 * snapshot, NOT the live-thumbnail cache path — that one overwrites a single per-channel PNG and
 * deletes the PRINT scratch file, see src/media/live-thumbnail-cache-capture.js).
 *
 * Follows routes-preview-nudge.js conventions: mainIndex preferred, explicit channel accepted
 * only when it IS a program channel; pure resolver exported for the offline smoke test.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getRouteMap } = require('./routes-scene-shared')
const { parsePrintFilenameFromAmcpData } = require('../media/live-thumbnail-cache-capture')

/**
 * Resolve the PGM channel to capture (mainIndex preferred; explicit channel must be a program
 * channel). Program channels are the on-air outputs — playbackChannels is the switcher-bus
 * fallback, matching routes-preview-nudge.js's resolveNudgePgmChannel.
 * Exported for the offline smoke test.
 * @param {object} ctx
 * @param {{ mainIndex?: unknown, channel?: unknown }} b
 * @returns {number | null}
 */
function resolvePgmCaptureChannel(ctx, b) {
	const routeMap = getRouteMap(ctx)
	const mainIdx = b.mainIndex != null ? parseInt(b.mainIndex, 10) : -1
	if (Number.isInteger(mainIdx) && mainIdx >= 0) {
		const ch = Number(routeMap.programChannels?.[mainIdx] ?? routeMap.playbackChannels?.[mainIdx])
		if (Number.isFinite(ch) && ch > 0) return ch
	}
	if (b.channel != null) {
		const ch = parseInt(b.channel, 10)
		const programs = [...(routeMap.programChannels || []), ...(routeMap.playbackChannels || [])]
			.map((p) => Number(p))
			.filter((n) => Number.isFinite(n) && n > 0)
		if (programs.includes(ch)) return ch
	}
	return null
}

/**
 * @param {string} body
 * @param {object} ctx — app context
 */
async function handlePgmCapture(body, ctx) {
	if (!ctx.amcp || typeof ctx.amcp.basic?.print !== 'function') {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const b = parseBody(body)
	const channel = resolvePgmCaptureChannel(ctx, b)
	if (!channel) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Program channel not found for mainIndex/channel' }),
		}
	}

	let res
	try {
		res = await ctx.amcp.basic.print(channel)
	} catch (e) {
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
	}
	if (!res?.ok) {
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'PRINT failed (check Caspar logs)', channel }),
		}
	}

	/* Best-effort: Caspar 2.3+ echoes the written file name — surface it for the client toast. */
	const file = parsePrintFilenameFromAmcpData(res.data)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, channel, file: file || null }),
	}
}

module.exports = {
	handlePgmCapture,
	resolvePgmCaptureChannel,
}
