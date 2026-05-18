/**
 * Video mode, EDID/xrandr display selection, timing + modeline preview, and "use detected display mode".
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { STANDARD_VIDEO_MODES, casparVideoModeToOsModeAndRate, CASPAR_VIDEO_MODE_SPECS } from './device-view-destinations-inspector.js'

export function populateGpuVideoModelineSection(wrapCtl, ctx) {
	const { saveRef, conn, lastPayload, cs, currentSettings, screenN, statusEl, load } = ctx
	const runSave = () => void saveRef.invoke?.()
	const keyForceOsRes = `screen_${screenN}_force_os_resolution`

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
	osBackendSel.addEventListener('change', () => { runSave() })

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
		runSave()
		scheduleModelinePreview()
	})
	overrideResIn.addEventListener('change', () => {
		runSave()
		syncTimingRowVisibility()
	})
	syncTimingRowVisibility()

	displayModeSelect.addEventListener('change', () => scheduleModelinePreview())
	customWidthIn.addEventListener('change', () => {
		runSave()
		scheduleModelinePreview()
	})
	customHeightIn.addEventListener('change', () => {
		runSave()
		scheduleModelinePreview()
	})
	customFpsIn.addEventListener('change', () => {
		runSave()
		scheduleModelinePreview()
	})
	customWidthIn.addEventListener('input', () => scheduleModelinePreview())
	customHeightIn.addEventListener('input', () => scheduleModelinePreview())
	customFpsIn.addEventListener('input', () => scheduleModelinePreview())
	modeSel.addEventListener('change', () => {
		syncCustomInputsState()
		scheduleModelinePreview()
		runSave()
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

	return {
		inherited,
		source,
		overrideResRow,
		keyMode,
		keyCustomWidth,
		keyCustomHeight,
		keyCustomFps,
		keySystemId,
		keyOsMode,
		keyOsBackend,
		keyOsRate,
		keyOsTimingSource,
		osBackendSel,
		modeSel,
		customWidthIn,
		customHeightIn,
		customFpsIn,
		timingRow,
		timingSel,
		displayModeSelect,
		uniqueDetectedModes,
		detectedDisplay,
		modeFromRes,
		overrideResIn,
		scheduleModelinePreview,
		syncTimingRowVisibility,
		buildOutputPatchFromSelection,
		buildOsOutputPatchForApply,
		autoFromEdidBtn,
	}
}
