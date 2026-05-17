/**
 * Settings API Router.
 */
'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')
const { getDisplayDetails } = require('../utils/hardware-info')
const { buildModelinePreview, normalizeTimingKind } = require('../utils/modeline-timings')
const Get = require('./settings-get')
const Post = require('./settings-post')
const OS = require('./settings-os')

async function handleGet(path, ctx) {
	return Get.handleGet(path, ctx)
}

async function handleHardwareGet(path, query = {}) {
	if (path === '/api/hardware/displays') {
		try { const displays = getDisplayDetails(); return { status: 200, headers: JSON_HEADERS, body: jsonBody({ displays }) } } catch { return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'Failed to enum displays' }) } }
	}
	if (path === '/api/hardware/modeline-preview') {
		try {
			const w = parseInt(String(query.w ?? '0'), 10)
			const h = parseInt(String(query.h ?? '0'), 10)
			const rate = parseFloat(String(query.rate ?? '60'))
			const type = normalizeTimingKind(query.type || 'cvt')
			if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64 || w > 8192 || h > 8192) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid w/h (64–8192)' }) }
			}
			if (!Number.isFinite(rate) || rate <= 0 || rate > 240) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid rate (0–240 Hz)' }) }
			}
			const preview = buildModelinePreview(type, w, h, rate)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(preview) }
		} catch (e) {
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: String(e?.message || e) }) }
		}
	}
	return null
}

async function handlePost(path, body, ctx) {
	return Post.handlePost(path, body, ctx)
}

async function handleOsPost(path, body, ctx) {
	return OS.handleOsPost(path, body, ctx)
}

module.exports = { handleGet, handlePost, handleHardwareGet, handleOsPost }
