/**
 * Video mode, EDID/xrandr display selection, timing + modeline preview, and "use detected display mode".
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { resolveCableSourceResolution } from '../lib/device-view-gpu-source-inherit.js'
import { gpuPhysicalPortCableId } from '../lib/device-view-gpu-port-list.js'
import { resolveGpuScreenNumber, resolveGpuDetectedDisplay } from './device-view-inspector-gpu-resolve.js'
import {
	STANDARD_VIDEO_MODES,
	casparVideoModeToOsModeAndRate,
	CASPAR_VIDEO_MODE_SPECS,
	resolveGpuInspectorVideoMode,
} from './device-view-destinations-inspector.js'
import { resolveDefaultVideoMode } from '../lib/project-fps.js'

function resolveMainScreenCount(cs, currentSettings) {
	return Math.max(1, Math.min(4, parseInt(String(currentSettings?.screen_count ?? cs?.screen_count ?? 1), 10) || 1))
}

function readPortOsValue(cs, currentSettings, screenN, suffix) {
	const n = Math.max(1, Math.min(4, Number(screenN) || 1))
	const k = `screen_${n}_${suffix}`
	return cs[k] ?? currentSettings?.casparServer?.[k] ?? currentSettings?.[k]
}

function buildPerPortOsSettingsPatch(osScreenN, fields, { systemId } = {}) {
	const n = Math.max(1, Math.min(4, Number(osScreenN) || 1))
	const patch = {
		[`screen_${n}_os_mode`]: fields.os_mode,
		[`screen_${n}_os_rate`]: fields.os_rate,
		[`screen_${n}_os_backend`]: fields.os_backend,
		[`screen_${n}_os_timing_source`]: fields.os_timing_source,
		[`screen_${n}_os_mode_source`]: fields.os_mode_source,
		[`screen_${n}_force_os_resolution`]: fields.force_os_resolution,
	}
	const sid = String(systemId || '').trim()
	if (sid) patch[`screen_${n}_system_id`] = sid
	return patch
}

function buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readOsResolutionFromUi) {
	const backend = osBackendSel.value === 'nvidia' ? 'nvidia' : 'xrandr'
	const ts = timingSel.value === 'gtf' ? 'gtf' : timingSel.value === 'cvt_r' ? 'cvt_r' : 'cvt'
	const force = !!overrideResIn.checked
	const os = readOsResolutionFromUi()
	return {
		os_mode: os.mode,
		os_rate: os.rate,
		os_mode_source: os.source,
		os_backend: backend,
		os_timing_source: ts,
		force_os_resolution: force,
	}
}


/** Expand to all main screens for POST /api/settings/apply-os only. */
function expandBlanketOsPatch(cs, currentSettings, fields) {
	const patch = {}
	const count = resolveMainScreenCount(cs, currentSettings)
	for (let n = 1; n <= count; n++) {
		for (const [suffix, val] of Object.entries(fields)) {
			if (val === undefined) continue
			patch[`screen_${n}_${suffix}`] = val
		}
	}
	return patch
}

/** Caspar video mode for a bound screen consumer — used when Override applies xrandr from Video Mode. */
function readScreenCasparOsDims(cs, currentSettings, screenN) {
	const n = Math.max(1, Math.min(4, Number(screenN) || 1))
	const modeKey = `screen_${n}_mode`
	const wKey = `screen_${n}_custom_width`
	const hKey = `screen_${n}_custom_height`
	const fpsKey = `screen_${n}_custom_fps`
	const projectMode = resolveDefaultVideoMode(currentSettings)
	const modeId = String(cs[modeKey] ?? currentSettings?.casparServer?.[modeKey] ?? currentSettings?.[modeKey] ?? projectMode).trim() || projectMode
	return casparVideoModeToOsModeAndRate(modeId, {
		customWidth: Math.max(64, parseInt(String(cs[wKey] ?? currentSettings?.casparServer?.[wKey] ?? 1920), 10) || 1920),
		customHeight: Math.max(64, parseInt(String(cs[hKey] ?? currentSettings?.casparServer?.[hKey] ?? 1080), 10) || 1080),
		customFps: Math.max(1, parseFloat(String(cs[fpsKey] ?? currentSettings?.casparServer?.[fpsKey] ?? 50)) || 50),
	})
}

