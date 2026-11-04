'use strict'

/**
 * WO-942 — which `<subregion>` fields a DeckLink port may carry, given its pixel format.
 *
 * The deployed Caspar is built on the v2.5.1 release (`VERSION` → `2.5.1 deac375bb`). Its v210 (YUV) converter,
 * `modules/decklink/consumer/v210_strategies.cpp` `convert_frame`, only writes the frame inside
 * `if (config.region_w == 0 && config.region_h == 0 && config.dest_x == 0)` — there is no else branch. A port with a
 * `<width>`, `<height>` or non-zero `<dest-x>` therefore schedules an untouched zero buffer, which a v210 SDI output
 * shows as SOLID GREEN, while every other consumer of the channel (operator GUI, SHM) is fine. Measured on the box
 * 04.11: 3072×1024 and 3840×2160 regions → green; the same ports with width/height omitted → picture.
 *
 * Upstream fixed it in master (#1700, `7d4572901`, "complete support for subregions in decklink v210", 2026-03-03);
 * it is not on the 2.5.x line. Until the fork carries it, a YUV port gets only src-x / src-y / dest-y: the card copies
 * a full SDI-width row from src-x (the "video lands where it lands" pattern of the owner's proven rigs, WO-485 §4),
 * and rows past the channel are black. The BGRA (rgba / auto on an 8-bit channel) path honours every field.
 *
 * When the fork gets #1700: make `v210HonoursRegion` return true (or probe it) and the full block comes back.
 */

/** @returns {boolean} true once the running Caspar's v210 path honours width/height/dest-x (upstream #1700). */
function v210HonoursRegion() {
	return false
}

/**
 * @param {{ srcX?: number, srcY?: number, destX?: number, destY?: number, width?: number, height?: number }} tile
 * @param {string} pixelFormat - the port's `<pixel-format>` override ('yuv' | 'rgba' | '' = Caspar default)
 * @returns {{ srcX: number, srcY: number, destX: number, destY: number, width: number|null, height: number|null }}
 *   width/height null = omit the element
 */
function decklinkSubregionFields(tile, pixelFormat) {
	const int = (v) => Math.max(0, parseInt(String(v ?? 0), 10) || 0)
	const f = {
		srcX: int(tile?.srcX),
		srcY: int(tile?.srcY),
		destX: int(tile?.destX),
		destY: int(tile?.destY),
		width: int(tile?.width) || null,
		height: int(tile?.height) || null,
	}
	/* Channels are 8-bit (HighAsCG never writes <color-depth>), so Caspar picks v210 only on an explicit yuv. */
	if (
		String(pixelFormat || '')
			.trim()
			.toLowerCase() !== 'yuv' ||
		v210HonoursRegion()
	)
		return f
	return { ...f, destX: 0, width: null, height: null }
}

/**
 * @param {Parameters<typeof decklinkSubregionFields>[0]} tile
 * @param {string} pixelFormat
 * @param {string} indent
 * @returns {string}
 */
function decklinkSubregionXml(tile, pixelFormat, indent) {
	const f = decklinkSubregionFields(tile, pixelFormat)
	const rows = [
		`<src-x>${f.srcX}</src-x>`,
		`<src-y>${f.srcY}</src-y>`,
		`<dest-x>${f.destX}</dest-x>`,
		`<dest-y>${f.destY}</dest-y>`,
	]
	if (f.width !== null) rows.push(`<width>${f.width}</width>`)
	if (f.height !== null) rows.push(`<height>${f.height}</height>`)
	return `${indent}<subregion>\n${rows.map((r) => `${indent}    ${r}`).join('\n')}\n${indent}</subregion>`
}

module.exports = { decklinkSubregionFields, decklinkSubregionXml, v210HonoursRegion }
