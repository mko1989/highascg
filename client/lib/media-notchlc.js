/**
 * WO-818 — the media list marks NotchLC rows with ⚠: stock Caspar decodes them on the CPU (ffmpeg's notchlc decoder);
 * the HighAsCG build decodes them on the GPU (WO-820).
 * The probed codec decides; the file name ("…notchlc…") only when nothing was probed.
 * Mirrors godot/client/features/live/media_ops.gd is_notchlc / NOTCHLC_TIP.
 */

export const NOTCHLC_WARNING =
	'NotchLC: the HighAsCG Caspar build decodes it on the GPU. Stock CasparCG decodes it on the CPU, far heavier than HAP.\n' +
	'On a stock Caspar, transcode it to HAP in HighAsCG before using it on air.'

/**
 * @param {{ id?: string, label?: string, codec?: string | null }} [item]
 * @returns {boolean}
 */
export function isNotchLcMedia(item) {
	const codec = String(item?.codec ?? '').trim().toLowerCase()
	if (codec) return codec === 'notchlc'
	const name = String(item?.id ?? item?.label ?? '').split(/[\\/]/).pop() || ''
	return name.toLowerCase().includes('notchlc')
}
