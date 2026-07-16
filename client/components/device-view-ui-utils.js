/**
 * UI Utilities for Device View.
 */

export function destinationRectLabel(d) {
	const modeRaw = String(d?.mode || 'pgm_prv')
	if (modeRaw === 'host_channel') {
		const ch = d?.casparChannel
		const role = d?.hostRole ? roleLabel({ role: d.hostRole }) : 'Host'
		return ch != null ? `${role} · ch ${ch}` : role
	}
	const mode =
		modeRaw === 'pgm_only'
			? 'PGM'
			: (modeRaw === 'multiview'
				? 'MVR'
				: (modeRaw === 'stream'
					? 'STREAM'
					: (modeRaw === 'pixelmap' ? 'PXM' : (modeRaw === 'operator_gui' ? 'OPG' : 'PGM/PRV'))))
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
		case 'decklink_input':
			return 'DeckLink input'
		case 'live_audio_input':
			return 'Live audio input'
		case 'v4l2_input':
			return 'USB video input'
		case 'extra_audio':
			return 'Extra audio'
		case 'streaming_channel':
			return 'Streaming channel'
		case 'webpage_host':
			return 'Webpage host'
		case 'ndi_host':
			return 'NDI host'
		case 'browser_display':
			return 'Browser display'
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
		if (r.strong) v.style.fontWeight = '600'
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

const CONNECTOR_HIT_RADIUS_PX = 22

/**
 * Nearest connector dot/port within a forgiving click radius (device view surface).
 * @param {number} clientX
 * @param {number} clientY
 * @param {HTMLElement | null | undefined} surfaceEl
 * @param {number} [maxDistance]
 * @returns {string}
 */
export function findNearestConnectorId(clientX, clientY, surfaceEl, maxDistance = CONNECTOR_HIT_RADIUS_PX) {
	if (!surfaceEl || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return ''
	let bestId = ''
	let bestDist = maxDistance
	for (const el of surfaceEl.querySelectorAll('[data-connector-id]')) {
		const id = String(el.getAttribute('data-connector-id') || '').trim()
		if (!id) continue
		const r = el.getBoundingClientRect()
		if (!r.width && !r.height) continue
		const cx = r.left + r.width / 2
		const cy = r.top + r.height / 2
		const d = Math.hypot(clientX - cx, clientY - cy)
		if (d <= bestDist) {
			bestDist = d
			bestId = id
		}
	}
	return bestId
}

/**
 * Extracts a connector ID from a DOM event by checking paths, closest elements, and points.
 */
export function connectorIdFromEvent(ev, surfaceEl = null) {
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
	const surface =
		surfaceEl ||
		(t && typeof t.closest === 'function' ? t.closest('.device-view') : null) ||
		document.querySelector('.device-view')
	return findNearestConnectorId(clientX, clientY, surface)
}

export function renderPreservingFocus(container, renderFn) {
	let activeDesc = null
	if (document.activeElement && container.contains(document.activeElement)) {
		const active = document.activeElement
		const inputs = Array.from(container.querySelectorAll('input, select, textarea, button'))
		const idx = inputs.indexOf(active)
		
		let selectionStart = null
		let selectionEnd = null
		
		const originalType = active.tagName.toLowerCase() === 'input' ? active.type : null
		const needsTypeHack = originalType && (originalType === 'number' || originalType === 'email')
		
		try {
			if (needsTypeHack) {
				active.type = 'text'
			}
			if (typeof active.selectionStart === 'number') {
				selectionStart = active.selectionStart
				selectionEnd = active.selectionEnd
			}
		} catch (_e) {
			/* selection read unsupported */
		} finally {
			if (needsTypeHack) {
				active.type = originalType
			}
		}

		activeDesc = {
			tagName: active.tagName.toLowerCase(),
			placeholder: active.getAttribute('placeholder'),
			type: originalType,
			value: active.value,
			index: idx,
			selectionStart,
			selectionEnd,
		}
	}

	renderFn()

	if (activeDesc) {
		const newInputs = Array.from(container.querySelectorAll('input, select, textarea, button'))
		let matched = null
		if (activeDesc.index >= 0 && activeDesc.index < newInputs.length) {
			const candidate = newInputs[activeDesc.index]
			if (candidate.tagName.toLowerCase() === activeDesc.tagName) {
				matched = candidate
			}
		}
		if (!matched && activeDesc.placeholder) {
			matched = newInputs.find(el => 
				el.tagName.toLowerCase() === activeDesc.tagName && 
				el.getAttribute('placeholder') === activeDesc.placeholder
			)
		}
		if (!matched) {
			matched = newInputs.find((el, idx) => el.tagName.toLowerCase() === activeDesc.tagName && idx === activeDesc.index)
		}
		if (matched) {
			// Select values are entity-specific (e.g. per timeline clip). Restoring the previous
			// option when switching clips made the audio-route dropdown show the wrong pair.
			const isSelect = activeDesc.tagName === 'select'
			if (
				!isSelect &&
				activeDesc.value !== undefined &&
				activeDesc.value !== null &&
				matched.value !== activeDesc.value
			) {
				matched.value = activeDesc.value
			}
			matched.focus()
			if (activeDesc.selectionStart !== null) {
				const originalType = matched.tagName.toLowerCase() === 'input' ? matched.type : null
				const needsTypeHack = originalType && (originalType === 'number' || originalType === 'email')
				
				const isFullSelection = activeDesc.selectionStart === 0 && activeDesc.selectionEnd >= activeDesc.value.length
				
				setTimeout(() => {
					if (isFullSelection) {
						try {
							matched.select()
						} catch (_e) { /* select() unsupported */ }
					} else if (!needsTypeHack) {
						try {
							if (typeof matched.setSelectionRange === 'function') {
								const start = Math.min(activeDesc.selectionStart, matched.value.length)
								const end = Math.min(activeDesc.selectionEnd, matched.value.length)
								matched.setSelectionRange(start, end)
							}
						} catch (_e) { /* select() unsupported */ }
					}
				}, 0)
			}
		}
	}
}
