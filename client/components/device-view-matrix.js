import * as Actions from './device-view-actions.js'
import { edgeOutputLayer } from '../lib/device-view-output-layer.js'
import { extractMatrixPorts } from '../lib/device-view-matrix-ports.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { getAppStateStore } from '../lib/app-runtime.js'
import { showLiveInputModal } from './live-input-modal.js'
import { saveVirtualCameraConfig } from '../lib/virtual-camera-state.js'

export function renderMatrix(matrixHost, payload, pushUndo, setCasparRestartDirty, loadCallback, selectKey, selectDestinationById) {
	matrixHost.innerHTML = ''
	
	const toolbar = document.createElement('div')
	toolbar.className = 'device-view-matrix__toolbar'
	toolbar.style.cssText = 'padding: 8px 12px; display: flex; gap: 8px; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(255,255,255,0.05);'
	
	const addDestBtn = document.createElement('button')
	addDestBtn.className = 'header-btn'
	addDestBtn.textContent = '+ Destination'
	addDestBtn.onclick = () => { Actions.addDestination({ mode: 'pgm_prv' }).then(() => loadCallback()) }

	const addStreamBtn = document.createElement('button')
	addStreamBtn.className = 'header-btn'
	addStreamBtn.textContent = '+ Stream'
	addStreamBtn.onclick = async () => {
		try {
			const cur = Array.isArray(payload?.settings?.streamOutputs) ? payload.settings.streamOutputs : []
			const idx = cur.length + 1
			const next = [...cur, { id: `str_${idx}`, label: `Str${idx}`, enabled: true, type: 'rtmp', name: `Str${idx}`, quality: 'medium', rtmpServerUrl: '', streamKey: '', srtUrl: '' }]
			await Actions.saveSettingsPatch({ streamOutputs: next })
			loadCallback()
		} catch {}
	}

	const addRecordBtn = document.createElement('button')
	addRecordBtn.className = 'header-btn'
	addRecordBtn.textContent = '+ Record'
	addRecordBtn.onclick = async () => {
		try {
			const cur = Array.isArray(payload?.settings?.recordOutputs) ? payload.settings.recordOutputs : []
			const idx = cur.length + 1
			const next = [...cur, { id: `rec_${idx}`, label: `Rec${idx}`, enabled: true, type: 'h264', name: `Rec${idx}`, quality: 'medium' }]
			await Actions.saveSettingsPatch({ recordOutputs: next })
			loadCallback()
		} catch {}
	}
	
	const addMapBtn = document.createElement('button')
	addMapBtn.className = 'header-btn'
	addMapBtn.textContent = '+ Pixel Map'
	addMapBtn.onclick = () => { Actions.addMappingNode().then(() => loadCallback()) }

	const addLiveBtn = document.createElement('button')
	addLiveBtn.className = 'header-btn'
	addLiveBtn.textContent = '+ Live input'
	addLiveBtn.onclick = () => {
		const store = getAppStateStore()
		if (!store) return
		showLiveInputModal(store, { onAdded: () => loadCallback() })
	}

	const addVcamBtn = document.createElement('button')
	addVcamBtn.className = 'header-btn'
	addVcamBtn.textContent = '+ Virtual cam'
	addVcamBtn.onclick = async () => {
		try {
			await saveVirtualCameraConfig(
				{
					showInDeviceView: true,
					label: 'Virtual cam',
					channel: 1,
					device: '/dev/video10',
					width: 1920,
					height: 1080,
					fps: 50,
					audioEnabled: true,
				},
				{ persist: true },
			)
			loadCallback()
		} catch {
			/* ignore */
		}
	}

	toolbar.append(addDestBtn, addLiveBtn, addStreamBtn, addRecordBtn, addVcamBtn, addMapBtn)
	matrixHost.appendChild(toolbar)

	const { sources, sinks } = extractMatrixPorts(payload)
	const edges = Array.isArray(payload?.graph?.edges) ? payload.graph.edges : []
	
	const table = document.createElement('table')
	table.className = 'device-view-matrix__table'
	
	// Top Header Row (Sinks)
	const thead = document.createElement('thead')
	const topTr = document.createElement('tr')
	
	// Empty top-left corner over the Source column
	const trCorner = document.createElement('th')
	trCorner.className = 'device-view-matrix__th-corner'
	trCorner.textContent = 'Sources'
	topTr.appendChild(trCorner)
	
	sinks.forEach(sink => {
		const th = document.createElement('th')
		th.className = 'device-view-matrix__th-sink device-view-matrix__th--clickable'
		th.innerHTML = `<span>${escapeHtml(sink.label)}</span><br><small>${escapeHtml(sink.group)}</small>`
		th.addEventListener('click', () => {
			if (sink.id.startsWith('dst_in_')) {
				selectDestinationById(sink.id.replace('dst_in_', ''))
			} else {
				selectKey('conn:' + sink.id)
			}
		})
		topTr.appendChild(th)
	})
	
	thead.appendChild(topTr)
	table.appendChild(thead)
	
	// Body Rows (Sources on Left)
	const tbody = document.createElement('tbody')
	sources.forEach(src => {
		const tr = document.createElement('tr')
		
		// Source label on the LEFT
		const thSrc = document.createElement('th')
		thSrc.className = 'device-view-matrix__th-source device-view-matrix__th--clickable'
		thSrc.innerHTML = `<span>${escapeHtml(src.label)}</span><br><small>${escapeHtml(src.group)}</small>`
		thSrc.addEventListener('click', () => {
			if (src.id.startsWith('dst_in_')) {
				selectDestinationById(src.id.replace('dst_in_', ''))
			} else {
				selectKey('conn:' + src.id)
			}
		})
		tr.appendChild(thSrc)
		
		sinks.forEach(sink => {
			const td = document.createElement('td')
			td.className = 'device-view-matrix__cell'
			
			const rowLayer = src.half === 'prv' ? 2 : 1
			const edgeIndex = edges.findIndex(
				e => e.sourceId === src.id && e.sinkId === sink.id && (!src.half || edgeOutputLayer(e) === rowLayer),
			)
			const isActive = edgeIndex !== -1
			
			if (isActive) {
				td.classList.add('device-view-matrix__cell--active')
				td.innerHTML = '<div class="matrix-dot"></div>'
			} else {
				td.innerHTML = '<div class="matrix-dot matrix-dot--empty"></div>'
			}
			
			td.addEventListener('click', async () => {
				pushUndo()
				const newGraph = JSON.parse(JSON.stringify(payload.graph || { edges: [], connectors: [] }))
				
				if (isActive) {
					// Disconnect (only this half's edge — WO-364)
					newGraph.edges = newGraph.edges.filter(
						e => !(e.sourceId === src.id && e.sinkId === sink.id && (!src.half || edgeOutputLayer(e) === rowLayer)),
					)
				} else {
					// Connect (add edge; a PRV row notes outputLayer 2 — WO-364)
					const id = `edge_${Date.now()}_${Math.floor(Math.random() * 1000)}`
					const edge = { id, sourceId: src.id, sinkId: sink.id }
					if (src.half === 'prv') edge.note = JSON.stringify({ outputLayer: 2 })
					newGraph.edges.push(edge)
				}
				
				try {
					await Actions.saveSettingsPatch({ deviceGraph: newGraph })
					setCasparRestartDirty(true)
					await loadCallback()
				} catch (err) {
					console.error('Matrix route error', err)
				}
			})
			
			tr.appendChild(td)
		})
		
		tbody.appendChild(tr)
	})
	
	table.appendChild(tbody)
	matrixHost.appendChild(table)
}
