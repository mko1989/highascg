'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { listNdiSources } = require('../streaming/ndi-resolve')

async function handleGet(path, ctx) {
	if (path === '/api/streaming/ndi-sources') {
		const r = listNdiSources()
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: r.ok,
				sources: r.sources,
				error: r.error,
			}),
		}
	}
	if (path === '/api/streams') {
		const pipelineReady = !!ctx?.streamingPipelineReady
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				streams: [],
				isRunning: false,
				pipelineReady,
				config: {},
				effectiveBasePort:
					ctx?.config?.streaming?._effectiveBasePort ?? ctx?.config?.streaming?.basePort,
			})
		}
	}
	return null
}

async function handlePost(path, body, ctx) {
	const b = parseBody(body)

	if (path === '/api/streaming/toggle') {
		// Normal startup: `index.js` assigns `ctx.toggleStreaming` from `streaming-lifecycle.js`.
		// This error only appears if context was built without those hooks (tests / minimal harness).
		if (ctx.toggleStreaming) {
			await ctx.toggleStreaming(!!b.enabled)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, enabled: !!b.enabled }) }
		}
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'toggleStreaming not available on server context' }) }
	}

	if (path === '/api/streaming/restart') {
		if (ctx.restartStreaming) {
			await ctx.restartStreaming()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		}
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'restartStreaming not available on server context' }) }
	}

	return null
}

module.exports = { handleGet, handlePost }
