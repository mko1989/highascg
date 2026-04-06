/**
 * GET /api/state, /api/variables, /api/media, /api/templates, /api/channels, /api/config
 * @see companion-module-casparcg-server/src/api-routes.js handleStateGet
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const filePersistence = require('../utils/persistence')

/** @type {string} */
const VARIABLE_CUSTOM_LABELS_KEY = 'variableCustomLabels'

function getAllVariables(ctx) {
	return ctx.state ? ctx.state.variables : ctx.variables || {}
}

function getPersistence(ctx) {
	return ctx.persistence || filePersistence
}
const { getState } = require('./get-state')
const {
	resolveSafe,
	probeMedia,
	getMediaIngestBasePath,
	scanMediaRecursiveForBrowser,
	normalizeMediaIdKey,
} = require('../media/local-media')
const { dedupeMediaList } = require('../utils/media-browser-dedupe')

/**
 * @param {string} path
 * @param {object} ctx
 * @param {Record<string, string>} [query]
 * @returns {Promise<{ status: number, headers: object, body: string | Buffer } | null>}
 */
async function handleGet(path, ctx, query = {}) {
	switch (path) {
		case '/api/state': {
			const basePath = (ctx.config?.local_media_path || '').trim()
			if (basePath && !ctx._mediaProbePopulating) {
				const media = ctx.CHOICES_MEDIAFILES || []
				if (media.length > 0) {
					ctx._mediaProbePopulating = true
					ctx._mediaProbeCache = ctx._mediaProbeCache || {}
					const toProbe = media
						.filter((c) => {
							const existing = ctx._mediaProbeCache[c.id]
							return !existing?.resolution || (existing?.fps == null && existing?.fps !== 0)
						})
						.slice(0, 120)
					Promise.all(
						toProbe.map(async (c) => {
							const fp = resolveSafe(basePath, c.id)
							if (fp) {
								try {
									const p = await probeMedia(fp)
									if (p && Object.keys(p).length) ctx._mediaProbeCache[c.id] = p
								} catch {}
							}
						}),
					).finally(() => {
						ctx._mediaProbePopulating = false
					})
				}
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(getState(ctx)) }
		}
		case '/api/variables': {
			let v = getAllVariables(ctx)
			const prefix = query.prefix
			if (prefix) {
				const filtered = {}
				for (const k of Object.keys(v)) {
					if (k.startsWith(prefix)) filtered[k] = v[k]
				}
				v = filtered
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(v) }
		}
		case '/api/variables/custom': {
			const labels = getPersistence(ctx).get(VARIABLE_CUSTOM_LABELS_KEY) || {}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ labels }) }
		}
		case '/api/variables/batch': {
			const v = getAllVariables(ctx)
			const categories = (query.categories || '').split(',').filter(Boolean)
			if (categories.length === 0) {
				return { status: 200, headers: JSON_HEADERS, body: jsonBody(v) }
			}
			const result = {}
			for (const cat of categories) {
				const prefix = cat.endsWith('_') ? cat : cat + '_'
				for (const k of Object.keys(v)) {
					if (k.startsWith(prefix)) result[k] = v[k]
				}
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(result) }
		}
		case '/api/media': {
			const stateMedia = ctx.state?.getState?.()?.media || []
			let media =
				stateMedia.length > 0
					? stateMedia
					: (ctx.CHOICES_MEDIAFILES || []).map((c) => ({ id: c.id, label: c.label }))
			// Files on disk under the ingest folder (WeTransfer zip extract, etc.) may lag Caspar CLS — merge them in.
			try {
				const ingestBase = getMediaIngestBasePath(ctx.config)
				const diskIds = scanMediaRecursiveForBrowser(ingestBase)
				if (diskIds.length > 0) {
					const seen = new Set(media.map((m) => normalizeMediaIdKey(m.id)))
					for (const id of diskIds) {
						const key = normalizeMediaIdKey(id)
						if (!seen.has(key)) {
							seen.add(key)
							media.push({ id, label: id })
						}
					}
				}
			} catch {
				/* ignore scan errors */
			}
			const basePath = (ctx.config?.local_media_path || '').trim() || getMediaIngestBasePath(ctx.config)
			if (basePath) {
				ctx._mediaProbeCache = ctx._mediaProbeCache || {}
				const toProbe = media
					.filter((m) => !m.resolution || (m.fps == null && m.fps !== 0))
					.slice(0, 120)
				await Promise.all(
					toProbe.map(async (m) => {
						const fp = resolveSafe(basePath, m.id)
						if (fp) {
							const probed = await probeMedia(fp)
							if (Object.keys(probed).length) ctx._mediaProbeCache[m.id] = probed
						}
					}),
				)
				media = media.map((m) => ({ ...m, ...(ctx._mediaProbeCache[m.id] || {}) }))
			}
			media = dedupeMediaList(media)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(media) }
		}
		case '/api/templates':
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody((ctx.CHOICES_TEMPLATES || []).map((c) => ({ id: c.id, label: c.label }))),
			}
		case '/api/channels':
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					ids: ctx.gatheredInfo?.channelIds || [],
					status: ctx.gatheredInfo?.channelStatusLines || {},
					channelXml: ctx.gatheredInfo?.channelXml || {},
				}),
			}
		case '/api/config':
			return {
				status: 200,
				headers: { 'Content-Type': 'text/xml' },
				body: ctx.gatheredInfo?.infoConfig || '',
			}
		case '/api/fonts': {
			if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
			const r = await ctx.amcp.query.fls()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/server': {
			if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
			const r = await ctx.amcp.query.infoServer()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/server/queues': {
			if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
			const r = await ctx.amcp.query.infoQueues()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/server/threads': {
			if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
			const r = await ctx.amcp.query.infoThreads()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/server/gl': {
			if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
			const r = await ctx.amcp.query.glInfo()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
		case '/api/help': {
			if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
			const r = await ctx.amcp.query.help()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		}
	}

	let m
	if ((m = path.match(/^\/api\/channels\/(\d+)$/))) {
		if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		const r = await ctx.amcp.query.infoChannel(m[1])
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
	}
	if ((m = path.match(/^\/api\/channels\/(\d+)\/delay$/))) {
		if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		const r = await ctx.amcp.query.infoDelay(m[1])
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
	}
	if ((m = path.match(/^\/api\/help\/(.+)$/))) {
		if (!ctx.amcp) return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		const cmd = decodeURIComponent(m[1])
		const r = await ctx.amcp.query.help(cmd)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
	}

	return null
}

