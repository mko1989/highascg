/**
 * After slim WS bootstrap (`catalogDeferred`), load media + templates via WS chunks (PF-01 C),
 * falling back to GET /api/state if WS catalog fails.
 */
import { api } from './api-client.js'

/**
 * @param {import('./ws-client.js').WsClient} ws
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {(data: object) => void} applyFullStateSideEffects
 */
export async function loadDeferredCatalogOverWs(ws, stateStore, applyFullStateSideEffects) {
	const finishHttp = async () => {
		const full = await api.get('/api/state')
		if (full && typeof full === 'object') {
			stateStore.setState(full)
			applyFullStateSideEffects(full)
		}
	}

	if (!ws || typeof ws.send !== 'function') {
		await finishHttp().catch((e) => console.warn('[HighAsCG] catalog HTTP fallback failed:', e?.message || e))
		return
	}

	/**
	 * @param {'media' | 'templates'} slice
	 * @param {number} offset
	 * @param {number} limit
	 */
	const requestChunk = (slice, offset, limit) =>
		new Promise((resolve, reject) => {
			const id = Date.now() + '-' + Math.random().toString(36).slice(2)
			const to = setTimeout(() => {
				cleanup()
				reject(new Error('catalog_request timeout'))
			}, 120_000)
			const onChunk = (data) => {
				if (!data || data.requestId !== id) return
				cleanup()
				resolve(data)
			}
			const onErr = (data) => {
				const rid = data && typeof data === 'object' ? data.requestId : undefined
				if (rid != null && rid !== id) return
				cleanup()
				const msg =
					data && typeof data === 'object' ? data.message || JSON.stringify(data) : String(data ?? 'catalog_error')
				reject(new Error(msg))
			}
			const unsubChunk = ws.on('catalog_chunk', onChunk)
			const unsubErr = ws.on('catalog_error', onErr)
			const cleanup = () => {
				clearTimeout(to)
				unsubChunk()
				unsubErr()
			}
			ws.send(JSON.stringify({ type: 'catalog_request', slice, offset, limit, id }))
		})

	try {
		const tpl = await requestChunk('templates', 0, 100_000)
		stateStore.applyChange('templates', tpl.items)

		const mid = Date.now() + '-' + Math.random().toString(36).slice(2)
		const buf = await new Promise((resolve, reject) => {
			const to = setTimeout(() => {
				cleanup()
				reject(new Error('catalog_subscribe timeout'))
			}, 300_000)
			/** @type {unknown[] | null} */
			let arr = null
			const onChunk = (data) => {
				if (!data || data.slice !== 'media' || data.requestId !== mid) return
				if (arr == null) arr = new Array(Math.max(0, data.total | 0))
				for (let i = 0; i < data.items.length; i++) {
					const idx = data.offset + i
					if (idx >= 0 && idx < arr.length) arr[idx] = data.items[i]
				}
				if (data.done) {
					cleanup()
					resolve(arr || [])
				}
			}
			const onErr = (data) => {
				const rid = data && typeof data === 'object' ? data.requestId : undefined
				if (rid != null && rid !== mid) return
				cleanup()
				const msg =
					data && typeof data === 'object' ? data.message || JSON.stringify(data) : String(data ?? 'catalog_error')
				reject(new Error(msg))
			}
			const unsubChunk = ws.on('catalog_chunk', onChunk)
			const unsubErr = ws.on('catalog_error', onErr)
			const cleanup = () => {
				clearTimeout(to)
				unsubChunk()
				unsubErr()
			}
			ws.send(JSON.stringify({ type: 'catalog_subscribe', slice: 'media', id: mid }))
		})
		stateStore.applyChange('media', buf)
		stateStore.applyChange('catalogDeferred', false)
		applyFullStateSideEffects(stateStore.getState())
	} catch (e) {
		console.warn('[HighAsCG] WS catalog load failed, falling back to /api/state:', e?.message || e)
		await finishHttp().catch((e2) => console.warn('[HighAsCG] catalog HTTP fallback failed:', e2?.message || e2))
	}
}
