/**
 * Sources panel — Media, Effects, Live sources, Timelines.
 * Each source is draggable for use in dashboard columns/layers.
 * Media tab: two-line rows (name + duration; resolution + fps).
 * Effects tab: CasparCG mixer effects (blend, crop, chroma, levels, etc.).
 * @see main_plan.md Prompt 12, Prompt 18
 * @see 22_WO_MIXER_EFFECTS.md
 */

import { timelineState } from '../lib/timeline-state.js'
import { api, getApiBase } from '../lib/api-client.js'
import { postFormDataWithProgress } from '../lib/form-upload.js'
import { showLiveInputModal } from './live-input-modal.js'
import {
	buildLiveSources,
	escapeHtml,
	makeDraggable,
	mergeMediaProbeOverlay,
	renderEffectsTab,
	renderMediaBrowser,
	renderSourceList,
} from './sources-panel-helpers.js'

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
			<button class="sources-tab" data-src-tab="effects">Effects</button>
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
			<div class="ingest-status-col">
				<div class="ingest-status" id="ingest-status"></div>
				<div class="ingest-upload-progress" id="ingest-upload-progress" style="display:none">
					<div class="ingest-upload-progress__track">
						<div class="ingest-upload-progress__bar" id="ingest-upload-progress-bar" style="width:0%"></div>
					</div>
					<span class="ingest-upload-progress__pct" id="ingest-upload-progress-pct">0%</span>
				</div>
			</div>
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
	const ingestProgressWrap = root.querySelector('#ingest-upload-progress')
	const ingestProgressBar = root.querySelector('#ingest-upload-progress-bar')
	const ingestProgressPct = root.querySelector('#ingest-upload-progress-pct')
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
			renderMediaBrowser(listEl, mergeMediaProbeOverlay(media, mediaWithProbe), filter, () => {
				showIngestStatus('✓ Removed from server', 'ok')
				void refreshMediaList()
			})
			if (mediaFooter) mediaFooter.style.display = 'flex'
		} else if (currentTab === 'effects') {
			searchWrap.style.display = 'block'
			listEl.classList.remove('sources-media-list')
			if (mediaFooter) mediaFooter.style.display = 'none'
			renderEffectsTab(listEl, filter)
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
					if (s.fps) metaParts.push(`${s.fps} fps`)
					const meta = metaParts.join(' · ')
					const el = document.createElement('div')
					el.className = 'source-item source-item--live source-item--live-stacked'
					el.dataset.sourceValue = s.value
					el.innerHTML = `
						<div class="source-item__live-col">
							<div class="source-item__live-line1">
								<span class="source-item__label" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span>
							</div>
							${meta ? `<div class="source-item__live-line2">${escapeHtml(meta)}</div>` : ''}
						</div>
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
	function hideIngestUploadProgress() {
		if (ingestProgressWrap) ingestProgressWrap.style.display = 'none'
		if (ingestProgressBar) ingestProgressBar.style.width = '0%'
		if (ingestProgressPct) ingestProgressPct.textContent = '0%'
	}

	function showIngestStatus(msg, type = 'info') {
		if (!ingestStatus) return
		hideIngestUploadProgress()
		ingestStatus.textContent = msg
		ingestStatus.className = `ingest-status ingest-status--${type}`
		if (type === 'ok') setTimeout(() => { ingestStatus.textContent = ''; ingestStatus.className = 'ingest-status' }, 4000)
	}

	async function uploadFiles(files) {
		if (!files || files.length === 0) return
		const formData = new FormData()
		for (const f of files) formData.append('file', f, f.name)
		if (ingestStatus) {
			ingestStatus.textContent = `Uploading ${files.length} file(s)…`
			ingestStatus.className = 'ingest-status ingest-status--info'
		}
		if (ingestProgressWrap) ingestProgressWrap.style.display = 'flex'
		if (ingestProgressBar) ingestProgressBar.style.width = '0%'
		if (ingestProgressPct) ingestProgressPct.textContent = '0%'
		try {
			const json = await postFormDataWithProgress(getApiBase() + '/api/ingest/upload', formData, (loaded, total) => {
				if (!ingestProgressBar || !ingestProgressPct) return
				if (total > 0) {
					const pct = Math.min(100, Math.round((loaded / total) * 100))
					ingestProgressBar.style.width = `${pct}%`
					ingestProgressPct.textContent = `${pct}%`
				} else {
					ingestProgressPct.textContent = '…'
				}
			})
			if (!json.ok) {
				showIngestStatus(`✗ ${json.error || 'Upload failed'}`, 'error')
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

	/* Only re-render when data this panel actually displays changes — not timeline.tick / playback (causes list flicker). */
	stateStore.on('*', (path) => {
		/* setState emits _emit('*',null); wildcard listeners may get null or '*' as path */
		if (path == null || path === '*') {
			render()
			return
		}
		if (
			path === 'timeline.tick' ||
			path === 'timeline.playback' ||
			path === 'playback.matrix' ||
			path === 'variables'
		) {
			return
		}
		if (currentTab === 'media') {
			if (path !== 'media' && path !== 'mediaProbe') return
		} else if (currentTab === 'live') {
			if (path !== 'channelMap') return
		} else if (currentTab === 'effects') {
			return
		} else if (currentTab === 'timelines') {
			return
		}
		render()
	})
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
