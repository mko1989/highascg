/**
 * WO-592 — media-file inspector (one clip selected in the Media tab).
 *
 * Preview: most of the library (NotchLC/HAP/ProRes) can't be decoded by a browser, so the
 * preview is the clip's thumbnail. Every client gets the thumbnail plus the waveform (any file
 * with an audio track, video included).
 */

import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'
import { classifyMediaItem } from '../lib/media-ext.js'
import { drawMediaWaveform, formatMediaTimecode } from './inspector-media-file-wave.js'
import { mountMediaFileLibrarySection } from './inspector-media-file-library.js'

/** Only the newest mount owns the Caspar preview layer — a disposed older one must not stop it. */
let currentToken = 0

function parseResolution(res) {
	const m = /^(\d+)\s*[x×]\s*(\d+)/.exec(String(res || ''))
	return m ? { width: Number(m[1]), height: Number(m[2]) } : null
}

/**
 * @param {HTMLElement} root
 * @param {{ id: string, item?: object }} sel
 */
export function renderMediaFileInspector(root, sel) {
	const token = ++currentToken
	const id = String(sel.id)
	const item = sel.item || { id }
	const kind = classifyMediaItem(item)
	const name = id.split('/').pop()
	const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''
	const dims = parseResolution(item.resolution)
	const fps = Number(item.fps) > 0 ? Number(item.fps) : 25
	// Unknown right after a rename/ingest (probe overlay keyed by the old id) — filled in below from
	// the waveform response.
	let durationSec = Number(item.durationMs) > 0 ? Number(item.durationMs) / 1000 : 0
	const aspect = dims ? `${dims.width} / ${dims.height}` : '16 / 9'

	const info = [
		['Codec', item.codec ? String(item.codec).toUpperCase() : ''],
		['Resolution', item.resolution || ''],
		['Frame rate', Number(item.fps) > 0 ? `${Math.round(Number(item.fps) * 100) / 100} fps` : ''],
		['Duration', durationSec ? formatMediaTimecode(durationSec, fps) : ''],
	].filter(([, v]) => v)

	let previewHtml = ''
	if (kind === 'video' || kind === 'still') {
		previewHtml = `<div class="media-insp__preview" style="aspect-ratio:${aspect}"><img src="${escapeHtml(getThumbnailUrl(id, 640, 2, item.fileSize))}" alt="" /></div>`
	}
	root.innerHTML = `
		<div class="media-insp">
			<h3 class="media-insp__title" title="${escapeHtml(id)}">${escapeHtml(name)}</h3>
			${folder ? `<div class="media-insp__folder">${escapeHtml(folder)}</div>` : ''}
			${previewHtml}
			<div class="media-insp__wave"><canvas></canvas><span class="media-insp__wave-note">Loading waveform…</span></div>
			<div class="media-insp__library"></div>
			${info.length ? `<dl class="media-insp__info">${info.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : ''}
		</div>`

	const waveWrap = root.querySelector('.media-insp__wave')
	const canvas = waveWrap.querySelector('canvas')
	const note = waveWrap.querySelector('.media-insp__wave-note')
	const state = { peaks: null, pos: 0, playing: false, channel: null, layer: null, trim: { inSec: null, outSec: null } }
	const frac = (sec) => (sec != null && durationSec > 0 ? Math.min(1, Math.max(0, sec / durationSec)) : null)
	const redraw = () =>
		drawMediaWaveform(canvas, state.peaks, durationSec > 0 ? state.pos / durationSec : 0, {
			in: frac(state.trim.inSec),
			out: frac(state.trim.outSec),
		})

	const onDuration = () => {
		const tc = root.querySelector('.media-insp__tc')
		if (tc) tc.textContent = `${formatMediaTimecode(state.pos, fps)} / ${formatMediaTimecode(durationSec, fps)}`
		redraw()
	}

	mountMediaFileLibrarySection(root.querySelector('.media-insp__library'), {
		id,
		fps,
		durationSec,
		timed: kind === 'video' || kind === 'audio',
		isCurrent: () => token === currentToken,
		onTrim: (t) => {
			state.trim = t
			redraw()
		},
	})

	api.get(`/api/local-media/${encodeURIComponent(id)}/waveform?bars=600`)
		.then((r) => {
			if (token !== currentToken) return
			if (!(durationSec > 0) && Number(r?.durationMs) > 0) {
				durationSec = Number(r.durationMs) / 1000
				onDuration()
			}
			if (!r?.hasAudio || !r.peaks?.length) {
				note.textContent = 'No audio track'
				return
			}
			note.remove()
			state.peaks = r.peaks
			redraw()
		})
		.catch(() => {
			if (token === currentToken) note.textContent = 'Waveform unavailable'
		})
	new ResizeObserver(redraw).observe(canvas)
}
