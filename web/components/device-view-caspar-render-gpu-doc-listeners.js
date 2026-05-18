import { normRandrCaspar, resolveCanonicalGpuConnectorId } from './device-view-caspar-render-helpers.js'

/**
 * Binds document-level GPU layout events used by the Caspar rear panel and inspector.
 * Call once per band render (same as prior inline behaviour).
 */
export function bindCasparGpuLayoutDocumentListeners({
	casparOverlay,
	customGpuItems,
	gpuPhysicalPorts,
	gpuOuts,
	live,
	resolveStatusClass,
	getGpuEditMode,
}) {
	const getConnectedDisplays = () => live?.gpu?.displays || []

	document.addEventListener('gpu-layout-changed', (e) => {
		const { id, pairs, label, hidden } = e.detail
		const item =
			customGpuItems.find((x) => x.id === id) ||
			customGpuItems.find(
				(x) => resolveCanonicalGpuConnectorId(x.pairs, gpuPhysicalPorts, gpuOuts) === String(id || '').trim()
			)
		if (item) {
			if (label) item.label = label
			if (Array.isArray(pairs)) {
				item.pairs = pairs
				item.type = pairs.some((p) => String(p).toLowerCase().includes('hdmi')) ? 'hdmi' : 'dp'
			}
			item.hidden = !!hidden

			const connectedDisplays = getConnectedDisplays()
			const connected = item.pairs.some((pName) =>
				connectedDisplays.some((d) => d.connected && normRandrCaspar(d.name) === normRandrCaspar(pName))
			)
			item.connected = connected
			const canonicalId =
				resolveCanonicalGpuConnectorId(item.pairs, gpuPhysicalPorts, gpuOuts) || item.id

			const element = casparOverlay.querySelector(`[data-layout-slot-id="${item.id}"]`)
			if (element) {
				const labelEl = element.querySelector('.device-view__panel-marker-label')
				if (labelEl) labelEl.textContent = item.label

				element.className =
					'device-view__panel-marker ' +
					resolveStatusClass({ ...item, connectorId: canonicalId, kind: 'gpu_out' })
				if (getGpuEditMode()) element.classList.add('device-view__panel-marker--editable')
				element.classList.add('device-view__panel-marker--gpu')

				if (hidden) {
					element.style.display = 'none'
				} else {
					element.style.display = ''
				}
			}
		}
	})

	document.addEventListener('gpu-layout-save', (e) => {
		const fromInspector = e?.detail?.items
		const toSave = Array.isArray(fromInspector) ? fromInspector : customGpuItems
		localStorage.setItem('gpu_custom_layout', JSON.stringify(toSave))
		alert('GPU layout saved to local storage!')
	})

	document.addEventListener('gpu-layout-export', (e) => {
		const fromInspector = e?.detail?.items
		const toExport = Array.isArray(fromInspector) ? fromInspector : customGpuItems
		const gpuModel = live?.gpu?.model || 'NVIDIA_GPU'
		const totalPorts = toExport.length
		const filename = `${gpuModel}_${totalPorts}ports_layout.json`.replace(/\s+/g, '_')

		const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(toExport, null, 2))
		const downloadAnchorNode = document.createElement('a')
		downloadAnchorNode.setAttribute('href', dataStr)
		downloadAnchorNode.setAttribute('download', filename)
		document.body.appendChild(downloadAnchorNode)
		downloadAnchorNode.click()
		downloadAnchorNode.remove()
	})
}
