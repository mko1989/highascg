export function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

export function escapeAttr(s) {
	return String(s).replace(/"/g, '&quot;')
}

/**
 * Shorten a media filename for narrow audio-mixer labels.
 * @param {string} raw
 * @param {{ max?: number, tailChars?: number }} [opts]
 */
export function shortenMediaName(raw, opts = {}) {
	const max = opts.max ?? 22
	const tailChars = opts.tailChars ?? 3
	const s = String(raw || '').trim()
	if (!s) return ''
	const noExt = s.replace(/\.[a-z0-9]{2,4}$/i, '')
	const tokens = noExt.split(/[_\s.-]+/).filter(Boolean)
	const KEEP = []
	for (const tok of tokens) {
		if (/^\d{6,}$/.test(tok)) continue
		if (/^\d{1,4}(fps|hz|k|p|i)$/i.test(tok)) continue
		if (/^(hd|uhd|sd|4k|8k|hdr|sdr)$/i.test(tok)) continue
		if (/^(r709|r2020|p3|rec709|rec2020|srgb)$/i.test(tok)) continue
		if (/^(hap|prores|h264|h265|hevc|dnxhd|dnxhr|mxf|mov)$/i.test(tok)) continue
		if (/^(master|final|preview|proxy|mezz|mezzanine)$/i.test(tok)) continue
		if (/^\d+dfx?$/i.test(tok)) continue
		if (/^[A-Z]{2}-[A-Z]{2,}$/.test(tok)) continue
		KEEP.push(tok)
	}
	const cleaned = KEEP.length ? KEEP.join('_') : noExt
	if (cleaned.length <= max) return cleaned
	if (tailChars > 0 && max > tailChars + 4) {
		const head = cleaned.slice(0, max - tailChars - 1)
		const tail = cleaned.slice(-tailChars)
		return `${head}…${tail}`
	}
	return `${cleaned.slice(0, max - 1)}…`
}
