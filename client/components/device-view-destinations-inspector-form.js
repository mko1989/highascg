import { buildInspectorTable } from './device-view-ui-utils.js'
import { PROGRAM_LAYOUT_OPTIONS } from '../lib/audio-channel-layouts.js'
import { defaultVideoModeForProjectFps, resolveProjectFpsFromSettings } from '../lib/project-fps.js'
import { renderHostChannelDestinationInspector } from './device-view-destinations-inspector-host-channel.js'
import { attachMathInput } from '../lib/math-input.js'
import {
	STANDARD_VIDEO_MODES,
	CASPAR_VIDEO_MODE_SPECS,
	edgeOutputLayer,
} from './device-view-destinations-inspector-modes.js'

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
		currentSettings,
		lastPayload,
		onWebpageHostApplied,
		onHostInputRemoved,
	} = args
	const projectDefaultMode = defaultVideoModeForProjectFps(resolveProjectFpsFromSettings(currentSettings))

	if (renderHostChannelDestinationInspector({
		host,
		d,
		mode,
		intent,
		mappedOutputEdges,
		connectorById,
		removeDestination,
		currentSettings,
		lastPayload,
		onWebpageHostApplied,
		onHostInputRemoved,
	})) {
		return
	}

	const rows = [
		{ label: 'Label', value: String(d?.label || d?.id || 'Destination') },
		{ label: 'Mode', value: mode === 'pgm_only' ? 'PGM only' : (mode === 'multiview' ? 'Multiview' : 'PGM/PRV') },
		{ label: 'Main index', value: String(d?.mainScreenIndex ?? 0) },
		...(mode !== 'multiview' && mode !== 'stream'
			? [{
				label: 'Audio outputs',
				value: PROGRAM_LAYOUT_OPTIONS.find((o) => o.value === String(d?.audioLayout || 'stereo'))?.label
					|| String(d?.audioLayout || 'stereo'),
			}]
			: []),
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
	const summaryValByLabel = new Map()
	for (const row of table.querySelectorAll('.device-view__kv-row')) {
		const label = row.querySelector('.device-view__kv-key')?.textContent
		const val = row.querySelector('.device-view__kv-val')
		if (label && val) summaryValByLabel.set(label, val)
	}
	const syncVideoModeSummary = (mode, width, height, fps) => {
		summaryValByLabel.get('Video mode')?.replaceChildren(document.createTextNode(String(mode)))
		summaryValByLabel.get('Resolution')?.replaceChildren(document.createTextNode(`${width}x${height}`))
		summaryValByLabel.get('FPS')?.replaceChildren(document.createTextNode(String(fps)))
	}
	const syncAudioOutputsSummary = (layoutId) => {
		const opt = PROGRAM_LAYOUT_OPTIONS.find((o) => o.value === String(layoutId || 'stereo'))
		summaryValByLabel.get('Audio outputs')?.replaceChildren(
			document.createTextNode(opt?.label || String(layoutId || 'stereo')),
		)
	}
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
	attachMathInput(mainIn, { decimals: 0 })

	const modeSel = document.createElement('select')
	modeSel.className = 'device-view__destinations-type'
	for (const opt of [
		{ value: 'pgm_prv', label: 'PGM/PRV' },
		{ value: 'pgm_only', label: 'PGM only' },
		{ value: 'multiview', label: 'Multiview' },
	]) {
		const option = document.createElement('option')
		option.value = opt.value
		option.textContent = opt.label
		modeSel.appendChild(option)
	}
	modeSel.value = mode === 'pgm_only' ? 'pgm_only' : (mode === 'multiview' ? 'multiview' : 'pgm_prv')
	modeSel.addEventListener('change', () => patchDestination(d.id, { mode: modeSel.value }))

	const audioOutputsFieldId = `dest_audio_outputs_${String(d?.id || 'dest').replace(/[^a-zA-Z0-9_-]/g, '_')}`
	const audioLayoutSel = document.createElement('select')
	audioLayoutSel.id = audioOutputsFieldId
	audioLayoutSel.className = 'device-view__destinations-type'
	audioLayoutSel.title = 'Number of audio output channels for this destination (program bus width)'
	for (const o of PROGRAM_LAYOUT_OPTIONS) {
		const opt = document.createElement('option')
		opt.value = o.value
		opt.textContent = o.label
		audioLayoutSel.appendChild(opt)
	}
	audioLayoutSel.value = PROGRAM_LAYOUT_OPTIONS.some((o) => o.value === String(d?.audioLayout || 'stereo'))
		? String(d?.audioLayout || 'stereo')
		: 'stereo'
	audioLayoutSel.addEventListener('change', () => {
		patchDestination(d.id, { audioLayout: audioLayoutSel.value })
		syncAudioOutputsSummary(audioLayoutSel.value)
	})

	const vmSel = document.createElement('select')
	vmSel.className = 'device-view__destinations-type'
	for (const opt of [{ value: 'custom', label: 'Custom' }, ...STANDARD_VIDEO_MODES.map((m) => ({ value: m, label: m }))]) {
		const option = document.createElement('option')
		option.value = opt.value
		option.textContent = opt.label
		vmSel.appendChild(option)
	}
	const currentMode = String(
		d?.videoMode || (d?.inheritsProjectFps !== false ? projectDefaultMode : '1080p5000'),
	)
	vmSel.value = STANDARD_VIDEO_MODES.includes(currentMode) ? currentMode : 'custom'

	const widthIn = document.createElement('input')
	widthIn.type = 'number'
	widthIn.min = '64'
	widthIn.step = '1'
	widthIn.className = 'device-view__destinations-type'
	widthIn.placeholder = 'Width'
	widthIn.value = String(Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920))
	widthIn.disabled = vmSel.value !== 'custom'
	attachMathInput(widthIn, { decimals: 0 })

	const heightIn = document.createElement('input')
	heightIn.type = 'number'
	heightIn.min = '64'
	heightIn.step = '1'
	heightIn.className = 'device-view__destinations-type'
	heightIn.placeholder = 'Height'
	heightIn.value = String(Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080))
	heightIn.disabled = vmSel.value !== 'custom'
	attachMathInput(heightIn, { decimals: 0 })

	const fpsIn = document.createElement('input')
	fpsIn.type = 'number'
	fpsIn.min = '1'
	fpsIn.step = '0.01'
	fpsIn.className = 'device-view__destinations-type'
	fpsIn.placeholder = 'Frame rate'
	fpsIn.value = String(Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50))
	fpsIn.disabled = vmSel.value !== 'custom'
	attachMathInput(fpsIn, { decimals: 2 })

	const applyStandardVideoMode = (modeId) => {
		const spec = CASPAR_VIDEO_MODE_SPECS[modeId]
		if (!spec) return
		widthIn.value = String(spec.width)
		heightIn.value = String(spec.height)
		fpsIn.value = String(spec.fps)
		widthIn.disabled = true
		heightIn.disabled = true
		fpsIn.disabled = true
		syncVideoModeSummary(modeId, spec.width, spec.height, spec.fps)
		patchDestination(d.id, { videoMode: modeId, width: spec.width, height: spec.height, fps: spec.fps, inheritsProjectFps: false })
	}
	vmSel.addEventListener('change', () => {
		if (vmSel.value === 'custom') {
			const width = Math.max(64, parseInt(String(d?.width ?? 1920), 10) || 1920)
			const height = Math.max(64, parseInt(String(d?.height ?? 1080), 10) || 1080)
			const fps = Math.max(1, parseFloat(String(d?.fps ?? 50)) || 50)
			widthIn.value = String(width)
			heightIn.value = String(height)
			fpsIn.value = String(fps)
			widthIn.disabled = false
			heightIn.disabled = false
			fpsIn.disabled = false
			syncVideoModeSummary('custom', width, height, fps)
			patchDestination(d.id, { videoMode: 'custom', width, height, fps, inheritsProjectFps: false })
			return
		}
		applyStandardVideoMode(vmSel.value)
	})

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
		const fps = Math.max(1, parseFloat(String(fpsIn.value || (d?.fps ?? 50))) || 50)
		syncVideoModeSummary('custom', width, height, fps)
		patchDestination(d.id, { videoMode: 'custom', width, height })
	})

	heightIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		const fallbackWidth = d?.width ?? 1920
		const width = Math.max(64, parseInt(String(widthIn.value || fallbackWidth), 10) || 1920)
		const height = Math.max(64, parseInt(String(heightIn.value || 1080), 10) || 1080)
		const fps = Math.max(1, parseFloat(String(fpsIn.value || (d?.fps ?? 50))) || 50)
		syncVideoModeSummary('custom', width, height, fps)
		patchDestination(d.id, { videoMode: 'custom', width, height })
	})

	fpsIn.addEventListener('change', () => {
		ensureCustomModeSelected()
		const width = Math.max(64, parseInt(String(widthIn.value || (d?.width ?? 1920)), 10) || 1920)
		const height = Math.max(64, parseInt(String(heightIn.value || (d?.height ?? 1080)), 10) || 1080)
		const fps = Math.max(1, parseFloat(String(fpsIn.value || 50)) || 50)
		syncVideoModeSummary('custom', width, height, fps)
		patchDestination(d.id, { videoMode: 'custom', fps })
	})
	const rm = document.createElement('button')
	rm.type = 'button'
	rm.className = 'header-btn'
	rm.textContent = 'Remove destination'
	rm.addEventListener('click', () => removeDestination(d.id))

	edits.append(nameIn, mainIn, modeSel)
	if (mode !== 'multiview' && mode !== 'stream') {
		const audioOutputsWrap = Object.assign(document.createElement('div'), {
			style: 'display:flex; flex-direction:column; gap:4px; width:100%',
		})
		const audioLab = Object.assign(document.createElement('label'), {
			className: 'device-view__inspector-label',
			htmlFor: audioOutputsFieldId,
			textContent: 'Audio outputs',
			style: 'font-size:10px;opacity:.7',
		})
		audioOutputsWrap.append(audioLab, audioLayoutSel)
		edits.append(audioOutputsWrap)
	}
	edits.append(vmSel, widthIn, heightIn, fpsIn, rm)
	host.append(
		Object.assign(document.createElement('p'), { className: 'device-view__status', textContent: 'Selected destination' }),
		table,
		outputMapWrap,
		edits
	)
}
