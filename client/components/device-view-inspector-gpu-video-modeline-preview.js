/**
 * Timing/modeline preview UI and mode-selection readers for the GPU video
 * modeline inspector section (CVT/GTF preview fetched from the server).
 */
import * as Actions from './device-view-actions.js'
import { CASPAR_VIDEO_MODE_SPECS } from './device-view-destinations-inspector.js'
import { readPortOsValue, readScreenCasparOsDims } from './device-view-inspector-gpu-video-modeline-os-settings.js'

/**
 * Readers over the live mode-selection UI controls.
 * Returns `readPreviewDims` (WxH×Hz for the timing preview) and
 * `readOsResolutionFromUi` (mode/rate/source for the OS settings patch).
 */
export function createModeSelectionReaders(refs) {
	const {
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
	} = refs

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

	return { readPreviewDims, readOsResolutionFromUi }
}

/**
 * Builds the timing-preview row (selector + debounced CVT/GTF modeline preview)
 * for the modeline inspector section.
 */
export function createModelineTimingPreview({ cs, currentSettings, osScreenN, readPreviewDims }) {
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

	let modelinePreviewTimer = null
	const scheduleModelinePreview = () => {
		clearTimeout(modelinePreviewTimer)
		modelinePreviewTimer = setTimeout(() => void refreshModelinePreview(), 280)
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

	return { timingRow, timingLbl, timingSel, scheduleModelinePreview }
}
