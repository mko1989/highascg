import { buildInspectorTable } from './device-view-ui-utils.js'

export const STANDARD_VIDEO_MODES = [
	'PAL', 'NTSC', '576p2500', '720p2398', '720p2400', '720p2500', '720p2997', '720p3000', '720p5000', '720p5994', '720p6000',
	'1080i5000', '1080i5994', '1080i6000', '1080p2398', '1080p2400', '1080p2500', '1080p2997', '1080p3000', '1080p5000', '1080p5994', '1080p6000',
	'1556p2398', '1556p2400', '1556p2500', '2160p2398', '2160p2400', '2160p2500', '2160p2997', '2160p3000', '2160p5000', '2160p5994', '2160p6000',
	'dci1080p2398', 'dci1080p2400', 'dci1080p2500', 'dci2160p2398', 'dci2160p2400', 'dci2160p2500',
]

export function edgeOutputLayer(edge) {
	const raw = edge?.note
	if (raw == null || raw === '') return 1
	if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.round(raw))
	const s = String(raw || '').trim()
	if (!s) return 1
	try {
		const j = JSON.parse(s)
		const n = Number(j?.outputLayer)
		return Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1
	} catch {
		const m = s.match(/outputLayer\s*[:=]\s*(\d+)/i)
		return m ? Math.max(1, parseInt(m[1], 10) || 1) : 1
	}
}