function listSiblingGpuPortsOnCasparScreen(conn, lastPayload, casparScreenN) {
	const sug = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	return sug
		.filter((c) => c?.kind === 'gpu_out' && String(c?.id || '') !== String(conn?.id || ''))
		.filter((c) => resolveGpuScreenNumber(c, lastPayload) === casparScreenN)
		.map((c) => gpuPhysicalPortCableId(c.id) || c.label || c.id)
}

export function populateGpuVideoModelineSection(wrapCtl, ctx) {
	const { saveRef, osSaveRef, conn, lastPayload, cs, currentSettings, screenN, osScreenN, statusEl, load } = ctx
	const projectMode = resolveDefaultVideoMode(currentSettings)
	const runSave = () => void saveRef.invoke?.()
	const runOsSave = () => void osSaveRef?.invoke?.()

	const keyMode = `screen_${screenN}_mode`
	const keyCustomWidth = `screen_${screenN}_custom_width`
	const keyCustomHeight = `screen_${screenN}_custom_height`
	const keyCustomFps = `screen_${screenN}_custom_fps`
	const keySystemId = `screen_${osScreenN}_system_id`
	const keyOsMode = `screen_${osScreenN}_os_mode`
	const keyOsBackend = `screen_${osScreenN}_os_backend`
	const keyOsRate = `screen_${osScreenN}_os_rate`
	const keyOsTimingSource = `screen_${osScreenN}_os_timing_source`
	const keyOsModeSource = `screen_${osScreenN}_os_mode_source`
	const osBackendSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	osBackendSel.innerHTML = '<option value="xrandr">Apply via X (xrandr)</option><option value="nvidia">Apply via NVIDIA</option>'
	osBackendSel.value = String(readPortOsValue(cs, currentSettings, osScreenN, 'os_backend') || 'xrandr').trim().toLowerCase() === 'nvidia' ? 'nvidia' : 'xrandr'
	osBackendSel.style.fontSize = '11px'
	osBackendSel.style.height = '24px'
	osBackendSel.addEventListener('change', () => { runOsSave() })

	const edges = lastPayload?.graph?.edges || []
	const inEdge = edges.find((e) => e.sinkId === conn.id)
	const source = inEdge ? resolveCableSourceResolution(lastPayload, inEdge.sourceId) : null
	const inherited = source ? {
		mode: source.videoMode || projectMode,
		width: Math.max(64, parseInt(String(source.width ?? 1920), 10) || 1920),
		height: Math.max(64, parseInt(String(source.height ?? 1080), 10) || 1080),
		fps: Math.max(1, parseFloat(String(source.fps ?? 50)) || 50)
	} : null

	const physicalPortRow = (() => {
		const canonicalId = gpuPhysicalPortCableId(conn?.id || '')
		const ports = Array.isArray(lastPayload?.live?.gpu?.physicalMap?.ports) ? lastPayload.live.gpu.physicalMap.ports : []
		return ports.find((p) => String(p?.physicalPortId || '').trim() === canonicalId) || null
	})()

	const detectedDisplay = resolveGpuDetectedDisplay(conn, lastPayload)
	const edidParsed = detectedDisplay?.monitor || detectedDisplay?.edid?.parsed || null

	const readDim = (suffix, fallback) => {
		const k = `screen_${screenN}_${suffix}`
		return cs[k] ?? currentSettings?.casparServer?.[k] ?? fallback
	}

	let cableFeedNote = null
	if (inherited) {
		cableFeedNote = Object.assign(document.createElement('div'), {
			style: 'font-size:10px; opacity:0.6; margin:2px 0 4px',
			textContent: `${source.label || source.id}: ${inherited.width}×${inherited.height} @ ${inherited.fps} Hz`,
		})
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

	const portModes = (Array.isArray(detectedDisplay?.modes) ? detectedDisplay.modes : [])
		.map(formatModeOption)
		.filter(Boolean)
	const uniqueDetectedModes = portModes.filter(
		(m, i, a) => a.findIndex((x) => x.randrMode === m.randrMode && x.rate === m.rate) === i,
	)
	const savedOsMode = String(readPortOsValue(cs, currentSettings, osScreenN, 'os_mode') || '').trim()
	const savedOsRate = readPortOsValue(cs, currentSettings, osScreenN, 'os_rate')
	const savedOsModeSource = String(readPortOsValue(cs, currentSettings, osScreenN, 'os_mode_source') || '').trim().toLowerCase()
	const matchSavedModeIdx = uniqueDetectedModes.findIndex((m) => {
		const modeMatch = m.randrMode === savedOsMode || m.mode === savedOsMode
		if (!modeMatch) return false
		if (savedOsRate == null || savedOsRate === '') return true
		return String(m.rate) === String(savedOsRate)
	})
	const savedBareOs = savedOsMode.match(/^(\d+)x(\d+)$/i)
	const preferCustomOs =
		savedOsModeSource === 'custom' ||
		(!savedOsModeSource && savedBareOs && matchSavedModeIdx < 0)
	const currentModeIdx = uniqueDetectedModes.findIndex((m) => m.current)
	const defaultEdidIdx = matchSavedModeIdx >= 0
		? matchSavedModeIdx
		: currentModeIdx >= 0
			? currentModeIdx
			: 0

	const resolvedVideoMode = resolveGpuInspectorVideoMode({
		cs,
		currentSettings,
		screenN,
		conn,
		inherited,
		detectedDisplay,
		uniqueDetectedModes,
		defaultModeIdx: defaultEdidIdx,
		physicalCasparMode: physicalPortRow?.runtime?.casparMode || detectedDisplay?.casparMode || null,
	})
	const displayModeId = String(resolvedVideoMode?.modeId || projectMode)
	const isStandardMode = displayModeId !== 'custom' && STANDARD_VIDEO_MODES.includes(displayModeId)
	const modeSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	modeSel.innerHTML = `<option value="custom">Custom</option>${STANDARD_VIDEO_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}`
	modeSel.value = isStandardMode ? displayModeId : 'custom'

	const customWidthIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '64',
		step: '1',
		placeholder: 'Width',
		value: String(
			Math.max(
				64,
				parseInt(
					String(
						resolvedVideoMode?.width ??
							readDim('custom_width', inherited?.width ?? 1920) ??
							1920,
					),
					10,
				) || 1920,
			),
		),
	})
	const customHeightIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '64',
		step: '1',
		placeholder: 'Height',
		value: String(
			Math.max(
				64,
				parseInt(
					String(
						resolvedVideoMode?.height ??
							readDim('custom_height', inherited?.height ?? 1080) ??
							1080,
					),
					10,
				) || 1080,
			),
		),
	})
	const customFpsIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '1',
		step: '0.01',
		placeholder: 'Frame rate',
		value: String(
			Math.max(
				1,
				parseFloat(
					String(resolvedVideoMode?.fps ?? readDim('custom_fps', inherited?.fps ?? 50) ?? 50),
				) || 50,
			),
		),
	})
	const syncCustomInputsState = () => {
		const isCustom = modeSel.value === 'custom'
		customWidthIn.disabled = !isCustom
		customHeightIn.disabled = !isCustom
		customFpsIn.disabled = !isCustom
	}
	syncCustomInputsState()

	const modeFromRes = String(detectedDisplay?.resolution || '').match(/^(\d+)x(\d+)$/)
	const displayModeSelect = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	const edidOptions = uniqueDetectedModes.length
		? uniqueDetectedModes.map((m, i) => `<option value="${i}">${m.label}</option>`).join('')
		: ''
	displayModeSelect.innerHTML = edidOptions
		? `${edidOptions}<option value="custom">Custom (register RandR mode)</option>`
		: `<option value="custom">Custom (register RandR mode)</option>`
	displayModeSelect.value = preferCustomOs ? 'custom' : String(defaultEdidIdx)

	const osCustomRow = Object.assign(document.createElement('div'), {
		style: 'display:none; flex-direction:column; gap:4px; margin-top:4px',
	})
	const osCustomLbl = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-label',
		textContent: 'Custom OS resolution (WxH × fps)',
		style: 'font-size:10px; opacity:0.75',
	})
	const osCustomFields = Object.assign(document.createElement('div'), {
		style: 'display:flex; gap:6px; flex-wrap:wrap',
	})
	const parseSavedOsCustom = () => {
		if (savedBareOs) {
			return {
				w: parseInt(savedBareOs[1], 10),
				h: parseInt(savedBareOs[2], 10),
				r: Math.max(1, parseFloat(String(savedOsRate ?? 50)) || 50),
			}
		}
		const or = readScreenCasparOsDims(cs, currentSettings, screenN)
		if (or?.osMode) {
			const mm = String(or.osMode).match(/^(\d+)x(\d+)$/i)
			if (mm) {
				return {
					w: parseInt(mm[1], 10),
					h: parseInt(mm[2], 10),
					r: Math.max(1, parseFloat(String(or.osRate ?? 50)) || 50),
				}
			}
		}
		return { w: 1920, h: 1080, r: 50 }
	}
	const osCustomInit = parseSavedOsCustom()
	const osCustomWidthIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '64',
		step: '1',
		placeholder: 'Width',
		value: String(osCustomInit.w),
	})
	const osCustomHeightIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '64',
		step: '1',
		placeholder: 'Height',
		value: String(osCustomInit.h),
	})
	const osCustomFpsIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '1',
		step: '0.01',
		placeholder: 'Hz',
		value: String(osCustomInit.r),
	})
	osCustomFields.append(osCustomWidthIn, osCustomHeightIn, osCustomFpsIn)
	osCustomRow.append(osCustomLbl, osCustomFields)

	const syncOsCustomRowVisibility = () => {
		const isCustom = displayModeSelect.value === 'custom'
		osCustomRow.style.display = isCustom ? 'flex' : 'none'
	}
	syncOsCustomRowVisibility()

	const overrideResRow = Object.assign(document.createElement('label'), {
		className: 'device-view__cablemode',
		style: 'display:flex; align-items:center; gap:6px; margin: 0 0 4px',
	})
	const overrideResIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	const savedForceOs = readPortOsValue(cs, currentSettings, osScreenN, 'force_os_resolution')
	overrideResIn.checked = savedForceOs === true || savedForceOs === 'true'
	overrideResRow.append(overrideResIn, document.createTextNode('Override'))
	overrideResRow.title = 'Use Caspar Video mode for layout when cabled to a destination (see WO-40)'

	const edidName = String(edidParsed?.monitorName || '').trim()
	const edidSerial = String(edidParsed?.serial || '').trim()
	const edidHeadline = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-label',
		style: `font-size:11px; margin-top:8px; font-weight:600;${edidName ? '' : ' color:#c90;'}`,
		textContent: edidName
			? `EDID: ${edidName}${edidSerial ? ` (${edidSerial})` : ''}`
			: detectedDisplay?.connected
				? 'No EDID received'
				: 'No display connected',
	})

	const displayLabel = detectedDisplay?.name ? String(detectedDisplay.name) : ''
	const systemResolutionLbl = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-label',
		textContent: displayLabel ? `Detected modes on ${displayLabel}` : 'Detected modes (from display)',
		style: 'font-size:10px; opacity:0.7; margin-top:8px',
	})
	const systemResolutionBlock = Object.assign(document.createElement('div'), {
		style: 'display:flex; flex-direction:column; gap:4px',
	})
	systemResolutionBlock.append(edidHeadline, systemResolutionLbl, displayModeSelect, osCustomRow, overrideResRow)

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
	const timingStored = String(readPortOsValue(cs, currentSettings, osScreenN, 'os_timing_source') || 'cvt')
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
		const osCustom = displayModeSelect.value === 'custom'
		timingLbl.textContent = osCustom
			? 'Timing for Custom OS mode — Apply GPU registers RandR mode (newmode/addmode) at this WxH×Hz'
			: 'EDID list selection — Apply GPU uses that xrandr mode token as-is (no newmode)'
		scheduleModelinePreview()
	}

	let modelinePreviewTimer = null
	const scheduleModelinePreview = () => {
		clearTimeout(modelinePreviewTimer)
		modelinePreviewTimer = setTimeout(() => void refreshModelinePreview(), 280)
	}

	const readPreviewDims = () => {
		if (displayModeSelect.value === 'custom') {
			return {
				w: Math.max(64, parseInt(String(osCustomWidthIn.value || 1920), 10) || 1920),
				h: Math.max(64, parseInt(String(osCustomHeightIn.value || 1080), 10) || 1080),
				r: Math.max(1, parseFloat(String(osCustomFpsIn.value || 50)) || 50),
			}
		}
		const idx = parseInt(String(displayModeSelect.value || '0'), 10)
		const pick = uniqueDetectedModes[Number.isFinite(idx) ? idx : 0] || null
		if (pick && pick.mode) {
			const mm = String(pick.mode).match(/^(\d+)x(\d+)$/i)
			if (mm) {
				const r = parseFloat(String(pick.rate || detectedDisplay?.refreshHz || 60)) || 60
				return { w: parseInt(mm[1], 10), h: parseInt(mm[2], 10), r }
			}
		}
		if (overrideResIn.checked) {
			const or = readScreenCasparOsDims(cs, currentSettings, screenN)
			if (or) {
				const mm = String(or.osMode).match(/^(\d+)x(\d+)$/i)
				if (mm) return { w: parseInt(mm[1], 10), h: parseInt(mm[2], 10), r: or.osRate }
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

	const readOsResolutionFromUi = () => {
		if (displayModeSelect.value === 'custom') {
			const w = Math.max(64, parseInt(String(osCustomWidthIn.value || 1920), 10) || 1920)
			const h = Math.max(64, parseInt(String(osCustomHeightIn.value || 1080), 10) || 1080)
			const r = Math.max(1, parseFloat(String(osCustomFpsIn.value || 50)) || 50)
			return { source: 'custom', mode: `${w}x${h}`, rate: r }
		}
		const selectedIdx = parseInt(String(displayModeSelect.value || 0), 10)
		const pick = uniqueDetectedModes[Number.isFinite(selectedIdx) ? selectedIdx : 0] || null
		const randr = pick?.randrMode && String(pick.randrMode).trim() ? String(pick.randrMode).trim() : ''
		const mode = randr || pick?.mode || (modeFromRes ? `${modeFromRes[1]}x${modeFromRes[2]}` : '')
		const rateRaw = pick?.rate || (Number.isFinite(Number(detectedDisplay?.refreshHz)) ? String(detectedDisplay.refreshHz) : '')
		const rate = rateRaw ? parseFloat(rateRaw) : ''
		return { source: 'edid', mode, rate }
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
		runOsSave()
		scheduleModelinePreview()
	})
	overrideResIn.addEventListener('change', () => {
		runOsSave()
		syncTimingRowVisibility()
	})
	syncTimingRowVisibility()

	displayModeSelect.addEventListener('change', () => {
		syncOsCustomRowVisibility()
		syncTimingRowVisibility()
		scheduleModelinePreview()
		runOsSave()
	})
	osCustomWidthIn.addEventListener('change', () => {
		runOsSave()
		scheduleModelinePreview()
	})
	osCustomHeightIn.addEventListener('change', () => {
		runOsSave()
		scheduleModelinePreview()
	})
	osCustomFpsIn.addEventListener('change', () => {
		runOsSave()
		scheduleModelinePreview()
	})
	osCustomWidthIn.addEventListener('input', () => scheduleModelinePreview())
	osCustomHeightIn.addEventListener('input', () => scheduleModelinePreview())
	osCustomFpsIn.addEventListener('input', () => scheduleModelinePreview())
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

	const readSelectedOsModeAndRate = () => {
		const os = readOsResolutionFromUi()
		return { mode: os.mode, rate: os.rate }
	}

	const buildOutputPatchFromSelection = () => {
		const fields = {
			...buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readOsResolutionFromUi),
		}
		return buildPerPortOsSettingsPatch(osScreenN, fields, { systemId: detectedDisplay?.name })
	}

	/** Blanket OS/xrandr for apply-os: same mode on every mapped output. */
	const buildOsOutputPatchForApply = () => {
		const fields = buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readOsResolutionFromUi)
		return expandBlanketOsPatch(cs, currentSettings, fields)
	}

	const buildGlobalOsSettingsPatchForSave = () => {
		const fields = buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readOsResolutionFromUi)
		return buildPerPortOsSettingsPatch(osScreenN, fields, { systemId: detectedDisplay?.name })
	}

	const siblingPorts = listSiblingGpuPortsOnCasparScreen(conn, lastPayload, screenN)
	let casparScreenNote = null
	if (siblingPorts.length) {
		casparScreenNote = Object.assign(document.createElement('div'), {
			style: 'font-size:10px; opacity:0.6; margin:0 0 4px',
			textContent: `Caspar screen ${screenN} — shared with ${siblingPorts.join(', ')}`,
		})
	}

	return {
		inherited,
		source,
		cableFeedNote,
		casparScreenNote,
		systemResolutionBlock,
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
		keyOsModeSource,
		osCustomRow,
		osCustomWidthIn,
		osCustomHeightIn,
		osCustomFpsIn,
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
		buildGlobalOsSettingsPatchForSave,
	}
}
