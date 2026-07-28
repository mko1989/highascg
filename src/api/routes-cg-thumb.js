'use strict'

const fs = require('fs')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const {
	hashCgThumbRequest,
	cgThumbCachePath,
	ensureCgThumbCacheDir,
	readCgThumbCacheStat,
} = require('../media/cg-look-thumb-cache')
const { renderCgLookThumbPng } = require('../media/cg-look-thumb-render')

/** @type {Map<string, Promise<Buffer>>} */
const _renderLocks = new Map()

/**
 * @param {string} p
 * @param {Record<string, string>} query
 * @param {object} ctx
 */
async function handleGet(p, query, ctx) {
	const m = p.match(/^\/api\/cg-thumb\/([a-f0-9]{16,64})\.png$/)
	if (!m) return null
	const hash = m[1]
	const stat = readCgThumbCacheStat(ctx.config, hash)
	if (!stat.exists) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'CG thumb not found' }) }
	}
	const body = fs.readFileSync(stat.path)
	const etag = `"${hash}-${Math.floor(stat.mtimeMs)}"`
	if (query?.etag === etag || query?.ifNoneMatch === etag) {
		return { status: 304, headers: { ETag: etag }, body: '' }
	}
	return {
		status: 200,
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=60',
			ETag: etag,
		},
		body,
		isBinary: true,
	}
}

/**
 * @param {string} p
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
	if (p !== '/api/cg-thumb/render') return null
	let payload
	try {
		payload = parseBody(body)
	} catch (e) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: e?.message || 'Invalid JSON' }),
		}
	}
	const req = payload && typeof payload === 'object' ? payload : {}
	const hash = hashCgThumbRequest(req)
	const stat = readCgThumbCacheStat(ctx.config, hash)
	if (stat.exists) {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, hash, url: `/api/cg-thumb/${hash}.png`, cached: true }),
		}
	}

	let renderPromise = _renderLocks.get(hash)
	if (!renderPromise) {
		renderPromise = (async () => {
			const png = await renderCgLookThumbPng(req)
			ensureCgThumbCacheDir(ctx.config)
			fs.writeFileSync(cgThumbCachePath(ctx.config, hash), png)
			return png
		})().finally(() => {
			_renderLocks.delete(hash)
		})
		_renderLocks.set(hash, renderPromise)
	}

	try {
		await renderPromise
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, hash, url: `/api/cg-thumb/${hash}.png`, cached: false }),
		}
	} catch (e) {
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({ error: e?.message || String(e) }),
		}
	}
}

module.exports = { handleGet, handlePost }
