import * as Actions from './device-view-actions.js'
import { CASPAR_HOST } from './device-view-helpers.js'
import {
	buildGpuLayoutItemsFromLive,
	buildGpuSelectablePortEntries,
	clearGpuLayoutPrefs,
	collectGpuPortNameOptions,
	GPU_CUSTOM_LAYOUT_KEY,
	gpuLayoutItemsToPhysicalTopology,
	layoutItemsFromGpuEntries,
} from '../lib/device-view-gpu-port-list.js'
import { setStatus } from './device-view-ui-utils.js'
import { exportGpuLayoutFile, saveGpuLayoutToStorage } from './device-view-caspar-render-gpu-doc-listeners.js'

/**
 * When the Caspar device band is in edit mode, append the GPU layout drag/drop editor to `wrapCtl`.
 */
export function appendGpuLayoutEditorIfEditMode(wrapCtl, { load, lastPayload, statusEl }) {
	const editMode = document.querySelector('.device-view__band--caspar')?.classList.contains('device-view--edit-mode')
	if (!editMode) return

	const editGroup = Object.assign(document.createElement('div'), { style: 'border: 1px solid #555; padding: 8px; border-radius: 4px; background: #333; margin-bottom: 8px;' })

	const gpuModel = String(lastPayload?.live?.gpu?.model || '').toUpperCase()
	const live = lastPayload?.live
	const suggested = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const gpuOuts = suggested.filter(
		(c) => c && c.deviceId === CASPAR_HOST && c.kind === 'gpu_out',
	)
	let customGpuItems = layoutItemsFromGpuEntries(
		buildGpuSelectablePortEntries({
			live,
			suggestedGpuOuts: gpuOuts,
			savedTopology: lastPayload?.gpuPhysicalTopology || null,
			hideDisconnectedByDefault: false,
		}),
	)
	const portNameOptions = collectGpuPortNameOptions(live)

	editGroup.innerHTML =
		'<div style="font-weight:bold; margin-bottom: 6px; font-size: 11px; color: #aaa;">GPU layout — one row per <em>physical</em> socket. Port A/B are RandR alternates on the same jack (only one cable per slot).</div>'

	const listContainer = Object.assign(document.createElement('div'), { style: 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;' })

	const mergeLoadedGpuLayout = (raw) => {
		const arr = Array.isArray(raw)
			? raw.map((x) => (x && typeof x === 'object' ? { ...x } : null)).filter(Boolean)
			: []
		const byId = new Map(customGpuItems.map((x) => [x.id, x]))
		for (const item of arr) {
			const id = String(item?.id || '').trim()
			if (!id) continue
			byId.set(id, { ...(byId.get(id) || {}), ...item })
		}
		const ordered = [...byId.values()]
		const orderFromFile = arr.map((x) => String(x?.id || '').trim()).filter(Boolean)
		if (orderFromFile.length) {
			ordered.sort((a, b) => {
				const ia = orderFromFile.indexOf(a.id)
				const ib = orderFromFile.indexOf(b.id)
				return (ia >= 0 ? ia : 9999) - (ib >= 0 ? ib : 9999)
			})
		}
		return ordered
	}

	const saveAndRefresh = async () => {
		saveGpuLayoutToStorage(customGpuItems)
		try {
			const topo = gpuLayoutItemsToPhysicalTopology(customGpuItems)
			if (topo.length) await Actions.saveGpuPhysicalTopology(topo)
		} catch (e) {
			console.warn('[device-view] gpuPhysicalTopology save failed', e)
		}
		if (statusEl) setStatus(statusEl, 'GPU layout saved (topology persisted)', true)
		if (load) await load()
	}

	const setAllHidden = (hidden) => {
		customGpuItems.forEach((item) => {
			item.hidden = hidden
		})
		saveAndRefresh()
	}

	const hideDisconnected = () => {
		const connectedNames = new Set(
			(Array.isArray(live?.gpu?.displays) ? live.gpu.displays : [])
				.filter((d) => d?.connected)
				.map((d) => String(d.name || '').trim().toUpperCase())
				.filter(Boolean),
		)
		customGpuItems.forEach((item) => {
			const pairs = Array.isArray(item.pairs) ? item.pairs : []
			const connected = pairs.some((p) => connectedNames.has(String(p).trim().toUpperCase()))
			item.hidden = !connected
		})
		saveAndRefresh()
	}

	const renderList = () => {
		listContainer.innerHTML = ''
		customGpuItems.forEach((item, index) => {
			const row = Object.assign(document.createElement('div'), {
				style: 'display:flex; flex-direction:column; gap:4px; padding:4px; border:1px solid #444; border-radius:3px; background:#2a2a2a; cursor:grab;',
				draggable: true,
			})

			const header = Object.assign(document.createElement('div'), { style: 'display:flex; justify-content:space-between; font-size:10px; opacity:0.8;' })
			header.innerHTML = `<span><strong>Socket ${index + 1}</strong> (${item.label})</span><span>≡</span>`

			row.addEventListener('dragstart', (ev) => {
				ev.dataTransfer.setData('application/x-highascg-inspector-gpu-slot', String(index))
				row.style.opacity = '0.5'
			})
			row.addEventListener('dragend', () => {
				row.style.opacity = '1'
			})
			row.addEventListener('dragover', (ev) => {
				ev.preventDefault()
				row.style.borderTop = '2px solid #007bff'
			})
			row.addEventListener('dragleave', () => {
				row.style.borderTop = '1px solid #444'
			})
			row.addEventListener('drop', (ev) => {
				ev.preventDefault()
				row.style.borderTop = '1px solid #444'
				const dragIdx = parseInt(ev.dataTransfer.getData('application/x-highascg-inspector-gpu-slot'), 10)
				if (!Number.isNaN(dragIdx) && dragIdx !== index) {
					const draggedItem = customGpuItems.splice(dragIdx, 1)[0]
					let insertAt = index
					if (dragIdx < index) insertAt = index - 1
					customGpuItems.splice(insertAt, 0, draggedItem)
					saveAndRefresh()
				}
			})

			const portRow = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px;' })
			const portASel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type', style: 'flex:1' })
			const portBSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type', style: 'flex:1' })

			const portOptions = ['None', ...portNameOptions]
			const renderOptions = (selVal) => portOptions.map((p) => {
				const val = p === 'None' ? '' : p
				return `<option value="${val}" ${val === selVal ? 'selected' : ''}>${p}</option>`
			}).join('')

			const currentPairs = item.pairs || []
			portASel.innerHTML = renderOptions(currentPairs[0] || '')
			portBSel.innerHTML = renderOptions(currentPairs[1] || '')

			const hideCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', style: 'display:flex; align-items:center; margin-top:2px;' })
			const hideIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
			hideIn.checked = !!item.hidden

			const triggerChange = () => {
				const a = portASel.value
				const b = portBSel.value
				const newPairs = [a, b].filter(Boolean)
				let newLabel = item.id
				if (newPairs.length) {
					const isHdmi = newPairs.some((p) => /HDMI/i.test(p))
					const isEdp = newPairs.some((p) => /EDP/i.test(p))
					if (isEdp) {
						newLabel = newPairs.join(' · ')
					} else {
						const nums = newPairs.map((p) => p.split('-').slice(1).join('-')).join('/')
						newLabel = `${isHdmi ? 'HDMI' : 'DP'} ${nums}`
					}
				}
				item.pairs = newPairs
				item.label = newLabel
				item.type = newPairs.some((p) => /HDMI/i.test(p))
					? 'hdmi'
					: newPairs.some((p) => /EDP/i.test(p))
						? 'edp'
						: 'dp'
				item.hidden = hideIn.checked
				saveAndRefresh()
			}

			portASel.addEventListener('change', triggerChange)
			portBSel.addEventListener('change', triggerChange)
			hideIn.addEventListener('change', triggerChange)

			hideCk.append(hideIn, document.createTextNode('Hide connector'))

			portRow.append(portASel, portBSel)
			row.append(header, portRow, hideCk)
			listContainer.append(row)
		})
	}

	renderList()

	const bulkRow = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:6px; flex-wrap:wrap' })
	const showAllBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		textContent: 'Show all',
		title: 'Show every GPU port on the rear panel and in the outputs list',
	})
	const hideDiscBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		textContent: 'Hide disconnected',
		title: 'Hide ports with no active display',
	})
	const hideAllBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		textContent: 'Hide all',
		title: 'Hide every GPU port (use Show all to restore)',
	})
	showAllBtn.onclick = () => setAllHidden(false)
	hideDiscBtn.onclick = () => hideDisconnected()
	hideAllBtn.onclick = () => setAllHidden(true)
	bulkRow.append(showAllBtn, hideDiscBtn, hideAllBtn)

	const actionsRow = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:8px; flex-wrap:wrap' })
	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save' })
	const exportBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Export' })
	const loadBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Load' })
	const resetLayoutBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		textContent: 'Reset layout',
		style: 'color: #ff6b6b; border-color: #ff6b6b33; margin-left: auto;',
		title: 'Clear saved layout and rebuild from detected GPU outputs (optional server xrandr refresh)',
	})
	const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
	fileIn.style.display = 'none'
	actionsRow.append(saveBtn, exportBtn, loadBtn, resetLayoutBtn, fileIn)

	saveBtn.onclick = () => saveAndRefresh()
	exportBtn.onclick = () => exportGpuLayoutFile(customGpuItems, gpuModel || live?.gpu?.model)

	loadBtn.onclick = () => fileIn.click()
	fileIn.onchange = async () => {
		const file = fileIn.files?.[0]
		fileIn.value = ''
		if (!file) return
		try {
			const parsed = JSON.parse(await file.text())
			if (!Array.isArray(parsed)) {
				alert('GPU layout file must be a JSON array (same format as Export).')
				return
			}
			customGpuItems = mergeLoadedGpuLayout(parsed)
			localStorage.setItem(GPU_CUSTOM_LAYOUT_KEY, JSON.stringify(customGpuItems))
			try {
				const topo = gpuLayoutItemsToPhysicalTopology(customGpuItems)
				if (topo.length) await Actions.saveGpuPhysicalTopology(topo)
			} catch (e) {
				console.warn('[device-view] gpuPhysicalTopology save failed', e)
			}
			alert('GPU layout loaded from file.')
			if (load) await load()
		} catch (e) {
			alert('Invalid GPU layout file: ' + (e?.message || e))
		}
	}
	resetLayoutBtn.onclick = async () => {
		if (!confirm('Clear saved GPU layout and rebuild from detected outputs?')) return
		clearGpuLayoutPrefs()
		let serverNote = ''
		try {
			const res = await Actions.resetGpuLayout()
			if (res?.pairs?.length) {
				localStorage.setItem(GPU_CUSTOM_LAYOUT_KEY, JSON.stringify(res.pairs))
				serverNote = ' Server xrandr layout applied.'
			}
		} catch (e) {
			console.warn('gpu-ports-reset unavailable', e)
		}
		customGpuItems = buildGpuLayoutItemsFromLive(live, gpuOuts)
		renderList()
		if (statusEl) {
			setStatus(
				statusEl,
				`GPU layout reset from detected outputs.${serverNote || ' (Server xrandr reset route not available on this host.)'}`,
				true,
			)
		}
		if (load) await load()
	}

	editGroup.append(listContainer, bulkRow, actionsRow)
	wrapCtl.append(editGroup)
}
