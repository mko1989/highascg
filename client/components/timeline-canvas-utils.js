/**
 * Timecode strings, canvas roundRect helper (timeline canvas).
 */

/** SMPTE timecode string for display in ruler. */
export function fmtTimecode(ms, fps) {
	fps = fps || 25
	const f = Math.floor(ms * fps / 1000)
	const h = Math.floor(f / (fps * 3600))
	const m = Math.floor((f % (fps * 3600)) / (fps * 60))
	const s = Math.floor((f % (fps * 60)) / fps)
	const fr = f % fps
	if (h > 0) return `${h}:${p(m)}:${p(s)}:${p(fr)}`
	if (m > 0) return `${m}:${p(s)}:${p(fr)}`
	return `${p(s)}:${p(fr)}`
}

/** Full SMPTE timecode for transport display. */
export function fmtSmpte(ms, fps) {
	fps = fps || 25
	const f = Math.floor(ms * fps / 1000)
	const h = Math.floor(f / (fps * 3600))
	const m = Math.floor((f % (fps * 3600)) / (fps * 60))
	const s = Math.floor((f % (fps * 60)) / fps)
	const fr = f % fps
	return `${p(h)}:${p(m)}:${p(s)}:${p(fr)}`
}

/** Timecode for display where a frame count is meaningless (flag jump targets, WO-542): HH:MM:SS:mmm. */
export function fmtHms(ms) {
	const total = Math.max(0, Math.round(Number(ms) || 0))
	const h = Math.floor(total / 3600000)
	const m = Math.floor((total % 3600000) / 60000)
	const s = Math.floor((total % 60000) / 1000)
	const msec = total % 1000
	return `${p(h)}:${p(m)}:${p(s)}:${String(msec).padStart(3, '0')}`
}

/**
 * Parse HH:MM:SS:mmm (or shorter M:SS:mmm / SS:mmm), ++500/--500 offsets, or plain ms — the
 * millisecond counterpart to {@link parseTcInput} for contexts with no frame rate of their own
 * (a flag's jump target isn't "at" a clip's fps).
 * @returns {number|null} ms or null if invalid
 */
export function parseHmsInput(str, currentMs, totalMs) {
	if (typeof str !== 'string') return null
	const s = str.trim()
	if (!s) return null
	const offsetMatch = s.match(/^([+-]{2})\s*(\d+)(?:ms)?$/)
	if (offsetMatch) {
		const sign = offsetMatch[1] === '++' ? 1 : -1
		const ms = parseInt(offsetMatch[2], 10) || 0
		return Math.max(0, Math.min(totalMs ?? 999999999, (currentMs ?? 0) + sign * ms))
	}
	const parts = s.split(':').map((x) => parseInt(x, 10))
	if (!parts.every((n) => !isNaN(n))) return null
	let ms = null
	if (parts.length === 4) {
		const [h, m, sec, msec] = parts
		ms = (h * 3600 + m * 60 + sec) * 1000 + msec
	} else if (parts.length === 3) {
		const [m, sec, msec] = parts
		ms = (m * 60 + sec) * 1000 + msec
	} else if (parts.length === 2) {
		const [sec, msec] = parts
		ms = sec * 1000 + msec
	} else if (parts.length === 1 && parts[0] >= 0) {
		ms = parts[0]
	}
	if (ms == null) return null
	return Math.max(0, Math.min(totalMs ?? 999999999, ms))
}

/**
 * Parse timecode input: SMPTE (HH:MM:SS:FF), ++500/--500 offsets, or plain ms.
 * @returns {number|null} ms or null if invalid
 */
export function parseTcInput(str, currentMs, totalMs, fps) {
	if (typeof str !== 'string') return null
	const s = str.trim()
	if (!s) return null
	fps = fps || 25
	const offsetMatch = s.match(/^([+-]{2})\s*(\d+)(?:ms)?$/)
	if (offsetMatch) {
		const sign = offsetMatch[1] === '++' ? 1 : -1
		const ms = parseInt(offsetMatch[2], 10) || 0
		return Math.max(0, Math.min(totalMs ?? 999999999, currentMs + sign * ms))
	}
	const parts = s.split(':').map((x) => parseInt(x, 10))
	if (parts.every((n) => !isNaN(n))) {
		if (parts.length === 4) {
			const [h, m, sec, fr] = parts
			return ((h * 3600 + m * 60 + sec) * fps + fr) * 1000 / fps
		}
		if (parts.length === 3) {
			const [m, sec, fr] = parts
			return ((m * 60 + sec) * fps + fr) * 1000 / fps
		}
		if (parts.length === 2) {
			const [sec, fr] = parts
			return ((sec * fps + fr) * 1000 / fps)
		}
		if (parts.length === 1 && parts[0] >= 0) {
			return parts[0]
		}
	}
	return null
}

function p(n) {
	return String(n).padStart(2, '0')
}

/** Canvas roundRect polyfill (old browsers don't have ctx.roundRect). */
export function roundRect(ctx, x, y, w, h, r) {
	if (ctx.roundRect) {
		ctx.roundRect(x, y, w, h, r)
		return
	}
	const minR = Math.min(r, w / 2, h / 2)
	ctx.moveTo(x + minR, y)
	ctx.arcTo(x + w, y, x + w, y + h, minR)
	ctx.arcTo(x + w, y + h, x, y + h, minR)
	ctx.arcTo(x, y + h, x, y, minR)
	ctx.arcTo(x, y, x + w, y, minR)
	ctx.closePath()
}
