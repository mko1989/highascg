/**
 * Modeline preview, OS patch builders, and event wiring for GPU inspector.
 */
import * as Actions from './device-view-actions.js'
import { CASPAR_VIDEO_MODE_SPECS } from './device-view-destinations-inspector-modes.js'
import {
	buildPerPortOsSettingsPatch,
	buildGlobalOsFieldsFromUi,
	expandBlanketOsPatch,
	readScreenCasparOsDims,
	listSiblingGpuPortsOnCasparScreen,
} from './device-view-inspector-gpu-modeline-os.js'

/**
 * @param {object} ui — DOM refs and ctx fields from populateGpuVideoModelineSection
 */
export function wireGpuModelinePreviewAndPatches(ui) {
	const {
		displayModeSelect,
		osCustomWidthIn,
		osCustomHeightIn,
		osCustomFpsIn,
		customWidthIn,
		customHeightIn,
		customFpsIn,
		modeSel,
		overrideResIn,
		timingSel,
		osBackendSel,
		timingRow,
		timingLbl,
		timingPreviewEl,
		linkTierEl,
		uniqueDetectedModes,
		detectedDisplay,
		modeFromRes,
		cs,
		currentSettings,
		screenN,
		osScreenN,
		conn,
		lastPayload,
		runSave,
		runOsSave,
		syncOsCustomRowVisibility,
		syncCustomInputsState,
	} = ui

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

	const buildOutputPatchFromSelection = () => {
		const fields = {
			...buildGlobalOsFieldsFromUi(overrideResIn, timingSel, osBackendSel, readOsResolutionFromUi),
		}
		return buildPerPortOsSettingsPatch(osScreenN, fields, { systemId: detectedDisplay?.name })
	}

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
		casparScreenNote,
		scheduleModelinePreview,
		syncTimingRowVisibility,
		buildOutputPatchFromSelection,
		buildOsOutputPatchForApply,
		buildGlobalOsSettingsPatchForSave,
	}
}
