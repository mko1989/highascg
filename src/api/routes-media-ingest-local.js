'use strict'

/**
 * WO-603 slice 1 — POST /api/media/ingest-local { paths[], folder? }: copy files dropped on the on-box Godot client
 * from their local paths into the media library (src/media/local-ingest.js). Runs in the background: 202 + state at
 * GET /api/media/ingest-local, progress over WS `media:ingest-progress`, POST /api/media/ingest-local/cancel.
 *
 * Loopback only — a path on this box only means something to a client running on it, and a remote caller must never
 * be able to pull arbitrary local files into the (downloadable) media library. Remote clients upload over HTTP.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const persistence = require('../utils/persistence')
const { planLocalIngest, resolveTarget, copyPlanned } = require('../media/local-ingest')
const { getMediaIngestBasePath } = require('../media/local-media')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

function isLoopback(req) {
	const ip = String(req?.socket?.remoteAddress || '').replace(/^::ffff:/, '')
	return ip === '127.0.0.1' || ip === '::1'
}

function state(ctx) {
	if (!ctx._localIngest) ctx._localIngest = { active: false, phase: 'idle' }
	return ctx._localIngest
}

function setState(ctx, patch) {
	Object.assign(state(ctx), patch, { updatedAt: Date.now() })
	if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('media:ingest-progress', { ...state(ctx) })
}

/** GET /api/media/ingest-local */
function handleState(ctx) {
	return reply(200, { ...state(ctx) })
}

/** POST /api/media/ingest-local */
async function handleStart(req, body, ctx) {
	if (!isLoopback(req)) return reply(403, { error: 'Local-path ingest is for a client on this machine — upload instead.' })
	if (state(ctx).active) return reply(409, { error: 'An ingest is already running.' })
	const b = parseBody(body)
	const config = ctx.config || {}
	const target = resolveTarget(config, b.folder, persistence)
	if (target.error) return reply(target.status, { error: target.error })
	const plan = planLocalIngest(b.paths, getMediaIngestBasePath(config))
	if (plan.error) return reply(plan.status, { error: plan.error })
	if (typeof ctx.log === 'function') {
		ctx.log('info', `[media] ingest-local ${plan.files.length} file(s) → "${target.folder || '/'}" from ${JSON.stringify(b.paths)}`)
	}
	const cancel = { cancelled: false }
	ctx._localIngestCancel = cancel
	const total = plan.files.reduce((a, f) => a + f.bytes, 0)
	setState(ctx, { active: true, phase: 'copying', folder: target.folder, fileTotal: plan.files.length, bytesTotal: total, bytesDone: 0, error: null, message: '' })
	let last = 0
	;(async () => {
		try {
			const r = await copyPlanned(plan, target.dir, {
				isCancelled: () => cancel.cancelled,
				report: (p) => {
					if (Date.now() - last < 250) return
					last = Date.now()
					setState(ctx, p)
				},
			})
			const extra = [r.unzipped ? `${r.unzipped} zip(s) unpacked` : '', plan.skipped ? `${plan.skipped} link(s)/special file(s) skipped` : ''].filter(Boolean)
			setState(ctx, { active: false, phase: 'complete', bytesDone: r.bytes, imported: r.imported, message: `Imported ${r.imported} file(s)${extra.length ? ` · ${extra.join(' · ')}` : ''}` })
		} catch (e) {
			setState(ctx, { active: false, phase: cancel.cancelled ? 'cancelled' : 'error', error: e?.message || String(e), message: cancel.cancelled ? 'Ingest cancelled' : 'Ingest failed' })
		} finally {
			ctx._localIngestCancel = null
			if (typeof ctx.runMediaLibraryQueryCycle === 'function') ctx.runMediaLibraryQueryCycle()
		}
	})()
	return reply(202, { ok: true, files: plan.files.length, bytes: total, folder: target.folder, skipped: plan.skipped })
}

/** POST /api/media/ingest-local/cancel */
function handleCancel(ctx) {
	if (!ctx._localIngestCancel) return reply(409, { error: 'No ingest running.' })
	ctx._localIngestCancel.cancelled = true
	return reply(200, { ok: true })
}

module.exports = { handleState, handleStart, handleCancel, isLoopback }
