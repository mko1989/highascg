'use strict'

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getSatellitePreviewClient } = require('../companion/satellite-preview-client')
const { readPreviewJpeg, getPreviewMeta, previewUrl } = require('../companion/button-preview-cache')
const { resolveCompanionConfig } = require('../companion/companion-config')
const { randomUUID } = require('crypto')

const JPEG_HEADERS = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=2' }

function parseLocationParams(pageStr, rowStr, colStr) {
	const page = parseInt(String(pageStr), 10)
	const row = parseInt(String(rowStr), 10)
	const column = parseInt(String(colStr), 10)
	if (!Number.isFinite(page) || !Number.isFinite(row) || !Number.isFinite(column)) return null
	if (page < 1) return null
	return { page, row, column }
}

function broadcastPreview(ctx, payload) {
	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('companion.buttonPreview', payload)
	}
}

function wirePreviewBroadcast(ctx) {
	const client = getSatellitePreviewClient()
	if (client._broadcastWired) return
	client._broadcastWired = true
	client.on('preview', (payload) => broadcastPreview(ctx, payload))
}

async function handleGet(path, ctx) {
	wirePreviewBroadcast(ctx)

	if (path === '/api/companion/button-preview/status') {
		const client = getSatellitePreviewClient()
		client.configure(ctx.config)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody(client.getStatus()),
		}
	}

	const imgMatch = path.match(/^\/api\/companion\/button-preview\/(-?\d+)\/(-?\d+)\/(-?\d+)\.jpg$/)
	if (imgMatch) {
		const loc = parseLocationParams(imgMatch[1], imgMatch[2], imgMatch[3])
		if (!loc) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid location' }) }
		const client = getSatellitePreviewClient()
		await client.ensureSubscribed(ctx.config, loc.page, loc.row, loc.column, { waitMs: 1500 })
		const hit = readPreviewJpeg(loc.page, loc.row, loc.column)
		if (!hit) {
			return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Preview not ready', url: previewUrl(loc.page, loc.row, loc.column) }) }
		}
		return {
			status: 200,
			headers: { ...JPEG_HEADERS, ETag: `"${Math.round(hit.mtimeMs)}"` },
			body: hit.buffer,
			isBinary: true,
		}
	}

	const pageStatusMatch = path.match(/^\/api\/companion\/page-preview\/(-?\d+)\/status$/)
	if (pageStatusMatch) {
		const page = parseInt(pageStatusMatch[1], 10)
		if (!Number.isFinite(page) || page < 1) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid page' }) }
		}
		const cfg = resolveCompanionConfig(ctx.config)
		const size = cfg.pickerGridSize
		const cells = []
		for (let row = 0; row < size; row++) {
			for (let column = 0; column < size; column++) {
				const meta = getPreviewMeta(page, row, column)
				cells.push({
					row,
					column,
					url: previewUrl(page, row, column),
					text: meta?.text,
					mtimeMs: meta?.mtimeMs ?? null,
					ready: !!meta?.mtimeMs,
				})
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, page, gridSize: size, cells }),
		}
	}

	return null
}

async function handlePost(path, body, ctx) {
	wirePreviewBroadcast(ctx)
	const client = getSatellitePreviewClient()

	if (path === '/api/companion/page-preview/subscribe') {
		let payload = {}
		try {
			payload = parseBody(body) || {}
		} catch {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
		}
		const page = parseInt(String(payload.page), 10)
		if (!Number.isFinite(page) || page < 1) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'page required' }) }
		}
		const sessionId = String(payload.sessionId || randomUUID())
		const cfg = resolveCompanionConfig(ctx.config)
		const size = cfg.pickerGridSize
		const result = await client.subscribePageSession(ctx.config, sessionId, page, {
			rowMin: payload.rowMin ?? 0,
			rowMax: payload.rowMax ?? size - 1,
			colMin: payload.colMin ?? 0,
			colMax: payload.colMax ?? size - 1,
		})
		return {
			status: result.ok ? 200 : 503,
			headers: JSON_HEADERS,
			body: jsonBody({ ...result, sessionId, page, gridSize: size }),
		}
	}

	if (path === '/api/companion/page-preview/unsubscribe') {
		let payload = {}
		try {
			payload = parseBody(body) || {}
		} catch {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
		}
		const sessionId = String(payload.sessionId || '')
		if (!sessionId) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'sessionId required' }) }
		}
		client.unsubscribePageSession(sessionId)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	if (path === '/api/companion/button-preview/test-press') {
		let payload = {}
		try {
			payload = parseBody(body) || {}
		} catch {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON' }) }
		}
		const loc = parseLocationParams(payload.page, payload.row, payload.column)
		if (!loc) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid location' }) }
		const cfg = resolveCompanionConfig(ctx.config)
		const url = `http://${cfg.host}:${cfg.port}/api/location/${loc.page}/${loc.row}/${loc.column}/press`
		try {
			const r = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			})
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: r.ok, status: r.status }),
			}
		} catch (e) {
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: false, error: e.message }),
			}
		}
	}

	return null
}

module.exports = { handleGet, handlePost }
