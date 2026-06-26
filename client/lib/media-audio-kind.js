/**
 * Heuristic: audio-only file (no video frame for thumbnail preview).
 * Uses CLS/media row type when present, else common audio extensions.
 */

import { findMediaRow } from './mixer-fill.js'

const AUDIO_EXT = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.wma'])

/**
 * @param {{ type?: string, value?: string } | null | undefined} source
 * @param {unknown[]} [mediaList]
 * @returns {boolean}
 */
export function isLikelyAudioOnlySource(source, mediaList) {
	if (!source?.value) return false
	const row = Array.isArray(mediaList) ? findMediaRow(mediaList, source.value) : null
	if (row?.type && String(row.type).toLowerCase() === 'audio') return true
	const id = String(source.value)
	const dot = id.lastIndexOf('.')
	const ext = dot >= 0 ? id.slice(dot).toLowerCase() : ''
	return AUDIO_EXT.has(ext)
}
