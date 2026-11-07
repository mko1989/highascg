'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')

async function handleGet(path, ctx) {
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

module.exports = { handleGet }
