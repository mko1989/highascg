/**
 * GPU Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { STANDARD_VIDEO_MODES, casparVideoModeToOsModeAndRate, CASPAR_VIDEO_MODE_SPECS } from './device-view-destinations-inspector.js'

export function renderGpuOutControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, connectorCtx }) {
	/** Must match `calculateLayoutPositions` graph-bound logic: screen index from binding / destination, not GPU list order. */
	const resolveGpuScreenNumber = (c) => {
		const ob = c?.caspar?.outputBinding
		if (ob && String(ob.type || '').toLowerCase() === 'screen') {
			const idx = parseInt(String(ob.index ?? ''), 10)
			if (Number.isFinite(idx) && idx >= 1) return Math.max(1, Math.min(4, idx))
		}
		const edges = lastPayload?.graph?.edges || []
		const inEdge = edges.find((e) => String(e?.sinkId || '') === String(c?.id || ''))
		if (inEdge) {
			const srcId = String(inEdge.sourceId || '')
			if (srcId.startsWith('dst_in_')) {
				const dstId = srcId.slice('dst_in_'.length)
				const dests = lastPayload?.screenDestinations?.destinations || []
				const d = dests.find((x) => String(x?.id || '') === dstId)
				if (d) {
					const dMode = String(d.mode || 'pgm_prv').toLowerCase()
					if (dMode !== 'multiview' && dMode !== 'stream') {
						const ms = parseInt(String(d.mainScreenIndex ?? 0), 10) || 0
						return Math.max(1, Math.min(4, ms + 1))
					}
				}
			}
		}
		const mainIdx = Number(c?.caspar?.mainIndex)
		if (Number.isFinite(mainIdx) && mainIdx >= 0) return Math.max(1, Math.min(4, Math.round(mainIdx) + 1))
		const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
		const gpu = sug.filter((x) => x && x.kind === 'gpu_out')
		const idx = gpu.findIndex((x) => String(x?.id || '') === String(c?.id || ''))
		return idx >= 0 ? Math.max(1, Math.min(4, idx + 1)) : 1
	}
	const cs = currentSettings?.casparServer && typeof currentSettings.casparServer === 'object' ? currentSettings.casparServer : {}
	const screenN = resolveGpuScreenNumber(conn)
	const keyWindowed = `screen_${screenN}_windowed`
	const keyVsync = `screen_${screenN}_vsync`
	const keyBorderless = `screen_${screenN}_borderless`
	const keyEdid = `screen_${screenN}_edid_override`
	const keyStretch = `screen_${screenN}_stretch`
	const keyKeyOnly = `screen_${screenN}_key_only`
	const keyAlwaysOnTop = `screen_${screenN}_always_on_top`
	const keyInteractive = `screen_${screenN}_interactive`
	const keySbsKey = `screen_${screenN}_sbs_key`
	const keyColourSpace = `screen_${screenN}_colour_space`
	const keyForceLinear = `screen_${screenN}_force_linear_filter`
	const keyMipmaps = `screen_${screenN}_enable_mipmaps`
	const keyHighBitdepth = `screen_${screenN}_high_bitdepth`
	const keyName = `screen_${screenN}_name`
	const keyAspectRatio = `screen_${screenN}_aspect_ratio`
	const keyPosX = `screen_${screenN}_x`
	const keyPosY = `screen_${screenN}_y`
	const keyForceOsRes = `screen_${screenN}_force_os_resolution`
	const windowedOn = cs[keyWindowed] !== false && cs[keyWindowed] !== 'false'
	const vsyncOn = cs[keyVsync] !== false && cs[keyVsync] !== 'false'
	const borderlessOn = cs[keyBorderless] === true || cs[keyBorderless] === 'true'
	const edidOverride = String(cs[keyEdid] || conn?.caspar?.edidOverride || '')
	const stretchVal = String(cs[keyStretch] || 'none')
	const keyOnlyOn = cs[keyKeyOnly] === true || cs[keyKeyOnly] === 'true'
	const alwaysOnTopOn = cs[keyAlwaysOnTop] !== false && cs[keyAlwaysOnTop] !== 'false'
	const interactiveOn = cs[keyInteractive] === true || cs[keyInteractive] === 'true'
	const sbsKeyOn = cs[keySbsKey] === true || cs[keySbsKey] === 'true'
	const colourSpaceVal = String(cs[keyColourSpace] || 'RGB')
	const forceLinearOn = cs[keyForceLinear] !== false && cs[keyForceLinear] !== 'false'
	const mipmapsOn = cs[keyMipmaps] === true || cs[keyMipmaps] === 'true'
	const highBitdepthOn = cs[keyHighBitdepth] === true || cs[keyHighBitdepth] === 'true'
	const screenName = String(cs[keyName] || '')
	const aspectRatio = String(cs[keyAspectRatio] || '')
	const posXVal = cs[keyPosX] ?? 0
	const posYVal = cs[keyPosY] ?? 0
	const wrapCtl = Object.assign(document.createElement('div'), { style: 'display:flex; flex-direction:column; gap:4px; margin-top:8px' })
	
	const editMode = document.querySelector('.device-view__band--caspar')?.classList.contains('device-view--edit-mode')
	if (editMode) {
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
			]
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
					draggable: true 
				})
				
				const header = Object.assign(document.createElement('div'), { style: 'display:flex; justify-content:space-between; font-size:10px; opacity:0.8;' })
				header.innerHTML = `<span><strong>Slot ${index + 1}</strong> (${item.label})</span><span>≡</span>`
				
				row.addEventListener('dragstart', ev => {
					ev.dataTransfer.setData('application/x-highascg-inspector-gpu-slot', String(index))
					row.style.opacity = '0.5'
				})
				row.addEventListener('dragend', ev => {
					row.style.opacity = '1'
				})
				row.addEventListener('dragover', ev => {
					ev.preventDefault()
					row.style.borderTop = '2px solid #007bff'
				})
				row.addEventListener('dragleave', ev => {
					row.style.borderTop = '1px solid #444'
				})
				row.addEventListener('drop', ev => {
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
				
				const portOptions = ['None', ...Array.from({length:8}, (_,i)=>`DP-${i}`), ...Array.from({length:4}, (_,i)=>`HDMI-${i}`)]
				const renderOptions = (selVal) => portOptions.map(p => {
					const val = p === 'None' ? '' : p
					return `<option value="${val}" ${val === selVal ? 'selected' : ''}>${p}</option>`
				}).join('')
				
				const currentPairs = item.pairs || []
				portASel.innerHTML = renderOptions(currentPairs[0] || '')
				portBSel.innerHTML = renderOptions(currentPairs[1] || '')
				
				const triggerChange = () => {
					const a = portASel.value
					const b = portBSel.value
					const newPairs = [a, b].filter(Boolean)
					let newLabel = item.id
					if (newPairs.length) {
						const isHdmi = newPairs.some(p => p.includes('HDMI'))
						const nums = newPairs.map(p => p.split('-')[1]).join('/')
						newLabel = `${isHdmi ? 'HDMI' : 'DP'} ${nums}`
					}
					item.pairs = newPairs
					item.label = newLabel
					item.type = newPairs.some(p => p.includes('HDMI')) ? 'hdmi' : 'dp'
					item.hidden = hideIn.checked
					saveAndRefresh()
				}
				
				portASel.addEventListener('change', triggerChange)
				portBSel.addEventListener('change', triggerChange)
				
				const hideCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', style: 'display:flex; align-items:center; margin-top:2px;' })
				const hideIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
				hideIn.checked = !!item.hidden
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
	
	const fullscreenCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Run in fullscreen mode' })
	const fullscreenIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	fullscreenIn.checked = !windowedOn
	fullscreenCk.append(fullscreenIn, document.createTextNode('Fullscreen'))
	const windowedCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Run in windowed mode' })
	const windowedIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	windowedIn.checked = !!windowedOn
	windowedCk.append(windowedIn, document.createTextNode('Windowed'))
	const borderCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Show window border' })
	const borderIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	borderIn.checked = !borderlessOn
	borderCk.append(borderIn, document.createTextNode('Border'))
	const vsyncCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title: 'Sync with monitor refresh rate' })
	const vsyncIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	vsyncIn.checked = !!vsyncOn
	vsyncCk.append(vsyncIn, document.createTextNode('V-sync'))

	// Advanced screen consumer controls
	const stretchSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	stretchSel.innerHTML = ['none','fill','uniform','uniform_to_fill'].map(v => `<option value="${v}"${v === stretchVal ? ' selected' : ''}>${v}</option>`).join('')
	stretchSel.addEventListener('change', saveCasparSettings)

	const mkCk = (label, checked, title) => {
		const ck = Object.assign(document.createElement('label'), { className: 'device-view__cablemode', title })
		const inp = Object.assign(document.createElement('input'), { type: 'checkbox' })
		inp.checked = !!checked
		inp.addEventListener('change', saveCasparSettings)
		ck.append(inp, document.createTextNode(label))
		return { ck, inp }
	}
	const { ck: keyOnlyCk, inp: keyOnlyIn } = mkCk('Key only', keyOnlyOn, 'Output only key channel')
	const { ck: aotCk, inp: aotIn } = mkCk('Always on top', alwaysOnTopOn, 'Keep window always on top')
	const { ck: interactiveCk, inp: interactiveIn } = mkCk('Interactive', interactiveOn, 'Allow mouse/keyboard interaction')
	const { ck: sbsKeyCk, inp: sbsKeyIn } = mkCk('SBS Key', sbsKeyOn, 'Side-by-side key')
	const { ck: forceLinearCk, inp: forceLinearIn } = mkCk('Force linear filter', forceLinearOn, 'Force linear filtering')
	const { ck: mipmapsCk, inp: mipmapsIn } = mkCk('Enable mipmaps', mipmapsOn, 'Enable mipmaps for scaling')
	const { ck: highBitdepthCk, inp: highBitdepthIn } = mkCk('High bitdepth', highBitdepthOn, 'Use high bitdepth')

	const colourSpaceSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	colourSpaceSel.innerHTML = ['RGB','datavideo-full','datavideo-limited'].map(v => `<option value="${v}"${v === colourSpaceVal ? ' selected' : ''}>${v}</option>`).join('')
	colourSpaceSel.addEventListener('change', saveCasparSettings)

	const nameIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'Screen name (optional)', value: screenName })
	nameIn.addEventListener('change', saveCasparSettings)
	const arIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'e.g. 16:9 or 1.7778', value: aspectRatio })
	arIn.addEventListener('change', saveCasparSettings)
	const posXIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', placeholder: 'X', value: String(posXVal) })
	posXIn.style.width = '50%'
	posXIn.addEventListener('change', saveCasparSettings)
	const posYIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', placeholder: 'Y', value: String(posYVal) })
	posYIn.style.width = '50%'
	posYIn.addEventListener('change', saveCasparSettings)
	const keyMode = `screen_${screenN}_mode`
	const keyCustomWidth = `screen_${screenN}_custom_width`
	const keyCustomHeight = `screen_${screenN}_custom_height`
	const keyCustomFps = `screen_${screenN}_custom_fps`
	const keySystemId = `screen_${screenN}_system_id`
	const keyOsMode = `screen_${screenN}_os_mode`
	const keyOsBackend = `screen_${screenN}_os_backend`
	const keyOsRate = `screen_${screenN}_os_rate`
	const keyOsTimingSource = `screen_${screenN}_os_timing_source`
	const osBackendSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	osBackendSel.innerHTML = '<option value="xrandr">Apply via X (xrandr)</option><option value="nvidia">Apply via NVIDIA</option>'
	osBackendSel.value = String(cs[keyOsBackend] || 'xrandr').trim().toLowerCase() === 'nvidia' ? 'nvidia' : 'xrandr'
	osBackendSel.style.fontSize = '11px'
	osBackendSel.style.height = '24px'
	osBackendSel.addEventListener('change', () => { void saveCasparSettings() })

	const edges = lastPayload?.graph?.edges || []
	const inEdge = edges.find((e) => e.sinkId === conn.id)
	const source = inEdge ? (lastPayload?.graph?.sources || []).find((s) => s.id === inEdge.sourceId) : null
	const inherited = source ? {
		mode: source.videoMode || '1080p5000',
		width: Math.max(64, parseInt(String(source.width ?? 1920), 10) || 1920),
		height: Math.max(64, parseInt(String(source.height ?? 1080), 10) || 1080),
		fps: Math.max(1, parseFloat(String(source.fps ?? 50)) || 50)
	} : null

	const currentMode = inherited ? inherited.mode : String(cs[keyMode] || conn?.caspar?.mode || '1080p5000')
	const isStandardMode = STANDARD_VIDEO_MODES.includes(currentMode)
	const modeSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	modeSel.innerHTML = `<option value="custom">Custom</option>${STANDARD_VIDEO_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}`
	modeSel.value = isStandardMode ? currentMode : 'custom'
	if (inherited) modeSel.disabled = true

	const parsedCurrentCustom = currentMode.match(/^(\d+)\s*x\s*(\d+)$/i)
	const customWidthIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '64',
		step: '1',
		placeholder: 'Width',
		value: String(
			inherited ? inherited.width : 
			Math.max(
				64,
				parseInt(
					String(
						cs[keyCustomWidth] ??
						(parsedCurrentCustom ? parseInt(parsedCurrentCustom[1], 10) : 0) ??
						1920
					),
					10
				) || 1920
			)
		),
	})
	const customHeightIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '64',
		step: '1',
		placeholder: 'Height',
		value: String(
			inherited ? inherited.height :
			Math.max(
				64,
				parseInt(
					String(
						cs[keyCustomHeight] ??
						(parsedCurrentCustom ? parseInt(parsedCurrentCustom[2], 10) : 0) ??
						1080
					),
					10
				) || 1080
			)
		),
	})
	const customFpsIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '1',
		step: '0.01',
		placeholder: 'Frame rate',
		value: String(inherited ? inherited.fps : Math.max(1, parseFloat(String(cs[keyCustomFps] ?? 50)) || 50)),
	})
	const syncCustomInputsState = () => {
		const isCustom = modeSel.value === 'custom'
		customWidthIn.disabled = inherited ? true : !isCustom
		customHeightIn.disabled = inherited ? true : !isCustom
		customFpsIn.disabled = inherited ? true : !isCustom
	}
	syncCustomInputsState()

	if (inherited) {
		const note = Object.assign(document.createElement('div'), { 
			className: 'device-view__inherited-box', 
			innerHTML: `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="opacity:0.8"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zM8.75 4h-1.5v4.5H11v-1.5H8.75V4z"/></svg> Inherited from ${source.label || source.id}`
		})
		wrapCtl.append(note)
		modeSel.classList.add('device-view__input--inherited')
		customWidthIn.classList.add('device-view__input--inherited')
		customHeightIn.classList.add('device-view__input--inherited')
		customFpsIn.classList.add('device-view__input--inherited')
	}

	const detectDisplayForConnector = () => {
		const ports = Array.isArray(lastPayload?.live?.gpu?.physicalMap?.ports) ? lastPayload.live.gpu.physicalMap.ports : []
		const byId = ports.find((p) => String(p?.physicalPortId || '') === String(conn?.id || '')) || null
		const activePort = String(byId?.runtime?.activePort || '').trim()
		const displays = Array.isArray(lastPayload?.live?.gpu?.displays) ? lastPayload.live.gpu.displays : []
		if (activePort) {
			const d = displays.find((x) => String(x?.name || '').trim().toUpperCase() === activePort.toUpperCase())
			if (d) return d
		}
		return displays.find((x) => Number.isFinite(Number(x?.casparScreenIndex)) && Number(x.casparScreenIndex) === screenN) || null
	}

	const formatModeOption = (m) => {
		const w = parseInt(String(m?.width ?? 0), 10)
		const hgt = parseInt(String(m?.height ?? 0), 10)
		const hz = Number(m?.hz)
		if (!Number.isFinite(w) || !Number.isFinite(hgt) || w <= 0 || hgt <= 0) return null
		const hzTxt = Number.isFinite(hz) && hz > 0 ? `${Math.round(hz * 100) / 100}` : ''
		const randrMode = String(m?.randrMode || '').trim() || `${w}x${hgt}`
		return {
			mode: `${w}x${hgt}`,
			randrMode,
			rate: hzTxt,
			label: hzTxt ? `${randrMode} @ ${hzTxt} Hz` : randrMode,
			current: m?.current === true,
		}
	}

	const detectedDisplay = detectDisplayForConnector()
	const detectedModes = Array.isArray(detectedDisplay?.modes) ? detectedDisplay.modes.map(formatModeOption).filter(Boolean) : []
	const uniqueDetectedModes = detectedModes.filter(
		(m, i, a) => a.findIndex((x) => x.randrMode === m.randrMode && x.rate === m.rate) === i
	)
	const modeFromRes = String(detectedDisplay?.resolution || '').match(/^(\d+)x(\d+)$/)
	const displayModeSelect = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	displayModeSelect.innerHTML = uniqueDetectedModes.length
		? uniqueDetectedModes.map((m, i) => `<option value="${i}" ${m.current ? 'selected' : ''}>${m.label}</option>`).join('')
		: '<option value="">No EDID/xrandr modes found</option>'
	const autoFromEdidBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Use detected display mode' })
	autoFromEdidBtn.disabled = !detectedDisplay
	autoFromEdidBtn.title = detectedDisplay
		? `Detect from ${String(detectedDisplay.name || 'active display')}`
		: 'No active display detected for this GPU output'

	const overrideResRow = Object.assign(document.createElement('label'), {
		className: 'device-view__cablemode',
		style: 'display:flex; align-items:center; gap:6px; margin: 0 0 4px',
	})
	const overrideResIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	const fkRoot = keyForceOsRes
	overrideResIn.checked =
		currentSettings?.[fkRoot] === true ||
		currentSettings?.[fkRoot] === 'true' ||
		cs[keyForceOsRes] === true ||
		cs[keyForceOsRes] === 'true'
	overrideResRow.append(overrideResIn, document.createTextNode('Override'))

	const timingRow = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-timing-row',
		style: 'display:none; flex-direction:column; gap:6px; margin:0 0 8px; font-size:10px',
	})
	const timingLbl = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-label',
		textContent: 'Timing preview (CVT/GTF for the resolution below)',
		style: 'opacity:0.75',
	})
	const timingSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	timingSel.innerHTML = [
		['cvt', 'CVT (default)'],
		['gtf', 'GTF'],
		['cvt_r', 'CVT reduced blanking (-r)'],
	]
		.map(([v, lab]) => `<option value="${v}">${lab}</option>`)
		.join('')
	const timingStored = String(cs[keyOsTimingSource] || currentSettings?.[keyOsTimingSource] || 'cvt')
		.trim()
		.toLowerCase()
		.replace(/-/g, '_')
	timingSel.value = timingStored === 'gtf' ? 'gtf' : timingStored === 'cvt_r' ? 'cvt_r' : 'cvt'
	const timingPreviewEl = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-modeline-preview',
		style: 'font-size:10px; line-height:1.4; margin-top:6px;',
	})
	const timingTop = Object.assign(document.createElement('div'), {
		style: 'display:flex; align-items:center; gap:8px; flex-wrap:wrap',
	})
	const linkTierEl = Object.assign(document.createElement('span'), {
		textContent: '',
		title: 'Dot-clock tier (approx.)',
		style: 'font-size:9px;opacity:0.55;font-family:ui-monospace,monospace;letter-spacing:0.06em',
	})
	timingTop.append(timingSel, linkTierEl)
	timingRow.append(timingLbl, timingTop, timingPreviewEl)

	const syncTimingRowVisibility = () => {
		timingRow.style.display = 'flex'
		timingLbl.textContent = overrideResIn.checked
			? 'Timing preview — same geometry used when Override applies Video Mode via xrandr'
			: 'Timing preview — with Override off, OS mode follows the EDID list below; preview uses that selection or Caspar mode'
		scheduleModelinePreview()
	}

	let modelinePreviewTimer = null
	const scheduleModelinePreview = () => {
		clearTimeout(modelinePreviewTimer)
		modelinePreviewTimer = setTimeout(() => void refreshModelinePreview(), 280)
	}

	const readPreviewDims = () => {
		if (overrideResIn.checked) {
			const modeId = inherited ? inherited.mode : String(modeSel.value || '1080p5000').trim()
			const or = casparVideoModeToOsModeAndRate(modeId, {
				customWidth: inherited ? inherited.width : Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920),
				customHeight: inherited ? inherited.height : Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080),
				customFps: inherited ? inherited.fps : Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50),
			})
			if (or) {
				const mm = String(or.osMode).match(/^(\d+)x(\d+)$/i)
				if (mm) return { w: parseInt(mm[1], 10), h: parseInt(mm[2], 10), r: or.osRate }
			}
		}
		const idx = parseInt(String(displayModeSelect.value || '0'), 10)
		const pick = uniqueDetectedModes[Number.isFinite(idx) ? idx : 0] || null
		if (pick && pick.mode) {
			const mm = String(pick.mode).match(/^(\d+)x(\d+)$/i)
			if (mm) {
				const r = parseFloat(String(pick.rate || detectedDisplay?.refreshHz || customFpsIn.value || 60)) || 60
				return { w: parseInt(mm[1], 10), h: parseInt(mm[2], 10), r }
			}
		}
		if (modeSel.value === 'custom') {
			return {
				w: Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920),
				h: Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080),
				r: Math.max(1, parseFloat(String(customFpsIn.value || 60)) || 60),
			}
		}
		const std = CASPAR_VIDEO_MODE_SPECS[String(modeSel.value || '')]
		if (std) return { w: std.width, h: std.height, r: std.fps }
		const mr = String(detectedDisplay?.resolution || '').match(/^(\d+)x(\d+)$/)
		if (mr) {
			const r = Number.isFinite(Number(detectedDisplay?.refreshHz)) ? Number(detectedDisplay.refreshHz) : 60
			return { w: parseInt(mr[1], 10), h: parseInt(mr[2], 10), r }
		}
		return { w: 1920, h: 1080, r: 60 }
	}

	async function refreshModelinePreview() {
		linkTierEl.textContent = ''
		timingPreviewEl.textContent = 'Loading timings…'
		try {
			const { w, h, r } = readPreviewDims()
			const data = await Actions.getModelinePreview({ w, h, rate: r, type: timingSel.value })
			if (!data?.ok) {
				timingPreviewEl.textContent = data?.error || 'Preview failed'
				return
			}
			const b = data.breakdown
			const band = data.bandwidth
			if (band && band.short) linkTierEl.textContent = String(band.short)
			const lines = []
			if (b) {
				lines.push(`<div><strong>Mode name:</strong> ${data.modeName || '—'}</div>`)
				lines.push(`<div><strong>Dot clock:</strong> ${b.dotClockMhz} MHz</div>`)
				lines.push(`<div><strong>H:</strong> display ${b.hDisplay} px · sync start ${b.hSyncStart} · sync end ${b.hSyncEnd} · total ${b.hTotal}</div>`)
				lines.push(`<div><strong>V:</strong> display ${b.vDisplay} px · sync start ${b.vSyncStart} · sync end ${b.vSyncEnd} · total ${b.vTotal}</div>`)
				lines.push(`<div><strong>Active pixels / frame:</strong> ${b.activePixels.toLocaleString()}</div>`)
				lines.push(`<div><strong>Total timing pixels / frame:</strong> ${b.framePixels.toLocaleString()}</div>`)
				if (Number.isFinite(b.approxHz)) lines.push(`<div><strong>≈ refresh:</strong> ${(Math.round(b.approxHz * 100) / 100).toFixed(2)} Hz</div>`)
				if (b.flags) lines.push(`<div><strong>Flags:</strong> ${b.flags}</div>`)
			}
			timingPreviewEl.innerHTML = lines.join('')
		} catch (e) {
			linkTierEl.textContent = ''
			timingPreviewEl.textContent = e?.message || String(e)
		}
	}

	timingSel.addEventListener('change', () => {
		void saveCasparSettings()
		scheduleModelinePreview()
	})
	overrideResIn.addEventListener('change', () => {
		void saveCasparSettings()
		syncTimingRowVisibility()
	})
	syncTimingRowVisibility()

	displayModeSelect.addEventListener('change', () => scheduleModelinePreview())
	customWidthIn.addEventListener('change', () => {
		void saveCasparSettings()
		scheduleModelinePreview()
	})
	customHeightIn.addEventListener('change', () => {
		void saveCasparSettings()
		scheduleModelinePreview()
	})
	customFpsIn.addEventListener('change', () => {
		void saveCasparSettings()
		scheduleModelinePreview()
	})
	customWidthIn.addEventListener('input', () => scheduleModelinePreview())
	customHeightIn.addEventListener('input', () => scheduleModelinePreview())
	customFpsIn.addEventListener('input', () => scheduleModelinePreview())
	modeSel.addEventListener('change', () => {
		syncCustomInputsState()
		scheduleModelinePreview()
		void saveCasparSettings()
	})

	const buildOutputPatchFromSelection = () => {
		const selectedIdx = parseInt(String(displayModeSelect.value || 0), 10)
		const pick = uniqueDetectedModes[Number.isFinite(selectedIdx) ? selectedIdx : 0] || null
		const randr = pick?.randrMode && String(pick.randrMode).trim() ? String(pick.randrMode).trim() : ''
		const mode = randr || pick?.mode || (modeFromRes ? `${modeFromRes[1]}x${modeFromRes[2]}` : '')
		const rate = pick?.rate || (Number.isFinite(Number(detectedDisplay?.refreshHz)) ? String(detectedDisplay.refreshHz) : '')
		const systemId = String(detectedDisplay?.name || cs[keySystemId] || '').trim()
		return {
			[keySystemId]: systemId,
			[keyOsMode]: mode,
			[keyOsRate]: rate ? parseFloat(rate) : '',
			[keyOsBackend]: osBackendSel.value === 'nvidia' ? 'nvidia' : 'xrandr',
		}
	}

	/** OS/xrandr fields for Apply: with Override, follow Video Mode (Caspar), not the EDID dropdown. */
	const buildOsOutputPatchForApply = () => {
		const backend = osBackendSel.value === 'nvidia' ? 'nvidia' : 'xrandr'
		const systemId = String(detectedDisplay?.name || cs[keySystemId] || '').trim()
		if (overrideResIn.checked) {
			const modeId = inherited ? inherited.mode : String(modeSel.value || '1080p5000').trim()
			const or = casparVideoModeToOsModeAndRate(modeId, {
				customWidth: inherited ? inherited.width : Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920),
				customHeight: inherited ? inherited.height : Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080),
				customFps: inherited ? inherited.fps : Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50),
			})
			if (or) {
				return {
					[keySystemId]: systemId,
					[keyOsMode]: or.osMode,
					[keyOsRate]: or.osRate,
					[keyOsBackend]: backend,
				}
			}
		}
		return buildOutputPatchFromSelection()
	}

	autoFromEdidBtn.onclick = async () => {
		try {
			const patch = buildOutputPatchFromSelection()
			const mode = String(patch[keyOsMode] || '').trim()
			const rate = patch[keyOsRate]
			const systemId = String(patch[keySystemId] || '').trim()
			await Actions.saveSettingsPatch(patch)
			await Actions.applyOsSettings(patch)
			setStatus(statusEl, `Applied detected mode ${mode || 'auto'}${rate ? ` @ ${rate}Hz` : ''} on ${systemId || `Screen ${screenN}`}`, true)
			await load()
		} catch (e) {
			setStatus(statusEl, `Failed to apply detected display mode: ${e?.message || e}`, false)
		}
	}

	const buildAdvancedPatch = () => ({
		[keyStretch]: stretchSel.value,
		[keyKeyOnly]: !!keyOnlyIn.checked,
		[keyAlwaysOnTop]: !!aotIn.checked,
		[keyInteractive]: !!interactiveIn.checked,
		[keySbsKey]: !!sbsKeyIn.checked,
		[keyColourSpace]: colourSpaceSel.value,
		[keyForceLinear]: !!forceLinearIn.checked,
		[keyMipmaps]: !!mipmapsIn.checked,
		[keyHighBitdepth]: !!highBitdepthIn.checked,
		[keyName]: nameIn.value.trim(),
		[keyAspectRatio]: arIn.value.trim(),
		[keyPosX]: parseInt(posXIn.value, 10) || 0,
		[keyPosY]: parseInt(posYIn.value, 10) || 0,
	})

	async function saveCasparSettings() {
		const vOverride = !!overrideResIn.checked
		const ts = timingSel.value === 'gtf' ? 'gtf' : timingSel.value === 'cvt_r' ? 'cvt_r' : 'cvt'
		const patch = {
			casparServer: {
				[keyWindowed]: !!windowedIn.checked,
				[keyVsync]: !!vsyncIn.checked,
				[keyBorderless]: !borderIn.checked,
				[keyMode]: inherited ? inherited.mode : String(modeSel.value || '1080p5000').trim(),
				[keyCustomWidth]: inherited ? inherited.width : Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920),
				[keyCustomHeight]: inherited ? inherited.height : Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080),
				[keyCustomFps]: inherited ? inherited.fps : Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50),
				[keyForceOsRes]: vOverride,
				[keyOsTimingSource]: ts,
				...buildAdvancedPatch(),
			},
			[keyForceOsRes]: vOverride,
			[keyOsTimingSource]: ts,
			...(vOverride ? buildOsOutputPatchForApply() : {}),
		}
		await Actions.saveSettingsPatch(patch)
		setCasparRestartDirty(true)
		setStatus(statusEl, `Settings for Screen ${screenN} saved`, true)
	}

	fullscreenIn.addEventListener('change', () => { 
		windowedIn.checked = !fullscreenIn.checked
		saveCasparSettings()
	})
	windowedIn.addEventListener('change', () => { 
		fullscreenIn.checked = !windowedIn.checked
		saveCasparSettings()
	})
	borderIn.addEventListener('change', saveCasparSettings)
	vsyncIn.addEventListener('change', saveCasparSettings)

	const edidIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		placeholder: 'EDID override (optional)',
		value: edidOverride,
	})
	const saveGpuBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: `Apply resolution to the screen (Screen ${screenN})` })
	saveGpuBtn.onclick = async () => {
		const edidText = String(edidIn.value || '').trim()
		const selectedMode = inherited ? inherited.mode : String(modeSel.value || '1080p5000').trim()
		const isCustom = selectedMode === 'custom'
		const customWidth = inherited ? inherited.width : Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920)
		const customHeight = inherited ? inherited.height : Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080)
		const customFps = inherited ? inherited.fps : Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50)
		const modeText = isCustom ? 'custom' : selectedMode
		const ts = timingSel.value === 'gtf' ? 'gtf' : timingSel.value === 'cvt_r' ? 'cvt_r' : 'cvt'
		const outputPatch = {
			...buildOsOutputPatchForApply(),
			[keyOsTimingSource]: ts,
			[keyForceOsRes]: !!overrideResIn.checked,
		}
		const casparSlice = {
			[keyWindowed]: !!windowedIn.checked,
			[keyVsync]: !!vsyncIn.checked,
			[keyBorderless]: !borderIn.checked,
			[keyEdid]: edidText,
			[keyMode]: modeText,
			[keyCustomWidth]: customWidth,
			[keyCustomHeight]: customHeight,
			[keyCustomFps]: customFps,
			[keyForceOsRes]: !!overrideResIn.checked,
			[keyOsTimingSource]: ts,
			...buildAdvancedPatch(),
		}
		const patch = {
			casparServer: casparSlice,
			[keyForceOsRes]: !!overrideResIn.checked,
			...outputPatch,
		}
		await Actions.saveSettingsPatch(patch)
		await Actions.applyOsSettings({ ...outputPatch, casparServer: casparSlice })
		await Actions.updateConnector(conn.id, { caspar: { edidOverride: edidText, mode: modeText } })
		setCasparRestartDirty(true)
		setStatus(statusEl, `Applied resolution to the screen (Screen ${screenN})`, true)
		await load()
	}

	const resetBtn = Object.assign(document.createElement('button'), { 
		className: 'header-btn device-view__destinations-reset', 
		textContent: 'Reset all settings for this screen',
		title: 'Clears CasparCG mode, windowed/vsync toggles, and OS-level system ID / resolution for this screen index.'
	})
	resetBtn.style.marginTop = '1rem'
	resetBtn.style.opacity = '0.7'
	resetBtn.onclick = async () => {
		if (!confirm(`Are you sure you want to reset all settings for Screen ${screenN}?`)) return
		const patch = {
			casparServer: {
				[keyMode]: null, [keyWindowed]: null, [keyVsync]: null, [keyBorderless]: null,
				[keyCustomWidth]: null, [keyCustomHeight]: null, [keyCustomFps]: null, [keyEdid]: null,
				[keySystemId]: null, [keyOsMode]: null, [keyOsRate]: null, [keyOsBackend]: null,
				[keyOsTimingSource]: null,
				[keyStretch]: null, [keyKeyOnly]: null, [keyAlwaysOnTop]: null, [keyInteractive]: null,
				[keySbsKey]: null, [keyColourSpace]: null, [keyForceLinear]: null, [keyMipmaps]: null,
				[keyHighBitdepth]: null,
				[keyName]: null, [keyAspectRatio]: null, [keyPosX]: null, [keyPosY]: null,
				[keyForceOsRes]: null,
			}
		}
		await Actions.saveSettingsPatch(patch)
		await load()
		setStatus(statusEl, `Settings for Screen ${screenN} cleared`, true)
	}

	const posRow = Object.assign(document.createElement('div'), { style: 'display:flex;gap:6px' })
	posRow.append(posXIn, posYIn)

	const minimalToggleRow = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links', style: 'margin: 4px 0; gap: 4px' })
	const mkSmallCk = (ckWrap) => {
		ckWrap.style.fontSize = '10px'
		ckWrap.style.padding = '2px 6px'
		ckWrap.style.opacity = '0.85'
		return ckWrap
	}
	minimalToggleRow.append(
		mkSmallCk(fullscreenCk), mkSmallCk(windowedCk), mkSmallCk(borderCk), mkSmallCk(vsyncCk),
		mkSmallCk(keyOnlyCk), mkSmallCk(aotCk),
		mkSmallCk(interactiveCk), mkSmallCk(sbsKeyCk), mkSmallCk(forceLinearCk), mkSmallCk(mipmapsCk), mkSmallCk(highBitdepthCk)
	)

	wrapCtl.append(
		minimalToggleRow,
		Object.assign(document.createElement('div'), { className: 'device-view__inspector-label', textContent: 'Video Mode', style: 'font-size:10px; opacity:0.7; margin-top:8px' }),
		modeSel, 
		(() => {
			const d = Object.assign(document.createElement('div'), { style: 'display:flex; gap:4px; margin-top:4px' });
			d.append(customWidthIn, customHeightIn, customFpsIn);
			return d;
		})(),
		timingRow,
		saveGpuBtn
	)
	
	// Advanced settings hidden by default
	const advancedToggles = Object.assign(document.createElement('div'), { style: 'display:none' })
	const osBackendWrap = Object.assign(document.createElement('div'), { style: 'display:flex; flex-direction:column; gap:4px; margin:4px 0' })
	osBackendWrap.append(
		Object.assign(document.createElement('div'), {
			className: 'device-view__inspector-label',
			textContent: 'OS apply backend',
			style: 'font-size:10px; opacity:0.7',
		}),
		osBackendSel
	)

	advancedToggles.append(
		Object.assign(document.createElement('hr'), { className: 'device-view__hr' }),
		Object.assign(document.createElement('div'), { className: 'device-view__inspector-label', textContent: 'OS / X11 Settings (xrandr)', style: 'font-size:10px; opacity:0.7' }),
		Object.assign(document.createElement('div'), { className: 'device-view__row', style: 'margin: 4px 0', innerHTML: `<small style="font-size:10px; opacity:0.6">Physical: ${detectedDisplay ? `<strong>${detectedDisplay.name}</strong>` : '<em>None</em>'}</small>` }),
		overrideResRow,
		osBackendWrap,
		displayModeSelect,
		autoFromEdidBtn,
		Object.assign(document.createElement('hr'), { className: 'device-view__hr' }),
		Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Stretch', style: 'font-size:10px;opacity:.7' }), stretchSel,
		Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'Colour Space', style: 'font-size:10px;opacity:.7' }), colourSpaceSel,
		nameIn, arIn, posRow,
		resetBtn
	)
	
	const showAdvancedBtn = Object.assign(document.createElement('button'), { 
		className: 'device-view__inspector-link-btn', 
		textContent: 'Show advanced consumer settings...',
		style: 'font-size:10px; margin-top:8px; opacity:0.6'
	})
	showAdvancedBtn.onclick = () => {
		advancedToggles.style.display = advancedToggles.style.display === 'none' ? 'block' : 'none'
		showAdvancedBtn.textContent = advancedToggles.style.display === 'none' ? 'Show advanced consumer settings...' : 'Hide advanced consumer settings'
		if (advancedToggles.style.display === 'block') scheduleModelinePreview()
	}
	
	wrapCtl.append(showAdvancedBtn, advancedToggles)
	h.append(wrapCtl)
}
