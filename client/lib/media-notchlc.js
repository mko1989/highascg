/**
 * WO-818 — NotchLC decodes on the CPU in Caspar (ffmpeg's notchlc decoder); the media list marks those rows with ⚠.
 * The probed codec decides; the file name ("…notchlc…") only when nothing was probed.
 * Mirrors godot/client/features/live/media_ops.gd is_notchlc / NOTCHLC_TIP.
 */

export const NOTCHLC_WARNING =
	'NotchLC: CasparCG decodes it on the CPU, which costs far more than HAP.\n' +
	'Transcode it to HAP in HighAsCG before using it on air.'

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
