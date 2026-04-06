/**
 * GET thumbnails, local-media probe/waveform, POST media refresh.
 * @see companion-module-casparcg-server/src/api-routes.js handleThumbnail, handleMediaRefresh
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { tryLocalThumbnailPng, handleLocalMedia: serveLocalMedia } = require('../media/local-media')
const { runMediaClsTlsRefresh } = require('../utils/periodic-sync')

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

	const maxW = Math.min(1920, Math.max(64, parseInt(String(query.w ?? ''), 10) || 720))
	const localBuf = await tryLocalThumbnailPng(ctx.config || {}, filename, maxW)
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

async function handleLocalMedia(path, ctx) {
	return serveLocalMedia(path, ctx.config || {})
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
	if (path === '/api/media/refresh') return handleMediaRefresh(body, ctx)
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

module.exports = { handleThumbnail, handleLocalMedia, handlePost, handleMediaRefresh }
