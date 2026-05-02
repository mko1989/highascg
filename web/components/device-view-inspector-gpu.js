/**
 * GPU Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { STANDARD_VIDEO_MODES } from './device-view-destinations-inspector.js'

export function renderGpuOutControls(h, conn, { currentSettings, lastPayload, skipPh, statusEl, load, setCasparRestartDirty }) {
	const resolveGpuScreenNumber = (c) => {
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
	const windowedOn = cs[keyWindowed] !== false && cs[keyWindowed] !== 'false'
	const vsyncOn = cs[keyVsync] !== false && cs[keyVsync] !== 'false'
	const borderlessOn = cs[keyBorderless] === true || cs[keyBorderless] === 'true'
	const edidOverride = String(cs[keyEdid] || conn?.caspar?.edidOverride || '')
	const wrapCtl = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const fullscreenCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode' })
	const fullscreenIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	fullscreenIn.checked = !windowedOn
	fullscreenCk.append(fullscreenIn, document.createTextNode('Fullscreen'))
	const windowedCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode' })
	const windowedIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	windowedIn.checked = !!windowedOn
	windowedCk.append(windowedIn, document.createTextNode('Windowed'))
	const borderCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode' })
	const borderIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	borderIn.checked = !borderlessOn
	borderCk.append(borderIn, document.createTextNode('Border'))
	const vsyncCk = Object.assign(document.createElement('label'), { className: 'device-view__cablemode' })
	const vsyncIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	vsyncIn.checked = !!vsyncOn
	vsyncCk.append(vsyncIn, document.createTextNode('V-sync'))
	const keyMode = `screen_${screenN}_mode`
	const keyCustomWidth = `screen_${screenN}_custom_width`
	const keyCustomHeight = `screen_${screenN}_custom_height`
	const keyCustomFps = `screen_${screenN}_custom_fps`
	const keySystemId = `screen_${screenN}_system_id`
	const keyOsMode = `screen_${screenN}_os_mode`
	const keyOsBackend = `screen_${screenN}_os_backend`
	const keyOsRate = `screen_${screenN}_os_rate`
	const osBackendSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	osBackendSel.innerHTML = '<option value="xrandr">Apply via X (xrandr)</option><option value="nvidia">Apply via NVIDIA</option>'
	osBackendSel.value = String(cs[keyOsBackend] || 'xrandr').trim().toLowerCase() === 'nvidia' ? 'nvidia' : 'xrandr'

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
	modeSel.addEventListener('change', syncCustomInputsState)
	syncCustomInputsState()

	if (inherited) {
		const note = Object.assign(document.createElement('p'), { 
			className: 'device-view__note', 
			textContent: `Inherited from ${source.label || source.id}` 
		})
		note.style.color = 'var(--accent)'
		h.append(note)
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
		return {
			mode: `${w}x${hgt}`,
			rate: hzTxt,
			label: hzTxt ? `${w}x${hgt} @ ${hzTxt}Hz` : `${w}x${hgt}`,
			current: m?.current === true,
		}
	}

	const detectedDisplay = detectDisplayForConnector()
	const detectedModes = Array.isArray(detectedDisplay?.modes) ? detectedDisplay.modes.map(formatModeOption).filter(Boolean) : []
	const uniqueDetectedModes = detectedModes.filter((m, i, a) => a.findIndex((x) => x.mode === m.mode && x.rate === m.rate) === i)
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


	const buildOutputPatchFromSelection = () => {
		const selectedIdx = parseInt(String(displayModeSelect.value || 0), 10)
		const pick = uniqueDetectedModes[Number.isFinite(selectedIdx) ? selectedIdx : 0] || null
		const mode = pick?.mode || (modeFromRes ? `${modeFromRes[1]}x${modeFromRes[2]}` : '')
		const rate = pick?.rate || (Number.isFinite(Number(detectedDisplay?.refreshHz)) ? String(detectedDisplay.refreshHz) : '')
		const systemId = String(detectedDisplay?.name || cs[keySystemId] || '').trim()
		return {
			[keySystemId]: systemId,
			[keyOsMode]: mode,
			[keyOsRate]: rate ? parseFloat(rate) : '',
			[keyOsBackend]: osBackendSel.value === 'nvidia' ? 'nvidia' : 'xrandr',
		}
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

	const saveCasparSettings = async () => {
		const patch = {
			casparServer: {
				[keyWindowed]: !!windowedIn.checked,
				[keyVsync]: !!vsyncIn.checked,
				[keyBorderless]: !borderIn.checked,
				[keyMode]: inherited ? inherited.mode : String(modeSel.value || '1080p5000').trim(),
				[keyCustomWidth]: inherited ? inherited.width : Math.max(64, parseInt(String(customWidthIn.value || 1920), 10) || 1920),
				[keyCustomHeight]: inherited ? inherited.height : Math.max(64, parseInt(String(customHeightIn.value || 1080), 10) || 1080),
				[keyCustomFps]: inherited ? inherited.fps : Math.max(1, parseFloat(String(customFpsIn.value || 50)) || 50),
			}
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
		const outputPatch = buildOutputPatchFromSelection()
		const patch = {
			casparServer: {
				[keyWindowed]: !!windowedIn.checked,
				[keyVsync]: !!vsyncIn.checked,
				[keyBorderless]: !borderIn.checked,
				[keyEdid]: edidText,
				[keyMode]: modeText,
				[keyCustomWidth]: customWidth,
				[keyCustomHeight]: customHeight,
				[keyCustomFps]: customFps,
			},
			...outputPatch,
		}
		await Actions.saveSettingsPatch(patch)
		await Actions.applyOsSettings(outputPatch)
		await Actions.updateConnector(conn.id, { caspar: { edidOverride: edidText, mode: modeText } }, skipPh)
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
				[keySystemId]: null, [keyOsMode]: null, [keyOsRate]: null, [keyOsBackend]: null
			}
		}
		await Actions.saveSettingsPatch(patch)
		await load()
		setStatus(statusEl, `Settings for Screen ${screenN} cleared`, true)
	}

	const edidLabel = Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'EDID Override / Force ID' })
	wrapCtl.append(
		fullscreenCk, windowedCk, borderCk, vsyncCk, 
		Object.assign(document.createElement('hr'), { className: 'device-view__hr' }),
		Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'CasparCG Video Mode' }),
		modeSel, customWidthIn, customHeightIn, customFpsIn, 
		Object.assign(document.createElement('hr'), { className: 'device-view__hr' }),
		Object.assign(document.createElement('label'), { className: 'device-view__inspector-label', textContent: 'OS / X11 Settings' }),
		osBackendSel, 
		Object.assign(document.createElement('div'), { className: 'device-view__row', innerHTML: `<small style="opacity:0.7">Physical Display: ${detectedDisplay ? `<strong>${detectedDisplay.name}</strong>` : '<em>None detected</em>'}</small>` }),
		displayModeSelect, autoFromEdidBtn, 
		edidLabel, edidIn, 
		saveGpuBtn,
		resetBtn
	)
	h.append(wrapCtl)
}
