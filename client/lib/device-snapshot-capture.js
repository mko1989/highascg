/**
 * WO-49 — rear-panel PNG for device snapshot (Caspar backplane).
 * Dynamic import so a vendor miss does not break the whole Devices UI.
 */

/** @param {string} name */
export function slugifyDeviceName(name) {
	const s = String(name || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return s || 'device'
}

/**
 * @param {HTMLElement | null} el
 * @param {{ pixelRatio?: number, backgroundColor?: string }} [opts]
 * @returns {Promise<{ mimeType: string, encoding: string, width: number, height: number, data: string } | null>}
 */
export async function captureRearPanelVisual(el, opts = {}) {
	if (!el) return null
	const pixelRatio = Number(opts.pixelRatio) > 0 ? Number(opts.pixelRatio) : 2
	try {
		const { toPng } = await import('html-to-image')
		const dataUrl = await toPng(el, {
			pixelRatio,
			cacheBust: true,
			backgroundColor: opts.backgroundColor || '#1a1a1a',
		})
		const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
		if (!m) return null
		const w = Math.max(1, Math.round((el.offsetWidth || el.clientWidth) * pixelRatio))
		const h = Math.max(1, Math.round((el.offsetHeight || el.clientHeight) * pixelRatio))
		return {
			mimeType: 'image/png',
			encoding: 'base64',
			width: w,
			height: h,
			data: m[1],
		}
	} catch (e) {
		console.warn('[device-snapshot] PNG capture failed', e)
		return null
	}
}
