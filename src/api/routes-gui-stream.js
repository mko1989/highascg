'use strict'

/**
 * WO-319 — status endpoint for the GUI live stream.
 *
 * The client compose-preview module calls this ONCE to learn which channel the stream carries
 * before deciding whether to open the binary WS at all — connecting is not free (the first client
 * starts the NVENC consumer server-side), so the browser must not connect speculatively when no
 * visible preview cell shows the streamed channel.
 */

/**
 * GET /api/gui-stream/status
 * @param {object} ctx app context (`_guiStreamIngest` / `_guiStreamRelay` set by index.js wiring)
 */
function handleGet(ctx) {
	const ingest = ctx?._guiStreamIngest
	if (!ingest) return { ok: true, enabled: false }
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
}

module.exports = { handleGet }
