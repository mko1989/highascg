'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { JSON_HEADERS, jsonBody } = require('../api/response')
const { getMediaIngestBasePath, resolveMediaFileOnDisk } = require('../media/local-media')

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string}
 */
function getBasename(config, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const prefix = String(config?.composePreview?.basenamePrefix || 'highascg_preview').trim() || 'highascg_preview'
	return `${prefix}/ch${ch}`
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string | null}
 */
function resolvePreviewJpgPath(config, channel) {
	const { getComposePreviewJpgBasename } = require('./compose-preview-ffmpeg-args')
	const base = getComposePreviewJpgBasename(config, channel)
	return resolveMediaFileOnDisk(config, base)
}

/**
 * Prefer JPG (ffmpeg_jpeg) then legacy PNG (caspar_image).
 * @param {object} config
 * @param {number} channel
 * @returns {{ path: string, format: 'jpeg' | 'png' } | null}
 */
function resolvePreviewImagePath(config, channel) {
	const jpg = resolvePreviewJpgPath(config, channel)
	if (jpg) return { path: jpg, format: 'jpeg' }
	const png = resolvePreviewPngPath(config, channel)
	if (png) return { path: png, format: 'png' }
	return null
}

/**
 * @param {object} config
 * @param {number} channel
 * @returns {string | null}
 */
function resolvePreviewPngPath(config, channel) {
	const base = getBasename(config, channel)
	return resolveMediaFileOnDisk(config, base) || resolveMediaFileOnDisk(config, `${base}.png`)
}

/**
 * @param {string} fp
 * @returns {Promise<string | null>}
 */
async function sha256File(fp) {
	try {
		const buf = await fs.promises.readFile(fp)
		return crypto.createHash('sha256').update(buf).digest('hex')
	} catch {
		return null
	}
}

/**
 * @param {string} fp
 * @param {number} sinceMs
 * @param {{ timeoutMs?: number, intervalMs?: number, minBytes?: number }} [opts]
 * @returns {Promise<{ path: string, stat: fs.Stats } | null>}
 */
async function waitForPngStable(fp, sinceMs, opts = {}) {
	const timeoutMs = Math.max(100, opts.timeoutMs ?? 2500)
	const intervalMs = Math.max(5, opts.intervalMs ?? 25)
	const minBytes = Math.max(256, opts.minBytes ?? 4096)
	const deadline = Date.now() + timeoutMs
	let lastSize = 0
	let stableReads = 0
	while (Date.now() <= deadline) {
		try {
			const st = await fs.promises.stat(fp)
			if (st.size >= minBytes && st.mtimeMs >= sinceMs - 50) {
				if (st.size === lastSize) {
					stableReads += 1
					if (stableReads >= 2) return { path: fp, stat: st }
				} else {
					stableReads = 0
					lastSize = st.size
				}
			} else {
				stableReads = 0
				lastSize = 0
			}
		} catch {
			stableReads = 0
			lastSize = 0
		}
		await new Promise((r) => setTimeout(r, intervalMs))
	}
	try {
		const st = await fs.promises.stat(fp)
		if (st.size >= minBytes) return { path: fp, stat: st }
	} catch {
		/* ignore */
	}
	return null
}

/**
 * Ensure preview scratch folder exists under media ingest.
 * @param {object} config
 */
async function ensurePreviewDir(config) {
	const prefix = String(config?.composePreview?.basenamePrefix || 'highascg_preview').trim() || 'highascg_preview'
	const dir = path.join(getMediaIngestBasePath(config), prefix.split('/')[0])
	await fs.promises.mkdir(dir, { recursive: true })
}

function etagFromStat(st) {
	return `W/"${Math.floor(st.mtimeMs)}-${st.size}"`
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @returns {Promise<{ status: number, headers: Record<string, string>, body?: Buffer|string }>}
 */
async function handleComposePreviewMetaGet(ctx, channel) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const resolved = resolvePreviewImagePath(cfg, ch)
	if (!resolved) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No compose preview captured yet', channel: ch }),
		}
	}
	try {
		const st = await fs.promises.stat(resolved.path)
		if (st.size <= 32) {
			return {
				status: 404,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Compose preview file empty', channel: ch }),
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				channel: ch,
				format: resolved.format,
				etag: etagFromStat(st),
				mtimeMs: st.mtimeMs,
				size: st.size,
				basename: getBasename(cfg, ch),
			}),
		}
	} catch {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No compose preview captured yet', channel: ch }),
		}
	}
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {Record<string, string>} [query]
 */
async function handleComposePreviewImageGet(ctx, channel, query = {}) {
	const ch = Math.max(1, parseInt(String(channel), 10) || 1)
	const cfg = ctx.config || {}
	const resolved = resolvePreviewImagePath(cfg, ch)
	if (!resolved) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No compose preview captured yet', channel: ch }),
		}
	}
	let st
	try {
		st = await fs.promises.stat(resolved.path)
	} catch {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'No compose preview captured yet', channel: ch }),
		}
	}
	if (st.size <= 32) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'Compose preview file empty', channel: ch }),
		}
	}
	const etag = etagFromStat(st)
	const inm = query['if-none-match'] || query.ifNoneMatch
	if (inm && String(inm).trim() === etag) {
		return { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } }
	}
	const buf = await fs.promises.readFile(resolved.path)
	const contentType = resolved.format === 'jpeg' ? 'image/jpeg' : 'image/png'
	return {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'no-cache',
			ETag: etag,
		},
		body: buf,
	}
}

/** @deprecated use handleComposePreviewImageGet */
async function handleComposePreviewPngGet(ctx, channel, query = {}) {
	return handleComposePreviewImageGet(ctx, channel, query)
}

module.exports = {
	getBasename,
	resolvePreviewPngPath,
	resolvePreviewJpgPath,
	resolvePreviewImagePath,
	waitForPngStable,
	ensurePreviewDir,
	sha256File,
	etagFromStat,
	handleComposePreviewMetaGet,
	handleComposePreviewImageGet,
	handleComposePreviewPngGet,
}
