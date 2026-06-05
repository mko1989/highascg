/**
 * POST /api/cg/:command — add, remove, clear, play, stop, next, goto, update, invoke, info
 * @see companion-module-casparcg-server/src/api-routes.js handleCg
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * @param {string} path
 * @param {string} body
 * @param {{ amcp: import('../caspar/amcp-client').AmcpClient }} ctx
 */
async function handleCg(path, body, ctx) {
	const m = path.match(/^\/api\/cg\/([^/]+)$/)
	if (!m) return null
	const b = parseBody(body)
	const { channel = 1, layer, templateHostLayer = 1 } = b
	const cmd = m[1].toLowerCase()
	const amcp = ctx.amcp
	let r
	switch (cmd) {
		case 'add':
			r = await amcp.cg.cgAdd(channel, layer, b.templateHostLayer ?? templateHostLayer, b.template, !!b.playOnLoad, b.data)
			break
		case 'remove':
			r = await amcp.cg.cgRemove(channel, layer, b.templateHostLayer ?? templateHostLayer)
			break
		case 'clear':
			r = await amcp.cg.cgClear(channel, layer)
			break
		case 'play':
			r = await amcp.cg.cgPlay(channel, layer, b.templateHostLayer ?? templateHostLayer)
			break
		case 'stop':
			r = await amcp.cg.cgStop(channel, layer, b.templateHostLayer ?? templateHostLayer)
			break
		case 'next':
			r = await amcp.cg.cgNext(channel, layer, b.templateHostLayer ?? templateHostLayer)
			break
		case 'goto':
			r = await amcp.cg.cgGoto(channel, layer, b.templateHostLayer ?? templateHostLayer, b.label)
			break
		case 'update':
			r = await amcp.cg.cgUpdate(channel, layer, b.templateHostLayer ?? templateHostLayer, b.data)
			break
		case 'invoke':
			r = await amcp.cg.cgInvoke(channel, layer, b.templateHostLayer ?? templateHostLayer, b.method)
			break
		case 'info':
			r = await amcp.cg.cgInfo(channel, layer, b.templateHostLayer ?? templateHostLayer) // added templateHostLayer
			break
		default:
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Unknown CG command: ${cmd}` }) }
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
}

async function handlePost(path, body, ctx) {
	if (!ctx.amcp) return null
	return handleCg(path, body, ctx)
}

module.exports = { handlePost }
