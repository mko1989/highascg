import * as Actions from './device-view-actions.js'
import { connectorById } from './device-view-helpers.js'
import { listAllScreenDestinationsForDeviceView } from '../lib/device-view-host-channels.js'
import { escapeHtml } from '../lib/dom-escape.js'

function extractMatrixPorts(payload) {
	const sources = []
	const sinks = []
	
	const addedIds = new Set()
	const addPort = (id, label, isSource, group) => {
		if (!id || addedIds.has(id)) return
		addedIds.add(id)
		const port = { id, label, group }
		if (isSource) sources.push(port)
		else sinks.push(port)
	}

	// 1. Screen + virtual host destinations (matrix sources / left column)
	const dests = listAllScreenDestinationsForDeviceView(payload)
	for (const d of dests) {
		const isHost = String(d?.mode || '') === 'host_channel' || d?.virtual === true
		const group = isHost ? 'Host channels' : 'Destinations'
		addPort(`dst_in_${d.id}`, d.label || d.id, true, group)
	}

	// 2. Pixel Maps — split: in on top (sink), each out on left (source)
	const mapNodes = (payload?.graph?.devices || []).filter((d) => d.role === 'pixel_mapping')
	const connectors = payload?.graph?.connectors || []
	for (const node of mapNodes) {
		const label = node.label || node.id
		const inConn = connectors.find((c) => c.deviceId === node.id && c.kind === 'pixel_map_in')
		if (inConn) addPort(inConn.id, `${label} In`, false, 'Pixel Maps')
		const outConns = connectors
			.filter((c) => c.deviceId === node.id && c.kind === 'pixel_map_out')
			.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0))
		for (const out of outConns) {
			const n = (Number(out.index) || 0) + 1
			addPort(out.id, `${label} Out ${n}`, true, 'Pixel Maps')
		}
	}

	// 3. Decklink & GPU
	const sug = Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []
	for (const c of sug) {
		if (!c || !c.id) continue
		const label = c.label || c.externalRef || c.id
		const isSink = c.kind === 'gpu_out' || c.kind === 'decklink_out' || c.kind === 'decklink_io' || c.kind === 'caspar_mv_out' || c.kind === 'stream_out' || c.kind === 'record_out' || c.kind === 'audio_out'
		const isSrc = c.kind === 'decklink_in' || c.kind === 'audio_in'
		
		let group = 'Outputs'
		if (c.kind.includes('decklink')) group = 'DeckLink'
		if (c.kind.includes('gpu')) group = 'GPU'
		if (c.kind.includes('stream') || c.kind.includes('record')) group = 'Streams/Records'
		
		if (isSink) addPort(c.id, label, false, group)
		if (isSrc) addPort(c.id, label, true, group)
	}

	// 4. Any remaining graph edges (synthetic/virtual ports)
	const edges = Array.isArray(payload?.graph?.edges) ? payload.graph.edges : []
	for (const e of edges) {
		if (e.sourceId && !addedIds.has(e.sourceId)) {
			const c = connectorById(payload, e.sourceId)
			addPort(e.sourceId, c?.label || e.sourceId, true, 'Other Sources')
		}
		if (e.sinkId && !addedIds.has(e.sinkId)) {
			const c = connectorById(payload, e.sinkId)
			addPort(e.sinkId, c?.label || e.sinkId, false, 'Other Outputs')
		}
	}

	return { sources, sinks }
}

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
		} catch(e) {}
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
		} catch(e) {}
	}
	
	const addMapBtn = document.createElement('button')
	addMapBtn.className = 'header-btn'
	addMapBtn.textContent = '+ Pixel Map'
	addMapBtn.onclick = () => { Actions.addMappingNode().then(() => loadCallback()) }

	toolbar.append(addDestBtn, addStreamBtn, addRecordBtn, addMapBtn)
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
			
			const edgeIndex = edges.findIndex(e => e.sourceId === src.id && e.sinkId === sink.id)
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
					// Disconnect
					newGraph.edges = newGraph.edges.filter(e => !(e.sourceId === src.id && e.sinkId === sink.id))
				} else {
					// Connect (add edge)
					const id = `edge_${Date.now()}_${Math.floor(Math.random() * 1000)}`
					newGraph.edges.push({ id, sourceId: src.id, sinkId: sink.id })
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
