/**
 * Parse CasparCG CINF response text into usable media metadata.
 * @see companion-module-casparcg-server/src/cinf-parse.js
 */

/** @param {string} [cinf] */
function parseCinfMedia(cinf) {
	if (!cinf || typeof cinf !== 'string') return {}
	const parts = cinf.replace(/^"[^"]*"\s*/, '').trim().split(/\s+/)
	const out = {}
	if (parts[0]) out.type = parts[0]
	const resM = cinf.match(/\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/i)
	if (resM) out.resolution = `${resM[1]}×${resM[2]}`
	for (let i = 0; i < parts.length; i++) {
		const fm = (parts[i] || '').match(/^(\d+)\/(\d+)$/)
		if (fm && i > 0) {
			const frames = parseInt(parts[i - 1], 10) || 0
			const den = parseInt(fm[2], 10) || 1
			const fps = den > 0 ? parseInt(fm[1], 10) / den : 0
			if (frames > 0 && fps > 0) out.durationMs = Math.round((frames / fps) * 1000)
			if (fps > 0) out.fps = Math.round(fps * 100) / 100
			break
		}
	}
	/** Some Caspar builds / scanners expose duration in seconds in the CINF line. */
	if (!out.durationMs || out.durationMs <= 0) {
		const secM = cinf.match(/\b(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)\b/i)
		if (secM) {
			const s = parseFloat(secM[1])
			if (s > 0) out.durationMs = Math.round(s * 1000)
		}
	}
	return out
}

module.exports = { parseCinfMedia }
