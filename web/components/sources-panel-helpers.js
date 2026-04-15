import { api, getApiBase } from '../lib/api-client.js'

/** @param {string | null} cd */
function parseContentDispositionFilename(cd) {
	if (!cd || typeof cd !== 'string') return null
	const mStar = /filename\*=(?:UTF-8''|)([^;\n]+)/i.exec(cd)
	if (mStar) {
		try {
			return decodeURIComponent(mStar[1].trim().replace(/^["']|["']$/g, ''))
		} catch {
			return mStar[1]
		}
	}
	const m = /filename="([^"]+)"/i.exec(cd)
	if (m) return m[1]
	const m2 = /filename=([^;\s]+)/i.exec(cd)
	if (m2) return m2[1].replace(/^["']|["']$/g, '')
	return null
}

/** Same-origin download without navigating the tab (avoids Chrome “insecure download” quirks on some HTTP setups). */
async function downloadLocalMediaFile(id, fallbackLabel) {
	const url = `${getApiBase()}/api/local-media/${encodeURIComponent(id)}/file`
	const res = await fetch(url)
	if (!res.ok) {
		let detail = res.statusText
		try {
			const j = await res.json()
			if (j?.error) detail = j.error
		} catch {}
		throw new Error(`HTTP ${res.status}: ${detail}`)
	}
	const lenStr = res.headers.get('content-length')
	const len = lenStr ? parseInt(lenStr, 10) : 0
	const maxBlob = 400 * 1024 * 1024
	if (len > maxBlob) {
		const a = document.createElement('a')
		a.href = url
		a.download = String(fallbackLabel || id).replace(/^.*[/\\]/, '') || 'download'
		a.rel = 'noopener'
		document.body.appendChild(a)
		a.click()
		a.remove()
		return
	}
	const cdName = parseContentDispositionFilename(res.headers.get('content-disposition'))
	let filename = cdName || String(fallbackLabel || id).replace(/^.*[/\\]/, '') || 'download'
	const blob = await res.blob()
	const blobUrl = URL.createObjectURL(blob)
	try {
		const a = document.createElement('a')
		a.href = blobUrl
		a.download = filename
		a.rel = 'noopener'
		document.body.appendChild(a)
		a.click()
		a.remove()
	} finally {
		setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
	}
}
import { classifyMediaItem } from '../lib/media-ext.js'
import { normalizeMediaIdForMatch } from '../lib/mixer-fill.js'
import { MIXER_EFFECTS, EFFECT_CATEGORIES } from '../lib/effect-registry.js'


/**
 * Ctrl+click / ⌘+click: download (GET /api/local-media/…/file).
 * Ctrl+Alt+click / ⌘+⌥+click: remove file on server (POST /api/media/delete).
 * @param {HTMLElement} el
 * @param {string} id - media id (Caspar path)
 * @param {string} label
 * @param {() => void} [onDeleted] - refresh list / feedback after successful delete
 */
function attachMediaModifierClick(el, id, label, onDeleted) {
	const hintDl = 'Ctrl+click or ⌘+click: download to this computer'
	const hintRm = 'Ctrl+Alt+click or ⌘+⌥+click: remove from server'
	el.title = `${label} — ${hintDl} · ${hintRm}`
	el.addEventListener('click', (e) => {
		if (!(e.ctrlKey || e.metaKey)) return
		e.preventDefault()
		e.stopPropagation()
		if (e.altKey) {
			const shortName = String(label || id).replace(/^.*[/\\]/, '') || id
			if (!confirm(`Remove "${shortName}" from the server?\n\nThis cannot be undone.`)) return
			void (async () => {
				try {
					await api.post('/api/media/delete', { id })
					onDeleted?.()
				} catch (err) {
					alert(err?.message || 'Delete failed')
				}
			})()
			return
		}
		void (async () => {
			try {
				await downloadLocalMediaFile(id, label)
			} catch (err) {
				alert(err?.message || 'Download failed')
			}
		})()
	})
}

export function makeDraggable(el, sourceType, sourceValue, label, extra = {}) {
	el.draggable = true
	el.dataset.sourceType = sourceType
	el.dataset.sourceValue = sourceValue
	el.dataset.sourceLabel = label || sourceValue
	el.classList.add('source-item', 'draggable')
	el.addEventListener('dragstart', (e) => {
		e.dataTransfer.effectAllowed = 'copy'
		e.dataTransfer.setData('application/json', JSON.stringify({ type: sourceType, value: sourceValue, label: label || sourceValue, ...extra }))
		e.dataTransfer.setData('text/plain', sourceValue)
		e.target.classList.add('dragging')
	})
	el.addEventListener('dragend', (e) => {
		e.target.classList.remove('dragging')
	})
}

export function renderSourceList(container, items, sourceType, filter, onPreview) {
	container.innerHTML = ''
	if (!items || items.length === 0) {
		container.innerHTML = '<p class="sources-empty">No items</p>'
		return
	}
	const filtered = filter ? items.filter((i) => (i.label || i.id || i).toLowerCase().includes(filter.toLowerCase())) : items
	filtered.forEach((item) => {
		const id = item.id ?? item
		const label = item.label ?? String(id)
		const el = document.createElement('div')
		el.className = 'source-item'
		el.dataset.sourceValue = id
		el.innerHTML = `
			<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 32))}</span>
		`
		makeDraggable(el, sourceType, id, label)
		container.appendChild(el)
	})
}

export function iconFor(type) {
	const icons = { media: '🎬', template: '📄', route: '📺', timeline: '⏱', effect: '✦' }
	return icons[type] || '•'
}

export function escapeHtml(s) {
	const div = document.createElement('div')
	div.textContent = s
	return div.innerHTML
}

function truncate(s, len) {
	if (!s || s.length <= len) return s
	return s.slice(0, len - 1) + '…'
}

function getExtension(filename) {
	if (!filename || typeof filename !== 'string') return ''
	const m = filename.match(/\.([a-zA-Z0-9]+)$/)
	return m ? m[1].toLowerCase() : ''
}

function formatDuration(ms) {
	if (ms == null || ms < 0) return '—'
	const s = Math.floor(ms / 1000)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
	return `${m}:${String(s % 60).padStart(2, '0')}`
}

function formatFps(fps) {
	if (fps == null || fps <= 0 || isNaN(fps)) return ''
	const n = Math.round(fps * 100) / 100
	return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function formatFileSize(bytes) {
	if (bytes == null || bytes < 0 || !Number.isFinite(bytes)) return ''
	if (bytes < 1024) return bytes + ' B'
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
	return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * Combine WebSocket `state.media` (CINF metadata after server flush) with last GET /api/media
 * (ffprobe + disk merge). Dedupe by basename without extension (same key as findMediaRow / scene fill).
 */
export function mergeMediaProbeOverlay(stateMedia, probeList) {
	const sm = stateMedia || []
	const pl = probeList || []
	if (!pl.length) return sm
	if (!sm.length) return pl
	const byKey = new Map()
	function addRow(item) {
		const key = normalizeMediaIdForMatch(item.id)
		const prev = byKey.get(key)
		if (!prev) {
			byKey.set(key, { ...item })
			return
		}
		byKey.set(key, { ...prev, ...item, id: prev.id })
	}
	for (const m of sm) addRow(m)
	for (const p of pl) addRow(p)
	return [...byKey.values()]
}

/** Media browser: two lines — name + duration, then resolution + fps (when known). */
export function renderMediaBrowser(container, media, filter, onMediaDeleted) {
	container.innerHTML = ''
	const filtered = filter
		? media.filter((i) => (i.label || i.id || i).toLowerCase().includes(filter.toLowerCase()))
		: media
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No media files</p>'
		return
	}
	const KIND_TITLE = { still: 'Still image', video: 'Video', audio: 'Audio', unknown: 'Media' }
	const KIND_PILL = { still: 'IMG', video: 'VID', audio: 'AUD', unknown: 'MED' }
	filtered.forEach((item) => {
		const id = item.id ?? item
		const label = item.label ?? String(id)
		const resolution = item.resolution || ''
		const duration = formatDuration(item.durationMs)
		const fpsStr = formatFps(item.fps)
		const kind = classifyMediaItem(item)
		const line2Parts = []
		if (resolution) line2Parts.push(resolution)
		if (fpsStr) line2Parts.push(`${fpsStr} fps`)
		const el = document.createElement('div')
		el.className = `source-item source-item--media source-item--media-compact source-item--kind-${kind}`
		el.dataset.sourceValue = id
		el.innerHTML = `
			<span class="source-item__kind-pill" title="${escapeHtml(KIND_TITLE[kind] || 'Media')}">${KIND_PILL[kind] || 'MED'}</span>
			<div class="source-item__media-col">
				<div class="source-item__media-line1">
					<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
					${duration !== '—' ? `<span class="source-item__duration">${escapeHtml(duration)}</span>` : ''}
				</div>
				${
					line2Parts.length
						? `<div class="source-item__media-line2">${escapeHtml(line2Parts.join(' · '))}</div>`
						: ''
				}
			</div>
		`
		makeDraggable(el, 'media', id, label, {
			resolution: item.resolution || '',
			...(item.durationMs != null && item.durationMs > 0 ? { durationMs: item.durationMs } : {}),
		})
		attachMediaModifierClick(el, id, label, onMediaDeleted)
		container.appendChild(el)
	})
}

/**
 * Render the Effects tab: CasparCG mixer effects grouped by category, each draggable.
 * @param {HTMLElement} container
 * @param {string} filter
 */
export function renderEffectsTab(container, filter) {
	container.innerHTML = ''
	const lowerFilter = (filter || '').toLowerCase()
	const filtered = lowerFilter
		? MIXER_EFFECTS.filter((e) => e.label.toLowerCase().includes(lowerFilter) || e.category.toLowerCase().includes(lowerFilter))
		: MIXER_EFFECTS

	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No matching effects</p>'
		return
	}

	// Group by category
	for (const cat of EFFECT_CATEGORIES) {
		const inCat = filtered.filter((e) => e.category === cat.id)
		if (inCat.length === 0) continue

		const heading = document.createElement('div')
		heading.className = 'sources-effects-category'
		heading.textContent = cat.label
		container.appendChild(heading)

		for (const fx of inCat) {
			const el = document.createElement('div')
			el.className = 'source-item source-item--effect'
			el.dataset.sourceValue = fx.type
			el.innerHTML = `
				<span class="source-item__label">${escapeHtml(fx.label)}</span>
			`
			makeDraggable(el, 'effect', fx.type, fx.label)
			container.appendChild(el)
		}
	}
}

export function buildLiveSources(channelMap) {
	const sources = []
	if (!channelMap) return sources
	const {
		programChannels = [],
		previewChannels = [],
		inputsCh,
		decklinkCount = 0,
		programResolutions = [],
		audioOnlyChannels = [],
		audioOnlyResolutions = [],
	} = channelMap
	programChannels.forEach((ch, i) => {
		const res = programResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		sources.push({ type: 'route', routeType: 'pgm', value: `route://${ch}`, label: `Program ${i + 1}`, resolution, fps })
	})
	previewChannels.forEach((ch, i) => {
		const res = programResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		// Full channel composite (black L9 + content L10+). Do not use route://N-11 — layer numbers match PGM now.
		sources.push({ type: 'route', routeType: 'prv', value: `route://${ch}`, label: `Preview ${i + 1}`, resolution, fps })
	})
	if (inputsCh != null && decklinkCount > 0) {
		const inputsRes = channelMap.inputsResolution
		const resolution = inputsRes?.w && inputsRes?.h ? `${inputsRes.w}×${inputsRes.h}` : ''
		const fps = inputsRes?.fps != null ? formatFps(inputsRes.fps) : ''
		for (let i = 1; i <= decklinkCount; i++) {
			sources.push({ type: 'route', routeType: 'decklink', value: `route://${inputsCh}-${i}`, label: `Decklink ${i}`, resolution, fps })
		}
	}
	audioOnlyChannels.forEach((ch, i) => {
		const res = audioOnlyResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		sources.push({
			type: 'route',
			routeType: 'audio_zone',
			value: `route://${ch}`,
			label: `Audio zone ${i + 1}`,
			resolution,
			fps,
		})
	})
	return sources
}
