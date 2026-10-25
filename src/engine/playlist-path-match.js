'use strict'

/** Playlist item ↔ the file Caspar reports on a layer (OSC / INFO) — moved out of scene-take-lbg-playlist.js (WO-766). */

const { pathsMatch, normPath } = require('../state/live-scene-reconcile')

/**
 * Score how well a playlist entry path matches Caspar's foreground path (OSC / INFO).
 * Used so two different files with the same basename do not collapse to the same index.
 */
/* Owner 2026-10-03 ("sponsorzy" looped 2-3): OSC names are extension-less (…/VIDEOS SPONSORS/4), so
 * `4.mp4` fell to pathsMatch's substring test and "4" hit "Raben START 40 SEK…" (item 0). Compare
 * extension-less paths on a `/` boundary first; strip only media extensions ("07.2026" is a name). */
const PLAYLIST_ITEM_EXT_RE = /\.(mp4|mov|mkv|avi|webm|mxf|m2ts?|ts|mpg|mpeg|m4v|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|gif|bmp|webp|tga|tiff?|html?)$/i
const stripPlaylistItemExt = (p) => p.replace(PLAYLIST_ITEM_EXT_RE, '')

function scorePlaylistPathMatch(expected, playingFile) {
	const e = normPath(expected || '')
	const a = normPath(playingFile || '')
	if (!e || !a) return -1
	if (e === a) return 100000
	const eBare = stripPlaylistItemExt(e)
	const aBare = stripPlaylistItemExt(a)
	if (eBare === aBare) return 90000
	if (aBare.endsWith(`/${eBare}`) || eBare.endsWith(`/${aBare}`)) return 85000 + Math.min(eBare.length, aBare.length)
	if (a.endsWith(e) || e.endsWith(a)) return 80000 + Math.min(e.length, a.length)
	if (pathsMatch(expected, playingFile)) return 1000 + Math.min(e.length, a.length)
	if (sameFileName(expected, playingFile)) return 100 + Math.min(e.length, a.length)
	return -1
}

/**
 * @param {object[]} playlist
 * @param {string} playingFile - path or name from Caspar OSC
 * @param {number} lastIdx - last known playlist index for this layer
 * @param {string | undefined} prevPlayingFile - foreground file from previous OSC sample for this layer
 */
function resolvePlaylistPlayingIndex(playlist, playingFile, lastIdx, prevPlayingFile) {
	if (!playingFile || !Array.isArray(playlist) || playlist.length === 0) return -1
	const scores = playlist.map((item) => scorePlaylistPathMatch(item?.value, playingFile))
	let best = -1
	for (const s of scores) {
		if (s > best) best = s
	}
	if (best < 0) return -1
	/** @type {number[]} */
	const cand = []
	for (let i = 0; i < scores.length; i++) {
		if (scores[i] === best) cand.push(i)
	}
	if (cand.length === 1) return cand[0]
	const li = Number(lastIdx) || 0
	const prevOk = prevPlayingFile != null && String(prevPlayingFile).trim().length > 0
	const changed = prevOk && normPath(prevPlayingFile) !== normPath(playingFile)
	if (changed) {
		const next = (li + 1) % playlist.length
		if (cand.includes(next)) return next
		if (cand.includes(li)) return li
		return cand[0]
	}
	if (cand.includes(li)) return li
	return cand[0]
}

function sameFileName(a, b) {
	if (!a || !b) return false
	const clean = (s) => {
		const parts = String(s).toLowerCase().replace(/\\/g, '/').split('/')
		const base = parts[parts.length - 1]
		return base.replace(/\.[^/.]+$/, '')
	}
	return clean(a) === clean(b)
}

module.exports = { scorePlaylistPathMatch, resolvePlaylistPlayingIndex, sameFileName }
