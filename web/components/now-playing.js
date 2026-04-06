/**
 * "Now Playing" card from OSC layer `file` metadata + optional thumbnail (`/api/thumbnail/…`).
 */

import { formatMmSs } from './playback-timer.js'
import { getApiBase } from '../lib/api-client.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'

function basename(p) {
	if (!p) return ''
	const s = String(p).replace(/\\/g, '/')
	const i = s.lastIndexOf('/')
	return i >= 0 ? s.slice(i + 1) : s
}

function thumbFileId(f) {
	const raw = f.name || f.path
	if (!raw) return ''
	return String(raw).trim().replace(/^"(.*)"$/, '$1').split(/\s+/)[0]
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   channel: number,
 *   layer: number,
 *   oscClient: import('../lib/osc-client.js').OscClient,
 *   showThumbnail?: boolean,
 * }} opts
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountNowPlaying(container, opts) {
	const { channel, layer, oscClient, showThumbnail = true } = opts
	if (!oscClient) throw new Error('mountNowPlaying: oscClient required')
	container.className = 'now-playing'
	container.style.cssText = `display:flex;gap:10px;align-items:center;font:12px/1.35 ${UI_FONT_FAMILY};max-width:100%`
	container.innerHTML =
		'<div class="now-playing__thumb" style="flex-shrink:0;width:96px;aspect-ratio:16/9;background:#222;border-radius:4px;overflow:hidden"></div>' +
		'<div class="now-playing__body" style="min-width:0;flex:1">' +
		'<div class="now-playing__title" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>' +
		'<div class="now-playing__time" style="opacity:.9"></div>' +
		'<div class="now-playing__tech" style="opacity:.75;font-size:11px"></div>' +
		'<span class="now-playing__loop" style="font-size:11px;color:#9cf"></span>' +
		'</div>'
	const thumbHost = container.querySelector('.now-playing__thumb')
	const titleEl = container.querySelector('.now-playing__title')
	const timeEl = container.querySelector('.now-playing__time')
	const techEl = container.querySelector('.now-playing__tech')
	const loopEl = container.querySelector('.now-playing__loop')

	function paint(layerState) {
		const t = String(layerState?.type || '')
		const f = layerState?.file || {}
		const tpl = layerState?.template || {}
		if (t === 'empty') {
			thumbHost.innerHTML = ''
			titleEl.textContent = '—'
			timeEl.textContent = ''
			techEl.textContent = ''
			loopEl.textContent = ''
			return
		}
		const label = (f.name && String(f.name)) || basename(f.path || '') || (tpl.path ? basename(tpl.path) : '') || '—'
		titleEl.textContent = label
		const e = f.elapsed
		const r = f.remaining
		timeEl.textContent =
			Number.isFinite(e) || Number.isFinite(r)
				? `${formatMmSs(Number.isFinite(e) ? e : NaN)} · rem ${formatMmSs(Number.isFinite(r) ? r : NaN)}`
				: ''
		const v = f.video || {}
		const res = v.width && v.height ? `${v.width}×${v.height}` : ''
		const codec = (v.codec || (f.audio && f.audio.codec) || '').trim()
		techEl.textContent = [codec, res].filter(Boolean).join(' · ') || '—'
		loopEl.textContent = f.loop ? '⟲ loop' : ''

		const id = thumbFileId(f)
		thumbHost.textContent = ''
		if (showThumbnail && id) {
			const url = `${getApiBase()}/api/thumbnail/${encodeURIComponent(id)}`
			const img = document.createElement('img')
			img.alt = ''
			img.style.cssText = 'width:100%;height:100%;object-fit:cover'
			img.src = url
			img.onerror = () => {
				thumbHost.textContent = ''
			}
			thumbHost.appendChild(img)
		}
	}

	function refresh() {
		const ch = oscClient.channels[String(channel)] || oscClient.channels[channel]
		const ly = ch?.layers?.[layer] ?? ch?.layers?.[String(layer)]
		paint(ly || { type: 'empty', file: {} })
	}

	const unsub = oscClient.onLayerState(channel, layer, paint)
	refresh()
	return {
		destroy() {
			unsub()
			container.textContent = ''
			container.className = ''
			container.style.cssText = ''
		},
		refresh,
	}
}
