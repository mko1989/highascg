'use strict'

/**
 * WO-734 — `GET /api/show-timers` (the timers as JSON) and `GET /api/show-timers/widget.js` (the strip the served pages
 * include: `<div id="show-timers"></div><script src="/api/show-timers/widget.js"></script>`).
 */

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody } = require('../api/response')
const { resolveCompanionConfig } = require('../companion/companion-config')
const { buildChannelMap } = require('../config/channel-map-from-ctx')
const { createShowTimers } = require('./show-timers-service')

const WIDGET = path.join(__dirname, 'widget.js')

function serviceOf(ctx) {
	if (!ctx._showTimers) {
		ctx._showTimers = createShowTimers({
			companionBase: () => {
				const c = resolveCompanionConfig(ctx.config)
				return `http://${c.host}:${c.port}`
			},
			osc: () => (ctx.oscState && typeof ctx.oscState.getSnapshot === 'function' ? ctx.oscState.getSnapshot() : {}),
			channelMap: () => buildChannelMap(ctx),
			banks: () => ctx.programLayerBankByChannel || {},
		})
	}
	return ctx._showTimers
}

async function handle(method, p, ctx) {
	if (method !== 'GET') return null
	if (p === '/api/show-timers') {
		return { status: 200, headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' }, body: jsonBody(await serviceOf(ctx).snapshot()) }
	}
	if (p === '/api/show-timers/widget.js') {
		return {
			status: 200,
			headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
			body: fs.readFileSync(WIDGET, 'utf8'),
		}
	}
	return null
}

module.exports = { handle }
