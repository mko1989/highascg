/**
 * WO-575 — POST/GET /api/media/hap-encode[/probe|/cancel]: media-browser "Encode to HAP".
 * The queue (src/media/hap-encode-queue.js) does the work; these handlers only validate and delegate.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { HapEncodeQueue } = require('../media/hap-encode-queue')

const MAX_IDS = 500

/** One queue per app context, created on first use. */
function getQueue(ctx) {
	if (!ctx._hapEncodeQueue) ctx._hapEncodeQueue = new HapEncodeQueue(ctx)
	return ctx._hapEncodeQueue
}

function reply(status, body) {
	return { status, headers: JSON_HEADERS, body: jsonBody(body) }
}

/** @returns {string[] | null} trimmed unique ids, or null when the body has none */
function readIds(b) {
	const raw = Array.isArray(b.ids) ? b.ids : b.id != null ? [b.id] : []
	const ids = [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))]
	return ids.length ? ids : null
}

async function handleHapEncodeStart(body, ctx) {
	const b = parseBody(body)
	const ids = readIds(b)
	if (!ids) return reply(400, { error: 'ids required' })
	if (ids.length > MAX_IDS) return reply(400, { error: `at most ${MAX_IDS} files per batch` })
	const job = getQueue(ctx).enqueue({ ids, alpha: b.alpha === true, hq: b.hq === true })
	return reply(202, { ok: true, ...job })
}

/**
 * WO-603: the on-air warning's input, decided here (web isAnythingPlaying read the client's copy of the matrix):
 * anything playing on any channel/layer of the server playback matrix.
 */
function isAnythingPlaying(ctx) {
	try {
		const matrix = require('../state/playback-tracker').getMatrixForState(ctx) || {}
		return Object.values(matrix).some((cell) => cell && cell.playing)
	} catch {
		return false
	}
}

async function handleHapEncodeProbe(body, ctx) {
	const b = parseBody(body)
	const ids = readIds(b)
	if (!ids) return reply(400, { error: 'ids required' })
	if (ids.length > MAX_IDS) return reply(400, { error: `at most ${MAX_IDS} files per batch` })
	return reply(200, { ok: true, items: await getQueue(ctx).probeFiles(ids), onAir: isAnythingPlaying(ctx) })
}

async function handleHapEncodeState(ctx) {
	return reply(200, { ok: true, jobs: ctx._hapEncodeQueue ? ctx._hapEncodeQueue.list() : [] })
}

async function handleHapEncodeCancel(body, ctx) {
	const jobId = String(parseBody(body).jobId || '').trim()
	if (!jobId) return reply(400, { error: 'jobId required' })
	const ok = ctx._hapEncodeQueue ? ctx._hapEncodeQueue.cancel(jobId) : false
	return ok ? reply(200, { ok: true }) : reply(404, { error: 'unknown jobId' })
}

module.exports = { isAnythingPlaying, handleHapEncodeStart, handleHapEncodeProbe, handleHapEncodeState, handleHapEncodeCancel }
