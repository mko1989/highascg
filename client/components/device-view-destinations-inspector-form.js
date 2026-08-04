import { buildInspectorTable } from './device-view-ui-utils.js'
import { PROGRAM_LAYOUT_OPTIONS } from '../lib/audio-channel-layouts.js'
import { defaultVideoModeForProjectFps, resolveProjectFpsFromSettings } from '../lib/project-fps.js'
import { renderHostChannelDestinationInspector } from './device-view-destinations-inspector-host-channel.js'
import { buildOperatorGuiFields } from './device-view-destinations-inspector-operator-gui-fields.js'
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
		{
			label: 'Mode',
			value:
				mode === 'pgm_only'
					? 'PGM only'
					: mode === 'multiview'
						? 'Multiview'
						: mode === 'pixelmap'
							? 'Pixel Map (native Art-Net)'
							: mode === 'operator_gui'
								? 'Operator GUI (Firefox + shaped overlay)'
								: 'PGM/PRV',
		},
		{ label: 'Main index', value: String(d?.mainScreenIndex ?? 0) },
		...(mode !== 'multiview' && mode !== 'stream' && mode !== 'operator_gui'
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
	if (mode !== 'pgm_only' && mode !== 'multiview' && mode !== 'pixelmap' && mode !== 'operator_gui') {
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
	nameIn.placeholder = 'Name'
	// WO-385: for a screen destination this name IS the screen's name everywhere (looks selector,
	// multiview, panels, Companion) — there is no second "screen label" to keep in step.
	nameIn.title =
		mode === 'pgm_prv' || mode === 'pgm_only'
			? 'Name of this screen — shown in the looks selector, multiview, panels and Companion'
			: 'Name of this destination'
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

	// WO-385: the separate "Screen label" field is gone (owner: "name and label should be one
	// thing"). The destination's own name above IS the screen name everywhere — looks selector,
	// multiview, panels, Companion — derived by screenLabelsFromConfig (src/config/screen-destinations.js).
	// It also never worked: its POST body was read as an object while routes receive a raw string,
	// so every save bailed out and answered an empty 200 that looked like success.

	const modeSel = document.createElement('select')
	modeSel.className = 'device-view__destinations-type'
	for (const opt of [
		{ value: 'pgm_prv', label: 'PGM/PRV' },
		{ value: 'pgm_only', label: 'PGM only' },
		{ value: 'multiview', label: 'Multiview' },
		{ value: 'pixelmap', label: 'Pixel Map (native Art-Net)' },
		{ value: 'operator_gui', label: 'Operator GUI (Firefox + shaped overlay)' },
	]) {
		const option = document.createElement('option')
		option.value = opt.value
		option.textContent = opt.label
		modeSel.appendChild(option)
	}
	modeSel.value =
		mode === 'pgm_only'
			? 'pgm_only'
			: (mode === 'multiview'
				? 'multiview'
				: (mode === 'pixelmap' ? 'pixelmap' : (mode === 'operator_gui' ? 'operator_gui' : 'pgm_prv')))
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

	// WO-242: fixture-array fields for the native <artnet> consumer — schema mirrors
	// docs/WALKTHROUGH_ARTNET_LED_WALL.md exactly (rows/cols -> fixture-count "cols x rows",
	// start-universe/start-address/color-order/refresh-rate map 1:1 onto <fixture>/<refresh-rate>).
	let pixelmapFields = []
	if (mode === 'pixelmap') {
		const art = d?.artnet && typeof d.artnet === 'object' ? d.artnet : {}
		const field = (labelText, input) => {
			const wrap = Object.assign(document.createElement('div'), {
				style: 'display:flex; flex-direction:column; gap:4px; width:100%',
			})
			const lab = Object.assign(document.createElement('label'), {
				className: 'device-view__inspector-label',
				textContent: labelText,
				style: 'font-size:10px;opacity:.7',
			})
			wrap.append(lab, input)
			return wrap
		}
		const patchArtnet = (patch) => patchDestination(d.id, { artnet: patch })

		const ipIn = document.createElement('input')
		ipIn.type = 'text'
		ipIn.className = 'device-view__destinations-type'
		ipIn.placeholder = '192.168.1.50'
		ipIn.value = String(art.ip || '')
		ipIn.title = 'Art-Net controller / node IP (fixture/host — required, valid IPv4)'
		ipIn.addEventListener('change', () => patchArtnet({ ip: String(ipIn.value || '').trim() }))

		const colsIn = document.createElement('input')
		colsIn.type = 'number'
		colsIn.min = '1'
		colsIn.step = '1'
		colsIn.className = 'device-view__destinations-type'
		colsIn.title = 'Fixture columns (horizontal panel count)'
		colsIn.value = String(Math.max(1, parseInt(String(art.cols ?? 1), 10) || 1))
		colsIn.addEventListener('change', () => patchArtnet({ cols: Math.max(1, parseInt(String(colsIn.value || 1), 10) || 1) }))
		attachMathInput(colsIn, { decimals: 0 })

		const rowsIn = document.createElement('input')
		rowsIn.type = 'number'
		rowsIn.min = '1'
		rowsIn.step = '1'
		rowsIn.className = 'device-view__destinations-type'
		rowsIn.title = 'Fixture rows (vertical panel count)'
		rowsIn.value = String(Math.max(1, parseInt(String(art.rows ?? 1), 10) || 1))
		rowsIn.addEventListener('change', () => patchArtnet({ rows: Math.max(1, parseInt(String(rowsIn.value || 1), 10) || 1) }))
		attachMathInput(rowsIn, { decimals: 0 })

		const colorOrderSel = document.createElement('select')
		colorOrderSel.className = 'device-view__destinations-type'
		colorOrderSel.title = 'Fixture type (fixture/type)'
		for (const opt of [{ value: 'RGB', label: 'RGB (3ch)' }, { value: 'RGBW', label: 'RGBW (4ch)' }]) {
			const option = document.createElement('option')
			option.value = opt.value
			option.textContent = opt.label
			colorOrderSel.appendChild(option)
		}
		colorOrderSel.value = String(art.colorOrder || 'RGB').toUpperCase() === 'RGBW' ? 'RGBW' : 'RGB'
		colorOrderSel.addEventListener('change', () => patchArtnet({ colorOrder: colorOrderSel.value }))

		const startUniverseIn = document.createElement('input')
		startUniverseIn.type = 'number'
		startUniverseIn.min = '0'
		startUniverseIn.max = '32767'
		startUniverseIn.step = '1'
		startUniverseIn.className = 'device-view__destinations-type'
		startUniverseIn.title = 'Start Art-Net universe (fixture/universe, 0-32767). Additional universes auto-spill upward.'
		startUniverseIn.value = String(Math.min(32767, Math.max(0, parseInt(String(art.startUniverse ?? 0), 10) || 0)))
		startUniverseIn.addEventListener('change', () =>
			patchArtnet({ startUniverse: Math.min(32767, Math.max(0, parseInt(String(startUniverseIn.value || 0), 10) || 0)) }),
		)
		attachMathInput(startUniverseIn, { decimals: 0 })

		const startAddressIn = document.createElement('input')
		startAddressIn.type = 'number'
		startAddressIn.min = '1'
		startAddressIn.max = '512'
		startAddressIn.step = '1'
		startAddressIn.className = 'device-view__destinations-type'
		startAddressIn.title = 'Start DMX channel of the first fixture (fixture/start-address, 1-512)'
		startAddressIn.value = String(Math.min(512, Math.max(1, parseInt(String(art.startAddress ?? 1), 10) || 1)))
		startAddressIn.addEventListener('change', () =>
			patchArtnet({ startAddress: Math.min(512, Math.max(1, parseInt(String(startAddressIn.value || 1), 10) || 1)) }),
		)
		attachMathInput(startAddressIn, { decimals: 0 })

		const refreshRateIn = document.createElement('input')
		refreshRateIn.type = 'number'
		refreshRateIn.min = '1'
		refreshRateIn.step = '1'
		refreshRateIn.className = 'device-view__destinations-type'
		refreshRateIn.title = 'DMX sends/sec, decoupled from the channel video rate (refresh-rate, default 10)'
		refreshRateIn.value = String(Math.max(1, parseInt(String(art.refreshRateHz ?? 10), 10) || 10))
		refreshRateIn.addEventListener('change', () =>
			patchArtnet({ refreshRateHz: Math.max(1, parseInt(String(refreshRateIn.value || 10), 10) || 10) }),
		)
		attachMathInput(refreshRateIn, { decimals: 0 })

		pixelmapFields = [
			field('Controller IP', ipIn),
			field('Fixture columns', colsIn),
			field('Fixture rows', rowsIn),
			field('Fixture type', colorOrderSel),
			field('Start universe', startUniverseIn),
			field('Start DMX address', startAddressIn),
			field('DMX refresh rate (Hz)', refreshRateIn),
		]

		const note = document.createElement('p')
		note.className = 'device-view__note'
		note.textContent =
			'This channel samples its own full raster into one native <artnet> fixture group (whole-frame area averaging). Universes beyond the first auto-spill per the deployed consumer’s addressing rule. Regenerate + restart Caspar to apply.'
		pixelmapFields.push(note)
	}

	// WO-243: guiUrl/physicalPort fields for the operator_gui destination — extracted to keep this
	// file under the repo's ~500-line target (device-view-destinations-inspector-operator-gui-fields.js).
	const operatorGuiFields = mode === 'operator_gui' ? buildOperatorGuiFields({ d, patchDestination }) : []

	edits.append(nameIn, mainIn, modeSel)
	if (mode !== 'multiview' && mode !== 'stream' && mode !== 'operator_gui') {
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
	edits.append(vmSel, widthIn, heightIn, fpsIn)
	if (pixelmapFields.length) edits.append(...pixelmapFields)
	if (operatorGuiFields.length) edits.append(...operatorGuiFields)
	edits.append(rm)
	host.append(
		Object.assign(document.createElement('p'), { className: 'device-view__status', textContent: 'Selected destination' }),
		table,
		outputMapWrap,
		edits
	)
}
