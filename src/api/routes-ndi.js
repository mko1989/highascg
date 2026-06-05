'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')

/**
 * @param {string} path
 * @param {object} ctx
 * @param {Record<string, string>} query
 */
async function handleGet(path, ctx, query) {
	if (path !== '/api/ndi/list') return null

	const amcp = ctx.amcp
	if (!amcp) {
		return {
			status: 503,
			headers: JSON_HEADERS,
			body: jsonBody({ error: 'AMCP client not available' })
		}
	}

	try {
		const res = await amcp.raw('NDI LIST')
		let rawStr = ''
		let sources = []

		if (res && Array.isArray(res.data)) {
			sources = res.data.map(l => {
				const match = l.match(/"([^"]+)"/)
				if (match) {
					const fullName = match[1]
					const nameMatch = fullName.match(/^([^(]+)\(([^)]+)\)$/)
					if (nameMatch) {
						const machine = nameMatch[1].trim().toLowerCase()
						const source = nameMatch[2].trim()
						return `ndi://${machine}/"${source}"`
					}
				}
				return l.trim()
			}).filter(Boolean)
		} else {
			if (typeof res === 'string') rawStr = res
			else if (res && typeof res.response === 'string') rawStr = res.response
			else if (res && typeof res.data === 'string') rawStr = res.data
			else if (Array.isArray(res)) rawStr = res.join('\n')
			else rawStr = JSON.stringify(res)

			const lines = rawStr.split('\n').map(l => l.trim()).filter(Boolean)
			sources = lines.filter(l => !/^\d{3}\s+/.test(l))
				.map(l => {
					const match = l.match(/"([^"]+)"/)
					if (match) {
						const fullName = match[1]
						const nameMatch = fullName.match(/^([^(]+)\(([^)]+)\)$/)
						if (nameMatch) {
							const machine = nameMatch[1].trim().toLowerCase()
							const source = nameMatch[2].trim()
							return `ndi://${machine}/"${source}"`
						}
					}
					return l.trim()
				}).filter(Boolean)
		}

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ sources })
		}
	} catch (e) {
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `Failed to list NDI sources: ${e.message}` })
		}
	}
}

module.exports = { handleGet }
