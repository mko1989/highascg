'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const {
	handleComposePreviewMetaGet,
	handleComposePreviewImageGet,
	handleComposePreviewPngGet,
	handleComposePreviewCompanionGet,
} = require('../preview/compose-preview-cache')
const ffmpegJpeg = require('../preview/compose-preview-ffmpeg-jpeg')
const {
	isSnapshotComposePreview,
	resolveComposePreviewMode,
	resolveMonitoredChannels,
} = require('../preview/compose-preview-mode')

/**
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {object} ctx
 */
async function handleGet(path, query, ctx) {
	const meta = path.match(/^\/api\/compose-preview\/(\d+)\/meta$/)
	if (meta) return handleComposePreviewMetaGet(ctx, parseInt(meta[1], 10))

	const companion = path.match(/^\/api\/compose-preview\/(\d+)\/companion\.jpg$/)
	if (companion) return handleComposePreviewCompanionGet(ctx, parseInt(companion[1], 10), query)

	const png = path.match(/^\/api\/compose-preview\/(\d+)\.png$/)
	if (png) return handleComposePreviewPngGet(ctx, parseInt(png[1], 10), query)

	const jpg = path.match(/^\/api\/compose-preview\/(\d+)\.jpg$/)
	if (jpg) return handleComposePreviewImageGet(ctx, parseInt(jpg[1], 10), query)

	if (path === '/api/compose-preview/stats') {
		const mode = resolveComposePreviewMode(ctx.config)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				enabled: isSnapshotComposePreview(ctx.config),
				mode,
				...ffmpegJpeg.getFfmpegJpegComposePreviewStats(ctx.config),
				channels: resolveMonitoredChannels(ctx.config),
			}),
		}
	}
	return null
}

/**
 * @param {string} path
 * @param {object} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path !== '/api/compose-preview/refresh') return null
	const channels = resolveMonitoredChannels(ctx.config)
	const { refreshComposePreviewConsumers } = require('../preview/compose-preview-consumer')
	await refreshComposePreviewConsumers(ctx)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, channels }),
	}
}

module.exports = { handleGet, handlePost }
