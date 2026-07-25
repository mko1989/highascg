/**
 * Route request dispatch (split from `router.js`).
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody, parseQueryString } = require('./response')

const routesAmcp = require('./routes-amcp')
const routesMixer = require('./routes-mixer')
const routesCg = require('./routes-cg')
const routesData = require('./routes-data')
const routesMultiview = require('./routes-multiview')
const routesScene = require('./routes-scene')
const routesMisc = require('./routes-misc')
const routesTimeline = require('./routes-timeline')
const routesProject = require('./routes-project')
const routesLedTestCard = require('./routes-led-test-card')
const { applyUiSelectionPayloadToVariables } = require('./apply-ui-selection-variables')
const routesFtb = require('./routes-ftb')
const routesPipOverlay = require('./routes-pip-overlay')
const routesMedia = require('./routes-media')
const routesPlugins = require('./routes-plugins')
const moduleRegistry = require('../module-registry')
const { checkHttpAuth } = require('../server/auth')

/**
 * Build the route request entry point bound to a RouteRegistry.
 * @param {import('./route-registry').RouteRegistry} routes
 */
function makeRouteRequest(routes) {
	/**
	 * Route request entry point.
	 * @param {string} method
	 * @param {string} path
	 * @param {string} body
	 * @param {import('http').IncomingMessage} req
	 */
	return async function routeRequest(method, path, body, ctx, req) {
		const pathRaw = path || ''
		const qIdx = pathRaw.indexOf('?')
		const query = parseQueryString(qIdx >= 0 ? pathRaw.slice(qIdx + 1) : '')
		let p = qIdx >= 0 ? pathRaw.slice(0, qIdx) : pathRaw

		const instanceMatch = p.match(/^\/instance\/[^/]+\/(.+)$/)
		if (instanceMatch) p = '/' + instanceMatch[1]

		if (!p.startsWith('/api/')) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
		}

		const authResult = checkHttpAuth(method, p, req, ctx)
		if (!authResult.ok) {
			return {
				status: authResult.status || 401,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: authResult.error || 'Unauthorized' }),
			}
		}

		if (method === 'POST' && p === '/api/selection') {
			try {
				const payload = parseBody(body)
				if (ctx.state) applyUiSelectionPayloadToVariables(ctx.state, payload && typeof payload === 'object' ? payload : {})
				return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e)
				return { status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: msg }) }
			}
		}

		// Module hook handled explicitly before standard routes
		const mr = await moduleRegistry.handleApi(method, p, body, ctx, req, query)
		if (mr) return mr

		const pg = await routesPlugins.handleGet(method, p, ctx)
		if (pg) return pg

		const pgPost = await routesPlugins.handlePost(method, p, body, ctx)
		if (pgPost) return pgPost

		try {
			// Dispatch to RouteRegistry
			const result = await routes.dispatch(method, p, body, ctx, req, query)
			if (result) return result
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}

		// Registry `/*` patterns require a trailing segment (`/api/foo/bar`), not bare `/api/foo`.
		// Keep legacy exact-path dispatch for AMCP basics, LED test card, FTB, timelines, etc.
		if (ctx.amcp) {
			try {
				if (method === 'POST') {
					let r = await routesAmcp.handlePost(p, body, ctx)
					if (r) return r
					r = await routesMixer.handlePost(p, body, ctx)
					if (r) return r
					r = await routesLedTestCard.handlePost(p, body, ctx)
					if (r) return r
					r = await routesFtb.handlePost(p, body, ctx)
					if (r) return r
					r = await routesPipOverlay.handlePost(p, body, ctx)
					if (r) return r
					r = await routesCg.handlePost(p, body, ctx)
					if (r) return r
					r = await routesData.handlePost(p, body, ctx)
					if (r) return r
					r = await routesMedia.handlePost(p, body, ctx, req, query)
					if (r) return r
					r = await routesMultiview.handlePost(p, body, ctx)
					if (r) return r
					r = await routesScene.handlePost(p, body, ctx)
					if (r) return r
					r = await routesProject.handlePost(p, body, ctx)
					if (r) return r
					r = await routesMisc.handlePost(p, body, ctx)
					if (r) return r
				}

				const tlResult = await routesTimeline.handle(method, p, body, ctx)
				if (tlResult) return tlResult
			} catch (e) {
				const msg = e?.message || String(e)
				return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
			}
		}

		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
	}
}

module.exports = {
	makeRouteRequest,
}
