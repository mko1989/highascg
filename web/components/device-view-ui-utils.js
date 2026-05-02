/**
 * UI Utilities for Device View.
 */

export function destinationRectLabel(d) {
	const modeRaw = String(d?.mode || 'pgm_prv')
	const mode = modeRaw === 'pgm_only' ? 'PGM' : (modeRaw === 'multiview' ? 'MVR' : (modeRaw === 'stream' ? 'STREAM' : 'PGM/PRV'))
	const w = Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920)
	const h = Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50)
	if (modeRaw === 'stream') {
		const t = String(d?.stream?.type || 'rtmp').toUpperCase()
		return `${mode} · ${t}`
	}
	return `${mode} · ${w}x${h}@${fps}`
}

export function roleLabel(item) {
	if (!item) return '-'
	switch (item.role) {
		case 'pgm':
			return `Main ${(item.mainIndex ?? 0) + 1} OUTPUT/PGM`
		case 'prv':
			return `Main ${(item.mainIndex ?? 0) + 1} PRV`
		case 'bus1':
			return `Main ${(item.mainIndex ?? 0) + 1} Bus 1`
		case 'bus2':
			return `Main ${(item.mainIndex ?? 0) + 1} Bus 2`
		case 'multiview':
			return 'Multiview'
		case 'inputs_host':
			return 'Inputs host'
		case 'extra_audio':
			return 'Extra audio'
		case 'streaming_channel':
			return 'Streaming channel'
		default:
			return String(item.role || 'channel')
	}
}

/**
 * @param {Array<{label: string, value: string}>} rows
 * @returns {HTMLElement}
 */
export function buildInspectorTable(rows) {
	const list = document.createElement('div')
	list.className = 'device-view__kv'
	for (const r of rows) {
		const item = document.createElement('div')
		item.className = 'device-view__kv-row'
		const k = document.createElement('span')
		k.className = 'device-view__kv-key'
		k.textContent = r.label
		const v = document.createElement('span')
		v.className = 'device-view__kv-val'
		v.textContent = r.value
		item.append(k, v)
		list.append(item)
	}
	return list
}

export function setStatus(el, msg, ok) {
	if (!el) return
	el.textContent = msg
	el.className = 'device-view__status' + (ok ? ' device-view__status--ok' : ' device-view__status--err')
}

/**
 * Extracts a connector ID from a DOM event by checking paths, closest elements, and points.
 */
export function connectorIdFromEvent(ev) {
	const readConnectorId = (node) => {
		if (!node || typeof node.getAttribute !== 'function') return ''
		return String(node.getAttribute('data-connector-id') || '').trim()
	}
	const path = typeof ev?.composedPath === 'function' ? ev.composedPath() : []
	for (const n of path) {
		const id = readConnectorId(n)
		if (id) return id
	}
	const t = ev?.target
	if (t && typeof t.closest === 'function') {
		const byClosest = String(t.closest('[data-connector-id]')?.getAttribute?.('data-connector-id') || '').trim()
		if (byClosest) return byClosest
	}
	const clientX = Number(ev?.clientX)
	const clientY = Number(ev?.clientY)
	if (Number.isFinite(clientX) && Number.isFinite(clientY) && typeof document?.elementsFromPoint === 'function') {
		const stack = document.elementsFromPoint(clientX, clientY) || []
		for (const el of stack) {
			const id = readConnectorId(el)
			if (id) return id
			if (typeof el?.closest === 'function') {
				const cid = String(el.closest('[data-connector-id]')?.getAttribute?.('data-connector-id') || '').trim()
				if (cid) return cid
			}
		}
	}
	return ''
}
