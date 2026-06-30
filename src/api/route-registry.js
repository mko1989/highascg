'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')

class RouteRegistry {
	constructor() {
		this.routes = []
	}

	/**
	 * Register a route handler.
	 * @param {string} method HTTP method (GET, POST, etc.)
	 * @param {string} path Path to match (supports :param and trailing *)
	 * @param {Function} handler Async function returning { status, headers, body }
	 * @param {object} options Additional options (e.g., { requireCaspar: true })
	 */
	add(method, path, handler, options = {}) {
		const keys = []
		let regexString = '^'
		
		// Split by slash and build regex
		const parts = path.split('/')
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i]
			if (part === '') continue

			regexString += '\\/'
			
			if (part.startsWith(':')) {
				keys.push(part.substring(1))
				regexString += '([^\\/]+)'
			} else if (part === '*') {
				keys.push('*')
				regexString += '(.*)'
			} else {
				// Escape regex chars in normal parts
				regexString += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			}
		}

		if (path === '/') {
			regexString += '\\/'
		}

		// Allow optional trailing slash if not a wildcard ending
		if (!path.endsWith('*')) {
			regexString += '\\/?$'
		} else {
			regexString += '$'
		}

		const regex = new RegExp(regexString)
		this.routes.push({ method, path, regex, keys, handler, options })
	}

	get(path, handler, options) { this.add('GET', path, handler, options) }
	post(path, handler, options) { this.add('POST', path, handler, options) }
	delete(path, handler, options) { this.add('DELETE', path, handler, options) }

	/**
	 * Dispatch a request through the registered routes.
	 * Returns null if no route matches.
	 */
	async dispatch(method, path, body, ctx, req, query) {
		for (const route of this.routes) {
			if (route.method !== method) continue

			const match = path.match(route.regex)
			if (match) {
				// Check Caspar requirement middleware
				if (route.options.requireCaspar && (!ctx || !ctx.amcp)) {
					return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
				}

				// Extract parameters
				const params = {}
				route.keys.forEach((key, index) => {
					// Don't decodeURIComponent on wildcards since they often contain full paths
					if (key === '*') {
						params[key] = match[index + 1]
					} else {
						try {
							params[key] = decodeURIComponent(match[index + 1])
						} catch (e) {
							params[key] = match[index + 1]
						}
					}
				})

				// Execute handler. We pass 'p' (which is 'path') exactly as before for backwards compatibility
				// inside the route files, alongside the new 'params' object.
				return await route.handler({ method, path, body, ctx, req, query, params })
			}
		}
		return null
	}
}

module.exports = { RouteRegistry }
