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
import { escapeHtml } from '../lib/dom-escape.js'

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

	const formatLayoutRows = (items) =>
		(items || [])
			.map((item) => {
				const pairs = (item.pairs || []).filter(Boolean).join(', ') || '(empty)'
				return `  ${item.id}: ${pairs}`
			})
			.join('\n')

	const unmappedContainer = Object.assign(document.createElement('div'), {
		style: 'margin-top: 8px; display: none; flex-direction: column; gap: 6px;',
	})

	const renderUnmapped = () => {
		unmappedContainer.innerHTML = ''
		const unmapped = (live?.gpu?.physicalMap?.ports || []).filter((p) => p?.unmapped)
		if (!unmapped.length) {
			unmappedContainer.style.display = 'none'
			return
		}
		unmappedContainer.style.display = 'flex'
		const heading = Object.assign(document.createElement('div'), {
			style: 'font-size: 11px; color: #f0ad4e; font-weight: bold;',
			textContent: 'Unmapped live displays — assign to a socket',
		})
		unmappedContainer.append(heading)
		const socketIds = customGpuItems.map((x) => x.id).filter((id) => /^gpu_p\d+$/i.test(id))
		for (const port of unmapped) {
			const displayName = String(
				port?.runtime?.xrandrName || port?.runtime?.activePort || port?.pair?.dpA || '',
			).trim()
			if (!displayName) continue
			const row = Object.assign(document.createElement('div'), {
				style: 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:11px;',
			})
			const label = Object.assign(document.createElement('span'), {
				textContent: displayName,
				style: 'min-width: 80px;',
			})
			const sel = Object.assign(document.createElement('select'), {
				className: 'device-view__destinations-type',
				style: 'flex:1; min-width: 100px;',
			})
			sel.innerHTML = socketIds
				.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`)
				.join('')
			const assignBtn = Object.assign(document.createElement('button'), {
				className: 'header-btn',
				textContent: 'Assign',
				title: 'Map this display onto the selected socket and save topology',
			})
			assignBtn.onclick = async () => {
				const targetId = sel.value
				const item = customGpuItems.find((x) => x.id === targetId)
				if (!item) return
				const pairs = Array.isArray(item.pairs) ? [...item.pairs] : []
				if (!pairs[0]) pairs[0] = displayName
				else if (!pairs[1] && pairs[0] !== displayName) pairs[1] = displayName
				else pairs[0] = displayName
				item.pairs = pairs.filter(Boolean)
				await saveAndRefresh()
				renderList()
				renderUnmapped()
			}
			row.append(label, sel, assignBtn)
			unmappedContainer.append(row)
		}
	}

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
			header.innerHTML = `<span><strong>Socket ${index + 1}</strong> (${escapeHtml(item.label)})</span><span>≡</span>`

			row.addEventListener('dragstart', (ev) => {
				ev.dataTransfer.setData('application/x-highascg-inspector-gpu-slot', String(index))
				row.style.opacity = '0.5'
			})
			row.addEventListener('dragend', () => {
				row.style.opacity = '1'
			})
			/* Insert-before vs insert-after by pointer half. The old top-border-only variant made
			 * "drag one slot down" a no-op (remove + insert-at-index-1 lands the row back where it
			 * was) — the todos06.08 "rearranging doesnt take with first try". */
			const dropAfter = (ev) => ev.offsetY > row.offsetHeight / 2
			const clearDropIndicator = () => {
				row.style.borderTop = '1px solid #444'
				row.style.borderBottom = ''
			}
			row.addEventListener('dragover', (ev) => {
				ev.preventDefault()
				if (dropAfter(ev)) {
					row.style.borderTop = '1px solid #444'
					row.style.borderBottom = '2px solid #007bff'
				} else {
					row.style.borderBottom = ''
					row.style.borderTop = '2px solid #007bff'
				}
			})
			row.addEventListener('dragleave', clearDropIndicator)
			row.addEventListener('drop', (ev) => {
				ev.preventDefault()
				clearDropIndicator()
				const dragIdx = parseInt(ev.dataTransfer.getData('application/x-highascg-inspector-gpu-slot'), 10)
				if (Number.isNaN(dragIdx) || dragIdx === index) return
				let insertAt = index + (dropAfter(ev) ? 1 : 0)
				if (dragIdx < insertAt) insertAt -= 1
				if (insertAt === dragIdx) return
				const draggedItem = customGpuItems.splice(dragIdx, 1)[0]
				customGpuItems.splice(insertAt, 0, draggedItem)
				saveAndRefresh()
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
		renderUnmapped()
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
		let res = null
		try {
			res = await Actions.resetGpuLayout()
		} catch (e) {
			console.warn('gpu-ports-reset unavailable', e)
		}
		const discoveredPairs = res?.pairs
		if (!discoveredPairs?.length) {
			if (!confirm('No discovered topology from server. Clear saved layout and rebuild from live data?')) return
			clearGpuLayoutPrefs()
			customGpuItems = buildGpuLayoutItemsFromLive(live, gpuOuts, lastPayload?.gpuPhysicalTopology || null)
			renderList()
			renderUnmapped()
			if (statusEl) {
				setStatus(statusEl, 'GPU layout reset from live data (server discovery unavailable).', true)
			}
			if (load) await load()
			return
		}
		const currentRows = formatLayoutRows(customGpuItems)
		const discoveredRows = formatLayoutRows(discoveredPairs)
		const diffMsg = `Current saved layout:\n${currentRows || '  (empty)'}\n\nDiscovered layout:\n${discoveredRows}\n\nReplace with discovered layout and save to server?`
		if (!confirm(diffMsg)) return
		clearGpuLayoutPrefs()
		customGpuItems = mergeLoadedGpuLayout(discoveredPairs)
		try {
			const persistRes = await Actions.resetGpuLayout({ persist: true })
			if (!persistRes?.persisted) {
				const topo = gpuLayoutItemsToPhysicalTopology(customGpuItems)
				if (topo.length) await Actions.saveGpuPhysicalTopology(topo)
			}
		} catch (e) {
			console.warn('[device-view] gpu topology persist failed', e)
		}
		renderList()
		renderUnmapped()
		if (statusEl) {
			setStatus(statusEl, 'GPU layout reset from discovery and saved to server.', true)
		}
		if (load) await load()
	}

	editGroup.append(listContainer, unmappedContainer, bulkRow, actionsRow)
	wrapCtl.append(editGroup)
}
