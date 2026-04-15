/**
 * GET thumbnails, local-media probe/waveform, POST media refresh.
 * @see companion-module-casparcg-server/src/api-routes.js handleThumbnail, handleMediaRefresh
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { parseCinfMedia } = require('../media/cinf-parse')
const {
	tryLocalThumbnailPng,
	handleLocalMedia: serveLocalMedia,
	handleDeleteLocalMedia: deleteLocalMediaFile,
	unlinkMediaById,
	resolveMediaFileOnDisk,
	probeMedia,
} = require('../media/local-media')
const { runMediaClsTlsRefresh } = require('../utils/periodic-sync')

function cinfResponseToStr(data) {
	if (data == null) return ''
	if (Array.isArray(data)) return data.join('\n')
	return String(data)
}

async function handleThumbnail(path, query, ctx) {
	if (path === '/api/thumbnails') {
		if (!ctx.amcp) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}
		const r = await ctx.amcp.thumbnailList()
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
	}

	let filename = null
	const m = path.match(/^\/api\/thumbnail(?:s?)\/([^/]+)$/)
	if (m) {
		filename = m[1]
		try {
			filename = decodeURIComponent(filename.replace(/\+/g, ' '))
		} catch {
			/* use raw */
		}
	} else if (path === '/api/thumbnail' && query && (query.filename || query.file)) {
		const raw = String(query.filename || query.file)
		try {
			filename = decodeURIComponent(raw.replace(/\+/g, ' '))
		} catch {
			filename = raw
		}
	}

	if (filename == null || filename === '') return null

	const maxW = Math.min(1920, Math.max(64, parseInt(String(query.w ?? ''), 10) || 960))
	const seekSec = Math.max(0, parseFloat(String(query.t ?? '')) || 2)
	const localBuf = await tryLocalThumbnailPng(ctx.config || {}, filename, maxW, seekSec)
	if (localBuf && localBuf.length) {
		return { status: 200, headers: { 'Content-Type': 'image/png' }, body: localBuf }
	}
	try {
		if (!ctx.amcp) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}
		const r = await ctx.amcp.thumbnailRetrieve(filename)
		const raw = r?.data
		let base64 = null
		if (Array.isArray(raw)) base64 = raw.join('').replace(/\s/g, '')
		else if (typeof raw === 'string' && raw.length > 100) base64 = raw.replace(/\s/g, '')
		if (base64 && /^[A-Za-z0-9+/=]+$/.test(base64)) {
			const buf = Buffer.from(base64, 'base64')
			return { status: 200, headers: { 'Content-Type': 'image/png' }, body: buf }
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
	} catch (e) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || 'Thumbnail not found' }) }
	}
}

async function handleLocalMedia(path, query, ctx) {
	return serveLocalMedia(path, ctx.config || {}, query || {})
}

/**
 * DELETE /api/local-media/:encodedId
 * @param {string} path
 * @param {object} ctx
 */
async function handleDeleteLocalMedia(path, ctx) {
	const r = await deleteLocalMediaFile(path, ctx.config || {})
	if (!r) return null
	if (r.status === 200 && typeof ctx.runMediaLibraryQueryCycle === 'function') ctx.runMediaLibraryQueryCycle()
	return r
}

/**
 * @param {object} ctx
 * @param {string} id - media id / relative path
 * @returns {Promise<number>}
 */
async function probeDurationMsFromLocalFiles(ctx, id) {
	const fp = resolveMediaFileOnDisk(ctx.config || {}, id)
	if (!fp) return 0
	const probed = await probeMedia(fp)
	return probed?.durationMs > 0 ? probed.durationMs : 0
}

async function handleMediaRefresh(body, ctx) {
	if (!ctx.amcp?.query) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}
	const fn = ctx.runMediaLibraryQueryCycle || ctx.runConnectionQueryCycle
	if (fn && typeof fn === 'function') {
		fn.call(ctx)
	} else {
		runMediaClsTlsRefresh(ctx).catch((e) => {
			if (typeof ctx.log === 'function') ctx.log('warn', 'Media library refresh: ' + (e?.message || e))
		})
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, message: 'Media refresh initiated' }) }
}

async function handlePost(path, body, ctx) {
	if (path === '/api/media/delete') {
		const b = parseBody(body)
		const id = (b.id || '').trim()
		if (!id) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'id required' }) }
		const r = await unlinkMediaById(ctx.config || {}, id)
		if (r.status === 200 && typeof ctx.runMediaLibraryQueryCycle === 'function') ctx.runMediaLibraryQueryCycle()
		return r
	}
	if (path === '/api/media/refresh') return handleMediaRefresh(body, ctx)
	if (path === '/api/media/cinf') {
		const b = parseBody(body)
		const id = (b.id || b.filename || '').trim()
		if (!id) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'id or filename required' }) }
		}
		if (!ctx.amcp?.query?.cinf) {
			const durationMs = await probeDurationMsFromLocalFiles(ctx, id)
			if (durationMs > 0) {
				return {
					status: 200,
					headers: JSON_HEADERS,
					body: jsonBody({ ok: true, id, durationMs, cinf: '', source: 'ffprobe' }),
				}
			}
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}
		try {
			const res = await ctx.amcp.query.cinf(id)
			const cinf = cinfResponseToStr(res?.data)
			const parsed = parseCinfMedia(cinf)
			let durationMs = parsed.durationMs
			if (!durationMs || durationMs <= 0) {
				durationMs = await probeDurationMsFromLocalFiles(ctx, id)
			}
			if (ctx.mediaDetails && typeof ctx.mediaDetails === 'object') {
				ctx.mediaDetails[id] = cinf
			}
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, id, cinf, ...parsed, ...(durationMs > 0 ? { durationMs } : {}) }),
			}
		} catch (e) {
			const durationMs = await probeDurationMsFromLocalFiles(ctx, id)
			if (durationMs > 0) {
				return {
					status: 200,
					headers: JSON_HEADERS,
					body: jsonBody({
						ok: true,
						id,
						durationMs,
						cinf: '',
						source: 'ffprobe',
						warn: String(e?.message || 'CINF failed'),
					}),
				}
			}
			return {
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: e?.message || 'CINF failed' }),
			}
		}
	}
	if (path === '/api/thumbnails/generate') {
		if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		const b = typeof body === 'object' ? body : JSON.parse(body || '{}') // body is usually parsed by caller, wait... parseBody is in response.js
		// let's require parseBody correctly
		const parsed = require('./response').parseBody(body)
		if (!parsed.filename) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'filename required' }) }
		const r = await ctx.amcp.thumbnailGenerate(parsed.filename)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
	}
	if (path === '/api/thumbnails/generate-all') {
		if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		const r = await ctx.amcp.thumbnailGenerateAll()
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
	}
	return null
}

module.exports = { handleThumbnail, handleLocalMedia, handleDeleteLocalMedia, handlePost, handleMediaRefresh }
