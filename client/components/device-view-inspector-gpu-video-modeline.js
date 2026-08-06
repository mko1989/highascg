/**
 * Video mode, EDID/xrandr display selection, timing + modeline preview, and "use detected display mode".
 *
 * Extracted concerns (WO-140):
 * - Settings/patch helpers: ./device-view-inspector-gpu-video-modeline-os-settings.js
 * - Timing preview UI + mode-selection readers: ./device-view-inspector-gpu-video-modeline-preview.js
 */
import { resolveCableSourceResolution } from '../lib/device-view-gpu-source-inherit.js'
import { gpuPhysicalPortCableId } from '../lib/device-view-gpu-port-list.js'
import { resolveGpuDetectedDisplay } from './device-view-inspector-gpu-resolve.js'
import { parseEdidPreferredMode, edidPreferredModeIsSelectable } from '../lib/edid-preferred-mode.js'
import {
	STANDARD_VIDEO_MODES,
	resolveGpuInspectorVideoMode,
} from './device-view-destinations-inspector.js'
import { resolveDefaultVideoMode } from '../lib/project-fps.js'
import { videoModeToResolution } from '../lib/mapping-node-service.js'
import {
	readPortOsValue,
	buildPerPortOsSettingsPatch,
	buildGlobalOsFieldsFromUi,
	expandBlanketOsPatch,
	readScreenCasparOsDims,
	listSiblingGpuPortsOnCasparScreen,
	formatModeOption,
} from './device-view-inspector-gpu-video-modeline-os-settings.js'
import {
	createModeSelectionReaders,
	createModelineTimingPreview,
} from './device-view-inspector-gpu-video-modeline-preview.js'
import { attachMathInput } from '../lib/math-input.js'

