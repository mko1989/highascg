'use strict'

/**
 * WO-319 — status endpoint for the GUI live stream.
 *
 * The client live-canvas module calls this to learn whether the feature is available (and which
 * channel it carries) before offering the "Live preview" toggle — connecting is not free (the first
 * client starts the NVENC consumer server-side), so the browser must not offer a dead control.
 */

const { JSON_HEADERS, jsonBody } = require('./response')

/**
 * GET /api/gui-stream/status
 * Handlers must return a { status, headers, body } envelope (see route-registry.js) — a bare object
 * serialises to an empty body, which is exactly what silently hid the toggle the first time.
 * @param {object} ctx app context (`_guiStreamIngest` / `_guiStreamRelay` set by index.js wiring)
 */
function handleGet(ctx) {
	const ingest = ctx?._guiStreamIngest
	const payload = ingest
		? (() => {
				const stats = ingest.stats()
				return {
					ok: true,
					enabled: true,
					channel: stats.channel,
					running: stats.running,
					watching: ctx._guiStreamRelay ? ctx._guiStreamRelay.clientCount() : 0,
					framesIngested: stats.seq,
					lastError: stats.lastError,
				}
			})()
		: { ok: true, enabled: false }
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(payload) }
}

module.exports = { handleGet }
