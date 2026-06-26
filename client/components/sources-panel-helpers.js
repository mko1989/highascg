import { api, getApiBase } from '../lib/api-client.js'
import { assetUrl } from '../lib/api-origin.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'
import { decklinkInputForSlot, liveAudioInputForSlot } from '../lib/input-channels.js'
import { liveAudioSlotStatusMessage } from '../lib/live-audio-inputs.js'

export { liveAudioSlotStatusMessage }

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
export function attachMediaModifierClick(el, id, label, onDeleted) {
	const hintDl = 'Alt+click: download to this computer'
	const hintRm = 'Ctrl+Alt+click or ⌘+⌥+click: remove from server'
	el.title = `${label} — ${hintDl} · ${hintRm}`
	el.addEventListener('click', (e) => {
		if (e.altKey && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			e.stopPropagation()
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
		if (e.altKey && !(e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			e.stopPropagation()
			void (async () => {
				try {
					await downloadLocalMediaFile(id, label)
				} catch (err) {
					alert(err?.message || 'Download failed')
				}
			})()
		}
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
		
		// Multi-drag support
		const isSelected = el.classList.contains('source-item--selected')
		let payload
		if (isSelected) {
			const container = el.closest('.sources-list')
			const selectedEls = container ? Array.from(container.querySelectorAll('.source-item--selected')) : [el]
			payload = selectedEls.map(sel => ({
				type: sel.dataset.sourceType,
				value: sel.dataset.sourceValue,
				label: sel.dataset.sourceLabel,
				...JSON.parse(sel.dataset.extra || '{}')
			}))
			
			// If multiple, use a special type or just the array
			e.dataTransfer.setData('application/json', JSON.stringify({
				type: 'multi',
				items: payload
			}))
			e.dataTransfer.setData('text/plain', payload.map(p => p.value).join('\n'))
		} else {
			payload = { type: sourceType, value: sourceValue, label: label || sourceValue, ...extra }
			e.dataTransfer.setData('application/json', JSON.stringify(payload))
			e.dataTransfer.setData('text/plain', sourceValue)
		}
		
		el.target?.classList.add('dragging') || el.classList.add('dragging')
		if (sourceType === 'media') {
			globalThis.__highascgMediaDragPayload = isSelected
				? { type: 'multi', items: payload }
				: { type: 'media', value: sourceValue, label: label || sourceValue }
		}
	})
	el.addEventListener('dragend', (e) => {
		el.target?.classList.remove('dragging') || el.classList.remove('dragging')
		if (sourceType === 'media') delete globalThis.__highascgMediaDragPayload
	})
	// Store extra for multi-drag reconstruction
	el.dataset.extra = JSON.stringify(extra)
}

export function renderSourceList(container, items, sourceType, filter, onPreview) {
	const filtered = filter ? items.filter((i) => (i.label || i.id || i).toLowerCase().includes(filter.toLowerCase())) : items
	
	const renderKey = JSON.stringify({
		ids: filtered.map(i => i.id || i.label || i),
		type: sourceType,
		filter
	})
	if (container._lastRenderKey === renderKey) return
	container._lastRenderKey = renderKey

	container.innerHTML = ''
	if (!items || items.length === 0) {
		container.innerHTML = '<p class="sources-empty">No items</p>'
		return
	}
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

export function truncate(s, len) {
	if (!s || s.length <= len) return s
	return s.slice(0, len - 1) + '…'
}

export function getExtension(filename) {
	if (!filename || typeof filename !== 'string') return ''
	const m = filename.match(/\.([a-zA-Z0-9]+)$/)
	return m ? m[1].toLowerCase() : ''
}

export function formatDuration(ms) {
	if (ms == null || ms < 0) return '—'
	const s = Math.floor(ms / 1000)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
	return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function formatFps(fps) {
	if (fps == null || fps <= 0 || isNaN(fps)) return ''
	const n = Math.round(fps * 100) / 100
	return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export function formatFileSize(bytes) {
	if (bytes == null || bytes < 0 || !Number.isFinite(bytes)) return ''
	if (bytes < 1024) return bytes + ' B'
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
	return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function normalizeMediaPathKey(id) {
	return String(id || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isAllCapsPathSegment(s) {
	const t = String(s || '')
	return t.length > 0 && t === t.toUpperCase() && /[A-Z]/.test(t)
}

/** Prefer probe/disk path casing over stale ALL-CAPS directory rows from the WS catalog. */
function preferMergedMediaId(prev, next, prevIsDir, nextIsDir) {
	const a = String(prev?.id ?? prev ?? '')
	const b = String(next?.id ?? next ?? '')
	if (prevIsDir || nextIsDir) {
		if (normalizeMediaPathKey(a) !== normalizeMediaPathKey(b)) return b || a
		if (isAllCapsPathSegment(a.split('/').pop()) && !isAllCapsPathSegment(b.split('/').pop())) return b
		if (isAllCapsPathSegment(b.split('/').pop()) && !isAllCapsPathSegment(a.split('/').pop())) return a
		return b || a
	}
	if (b.includes('/') && !a.includes('/')) return b
	if (a.includes('/') && !b.includes('/')) return a
	return b.length >= a.length ? b : a
}

function mediaCatalogMergeKey(item) {
	const raw = String(item.id ?? item).replace(/\\/g, '/')
	if (item.isDir) return `dir:${normalizeMediaPathKey(raw)}`
	return `file:${normalizeMediaIdForMatch(raw)}`
}

/**
 * Combine WebSocket `state.media` (CINF metadata after server flush) with last GET /api/media
 * (ffprobe + disk merge). Files dedupe by basename (scene fill); folders by full path (case-insensitive).
 */
export function mergeMediaProbeOverlay(stateMedia, probeList) {
	const sm = stateMedia || []
	const pl = probeList || []
	if (!pl.length) return sm
	if (!sm.length) return pl
	const byKey = new Map()
	function addRow(item) {
		const key = mediaCatalogMergeKey(item)
		const prev = byKey.get(key)
		if (!prev) {
			byKey.set(key, { ...item })
			return
		}
		const id = preferMergedMediaId(prev, item, !!prev.isDir, !!item.isDir)
		byKey.set(key, { ...prev, ...item, id })
	}
	for (const m of sm) addRow(m)
	for (const p of pl) addRow(p)
	return pruneRedundantMediaDirs([...byKey.values()])
}

/** Drop duplicate empty folder rows (e.g. stale WS `CLIPS` when disk has `clips/…`). */
function pruneRedundantMediaDirs(items) {
	const dirs = items.filter((i) => i.isDir)
	const files = items.filter((i) => !i.isDir)
	return items.filter((item) => {
		if (!item.isDir) return true
		const dk = normalizeMediaPathKey(item.id)
		const hasFiles = files.some((f) => {
			const fk = normalizeMediaPathKey(f.id)
			return fk === dk || fk.startsWith(dk + '/')
		})
		if (hasFiles) return true
		const peers = dirs.filter((d) => normalizeMediaPathKey(d.id) === dk)
		if (peers.length <= 1) return true
		const preferred = peers.slice().sort((a, b) => {
			const ac = isAllCapsPathSegment(String(a.id).split('/').pop())
			const bc = isAllCapsPathSegment(String(b.id).split('/').pop())
			return Number(ac) - Number(bc)
		})[0]
		return item === preferred
	})
}

export function buildLiveSources(channelMap, connectors, liveAudioConfigured) {
	const sources = []
	
	// Built-in System Timers Template source
	sources.push({
		type: 'browser',
		routeType: 'browser',
		value: assetUrl('/templates/playback_timers.html'),
		label: 'System Timers Template',
		resolution: '1920×1080',
		fps: '50',
		browserAsCg: false
	})

	if (!channelMap) return sources
	const {
		programChannels = [],
		previewChannels = [],
		decklinkCount = 0,
		liveAudioCount = 0,
		programResolutions = [],
		audioOnlyChannels = [],
		audioOnlyResolutions = [],
		previewEnabledByMain = [],
	} = channelMap
	programChannels.forEach((ch, i) => {
		const res = programResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		sources.push({ type: 'route', routeType: 'pgm', value: `route://${ch}`, label: `Program ${i + 1}`, resolution, fps })
	})
	previewChannels.forEach((ch, i) => {
		if ((previewEnabledByMain[i] === false) || ch == null) return
		const res = programResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		// Full channel composite (black L9 + content L10+). Do not use route://N-11 — layer numbers match PGM now.
		sources.push({ type: 'route', routeType: 'prv', value: `route://${ch}`, label: `Preview ${i + 1}`, resolution, fps })
	})
	for (let i = 1; i <= decklinkCount; i++) {
		const entry = decklinkInputForSlot(channelMap, i)
		if (!entry) continue
		const conn = connectors.find(
			(c) =>
				(c.kind === 'decklink_io' || c.kind === 'decklink') &&
				c.caspar?.ioDirection === 'in' &&
				c.index === i - 1,
		)
		const res = entry.resolution
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		sources.push({
			type: 'route',
			routeType: 'decklink',
			value: entry.route,
			label: entry.label || conn?.label || `DeckLink ${i}`,
			resolution,
			fps,
			decklinkSlot: entry.slot,
			inputsChannel: entry.channel,
			inputsLayer: entry.layer,
			connectorId: conn?.id,
			decklinkDevice: conn?.externalRef != null ? parseInt(String(conn.externalRef), 10) : i - 1,
		})
	}
	const cfgSlots = Array.isArray(liveAudioConfigured?.configured?.slots)
		? liveAudioConfigured.configured.slots
		: []
	for (let i = 1; i <= liveAudioCount; i++) {
		const entry = liveAudioInputForSlot(channelMap, i)
		if (!entry) continue
		const cfg = cfgSlots.find((s) => s && Number(s.slot) === i)
		const res = entry.resolution || cfg?.resolution
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		sources.push({
			type: 'route',
			routeType: 'live_audio',
			value: entry.route || cfg?.route,
			label: entry.label || cfg?.label || `Live audio ${i}`,
			resolution,
			fps,
			liveAudioSlot: i,
			inputsChannel: entry.channel,
			inputsLayer: entry.layer,
		})
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

/**
 * @param {object | null | undefined} status - state.decklinkInputsStatus
 * @param {number} slot - 1-based decklink slot (layer on inputs channel)
 * @returns {string}
 */
export function decklinkSlotStatusMessage(status, slot) {
	if (status == null || typeof status !== 'object') return ''
	if (status.enabled === false && status.reason === 'amcp_disconnected') return 'AMCP offline — inputs not started'
	const failed = Array.isArray(status.failed) ? status.failed.find((x) => x && x.layer === slot) : null
	if (failed) return (failed.message && String(failed.message)) || 'PLAY failed on this layer'
	const sc = Array.isArray(status.skippedConflicts)
		? status.skippedConflicts.find((x) => x && x.input === slot)
		: null
	if (sc) return 'Skipped: device used as DeckLink output elsewhere'
	const sd = Array.isArray(status.skippedDuplicates)
		? status.skippedDuplicates.find((x) => x && x.input === slot)
		: null
	if (sd) return 'Skipped: duplicate device index (see Settings → Screens)'
	return ''
}

