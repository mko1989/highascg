/**
 * WS catalog paging: catalog_request (single chunk) + catalog_subscribe (auto-pump media chunks). PF-01 C.
 */
'use strict'

const WebSocket = require('ws')

const {
	getRawMediaCatalog,
	getTemplateCatalog,
	enrichMediaListForHttp,
	normalizeChunkRange,
} = require('../api/media-catalog')

function wsCatalogChunkEnrichEnabled() {
	const v = process.env.HIGHASCG_WS_CATALOG_CHUNK_ENRICH
	if (v === undefined || v === '') return true
	return !/^0|false$/i.test(String(v))
}

/**
 * @param {import('ws')} ws
 * @param {object} ctx
 * @param {object} msg — parsed JSON client message
 * @param {(o: object) => string} safeStringify
 */
async function dispatchCatalogWsMessage(ws, ctx, msg, safeStringify) {
	const t = msg.type
	if (t !== 'catalog_request' && t !== 'catalog_subscribe') return false

	const slice = msg.slice === 'templates' ? 'templates' : msg.slice === 'media' ? 'media' : null
	if (!slice) {
		ws.send(
			safeStringify({
				type: 'catalog_error',
				data: { message: 'catalog: slice must be "media" or "templates"', requestId: msg.id },
				id: msg.id,
			}),
		)
		return true
	}

	const fullCinf = msg.fullCinf === true || msg.fullCinf === '1' || String(msg.fullCinf || '').toLowerCase() === 'true'
	const enrich = wsCatalogChunkEnrichEnabled()

	if (slice === 'templates') {
		const items = getTemplateCatalog(ctx)
		const { offset: o, sliceLen } = normalizeChunkRange(msg.offset, msg.limit, items.length)
		const chunk = items.slice(o, o + sliceLen)
		ws.send(
			safeStringify({
				type: 'catalog_chunk',
				data: {
					slice: 'templates',
					offset: o,
					total: items.length,
					items: chunk,
					done: o + chunk.length >= items.length,
					requestId: msg.id,
				},
			}),
		)
		return true
	}

	// media
	const raw = getRawMediaCatalog(ctx)
	const streamId =
		msg.streamId || `cat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

	if (t === 'catalog_request') {
		const { offset: o, sliceLen } = normalizeChunkRange(msg.offset, msg.limit, raw.length)
		let part = raw.slice(o, o + sliceLen)
		if (enrich) part = await enrichMediaListForHttp(ctx, part, { forceFullCinf: fullCinf, skipFinalDedupe: true })
		const done = o + part.length >= raw.length
		ws.send(
			safeStringify({
				type: 'catalog_chunk',
				data: {
					slice: 'media',
					offset: o,
					total: raw.length,
					items: part,
					done,
					requestId: msg.id,
					streamId,
				},
			}),
		)
		return true
	}

	// catalog_subscribe — pump media chunks until done
	let off = 0
	const pump = async () => {
		try {
			if (ws.readyState !== WebSocket.OPEN) return
			const { offset: o, sliceLen } = normalizeChunkRange(off, msg.limit, raw.length)
			let part = raw.slice(o, o + sliceLen)
			if (enrich) part = await enrichMediaListForHttp(ctx, part, { forceFullCinf: fullCinf, skipFinalDedupe: true })
			const end = o + part.length
			const done = end >= raw.length
			ws.send(
				safeStringify({
					type: 'catalog_chunk',
					data: {
						slice: 'media',
						offset: o,
						total: raw.length,
						items: part,
						done,
						requestId: msg.id,
						streamId,
					},
				}),
			)
			off = end
			if (!done) setImmediate(() => pump().catch(sendErr))
		} catch (e) {
			sendErr(e)
		}
	}
	const sendErr = (e) => {
		const m = e instanceof Error ? e.message : String(e)
		try {
			ws.send(safeStringify({ type: 'catalog_error', data: { message: m, requestId: msg.id, streamId }, id: msg.id }))
		} catch (_) {}
	}
	pump().catch(sendErr)
	return true
}

module.exports = { dispatchCatalogWsMessage }
