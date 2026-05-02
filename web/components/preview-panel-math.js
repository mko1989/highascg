/**
 * Math helpers for the preview panel.
 */

export function fitComposePairRect(w, h, layout, cw, ch) {
	const w2 = Math.max(1, w); const h2 = Math.max(1, h); const cw2 = Math.max(1, cw); const ch2 = Math.max(1, ch)
	const ar = (layout === 'lr') ? (2 * w2) / h2 : w2 / (2 * h2)
	let fitW = cw2; let fitH = fitW / ar
	if (fitH > ch2) { fitH = ch2; fitW = fitH * ar }
	return { fitW: Math.round(fitW), fitH: Math.round(Math.max(64, fitH)) }
}

export function composeCellLogicalDimensions(layout, ww, hh, fitW, fitH, prvSize, pgmSize) {
	const ps = Math.max(1, prvSize); const pgs = Math.max(1, pgmSize)
	if (layout === 'lr') return { prv: { w: ww, h: ww * (fitH / ps) }, pgm: { w: ww, h: ww * (fitH / pgs) } }
	return { prv: { w: hh * (fitW / ps), h: hh }, pgm: { w: hh * (fitW / pgs), h: hh } }
}
