/**
 * Parse and match an EDID's preferred/native timing string, extracted as pure logic so it is
 * testable without a DOM.
 *
 * Reported live: the GPU port inspector's "Native mode" summary row correctly read the monitor's
 * EDID-preferred timing ("3840x2160@50Hz" — edid-parse.js's detailed-timing descriptor at 0x36),
 * but that same resolution could not be selected anywhere — the OS-resolution dropdown only ever
 * lists modes xrandr already has as CRTC modes, and "Custom OS resolution" defaulted to a
 * hardcoded 1920x1080@50 with no awareness of the EDID value shown two rows up.
 */

/**
 * @param {string | null | undefined} preferredMode e.g. "3840x2160@50Hz" (edid-parse.js's format)
 * @returns {{ w: number, h: number, r: number } | null}
 */
export function parseEdidPreferredMode(preferredMode) {
	const m = String(preferredMode || '').match(/^(\d+)x(\d+)@([\d.]+)/i)
	if (!m) return null
	const w = parseInt(m[1], 10)
	const h = parseInt(m[2], 10)
	const r = parseFloat(m[3])
	if (!(w > 0) || !(h > 0) || !Number.isFinite(r) || r <= 0) return null
	return { w, h, r }
}

/**
 * @param {{ w: number, h: number } | null} edidPreferred
 * @param {Array<{ mode?: string }>} detectedModes formatModeOption() output (has `.mode` = "WxH")
 * @returns {boolean} true when there is no EDID preference to check, OR it already matches a
 *   detected mode's WxH — i.e. true means "nothing extra needs to happen", false means "the
 *   monitor's real native resolution is not selectable from the detected-modes list at all".
 */
export function edidPreferredModeIsSelectable(edidPreferred, detectedModes) {
	if (!edidPreferred) return true
	const list = Array.isArray(detectedModes) ? detectedModes : []
	return list.some((m) => m?.mode === `${edidPreferred.w}x${edidPreferred.h}`)
}