export function populateGpuVideoModelineSection(wrapCtl, ctx) {
	const { saveRef, osSaveRef, conn, lastPayload, cs, currentSettings, screenN, osScreenN } = ctx
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

	/**
	 * The EDID's own preferred/native timing ("3840x2160@50Hz" — edid-parse.js's detailed-timing
	 * descriptor at 0x36). Only meaningful when it is NOT already one of the driver's known CRTC
	 * modes: that is exactly the case reported live — the inspector's "Native mode" summary row
	 * read this correctly, but it could not be picked from `displayModeSelect` (that list only ever
	 * shows modes xrandr already has), and "Custom OS resolution" defaulted to a hardcoded
	 * 1920x1080@50 with no awareness of it, forcing a hand-retype of numbers already shown two rows
	 * up. Used below both to prefill the Custom fields and to default the dropdown itself to
	 * "Custom" when the native mode is the only correct choice.
	 */
	const edidPreferred = parseEdidPreferredMode(edidParsed?.preferredMode)

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
	const edidPreferredIsSelectable = edidPreferredModeIsSelectable(edidPreferred, uniqueDetectedModes)
	const preferCustomOs =
		savedOsModeSource === 'custom' ||
		(!savedOsModeSource && savedBareOs && matchSavedModeIdx < 0) ||
		// Nothing saved yet, and the monitor's own EDID-native mode is not even one of the choices
		// xrandr currently offers — default to Custom (prefilled with that native mode below) rather
		// than silently landing on whatever lower-resolution mode happens to be first/current.
		(!savedOsMode && !edidPreferredIsSelectable)
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
	for (const opt of [{ value: 'custom', label: 'Custom' }, ...STANDARD_VIDEO_MODES.map((m) => ({ value: m, label: m }))]) {
		const option = document.createElement('option')
		option.value = opt.value
		option.textContent = opt.label
		modeSel.appendChild(option)
	}
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
	attachMathInput(customWidthIn, { decimals: 0 })
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
	attachMathInput(customHeightIn, { decimals: 0 })
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
	attachMathInput(customFpsIn, { decimals: 2 })
	const syncCustomInputsState = () => {
		const isCustom = modeSel.value === 'custom'
		customWidthIn.disabled = !isCustom
		customHeightIn.disabled = !isCustom
		customFpsIn.disabled = !isCustom
		/* WO-442: a standard mode fully determines the raster — showing the (disabled) custom
		 * boxes next to it displays whatever screen_N_custom_* keys happen to hold (the owner
		 * found seeded 1920/1080 fossils beside a 2160p mode: "it doesnt make sense at all").
		 * The row only exists when Custom is selected. Parent is assembled by the caller, so
		 * resolve it at call time. */
		const row = customWidthIn.parentElement
		if (row) row.style.display = isCustom ? 'flex' : 'none'
		/* Switching TO custom starts from the mode that was just active, not from stale keys. */
		if (isCustom && modeSel.dataset.prevStandardMode) {
			const res = videoModeToResolution(modeSel.dataset.prevStandardMode)
			customWidthIn.value = String(res.w)
			customHeightIn.value = String(res.h)
			customFpsIn.value = String(res.fps ?? 50)
		}
		if (!isCustom) modeSel.dataset.prevStandardMode = modeSel.value
	}
	if (modeSel.value !== 'custom') modeSel.dataset.prevStandardMode = modeSel.value
	syncCustomInputsState()

	const modeFromRes = String(detectedDisplay?.resolution || '').match(/^(\d+)x(\d+)$/)
	const displayModeSelect = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	const edidOptions = uniqueDetectedModes.length
		? uniqueDetectedModes.map((m, i) => `<option value="${i}">${m.label}</option>`).join('')
		: ''
	// Label makes explicit that "Custom" is how the EDID-native mode gets registered when xrandr
	// doesn't already have it as a CRTC mode — this IS the correct choice, not a workaround; it
	// used to read just "Custom (register RandR mode)", which read as "give up and guess numbers"
	// even when the exact right numbers were already known and shown two rows up.
	const customOptionLabel =
		!edidPreferredIsSelectable && edidPreferred
			? `Custom (register RandR mode) — EDID native ${edidPreferred.w}x${edidPreferred.h} @ ${edidPreferred.r}`
			: 'Custom (register RandR mode)'
	displayModeSelect.innerHTML = edidOptions
		? `${edidOptions}<option value="custom">${customOptionLabel}</option>`
		: `<option value="custom">${customOptionLabel}</option>`
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
		return edidPreferred || { w: 1920, h: 1080, r: 50 }
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
	attachMathInput(osCustomWidthIn, { decimals: 0 })
	const osCustomHeightIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '64',
		step: '1',
		placeholder: 'Height',
		value: String(osCustomInit.h),
	})
	attachMathInput(osCustomHeightIn, { decimals: 0 })
	const osCustomFpsIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '1',
		step: '0.01',
		placeholder: 'Hz',
		value: String(osCustomInit.r),
	})
	attachMathInput(osCustomFpsIn, { decimals: 2 })
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

	const { readPreviewDims, readOsResolutionFromUi } = createModeSelectionReaders({
		displayModeSelect,
		osCustomWidthIn,
		osCustomHeightIn,
		osCustomFpsIn,
		uniqueDetectedModes,
		detectedDisplay,
		overrideResIn,
		modeSel,
		customWidthIn,
		customHeightIn,
		customFpsIn,
		modeFromRes,
		cs,
		currentSettings,
		screenN,
	})

	const { timingRow, timingLbl, timingSel, scheduleModelinePreview } = createModelineTimingPreview({
		cs,
		currentSettings,
		osScreenN,
		readPreviewDims,
	})

	const syncTimingRowVisibility = () => {
		timingRow.style.display = 'flex'
		const osCustom = displayModeSelect.value === 'custom'
		timingLbl.textContent = osCustom
			? 'Timing for Custom OS mode — Apply GPU registers RandR mode (newmode/addmode) at this WxH×Hz'
			: 'EDID list selection — Apply GPU uses that xrandr mode token as-is (no newmode)'
		scheduleModelinePreview()
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
