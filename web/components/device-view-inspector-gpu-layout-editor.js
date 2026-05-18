import * as Actions from './device-view-actions.js'

/**
 * When the Caspar device band is in edit mode, append the GPU layout drag/drop editor to `wrapCtl`.
 */
export function appendGpuLayoutEditorIfEditMode(wrapCtl, { load, lastPayload }) {
	const editMode = document.querySelector('.device-view__band--caspar')?.classList.contains('device-view--edit-mode')
	if (!editMode) return

	const editGroup = Object.assign(document.createElement('div'), { style: 'border: 1px solid #555; padding: 8px; border-radius: 4px; background: #333; margin-bottom: 8px;' })
	editGroup.innerHTML = '<div style="font-weight:bold; margin-bottom: 6px; font-size: 11px; color: #aaa;">GPU Layout Editor (Drag slots to reorder)</div>'

	const gpuModel = String(lastPayload?.live?.gpu?.model || '').toUpperCase()
	const gpuLayoutPresets = {
		'2080': [
			{ id: 'gpu_p0_1', label: 'DP 0/1', pairs: ['DP-0', 'DP-1'], type: 'dp' },
			{ id: 'gpu_p2_3', label: 'HDMI 0/1', pairs: ['HDMI-0', 'HDMI-1'], type: 'hdmi' },
			{ id: 'gpu_p4_5', label: 'DP 2/3', pairs: ['DP-2', 'DP-3'], type: 'dp' },
			{ id: 'gpu_p6_7', label: 'DP 4/5', pairs: ['DP-4', 'DP-5'], type: 'dp' },
		],
		'DEFAULT': [
			{ id: 'gpu_p0_1', label: 'DP 0/1', pairs: ['DP-0', 'DP-1'], type: 'dp' },
			{ id: 'gpu_p2_3', label: 'HDMI 0/1', pairs: ['HDMI-0', 'HDMI-1'], type: 'hdmi' },
			{ id: 'gpu_p4_5', label: 'DP 2/3', pairs: ['DP-2', 'DP-3'], type: 'dp' },
			{ id: 'gpu_p6_7', label: 'DP 4/5', pairs: ['DP-4', 'DP-5'], type: 'dp' },
		],
	}
	const defaultGpuItems = gpuModel.includes('2080') ? gpuLayoutPresets['2080'] : gpuLayoutPresets['DEFAULT']
	const savedLayout = localStorage.getItem('gpu_custom_layout')
	let customGpuItems = savedLayout ? JSON.parse(savedLayout) : [...defaultGpuItems]
	defaultGpuItems.forEach((def) => {
		if (!customGpuItems.find((x) => x.id === def.id)) customGpuItems.push({ ...def })
	})

	const listContainer = Object.assign(document.createElement('div'), { style: 'display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;' })

	const mergeLoadedGpuLayout = (raw) => {
		const arr = Array.isArray(raw)
			? raw.map((x) => (x && typeof x === 'object' ? { ...x } : null)).filter(Boolean)
			: []
		defaultGpuItems.forEach((def) => {
			if (!arr.find((x) => x.id === def.id)) arr.push({ ...def })
		})
		return arr
	}

	const saveAndRefresh = () => {
		localStorage.setItem('gpu_custom_layout', JSON.stringify(customGpuItems))
		if (load) load()
	}

	const renderList = () => {
		listContainer.innerHTML = ''
		customGpuItems.forEach((item, index) => {
			const row = Object.assign(document.createElement('div'), {
				style: 'display:flex; flex-direction:column; gap:4px; padding:4px; border:1px solid #444; border-radius:3px; background:#2a2a2a; cursor:grab;',
				draggable: true,
			})

			const header = Object.assign(document.createElement('div'), { style: 'display:flex; justify-content:space-between; font-size:10px; opacity:0.8;' })
			header.innerHTML = `<span><strong>Slot ${index + 1}</strong> (${item.label})</span><span>≡</span>`

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

			const portOptions = ['None', ...Array.from({ length: 8 }, (_, i) => `DP-${i}`), ...Array.from({ length: 4 }, (_, i) => `HDMI-${i}`)]
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
					const isHdmi = newPairs.some((p) => p.includes('HDMI'))
					const nums = newPairs.map((p) => p.split('-')[1]).join('/')
					newLabel = `${isHdmi ? 'HDMI' : 'DP'} ${nums}`
				}
				item.pairs = newPairs
				item.label = newLabel
				item.type = newPairs.some((p) => p.includes('HDMI')) ? 'hdmi' : 'dp'
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

	const actionsRow = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:8px; flex-wrap:wrap' })
	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save' })
	const exportBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Export' })
	const loadBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Load' })
	const resetLayoutBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Reset Layout', style: 'color: #ff6b6b; border-color: #ff6b6b33; margin-left: auto;', title: 'Re-detect outputs using xrandr' })
	const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
	fileIn.style.display = 'none'
	actionsRow.append(saveBtn, exportBtn, loadBtn, resetLayoutBtn, fileIn)

	saveBtn.onclick = () => {
		document.dispatchEvent(new CustomEvent('gpu-layout-save', { detail: { items: customGpuItems } }))
	}
	exportBtn.onclick = () => {
		document.dispatchEvent(new CustomEvent('gpu-layout-export', { detail: { items: customGpuItems } }))
	}

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
			localStorage.setItem('gpu_custom_layout', JSON.stringify(customGpuItems))
			alert('GPU layout loaded from file.')
			if (load) await load()
		} catch (e) {
			alert('Invalid GPU layout file: ' + (e?.message || e))
		}
	}
	resetLayoutBtn.onclick = async () => {
		if (confirm('Reset GPU layout from xrandr query? This will erase your saved layout.')) {
			try {
				const res = await Actions.resetGpuLayout()
				if (res && res.pairs && res.pairs.length > 0) {
					localStorage.setItem('gpu_custom_layout', JSON.stringify(res.pairs))
					if (load) load()
				} else {
					alert('Failed to fetch layout or no output from xrandr.')
				}
			} catch (e) {
				console.error(e)
				alert('Error resetting GPU layout: ' + e.message)
			}
		}
	}

	editGroup.append(listContainer, actionsRow)
	wrapCtl.append(editGroup)
}
