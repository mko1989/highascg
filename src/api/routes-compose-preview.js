'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const {
	handleComposePreviewMetaGet,
	handleComposePreviewImageGet,
	handleComposePreviewPngGet,
} = require('../preview/compose-preview-cache')
const composeTick = require('../preview/compose-preview-tick')
const ffmpegJpeg = require('../preview/compose-preview-ffmpeg-jpeg')
const { isSnapshotComposePreview, resolveComposePreviewMode } = require('../preview/compose-preview-mode')

/**
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {object} ctx
 */
async function handleGet(path, query, ctx) {
	const meta = path.match(/^\/api\/compose-preview\/(\d+)\/meta$/)
	if (meta) return handleComposePreviewMetaGet(ctx, parseInt(meta[1], 10))

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
				...(mode === 'ffmpeg_jpeg'
					? ffmpegJpeg.getFfmpegJpegComposePreviewStats(ctx.config)
					: composeTick.getComposePreviewStats(ctx.config)),
				channels: composeTick.resolveMonitoredChannels(ctx.config),
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
	const channels = composeTick.resolveMonitoredChannels(ctx.config)
	if (resolveComposePreviewMode(ctx.config) === 'ffmpeg_jpeg') {
		const consumer = require('../preview/compose-preview-consumer')
		const receiver = require('../preview/compose-preview-receiver')
		receiver.startAllComposePreviewReceivers(ctx)
		await consumer.attachAllComposeFileConsumers(ctx)
	} else {
		composeTick.forceAllDirty(channels)
		if (ctx.amcp && composeTick.isComposePreviewTickEnabled(ctx.config)) {
			await composeTick.runComposePreviewTick(ctx)
		}
	}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, channels }),
	}
}

module.exports = { handleGet, handlePost }
