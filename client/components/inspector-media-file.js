/**
 * WO-592 — media-file inspector (one clip selected in the Media tab).
 *
 * Preview: most of the library (NotchLC/HAP/ProRes) can't be decoded by a browser, so the KIOSK
 * previews through Caspar — the clip is LOADed on the operator-GUI channel's media layer
 * (POST /api/media/preview) and shows through a hole over `.media-insp__preview` (reported as a
 * role 'media' cell). Holes are click- and paint-dead, so every control sits below the preview.
 * Remote clients get the thumbnail plus the waveform (any file with an audio track, video included).
 */

import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'
import { classifyMediaItem } from '../lib/media-ext.js'
import { isOperatorGuiModeActive } from '../lib/operator-gui-mode.js'
import { reportMediaPreviewRect } from '../lib/operator-gui-mode-report.js'
import { drawMediaWaveform, formatMediaTimecode } from './inspector-media-file-wave.js'

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
	const durationSec = Number(item.durationMs) > 0 ? Number(item.durationMs) / 1000 : 0
	const kiosk = isOperatorGuiModeActive() && kind === 'video'
	const aspect = dims ? `${dims.width} / ${dims.height}` : '16 / 9'

	const info = [
		['Codec', item.codec ? String(item.codec).toUpperCase() : ''],
		['Resolution', item.resolution || ''],
		['Frame rate', Number(item.fps) > 0 ? `${Math.round(Number(item.fps) * 100) / 100} fps` : ''],
		['Duration', durationSec ? formatMediaTimecode(durationSec, fps) : ''],
	].filter(([, v]) => v)

	let previewHtml = ''
	if (kind === 'video' || kind === 'still') {
		previewHtml = kiosk
			? `<div class="media-insp__preview media-insp__preview--hole" style="aspect-ratio:${aspect}"></div>`
			: `<div class="media-insp__preview" style="aspect-ratio:${aspect}"><img src="${escapeHtml(getThumbnailUrl(id, 640, 2))}" alt="" /></div>`
	}
	root.innerHTML = `
		<div class="media-insp">
			<h3 class="media-insp__title" title="${escapeHtml(id)}">${escapeHtml(name)}</h3>
			${folder ? `<div class="media-insp__folder">${escapeHtml(folder)}</div>` : ''}
			${previewHtml}
			<div class="media-insp__wave"><canvas></canvas><span class="media-insp__wave-note">Loading waveform…</span></div>
			${
				kiosk
					? `<div class="media-insp__transport">
				<button type="button" class="media-insp__btn media-insp__play" title="Play / pause (preview on the operator screen only — silent)">▶</button>
				<span class="media-insp__tc">${formatMediaTimecode(0, fps)} / ${formatMediaTimecode(durationSec, fps)}</span>
			</div>`
					: ''
			}
			${info.length ? `<dl class="media-insp__info">${info.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : ''}
		</div>`

	const waveWrap = root.querySelector('.media-insp__wave')
	const canvas = waveWrap.querySelector('canvas')
	const note = waveWrap.querySelector('.media-insp__wave-note')
	const state = { peaks: null, pos: 0, playing: false, channel: null, layer: null }
	const redraw = () => drawMediaWaveform(canvas, state.peaks, durationSec > 0 ? state.pos / durationSec : 0)

	api.get(`/api/local-media/${encodeURIComponent(id)}/waveform?bars=600`)
		.then((r) => {
			if (token !== currentToken) return
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

	if (!kiosk) return

	const hole = root.querySelector('.media-insp__preview--hole')
	const playBtn = root.querySelector('.media-insp__play')
	const tcEl = root.querySelector('.media-insp__tc')
	const send = (body) => api.post('/api/media/preview', body)
	let offOsc = null
	let lastRectKey = ''

	const setPlaying = (on) => {
		state.playing = on
		playBtn.textContent = on ? '❚❚' : '▶'
	}
	const showPos = () => {
		tcEl.textContent = `${formatMediaTimecode(state.pos, fps)} / ${formatMediaTimecode(durationSec, fps)}`
		redraw()
	}

	send({ action: 'load', id })
		.then((r) => {
			if (token !== currentToken) return
			state.channel = r.channel
			state.layer = r.layer
			const osc = window.highascg_osc_client
			if (osc?.onLayerState) {
				offOsc = osc.onLayerState(r.channel, r.layer, (ly) => {
					const el = Number(ly?.file?.elapsed)
					if (Number.isFinite(el)) state.pos = el
					if (typeof ly?.paused === 'boolean' && ly.paused === state.playing) setPlaying(!ly.paused)
					showPos()
				})
			}
		})
		.catch((e) => {
			if (token === currentToken) tcEl.textContent = e?.message || 'Preview unavailable'
		})

	playBtn.addEventListener('click', () => {
		const next = !state.playing
		setPlaying(next)
		void send({ action: next ? 'play' : 'pause' }).catch(() => setPlaying(!next))
	})
	canvas.addEventListener('click', (e) => {
		if (!(durationSec > 0)) return
		const r = canvas.getBoundingClientRect()
		const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)))
		state.pos = frac * durationSec
		showPos()
		void send({ action: 'seek', frame: Math.floor(state.pos * fps) })
	})

	// Track the hole: re-report on move/resize/visibility; withdraw + stop once unmounted.
	const tick = () => {
		if (!hole.isConnected) {
			clearInterval(timer)
			offOsc?.()
			if (token === currentToken) {
				reportMediaPreviewRect(null)
				void send({ action: 'stop' }).catch(() => {})
			}
			return
		}
		const b = hole.getBoundingClientRect()
		const visible = hole.offsetParent !== null && b.width > 0 && b.height > 0
		const key = visible ? `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)}` : ''
		if (key === lastRectKey) return
		lastRectKey = key
		reportMediaPreviewRect(visible ? b : null, dims || undefined)
	}
	const timer = setInterval(tick, 200)
	tick()
}
