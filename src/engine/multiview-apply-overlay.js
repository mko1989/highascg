'use strict'

const {
	overlayType,
	inferPgmScreen,
	inferPrvScreen,
	chromeReserveForCellLayout,
	loadOverlayTemplate,
} = require('./multiview-layout-helper')

/**
 * Load (or clear) the multiview overlay CG for one channel.
 * @param {object} ctx
 * @param {number} ch
 * @param {number} overlayLayer
 * @param {object} params
 */
async function applyMultiviewOverlay(ctx, ch, overlayLayer, params) {
	const {
		layout,
		showOverlay,
		showTimersUnderLabels,
		timerScale,
		highlightTopTimer,
		programChannels,
		previewChannels,
		inputsCh,
		decklinkInputChannels,
	} = params

	if (showOverlay) {
		const { buildChannelMap } = require('../config/channel-map-from-ctx')
		const cm = buildChannelMap(ctx)

		const cells = layout.map((c) => {
			const ovTypeCell = overlayType(c, programChannels, previewChannels, inputsCh, decklinkInputChannels)
			let suffix = ''
			let channelNum = null
			let screenIdx = -1

			if (ovTypeCell === 'pgm') {
				screenIdx = inferPgmScreen(c, programChannels) - 1
				channelNum = programChannels[screenIdx] || null
				const res = cm.programResolutions?.[screenIdx]
				if (res && res.w > 0 && res.h > 0) {
					suffix = ` (${res.w}x${res.h} ${res.fps}p)`
				}
			} else if (ovTypeCell === 'prv') {
				screenIdx = inferPrvScreen(c, previewChannels) - 1
				channelNum = previewChannels[screenIdx] || null
				const res = cm.previewResolutions?.[screenIdx] || cm.programResolutions?.[screenIdx]
				if (res && res.w > 0 && res.h > 0) {
					suffix = ` (${res.w}x${res.h} ${res.fps}p)`
				}
			}

			const displayLabel = c.label || c.id || ''
			const { chromeBottomFrac } = chromeReserveForCellLayout(c, ovTypeCell, showTimersUnderLabels)
			return {
				id: c.id,
				label: displayLabel + suffix,
				x: c._calc ? c._calc.vx : c.x,
				y: c._calc ? c._calc.vy : c.y,
				w: c._calc ? c._calc.vw : c.w,
				h: c._calc ? c._calc.vh : c.h,
				labelX: c._calc ? c._calc.lx : c.x,
				labelY: c._calc ? c._calc.ly : (c.y + c.h),
				labelW: c._calc ? c._calc.lw : c.w,
				labelH: c._calc ? c._calc.lh : 0,
				type: ovTypeCell,
				screenIdx,
				channelNum,
				chromeBottomFrac: c._calc ? (c._calc.lh / c._calc.vh) : chromeBottomFrac,
			}
		})

		const keyed = {}
		for (const c of layout) {
			const r = {
				x: c._calc ? c._calc.vx : c.x,
				y: c._calc ? c._calc.vy : c.y,
				w: c._calc ? c._calc.vw : c.w,
				h: c._calc ? c._calc.vh : c.h,
				labelX: c._calc ? c._calc.lx : c.x,
				labelY: c._calc ? c._calc.ly : (c.y + c.h),
				labelW: c._calc ? c._calc.lw : c.w,
				labelH: c._calc ? c._calc.lh : 0,
				label: c.label || c.id || '',
			}
			const ovTypeCell = overlayType(c, programChannels, previewChannels, inputsCh, decklinkInputChannels)
			const pgmM = c.id?.match(/^pgm(?:_(\d+))?$/)
			const prvM = c.id?.match(/^prv(?:_(\d+))?$/)
			let n = 1
			if (pgmM || ovTypeCell === 'pgm') {
				if (pgmM?.[1] != null) n = parseInt(pgmM[1], 10) + 1
				else if (c.source && String(c.source).startsWith('route://')) {
					const chNum = parseInt(String(c.source).replace(/^route:\/\//, '').split('-')[0], 10)
					if (!isNaN(chNum) && programChannels.includes(chNum))
						n = programChannels.indexOf(chNum) + 1
					else n = inferPgmScreen(c, programChannels)
				} else n = inferPgmScreen(c, programChannels)
				keyed[n === 1 ? 'pgm' : `pgm${n}`] = r
			} else if (prvM || ovTypeCell === 'prv') {
				if (prvM?.[1] != null) n = parseInt(prvM[1], 10) + 1
				else if (c.source && String(c.source).startsWith('route://')) {
					const chNum = parseInt(String(c.source).replace(/^route:\/\//, '').split('-')[0], 10)
					if (!isNaN(chNum) && previewChannels.includes(chNum))
						n = previewChannels.indexOf(chNum) + 1
					else n = inferPrvScreen(c, previewChannels)
				} else n = inferPrvScreen(c, previewChannels)
				keyed[n === 1 ? 'prev' : `prev${n}`] = r
			} else {
				let m = c.id?.match(/^(decklink|ndi)_(\d+)$/)
				if (m) {
					keyed[m[1] + m[2]] = r
				} else if (ovTypeCell === 'decklink') {
					const lblM = (c.label || '').match(/decklink\s*(\d+)/i)
					const idx = lblM ? parseInt(lblM[1], 10) - 1 : (c.source && String(c.source).match(/route:\/\/[^-]+-(\d+)/)) ? parseInt(RegExp.$1, 10) - 1 : 0
					if (idx >= 0 && idx < 8) keyed['decklink' + idx] = r
				} else if (ovTypeCell === 'ndi') {
					const lblM = (c.label || '').match(/ndi\s*(\d+)/i)
					const idx = lblM ? parseInt(lblM[1], 10) - 1 : 0
					if (idx >= 0 && idx < 8) keyed['ndi' + idx] = r
				} else {
					const lbl = (c.label || '').toLowerCase()
					const pgmN = lbl.match(/\b(?:program|pgm)\s*(\d+)\b/) || lbl.match(/\bpgm(\d+)\b/) || lbl.match(/pgm\s*s\s*(\d+)/)
					const prvN = lbl.match(/\b(?:preview|prv)\s*(\d+)\b/) || lbl.match(/\bprv(\d+)\b/) || lbl.match(/prv\s*s\s*(\d+)/)
					if (pgmN) keyed[parseInt(pgmN[1], 10) === 1 ? 'pgm' : `pgm${pgmN[1]}`] = r
					else if (prvN) keyed[parseInt(prvN[1], 10) === 1 ? 'prev' : `prev${prvN[1]}`] = r
				}
			}
		}
		const overlayData = JSON.stringify({ cells, showTimersUnderLabels, timerScale, highlightTopTimer, ...keyed })
		await loadOverlayTemplate(ctx, ch, overlayLayer, overlayData)
	} else {
		try {
			await ctx.amcp.cgClear(ch, overlayLayer)
		} catch {}
		try {
			await ctx.amcp.stop(ch, overlayLayer)
		} catch {}
	}
}

module.exports = { applyMultiviewOverlay }
