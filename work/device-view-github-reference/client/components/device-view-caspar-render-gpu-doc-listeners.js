import { normRandrCaspar, resolveCanonicalGpuConnectorId } from './device-view-caspar-render-helpers.js'
import { GPU_CUSTOM_LAYOUT_KEY } from '../lib/device-view-gpu-port-list.js'

/** @type {object | null} Latest rear-panel GPU layout context (updated each render). */
let listenerCtx = null
let documentListenersBound = false

function onGpuLayoutChanged(e) {
	const ctx = listenerCtx
	if (!ctx) return
	const { customGpuItems, gpuPhysicalPorts, gpuOuts, casparOverlay, resolveStatusClass, getGpuEditMode } = ctx
	const { id, pairs, label, hidden } = e.detail || {}
	const item =
		customGpuItems.find((x) => x.id === id) ||
		customGpuItems.find(
			(x) => resolveCanonicalGpuConnectorId(x.pairs, gpuPhysicalPorts, gpuOuts) === String(id || '').trim(),
		)
	if (!item) return

	if (label) item.label = label
	if (Array.isArray(pairs)) {
		item.pairs = pairs
		item.type = pairs.some((p) => String(p).toLowerCase().includes('hdmi')) ? 'hdmi' : 'dp'
	}
	item.hidden = !!hidden

	const slotId = String(item.id || '').replace(/__.*$/i, '')
	const canonicalId =
		/^gpu_p\d+$/i.test(slotId)
			? slotId
			: resolveCanonicalGpuConnectorId(item.pairs, gpuPhysicalPorts, gpuOuts) || item.id
	const connectedDisplays = ctx.live?.gpu?.displays || []
	const connected = item.pairs.some((pName) =>
		connectedDisplays.some((d) => d.connected && normRandrCaspar(d.name) === normRandrCaspar(pName)),
	)
	item.connected = connected

	const element = casparOverlay?.querySelector?.(`[data-layout-slot-id="${item.id}"]`)
	if (!element) return

	const labelEl = element.querySelector('.device-view__panel-marker-label')
	if (labelEl) labelEl.textContent = item.label

	element.className =
		'device-view__panel-marker ' + resolveStatusClass({ ...item, connectorId: canonicalId, kind: 'gpu_out' })
	if (getGpuEditMode()) element.classList.add('device-view__panel-marker--editable')
	element.classList.add('device-view__panel-marker--gpu')
	element.style.display = hidden ? 'none' : ''
}

function ensureDocumentListenersOnce() {
	if (documentListenersBound) return
	documentListenersBound = true
	document.addEventListener('gpu-layout-changed', onGpuLayoutChanged)
}

/**
 * Updates GPU layout listener context. Document listeners are registered at most once.
 */
export function bindCasparGpuLayoutDocumentListeners(ctx) {
	listenerCtx = ctx
	ensureDocumentListenersOnce()
}

/** @param {object[]} items */
export function saveGpuLayoutToStorage(items) {
	if (!Array.isArray(items)) return
	localStorage.setItem(GPU_CUSTOM_LAYOUT_KEY, JSON.stringify(items))
}

/** @param {object[]} items @param {string} [gpuModel] */
export function exportGpuLayoutFile(items, gpuModel = 'NVIDIA_GPU') {
	if (!Array.isArray(items)) return
	const totalPorts = items.length
	const filename = `${gpuModel}_${totalPorts}ports_layout.json`.replace(/\s+/g, '_')
	const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(items, null, 2))
	const anchor = document.createElement('a')
	anchor.setAttribute('href', dataStr)
	anchor.setAttribute('download', filename)
	document.body.appendChild(anchor)
	anchor.click()
	anchor.remove()
}
