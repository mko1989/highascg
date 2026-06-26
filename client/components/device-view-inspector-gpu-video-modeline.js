/**
 * Video mode, EDID/xrandr display selection, timing + modeline preview, and "use detected display mode".
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { resolveCableSourceResolution } from '../lib/device-view-gpu-source-inherit.js'
import {
	gpuPhysicalPortCableId,
	readGpuLayoutPrefs,
	resolveEffectiveGpuTopology,
} from '../lib/device-view-gpu-port-list.js'
import { resolveGpuScreenNumber } from './device-view-inspector-gpu-resolve.js'
import { normRandrCaspar } from './device-view-caspar-render-helpers.js'
import { STANDARD_VIDEO_MODES, casparVideoModeToOsModeAndRate, CASPAR_VIDEO_MODE_SPECS } from './device-view-destinations-inspector.js'

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
		[`screen_${n}_force_os_resolution`]: fields.force_os_resolution,
	}
	const sid = String(systemId || '').trim()
	if (sid) patch[`screen_${n}_system_id`] = sid
	return patch
}

function buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readSelectedOsModeAndRate, cs, currentSettings, casparScreenN) {
	const backend = osBackendSel.value === 'nvidia' ? 'nvidia' : 'xrandr'
	const ts = timingSel.value === 'gtf' ? 'gtf' : timingSel.value === 'cvt_r' ? 'cvt_r' : 'cvt'
	const force = !!overrideResIn.checked
	let mode = ''
	let rate = ''
	if (overrideResIn.checked) {
		const or = readScreenCasparOsDims(cs, currentSettings, casparScreenN)
		if (or) {
			mode = or.osMode
			rate = or.osRate
		}
	}
	if (!mode) {
		const sel = readSelectedOsModeAndRate()
		mode = sel.mode
		rate = sel.rate
	}
	return {
		os_mode: mode,
		os_rate: rate,
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
	const modeId = String(cs[modeKey] ?? currentSettings?.casparServer?.[modeKey] ?? currentSettings?.[modeKey] ?? '1080p5000').trim() || '1080p5000'
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
		mode: source.videoMode || '1080p5000',
		width: Math.max(64, parseInt(String(source.width ?? 1920), 10) || 1920),
		height: Math.max(64, parseInt(String(source.height ?? 1080), 10) || 1080),
		fps: Math.max(1, parseFloat(String(source.fps ?? 50)) || 50)
	} : null

	const currentMode = String(cs[keyMode] || currentSettings?.casparServer?.[keyMode] || conn?.caspar?.mode || '1080p5000')
	const isStandardMode = STANDARD_VIDEO_MODES.includes(currentMode)
	const modeSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	modeSel.innerHTML = `<option value="custom">Custom</option>${STANDARD_VIDEO_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}`
	modeSel.value = isStandardMode ? currentMode : 'custom'

	const parsedCurrentCustom = currentMode.match(/^(\d+)\s*x\s*(\d+)$/i)
	const readDim = (suffix, fallback) => {
		const k = `screen_${screenN}_${suffix}`
		return cs[k] ?? currentSettings?.casparServer?.[k] ?? fallback
	}
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
						readDim('custom_width', parsedCurrentCustom ? parseInt(parsedCurrentCustom[1], 10) : 1920) ?? 1920,
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
						readDim('custom_height', parsedCurrentCustom ? parseInt(parsedCurrentCustom[2], 10) : 1080) ?? 1080,
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
		value: String(Math.max(1, parseFloat(String(readDim('custom_fps', 50) ?? 50)) || 50)),
	})
	const syncCustomInputsState = () => {
		const isCustom = modeSel.value === 'custom'
		customWidthIn.disabled = !isCustom
		customHeightIn.disabled = !isCustom
		customFpsIn.disabled = !isCustom
	}
	syncCustomInputsState()

	let cableFeedNote = null
	if (inherited) {
		cableFeedNote = Object.assign(document.createElement('div'), {
			style: 'font-size:10px; opacity:0.6; margin:2px 0 4px',
			textContent: `${source.label || source.id}: ${inherited.width}×${inherited.height} @ ${inherited.fps} Hz`,
		})
	}

	const detectDisplayForConnector = () => {
		const ports = Array.isArray(lastPayload?.live?.gpu?.physicalMap?.ports) ? lastPayload.live.gpu.physicalMap.ports : []
		const displays = Array.isArray(lastPayload?.live?.gpu?.displays) ? lastPayload.live.gpu.displays : []
		const canonicalId = gpuPhysicalPortCableId(conn?.id || '')
		const byId = ports.find((p) => String(p?.physicalPortId || '').trim() === canonicalId) || null
		const topo = resolveEffectiveGpuTopology(
			lastPayload?.gpuPhysicalTopology || lastPayload?.settings?.gpuPhysicalTopology,
			readGpuLayoutPrefs(),
		)
		const topoRow = topo.find((t) => String(t?.physicalPortId || '').trim() === canonicalId) || null
		const pairNames = []
		if (topoRow) {
			if (topoRow.dpA) pairNames.push(String(topoRow.dpA).trim())
			if (topoRow.dpB) pairNames.push(String(topoRow.dpB).trim())
		} else if (byId?.pair) {
			if (byId.pair.dpA) pairNames.push(String(byId.pair.dpA).trim())
			if (byId.pair.dpB) pairNames.push(String(byId.pair.dpB).trim())
		} else if (conn?.gpuPhysical?.pair) {
			if (conn.gpuPhysical.pair.dpA) pairNames.push(String(conn.gpuPhysical.pair.dpA).trim())
			if (conn.gpuPhysical.pair.dpB) pairNames.push(String(conn.gpuPhysical.pair.dpB).trim())
		}
		const findDisplay = (name) => {
			const want = normRandrCaspar(name)
			if (!want) return null
			return displays.find((x) => normRandrCaspar(x?.name) === want) || null
		}
		if (byId) {
			const activePort = String(byId?.runtime?.activePort || byId?.runtime?.xrandrName || '').trim()
			if (activePort) {
				const activeNorm = normRandrCaspar(activePort)
				if (pairNames.some((p) => normRandrCaspar(p) === activeNorm)) {
					const d = findDisplay(activePort)
					if (d) return d
				}
			}
		}
		for (const name of pairNames) {
			const d = findDisplay(name)
			if (d?.connected) return d
		}
		for (const name of pairNames) {
			const d = findDisplay(name)
			if (d) return d
		}
		return null
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
	const portModes = (Array.isArray(detectedDisplay?.modes) ? detectedDisplay.modes : [])
		.map(formatModeOption)
		.filter(Boolean)
	const uniqueDetectedModes = portModes.filter(
		(m, i, a) => a.findIndex((x) => x.randrMode === m.randrMode && x.rate === m.rate) === i,
	)
	const savedOsMode = String(readPortOsValue(cs, currentSettings, osScreenN, 'os_mode') || '').trim()
	const savedOsRate = readPortOsValue(cs, currentSettings, osScreenN, 'os_rate')
	const matchSavedModeIdx = uniqueDetectedModes.findIndex((m) => {
		const modeMatch = m.randrMode === savedOsMode || m.mode === savedOsMode
		if (!modeMatch) return false
		if (savedOsRate == null || savedOsRate === '') return true
		return String(m.rate) === String(savedOsRate)
	})
	const currentModeIdx = uniqueDetectedModes.findIndex((m) => m.current)
	const defaultModeIdx = matchSavedModeIdx >= 0
		? matchSavedModeIdx
		: currentModeIdx >= 0
			? currentModeIdx
			: 0
	const modeFromRes = String(detectedDisplay?.resolution || '').match(/^(\d+)x(\d+)$/)
	const displayModeSelect = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	const displayLabel = detectedDisplay?.name ? String(detectedDisplay.name) : ''
	displayModeSelect.innerHTML = uniqueDetectedModes.length
		? uniqueDetectedModes.map((m, i) => `<option value="${i}" ${i === defaultModeIdx ? 'selected' : ''}>${m.label}</option>`).join('')
		: `<option value="">${displayLabel ? `No modes for ${displayLabel}` : 'No EDID/xrandr modes for this port'}</option>`

	const overrideResRow = Object.assign(document.createElement('label'), {
		className: 'device-view__cablemode',
		style: 'display:flex; align-items:center; gap:6px; margin: 0 0 4px',
	})
	const overrideResIn = Object.assign(document.createElement('input'), { type: 'checkbox' })
	const savedForceOs = readPortOsValue(cs, currentSettings, osScreenN, 'force_os_resolution')
	overrideResIn.checked = savedForceOs === true || savedForceOs === 'true'
	overrideResRow.append(overrideResIn, document.createTextNode('Override'))
	overrideResRow.title = 'Use Caspar video mode for xrandr instead of the EDID list'

	const systemResolutionLbl = Object.assign(document.createElement('div'), {
		className: 'device-view__inspector-label',
		textContent: displayLabel ? `System resolution (${displayLabel})` : 'System resolution',
		style: 'font-size:10px; opacity:0.7; margin-top:8px',
	})
	const systemResolutionBlock = Object.assign(document.createElement('div'), {
		style: 'display:flex; flex-direction:column; gap:4px',
	})
	systemResolutionBlock.append(systemResolutionLbl, displayModeSelect, overrideResRow)

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
			const or = readScreenCasparOsDims(cs, currentSettings, screenN)
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
		runOsSave()
		scheduleModelinePreview()
	})
	overrideResIn.addEventListener('change', () => {
		runOsSave()
		syncTimingRowVisibility()
	})
	syncTimingRowVisibility()

	displayModeSelect.addEventListener('change', () => {
		scheduleModelinePreview()
		runOsSave()
	})
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
		const selectedIdx = parseInt(String(displayModeSelect.value || 0), 10)
		const pick = uniqueDetectedModes[Number.isFinite(selectedIdx) ? selectedIdx : 0] || null
		const randr = pick?.randrMode && String(pick.randrMode).trim() ? String(pick.randrMode).trim() : ''
		const mode = randr || pick?.mode || (modeFromRes ? `${modeFromRes[1]}x${modeFromRes[2]}` : '')
		const rateRaw = pick?.rate || (Number.isFinite(Number(detectedDisplay?.refreshHz)) ? String(detectedDisplay.refreshHz) : '')
		const rate = rateRaw ? parseFloat(rateRaw) : ''
		return { mode, rate }
	}

	const buildOutputPatchFromSelection = () => {
		const fields = {
			...buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readSelectedOsModeAndRate, cs, currentSettings, screenN),
		}
		return buildPerPortOsSettingsPatch(osScreenN, fields, { systemId: detectedDisplay?.name })
	}

	/** Blanket OS/xrandr for apply-os: same mode on every mapped output. */
	const buildOsOutputPatchForApply = () => {
		const fields = buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readSelectedOsModeAndRate, cs, currentSettings, screenN)
		return expandBlanketOsPatch(cs, currentSettings, fields)
	}

	const buildGlobalOsSettingsPatchForSave = () => {
		const fields = buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readSelectedOsModeAndRate, cs, currentSettings, screenN)
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
