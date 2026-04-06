/**
 * Sources panel — Media, Templates, Live sources, Timelines.
 * Each source is draggable for use in dashboard columns/layers.
 * Media tab: detailed list with extension, resolution, duration (no thumbnails).
 * @see main_plan.md Prompt 12, Prompt 18
 */

import { timelineState } from '../lib/timeline-state.js'
import { api, getApiBase } from '../lib/api-client.js'
import { classifyMediaItem } from '../lib/media-ext.js'
import { normalizeMediaIdForMatch } from '../lib/mixer-fill.js'
import { showLiveInputModal } from './live-input-modal.js'


function makeDraggable(el, sourceType, sourceValue, label, extra = {}) {
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

function renderSourceList(container, items, sourceType, filter, onPreview) {
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
			<span class="source-item__icon">${iconFor(sourceType)}</span>
			<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 32))}</span>
		`
		makeDraggable(el, sourceType, id, label)
		container.appendChild(el)
	})
}

function iconFor(type) {
	const icons = { media: '🎬', template: '📄', route: '📺', timeline: '⏱' }
	return icons[type] || '•'
}

function escapeHtml(s) {
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
function mergeMediaProbeOverlay(stateMedia, probeList) {
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

/** Super minimal media browser for synced media folder scenario. Columns: ext | res | codec | dur | size */
function renderMediaBrowser(container, media, filter) {
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
		const kind = classifyMediaItem(item)
		const metaParts = []
		if (resolution) metaParts.push(resolution)
		if (duration !== '—') metaParts.push(duration)
		const metaStr = metaParts.join('  ')
		const el = document.createElement('div')
		el.className = `source-item source-item--media source-item--media-compact source-item--kind-${kind}`
		el.dataset.sourceValue = id
		el.innerHTML = `
			<span class="source-item__kind-pill" title="${escapeHtml(KIND_TITLE[kind] || 'Media')}">${KIND_PILL[kind] || 'MED'}</span>
			<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
			${metaStr ? `<span class="source-item__meta-inline">${escapeHtml(metaStr)}</span>` : ''}
		`
		makeDraggable(el, 'media', id, label, {
			resolution: item.resolution || '',
		})
		container.appendChild(el)
	})
}

function buildLiveSources(channelMap) {
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

/**
 * @param {HTMLElement} root - Panel body element
 * @param {object} stateStore - StateStore instance
 */
export function initSourcesPanel(root, stateStore) {
	let previewFeedback = null  // timeout handle for flash feedback

	async function sendToPreview(source) {
		const channelMap = stateStore.getState()?.channelMap || {}
		const previewCh = channelMap.previewChannels?.[0] ?? 2
		try {
			await api.post('/api/play', { channel: previewCh, layer: 1, clip: source.value })
			// Brief flash to confirm
			const el = root.querySelector(`[data-source-value="${CSS.escape(source.value)}"]`)
			if (el) {
				el.classList.add('source-item--previewing')
				clearTimeout(previewFeedback)
				previewFeedback = setTimeout(() => el.classList.remove('source-item--previewing'), 1200)
			}
		} catch (e) {
			console.warn('Preview failed:', e?.message || e)
		}
	}

	root.innerHTML = `
		<div class="sources-tabs">
			<button class="sources-tab active" data-src-tab="media">Media</button>
			<button class="sources-tab" data-src-tab="templates">Templates</button>
			<button class="sources-tab" data-src-tab="live">Live</button>
			<button class="sources-tab" data-src-tab="timelines">Timelines</button>
		</div>
		<div class="sources-search" id="sources-search" style="display:none">
			<input type="text" placeholder="Filter…" id="sources-filter" />
		</div>
		<div class="sources-list" id="sources-list"></div>
		<div class="sources-live-footer" id="sources-live-footer" style="display:none">
			<button type="button" class="sources-live-add-btn" id="sources-live-add-btn" title="Add live input (Decklink / NDI)">+</button>
		</div>
		<div class="sources-media-footer" id="sources-media-footer" style="display:none">
			<div class="sources-media-footer__row">
				<button type="button" class="sources-refresh-btn" id="sources-refresh-media" title="Refresh media library from CasparCG server">↻ Refresh</button>
				<div class="ingest-plus-wrap" id="ingest-plus-wrap">
					<button type="button" class="ingest-plus-btn" id="ingest-plus-btn" title="Add Media">+</button>
					<div class="ingest-dropup-menu" id="ingest-dropup-menu" style="display:none">
						<button type="button" class="ingest-menu-item" id="ingest-menu-file">📁 Select File(s)</button>
						<div class="ingest-url-row">
							<input type="text" id="ingest-url" class="ingest-url-input" placeholder="Paste URL (we.tl, etc)…" />
							<button type="button" id="ingest-url-btn" class="ingest-url-btn" title="Download from URL">⬇</button>
						</div>
					</div>
				</div>
			</div>
			<div class="ingest-status" id="ingest-status"></div>
		</div>
		<div id="sources-drag-overlay" class="sources-drag-overlay" style="display:none">
			<div class="sources-drag-overlay__content">
				<span class="sources-drag-overlay__icon">⬆</span>
				<span>Drop media to ingest</span>
			</div>
		</div>
	`

	const tabs = root.querySelectorAll('.sources-tab')
	const searchWrap = root.querySelector('#sources-search')
	const filterInput = root.querySelector('#sources-filter')
	const listEl = root.querySelector('#sources-list')
	const mediaFooter = root.querySelector('#sources-media-footer')
	const refreshBtn = root.querySelector('#sources-refresh-media')
	const ingestPlusWrap = root.querySelector('#ingest-plus-wrap')
	const ingestPlusBtn = root.querySelector('#ingest-plus-btn')
	const ingestDropupMenu = root.querySelector('#ingest-dropup-menu')
	const ingestMenuFile = root.querySelector('#ingest-menu-file')
	const ingestUrlInput = root.querySelector('#ingest-url')
	const ingestUrlBtn = root.querySelector('#ingest-url-btn')
	const ingestStatus = root.querySelector('#ingest-status')
	const dragOverlay = root.querySelector('#sources-drag-overlay')
	const liveFooter = root.querySelector('#sources-live-footer')

	let currentTab = 'media'
	let filter = ''
	let mediaWithProbe = null

	root.querySelector('#sources-live-add-btn')?.addEventListener('click', () => showLiveInputModal(stateStore))

	async function fetchMediaWithProbe() {
		try {
			const data = await api.get('/api/media')
			mediaWithProbe = Array.isArray(data) ? data : (data?.media ?? [])
			render()
		} catch {
			mediaWithProbe = null
		}
	}

	/**
	 * Ask server to re-query CLS (async), then poll GET /api/media — first response often races the library update.
	 */
	async function refreshMediaList() {
		try {
			await api.post('/api/media/refresh')
		} catch (e) {
			console.warn('Refresh media failed:', e?.message || e)
		}
		await fetchMediaWithProbe()
		for (const ms of [400, 1100]) {
			await new Promise((r) => setTimeout(r, ms))
			await fetchMediaWithProbe()
		}
	}

	function render() {
		const state = stateStore.getState()
		const media = state.media || []
		const templates = state.templates || []
		const timelines = (currentTab === 'timelines' ? timelineState.getAll() : []) || state.timelines || []
		const channelMap = state.channelMap || {}

		if (liveFooter) liveFooter.style.display = currentTab === 'live' ? 'flex' : 'none'

		if (currentTab === 'media') {
			searchWrap.style.display = 'block'
			listEl.classList.add('sources-media-list')
			renderMediaBrowser(listEl, mergeMediaProbeOverlay(media, mediaWithProbe), filter)
			if (mediaFooter) mediaFooter.style.display = 'flex'
		} else if (currentTab === 'templates') {
			searchWrap.style.display = 'block'
			listEl.classList.remove('sources-media-list')
			if (mediaFooter) mediaFooter.style.display = 'none'
			renderSourceList(listEl, templates, 'template', filter, sendToPreview)
		} else if (currentTab === 'live') {
			searchWrap.style.display = 'none'
			listEl.classList.remove('sources-media-list')
			if (mediaFooter) mediaFooter.style.display = 'none'
			const liveSources = buildLiveSources(channelMap)
			listEl.innerHTML = ''
			if (liveSources.length === 0) {
				listEl.innerHTML = '<p class="sources-empty">No live sources (check channel config)</p>'
			} else {
				liveSources.forEach((s) => {
					const metaParts = []
					if (s.resolution) metaParts.push(s.resolution)
					if (s.fps) metaParts.push(`${s.fps}fps`)
					const meta = metaParts.join(' · ')
					const el = document.createElement('div')
					el.className = 'source-item source-item--live'
					el.dataset.sourceValue = s.value
					el.innerHTML = `
						<span class="source-item__icon">${iconFor('route')}</span>
						<span class="source-item__label" title="${escapeHtml(s.label + (meta ? ' — ' + meta : ''))}">${escapeHtml(s.label)}</span>
						${meta ? `<span class="source-item__meta">${escapeHtml(meta)}</span>` : ''}
					`
					const dragExtra = {}
					if (s.resolution) dragExtra.resolution = s.resolution
					if (s.fps) dragExtra.fps = s.fps
					if (s.routeType) dragExtra.routeType = s.routeType
					if (s.screenIdx != null) dragExtra.screenIdx = s.screenIdx
					makeDraggable(el, s.type, s.value, s.label, dragExtra)
					listEl.appendChild(el)
				})
			}
		} else {
			searchWrap.style.display = 'block'
			listEl.classList.remove('sources-media-list')
			if (mediaFooter) mediaFooter.style.display = 'none'
			const items = timelines.map((t) => ({ id: t.id || t.name, label: t.name || t.id || 'Untitled' }))
			renderSourceList(listEl, items, 'timeline', filter, null) // timelines: no preview
		}
	}

	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			currentTab = tab.dataset.srcTab
			tabs.forEach((t) => t.classList.remove('active'))
			tab.classList.add('active')
			filter = ''
			if (filterInput) filterInput.value = ''
			if (currentTab === 'media') void refreshMediaList()
			render()
		})
	})

	filterInput?.addEventListener('input', () => {
		filter = filterInput.value.trim()
		render()
	})

	refreshBtn?.addEventListener('click', () => void refreshMediaList())

	// ─── Ingest: Drag & Drop ───
	function showIngestStatus(msg, type = 'info') {
		if (!ingestStatus) return
		ingestStatus.textContent = msg
		ingestStatus.className = `ingest-status ingest-status--${type}`
		if (type === 'ok') setTimeout(() => { ingestStatus.textContent = ''; ingestStatus.className = 'ingest-status' }, 4000)
	}

	async function uploadFiles(files) {
		if (!files || files.length === 0) return
		const formData = new FormData()
		for (const f of files) formData.append('file', f, f.name)
		showIngestStatus(`Uploading ${files.length} file(s)…`, 'info')
		try {
			const resp = await fetch(getApiBase() + '/api/ingest/upload', { method: 'POST', body: formData })
			const ct = resp.headers.get('content-type') || ''
			if (!ct.includes('application/json')) {
				const text = await resp.text()
				throw new Error(text.startsWith('<') ? `HTTP ${resp.status}: server returned HTML (not JSON)` : `HTTP ${resp.status}: ${text.slice(0, 120)}`)
			}
			const json = await resp.json()
			if (!resp.ok || !json.ok) {
				showIngestStatus(`✗ ${json.error || resp.statusText || 'Upload failed'}`, 'error')
				return
			}
			showIngestStatus(`✓ Uploaded ${json.count || files.length} file(s)`, 'ok')
			void refreshMediaList()
		} catch (e) {
			showIngestStatus(`✗ ${e.message}`, 'error')
		}
	}

	// Universal Drag & Drop onto Sources root
	let dragCounter = 0
	root.addEventListener('dragenter', (e) => {
		e.preventDefault()
		dragCounter++
		dragOverlay.style.display = 'flex'
	})
	root.addEventListener('dragover', (e) => {
		e.preventDefault()
	})
	root.addEventListener('dragleave', (e) => {
		e.preventDefault()
		dragCounter--
		if (dragCounter <= 0) {
			dragCounter = 0
			dragOverlay.style.display = 'none'
		}
	})
	root.addEventListener('drop', (e) => {
		e.preventDefault()
		dragCounter = 0
		dragOverlay.style.display = 'none'
		
		const files = e.dataTransfer?.files
		if (!files || files.length === 0) return
		
		// If on another tab, switch to Media tab
		if (currentTab !== 'media') {
			const mediaTab = Array.from(tabs).find(t => t.dataset.srcTab === 'media')
			if (mediaTab) mediaTab.click()
		}
		uploadFiles(files)
	})

	// Plus button menu
	if (ingestPlusBtn) {
		ingestPlusBtn.addEventListener('click', (e) => {
			e.stopPropagation()
			const isVisible = ingestDropupMenu.style.display === 'flex'
			ingestDropupMenu.style.display = isVisible ? 'none' : 'flex'
		})
		
		document.addEventListener('click', (e) => {
			if (ingestPlusWrap && !ingestPlusWrap.contains(e.target)) {
				ingestDropupMenu.style.display = 'none'
			}
		})

		ingestMenuFile.addEventListener('click', () => {
			ingestDropupMenu.style.display = 'none'
			const inp = document.createElement('input')
			inp.type = 'file'
			inp.multiple = true
			inp.onchange = () => uploadFiles(inp.files)
			inp.click()
		})
	}

	// ─── Ingest: URL Download (poll /api/ingest/download-status for progress) ───
	let downloadPollTimer = null
	function stopDownloadPoll() {
		if (downloadPollTimer) {
			clearInterval(downloadPollTimer)
			downloadPollTimer = null
		}
	}

	async function pollDownloadUntilIdle() {
		stopDownloadPoll()
		const started = Date.now()
		const maxMs = 60 * 60 * 1000
		const tick = async () => {
			if (Date.now() - started > maxMs) {
				stopDownloadPoll()
				showIngestStatus('✗ Download status timed out (1h)', 'error')
				return
			}
			try {
				const st = await api.get('/api/ingest/download-status')
				if (st.active) {
					const pct = st.progress != null && st.progress !== '' ? ` ${Math.round(Number(st.progress))}%` : ''
					showIngestStatus(`${st.message || 'Working…'}${pct}`, 'info')
					return
				}
				stopDownloadPoll()
				if (st.error) {
					showIngestStatus(`✗ ${st.error}`, 'error')
				} else {
					showIngestStatus(`✓ ${st.message || 'Download complete'}`, 'ok')
					void refreshMediaList()
				}
			} catch (e) {
				stopDownloadPoll()
				showIngestStatus(`✗ ${e.message}`, 'error')
			}
		}
		await tick()
		downloadPollTimer = setInterval(() => void tick(), 450)
	}

	if (ingestUrlBtn) {
		ingestUrlBtn.addEventListener('click', async () => {
			const url = (ingestUrlInput?.value || '').trim()
			if (!url) return
			stopDownloadPoll()
			showIngestStatus('Starting download…', 'info')
			try {
				const resp = await api.post('/api/ingest/download', { url })
				if (resp.ok) {
					ingestUrlInput.value = ''
					void pollDownloadUntilIdle()
				} else {
					showIngestStatus(`✗ ${resp.error || 'Failed'}`, 'error')
				}
			} catch (e) {
				showIngestStatus(`✗ ${e.message}`, 'error')
			}
		})
	}

	stateStore.on('*', () => render())
	timelineState.on('change', () => render())
	render()
	if (currentTab === 'media') void refreshMediaList()
	window.addEventListener('highascg-bootstrap-complete', () => {
		if (currentTab === 'media') void refreshMediaList()
	})
	window.addEventListener('pageshow', (ev) => {
		if (ev.persisted && currentTab === 'media') void refreshMediaList()
	})
}