/**
 * POST /api/variables/batch — body `{ keys: string[] }` returns only those variable values (max 2000 keys).
 * POST /api/variables/custom — body `{ labels: { [varKey]: string | null } }` merges user-facing labels (persisted).
 *
 * @param {string} path
 * @param {string|Buffer|object} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	const b = parseBody(body)
	if (path === '/api/variables/batch') {
		const keys = Array.isArray(b.keys) ? b.keys : []
		if (keys.length > 2000) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Too many keys (max 2000)' }),
			}
		}
		const v = getAllVariables(ctx)
		const out = {}
		for (const k of keys) {
			if (typeof k !== 'string' || k.length > 256) continue
			if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = v[k]
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
	}
	if (path === '/api/variables/custom') {
		if (!b.labels || typeof b.labels !== 'object' || Array.isArray(b.labels)) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Expected { labels: { [variableKey]: string | null } }' }),
			}
		}
		const store = getPersistence(ctx)
		const cur = store.get(VARIABLE_CUSTOM_LABELS_KEY) || {}
		const merged = { ...cur }
		for (const [k, val] of Object.entries(b.labels)) {
			if (typeof k !== 'string' || k.length > 256) continue
			if (val === null || val === '') delete merged[k]
			else if (typeof val === 'string') merged[k] = val.slice(0, 500)
		}
		store.set(VARIABLE_CUSTOM_LABELS_KEY, merged)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, labels: merged }) }
	}
	return null
}

module.exports = { handleGet, handlePost }