export function renderDestinationInspector(args) {
	const {
		host,
		d,
		mode,
		intent,
		mappedOutputEdges,
		connectorById,
		patchDestination,
		removeDestination,
		updateDestinationOutputLayer,
	} = args
	const rows = [
		{ label: 'Label', value: String(d?.label || d?.id || 'Destination') },
		{ label: 'Mode', value: mode === 'pgm_only' ? 'PGM only' : (mode === 'multiview' ? 'Multiview' : 'PGM/PRV') },
		{ label: 'Main index', value: String(d?.mainScreenIndex ?? 0) },
		{ label: 'Video mode', value: String(d?.videoMode || '1080p5000') },
		{ label: 'Resolution', value: `${Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920)}x${Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080)}` },
		{ label: 'FPS', value: String(Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50)) },
		{ label: 'PGM channel', value: intent?.pgmChannel != null ? String(intent.pgmChannel) : '-' },
	]
	if (mode !== 'pgm_only' && mode !== 'multiview') {
		rows.push({
			label: 'PRV channel',
			value: intent == null ? '-' : String(intent.previewChannelIntended ?? intent.previewChannelGenerated ?? '-'),
		})
	}
	const table = buildInspectorTable(rows)
	const edits = document.createElement('div')
	edits.className = 'device-view__inspector-links'
	const outputMapWrap = document.createElement('div')
	outputMapWrap.className = 'device-view__kv'
	const outputMapTitle = document.createElement('div')
	outputMapTitle.className = 'device-view__kv-row'
	outputMapTitle.innerHTML = '<span class="device-view__kv-key">Mapped outputs</span><span class="device-view__kv-val"></span>'
	outputMapWrap.appendChild(outputMapTitle)
	if (mappedOutputEdges.length) {
		for (const edge of mappedOutputEdges) {
			const c = connectorById.get(String(edge?.sinkId || '')) || null
			const row = document.createElement('div')
			row.className = 'device-view__kv-row'
			
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'device-view__inspector-link-btn'
			btn.textContent = String(c?.label || edge?.sinkId || 'Output')
			btn.title = 'Click to go to this output connector inspector'
			btn.onclick = () => {
				window.dispatchEvent(new CustomEvent('highascg-device-view-focus-connector', { 
					detail: { connectorId: edge.sinkId } 
				}))
			}

			const layerInfo = document.createElement('span')
			layerInfo.className = 'device-view__kv-val'
			layerInfo.style.opacity = '0.5'
			layerInfo.style.fontSize = '11px'
			const layer = edgeOutputLayer(edge)
			if (layer > 1) {
				layerInfo.textContent = ` (Layer ${layer})`
			}

			row.append(btn, layerInfo)
			outputMapWrap.appendChild(row)
		}
	} else {
		const row = document.createElement('div')
		row.className = 'device-view__kv-row'
		row.innerHTML = '<span class="device-view__kv-key"></span><span class="device-view__kv-val">No mapped outputs yet.</span>'
		outputMapWrap.appendChild(row)
	}

	const nameIn = document.createElement('input')
	nameIn.type = 'text'
	nameIn.className = 'device-view__destinations-type'
	nameIn.value = String(d?.label || d?.id || '')
	nameIn.placeholder = 'Destination label'
	nameIn.addEventListener('change', () => patchDestination(d.id, { label: String(nameIn.value || '').trim() || String(d?.label || d?.id || 'Destination') }))

	const mainIn = document.createElement('input')
	mainIn.type = 'number'
	mainIn.min = '0'
	mainIn.step = '1'
	mainIn.className = 'device-view__destinations-type'
	mainIn.value = String(Math.max(0, parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0))
	mainIn.title = 'Main index (zero-based)'
	mainIn.addEventListener('change', () => patchDestination(d.id, { mainScreenIndex: Math.max(0, parseInt(String(mainIn.value || 0), 10) || 0) }))

	const modeSel = document.createElement('select')
	modeSel.className = 'device-view__destinations-type'
	modeSel.innerHTML = '<option value="pgm_prv">PGM/PRV</option><option value="pgm_only">PGM only</option><option value="multiview">Multiview</option>'
	modeSel.value = mode === 'pgm_only' ? 'pgm_only' : (mode === 'multiview' ? 'multiview' : 'pgm_prv')
	modeSel.addEventListener('change', () => patchDestination(d.id, { mode: modeSel.value }))

	const vmSel = document.createElement('select')
	vmSel.className = 'device-view__destinations-type'
	vmSel.innerHTML = `<option value="custom">Custom</option>${STANDARD_VIDEO_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}`
	const currentMode = String(d?.videoMode || '1080p5000')
	vmSel.value = STANDARD_VIDEO_MODES.includes(currentMode) ? currentMode : 'custom'
	vmSel.addEventListener('change', () => {
		if (vmSel.value === 'custom') {
			patchDestination(d.id, {
				videoMode: 'custom',
				width: Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920),
				height: Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080),
				fps: Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50),
			})
			return
		}
		patchDestination(d.id, { videoMode: vmSel.value })
	})

	const widthIn = document.createElement('input')
	widthIn.type = 'number'
	widthIn.min = '64'
	widthIn.step = '1'
	widthIn.className = 'device-view__destinations-type'
	widthIn.placeholder = 'Width'
	widthIn.value = String(Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920))
	widthIn.disabled = vmSel.value !== 'custom'
	const ensureCustomModeSelected = () => {
		if (vmSel.value !== 'custom') vmSel.value = 'custom'
		widthIn.disabled = false
		heightIn.disabled = false
		fpsIn.disabled = false
	}
	widthIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		const width = Math.max(64, parseInt(String(widthIn.value || 1920), 10) || 1920)
		const fallbackHeight = d?.height ?? 1080
		const height = Math.max(64, parseInt(String(heightIn.value || fallbackHeight), 10) || 1080)
		patchDestination(d.id, { videoMode: 'custom', width, height })
	})

	const heightIn = document.createElement('input')
	heightIn.type = 'number'
	heightIn.min = '64'
	heightIn.step = '1'
	heightIn.className = 'device-view__destinations-type'
	heightIn.placeholder = 'Height'
	heightIn.value = String(Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080))
	heightIn.disabled = vmSel.value !== 'custom'
	heightIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		const fallbackWidth = d?.width ?? 1920
		const width = Math.max(64, parseInt(String(widthIn.value || fallbackWidth), 10) || 1920)
		const height = Math.max(64, parseInt(String(heightIn.value || 1080), 10) || 1080)
		patchDestination(d.id, { videoMode: 'custom', width, height })
	})

	const fpsIn = document.createElement('input')
	fpsIn.type = 'number'
	fpsIn.min = '1'
	fpsIn.step = '0.01'
	fpsIn.className = 'device-view__destinations-type'
	fpsIn.placeholder = 'Frame rate'
	fpsIn.value = String(Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50))
	fpsIn.disabled = vmSel.value !== 'custom'
	fpsIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		patchDestination(d.id, { videoMode: 'custom', fps: parseFloat(String(fpsIn.value || 50)) || 50 })
	})
	vmSel.addEventListener('change', () => {
		const custom = vmSel.value === 'custom'
		widthIn.disabled = !custom
		heightIn.disabled = !custom
		fpsIn.disabled = !custom
	})

	const rm = document.createElement('button')
	rm.type = 'button'
	rm.className = 'header-btn'
	rm.textContent = 'Remove destination'
	rm.addEventListener('click', () => removeDestination(d.id))

	edits.append(nameIn, mainIn, modeSel, vmSel, widthIn, heightIn, fpsIn, rm)
	host.append(
		Object.assign(document.createElement('p'), { className: 'device-view__status', textContent: 'Selected destination' }),
		table,
		outputMapWrap,
		edits
	)
}
