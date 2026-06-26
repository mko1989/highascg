/**
 * Sources panel — Media, Effects, Live sources, Timelines.
 */
import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { showLiveInputModal } from './live-input-modal.js'
import { mergeMediaProbeOverlay, renderSourceList } from './sources-panel-helpers.js'
import { renderMediaBrowser } from './sources-panel-media.js'
import { renderTemplatesBrowser } from './sources-panel-templates.js'
import { renderEffectsTab } from './sources-panel-effects.js'
import { renderPlaceholdersBrowser } from './sources-panel-placeholders.js'
import { showUsbImportModal } from './usb-import-modal.js'
import * as Ingest from './sources-panel-ingest-logic.js'
import { renderLiveTab } from './sources-panel-live-render.js'
import { showPlaceholderModal } from './placeholder-modal.js'
import { refreshLiveAudioConfigured } from '../lib/live-audio-state.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'
import { decklinkInputForSlot, decklinkSlotFromConnector } from '../lib/input-channels.js'
import { copyMediaFiles, deleteMediaFiles, formatMediaOpResult, moveMediaFiles } from '../lib/media-file-ops.js'
import { showMediaFolderPicker, listMediaFolders } from './media-folder-picker-modal.js'

export function initSourcesPanel(root, stateStore, opts = {}) {
	const wsClient = opts.wsClient; let previewFeedback = null; let currentTab = 'media'; let filter = ''; let mediaWithProbe = null; let extraLiveSources = []
	/** @type {object | null} */
	let liveAudioConfiguredCache = null
	const collapsedFolders = new Set()

	async function fetchLiveAudioConfigured() {
		liveAudioConfiguredCache = await refreshLiveAudioConfigured(stateStore)
		return liveAudioConfiguredCache
	}
	const selectedMedia = new Set()
	let lastSelectedMediaId = null
	/** @type {string[]} */
	let visibleMediaOrder = []
	const sendToPrv = async (s) => { const ch = (stateStore.getState()?.channelMap?.previewChannels?.[0] ?? 2); try { await api.post('/api/play', { channel: ch, layer: 1, clip: s.value }); const el = root.querySelector(`[data-source-value="${CSS.escape(s.value)}"]`); if (el) { el.classList.add('source-item--previewing'); clearTimeout(previewFeedback); previewFeedback = setTimeout(() => el.classList.remove('source-item--previewing'), 1200) } } catch {} }

	root.innerHTML = `<div class="sources-tabs"><button class="sources-tab active" data-src-tab="media">Media</button><button class="sources-tab" data-src-tab="templates">Templates</button><button class="sources-tab" data-src-tab="placeholders" style="display:none">Placeholders</button><button class="sources-tab" data-src-tab="effects">Effects</button><button class="sources-tab" data-src-tab="live">Live</button><button class="sources-tab" data-src-tab="timelines">Timelines</button></div><div class="sources-search" style="display:none"><input type="text" placeholder="Filter…" id="sources-filter" /></div><div class="sources-list" id="sources-list"></div><div class="sources-live-footer" style="display:none"><button type="button" class="sources-live-add-btn" id="sources-live-add-btn">+</button></div><div class="sources-media-footer" style="display:none"><div class="sources-media-selection-bar" id="sources-media-selection-bar" style="display:none"><span class="sources-media-selection-bar__count" id="sources-selection-count">0 selected</span><button type="button" class="sources-media-action-btn" id="sources-copy-selected">Copy to…</button><button type="button" class="sources-media-action-btn" id="sources-move-selected">Move to…</button><button type="button" class="sources-media-action-btn sources-media-action-btn--danger" id="sources-delete-selected">Delete</button><button type="button" class="sources-media-action-btn sources-media-action-btn--ghost" id="sources-clear-selected">Clear</button></div><div class="sources-media-footer__row"><button type="button" class="sources-refresh-btn" id="sources-refresh-media">↻ Refresh</button><div class="ingest-plus-wrap"><button type="button" class="ingest-plus-btn" id="ingest-plus-btn">+</button><div class="ingest-dropup-menu" style="display:none"><button class="ingest-menu-item" id="ingest-menu-file">Select File(s)</button><button class="ingest-menu-item" id="ingest-menu-mkdir">New Folder…</button><button class="ingest-menu-item ingest-menu-item--usb" id="ingest-menu-usb">Import USB…<span class="ingest-usb-badge" style="display:none"></span></button><button class="ingest-menu-item ingest-menu-item--placeholder" id="ingest-menu-placeholder" style="display:none">Add Placeholder…</button><div class="ingest-url-row"><input type="text" id="ingest-url" class="ingest-url-input" placeholder="Paste URL…" /><button type="button" id="ingest-url-btn" class="ingest-url-btn">⬇</button></div></div></div></div><div class="ingest-status-col"><div class="ingest-status" id="ingest-status"></div><div class="ingest-upload-progress" style="display:none"><div class="ingest-upload-progress__track"><div class="ingest-upload-progress__bar" style="width:0%"></div></div><span class="ingest-upload-progress__pct">0%</span></div></div></div><div id="sources-drag-overlay" class="sources-drag-overlay" style="display:none"><div class="sources-drag-overlay__content"><span>Drop to ingest</span></div></div>`
	const tabs = root.querySelectorAll('.sources-tab'); const filterInput = root.querySelector('#sources-filter'); const listEl = root.querySelector('#sources-list'); const mediaFooter = root.querySelector('.sources-media-footer'); const selectionBar = root.querySelector('#sources-media-selection-bar'); const selectionCountEl = root.querySelector('#sources-selection-count'); const refreshBtn = root.querySelector('#sources-refresh-media'); const copyBtn = root.querySelector('#sources-copy-selected'); const moveBtn = root.querySelector('#sources-move-selected'); const deleteBtn = root.querySelector('#sources-delete-selected'); const clearSelBtn = root.querySelector('#sources-clear-selected'); const plusBtn = root.querySelector('#ingest-plus-btn'); const dropMenu = root.querySelector('.ingest-dropup-menu'); const fileBtn = root.querySelector('#ingest-menu-file'); const mkdirBtn = root.querySelector('#ingest-menu-mkdir'); const usbBtn = root.querySelector('#ingest-menu-usb'); const placeholderBtn = root.querySelector('#ingest-menu-placeholder'); const usbBadge = root.querySelector('.ingest-usb-badge'); const urlIn = root.querySelector('#ingest-url'); const urlBtn = root.querySelector('#ingest-url-btn'); const iStatus = root.querySelector('#ingest-status'); const iProgWrap = root.querySelector('.ingest-upload-progress'); const iBar = root.querySelector('.ingest-upload-progress__bar'); const iPct = root.querySelector('.ingest-upload-progress__pct'); const liveFooter = root.querySelector('.sources-live-footer'); const dragOverlay = root.querySelector('#sources-drag-overlay')
	root.querySelector('#sources-live-add-btn')?.addEventListener('click', () => showLiveInputModal(stateStore))

	const applyMediaList = (list) => {
		if (!Array.isArray(list)) return
		mediaWithProbe = list
		stateStore?.applyChange?.('media', list)
		render()
	}
	const fetchMedia = async () => {
		try {
			const data = await api.get('/api/media')
			applyMediaList(data.media || data)
		} catch {
			mediaWithProbe = null
		}
	}
	const refreshMedia = async () => {
		await api.post('/api/media/refresh', { ensureHqThumbs: true }).catch(() => {})
		await fetchMedia()
		setTimeout(fetchMedia, 400)
		setTimeout(fetchMedia, 1100)
	}
	const setStatus = (m, t) => { iStatus.textContent = m; iStatus.className = `ingest-status ingest-status--${t}`; if (t === 'ok') setTimeout(() => { iStatus.textContent = ''; iStatus.className = 'ingest-status' }, 4000) }
	const poller = Ingest.createDownloadPoller({ setStatus, refreshCallback: refreshMedia })
	const parseDecklinkDrop = (ev) => { const raw = ev?.dataTransfer?.getData('application/x-highascg-connector') || ''; if (!raw) return null; try { const payload = JSON.parse(raw); if (String(payload?.kind || '') !== 'decklink_io') return null; const connectorId = String(payload?.connectorId || '').trim(); return connectorId ? { connectorId } : null } catch { return null } }
	const showDecklinkDropHint = (routeValue, connectorId) => {
		const host = document.createElement('div')
		host.className = 'sources-status'
		host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;pointer-events:none'
		const toast = document.createElement('div')
		toast.style.cssText = 'background:rgba(17,24,39,0.96);color:#e5e7eb;border:1px solid rgba(88,166,255,0.55);border-radius:8px;padding:9px 12px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,0.35)'
		toast.textContent = `Ready in Live tab: ${routeValue} (${connectorId})`
		host.appendChild(toast)
		document.body.appendChild(host)
		setTimeout(() => host.remove(), 2600)
	}
	const mapDecklinkToLiveInput = async (connectorId) => {
		if (!connectorId) return
		setStatus(`Mapping ${connectorId} as live input…`, 'info')
		try {
			await api.post('/api/device-view', { updateConnector: { id: connectorId, patch: { caspar: { ioDirection: 'in' } } } })
			const payload = await api.get('/api/device-view')
			const connectors = [
				...(Array.isArray(payload?.graph?.connectors) ? payload.graph.connectors : []),
				...(Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []),
			]
			const c = connectors.find((x) => String(x?.id || '') === connectorId) || null
			const slot = decklinkSlotFromConnector(c || { index: parseInt(String(connectorId).replace(/^dli_/, ''), 10) - 1 })
			const dev = Math.max(0, parseInt(String(c?.externalRef ?? 0), 10) || 0)
			const cm = stateStore.getState()?.channelMap || {}
			const entry = decklinkInputForSlot(cm, slot)
			if (entry?.channel == null) {
				markCasparRestartDirty()
				setStatus(`Mapped ${connectorId} to input. Set decklink_input_count ≥ ${slot} and restart Caspar.`, 'ok')
				return
			}
			const layer = entry.layer ?? slot
			const cl = `${entry.channel}-${layer}`
			await api.post('/api/raw', { cmd: `STOP ${cl}` }).catch(() => {})
			await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }).catch(() => {})
			await api.post('/api/raw', { cmd: `PLAY ${cl} DECKLINK ${dev}` })
			const routeVal = entry.route || `route://${cl}`
			const item = {
				type: 'route',
				routeType: 'decklink',
				value: routeVal,
				label: entry.label || `decklink ${slot}`,
				decklinkSlot: slot,
				inputsChannel: entry.channel,
				inputsLayer: layer,
				connectorId,
				decklinkDevice: dev,
			}
			const addRes = await api.post('/api/device-view', { addExtraLiveSource: item })
			if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
				window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
			}
			markCasparRestartDirty()
			setStatus(`Live source ready: ${routeVal} (${connectorId})`, 'ok')
			showDecklinkDropHint(`route://${cl}`, connectorId)
			activateTab('live')
		} catch (e) {
			setStatus(e?.message || String(e), 'error')
		}
	}
	listEl.addEventListener('dragover', (ev) => { const parsed = parseDecklinkDrop(ev); if (!parsed) return; ev.preventDefault(); listEl.style.outline = '1px dashed var(--accent-color,#58a6ff)' })
	listEl.addEventListener('dragleave', () => { listEl.style.outline = '' })
	listEl.addEventListener('drop', async (ev) => { listEl.style.outline = ''; const parsed = parseDecklinkDrop(ev); if (!parsed) return; ev.preventDefault(); ev.stopPropagation(); await mapDecklinkToLiveInput(parsed.connectorId) })

	function toggleMediaSelection(id, modifiers = {}) {
		const multi = modifiers.ctrlKey || modifiers.metaKey
		if (modifiers.shiftKey && lastSelectedMediaId) {
			const a = visibleMediaOrder.indexOf(lastSelectedMediaId)
			const b = visibleMediaOrder.indexOf(id)
			if (a >= 0 && b >= 0) {
				const lo = Math.min(a, b)
				const hi = Math.max(a, b)
				if (!multi) selectedMedia.clear()
				for (let i = lo; i <= hi; i++) selectedMedia.add(visibleMediaOrder[i])
			} else if (!multi) {
				selectedMedia.clear()
				selectedMedia.add(id)
			}
		} else if (multi) {
			if (selectedMedia.has(id)) selectedMedia.delete(id)
			else selectedMedia.add(id)
		} else if (selectedMedia.size === 1 && selectedMedia.has(id)) {
			selectedMedia.clear()
		} else {
			selectedMedia.clear()
			selectedMedia.add(id)
		}
		lastSelectedMediaId = id
		render()
	}

	function updateSelectionBar() {
		const count = selectedMedia.size
		if (selectionBar) selectionBar.style.display = count > 0 ? 'flex' : 'none'
		if (selectionCountEl) {
			selectionCountEl.textContent = `${count} selected`
		}
	}

	async function runMediaTransfer(op, ids) {
		const list = ids?.length ? ids : Array.from(selectedMedia)
		if (list.length === 0) return
		const s = stateStore.getState()
		const mediaList = mergeMediaProbeOverlay(s.media || [], mediaWithProbe)
		const title = op === 'copy' ? `Copy ${list.length} file${list.length === 1 ? '' : 's'} to` : `Move ${list.length} file${list.length === 1 ? '' : 's'} to`
		const dest = await showMediaFolderPicker({ title, mediaList })
		if (dest == null) return
		const folders = new Set(listMediaFolders(mediaList))
		if (dest && !folders.has(dest)) {
			await api.post('/api/media/mkdir', { path: dest }).catch(() => {})
		}
		setStatus(`${op === 'copy' ? 'Copying' : 'Moving'} ${list.length}…`, 'info')
		const result = op === 'copy' ? await copyMediaFiles(list, dest) : await moveMediaFiles(list, dest)
		setStatus(formatMediaOpResult(result, op === 'copy' ? 'Copied' : 'Moved'), result.failed ? 'error' : 'ok')
		if (result.failed && result.errors[0]) console.warn('[media]', result.errors[0])
		if (op === 'move') selectedMedia.clear()
		refreshMedia()
	}

	async function runMediaDelete(ids) {
		const list = ids?.length ? ids : Array.from(selectedMedia)
		if (list.length === 0) return
		if (!confirm(`Delete ${list.length} selected file${list.length === 1 ? '' : 's'}?\n\nThis cannot be undone.`)) return
		setStatus(`Deleting ${list.length}…`, 'info')
		const result = await deleteMediaFiles(list)
		setStatus(formatMediaOpResult(result, 'Deleted'), result.failed ? 'error' : 'ok')
		selectedMedia.clear()
		refreshMedia()
	}

	function render() {
		const s = stateStore.getState(); listEl.classList.remove('sources-media-list'); if (liveFooter) liveFooter.style.display = currentTab === 'live' ? 'flex' : 'none'
		if (selectionBar) selectionBar.style.display = 'none'
		if (currentTab === 'media') {
			listEl.classList.add('sources-media-list')
			listEl.tabIndex = 0
			renderMediaBrowser(listEl, mergeMediaProbeOverlay(s.media || [], mediaWithProbe), filter, refreshMedia, {
				collapsedFolders,
				selected: selectedMedia,
				onVisibleFileOrder: (ids) => {
					visibleMediaOrder = ids
				},
				onToggleFolder: (path) => { if (collapsedFolders.has(path)) collapsedFolders.delete(path); else collapsedFolders.add(path); render() },
				onToggleSelect: (id, modifiers) => toggleMediaSelection(id, modifiers),
				onMoveItem: async (sourceId, targetId) => {
					setStatus(`Moving…`, 'info')
					const result = await moveMediaFiles([sourceId], targetId)
					setStatus(formatMediaOpResult(result, 'Moved'), result.failed ? 'error' : 'ok')
					refreshMedia()
				},
				onMoveItems: async (sourceIds, targetId) => {
					setStatus(`Moving ${sourceIds.length}…`, 'info')
					const result = await moveMediaFiles(sourceIds, targetId)
					setStatus(formatMediaOpResult(result, 'Moved'), result.failed ? 'error' : 'ok')
					selectedMedia.clear()
					refreshMedia()
				},
				onCopyItem: async (sourceId, targetId) => {
					setStatus(`Copying…`, 'info')
					const result = await copyMediaFiles([sourceId], targetId)
					setStatus(formatMediaOpResult(result, 'Copied'), result.failed ? 'error' : 'ok')
					refreshMedia()
				},
				onCopyItems: async (sourceIds, targetId) => {
					setStatus(`Copying ${sourceIds.length}…`, 'info')
					const result = await copyMediaFiles(sourceIds, targetId)
					setStatus(formatMediaOpResult(result, 'Copied'), result.failed ? 'error' : 'ok')
					refreshMedia()
				},
			})
			mediaFooter.style.display = 'flex'; watchUsbBadge()
			updateSelectionBar()
		}
		else if (currentTab === 'templates') { renderTemplatesBrowser(listEl, s.templates || [], filter); mediaFooter.style.display = 'flex'; watchUsbBadge() }
		else if (currentTab === 'placeholders') { renderPlaceholdersBrowser(listEl, window.placeholderState?.getAll() || [], filter); mediaFooter.style.display = 'flex'; unwatchUsbBadge() }
		else if (currentTab === 'effects') { unwatchUsbBadge(); renderEffectsTab(listEl, filter); mediaFooter.style.display = 'none' }
		else if (currentTab === 'live') {
			unwatchUsbBadge()
			const liveCfg = s.liveAudioConfigured || liveAudioConfiguredCache
			if (!liveCfg) void fetchLiveAudioConfigured().then(() => render())
			renderLiveTab(listEl, {
				channelMap: s.channelMap || {},
				decklinkInputsStatus: s.decklinkInputsStatus,
				liveAudioInputsStatus: s.liveAudioInputsStatus,
				liveAudioConfigured: liveCfg,
				extraSources: s.extraLiveSources || [],
				connectors: s.connectors || [],
			})
			mediaFooter.style.display = 'none'
		}
		else { unwatchUsbBadge(); renderSourceList(listEl, (timelineState.getAll() || s.timelines || []).map(t => ({ id: t.id || t.name, label: t.name || t.id })), 'timeline', filter, null); mediaFooter.style.display = 'none' }
		root.querySelector('.sources-search').style.display = (['live'].includes(currentTab) ? 'none' : 'block')
	}


	const activateTab = (tabName) => {
		currentTab = tabName
		tabs.forEach(x => x.classList.toggle('active', x.dataset.srcTab === tabName))
		filterInput.value = ''
		filter = ''
		if (['media', 'templates'].includes(currentTab)) refreshMedia()
		render()
	}
	tabs.forEach(t => t.onclick = () => activateTab(t.dataset.srcTab))
	filterInput?.addEventListener('input', () => { filter = filterInput.value.trim(); render() })
	if (refreshBtn) refreshBtn.onclick = refreshMedia
	if (copyBtn) copyBtn.onclick = () => void runMediaTransfer('copy')
	if (moveBtn) moveBtn.onclick = () => void runMediaTransfer('move')
	if (deleteBtn) deleteBtn.onclick = () => void runMediaDelete()
	if (clearSelBtn) {
		clearSelBtn.onclick = () => {
			selectedMedia.clear()
			lastSelectedMediaId = null
			render()
		}
	}
	root.addEventListener('keydown', (e) => {
		if (currentTab !== 'media' || selectedMedia.size === 0) return
		if (e.key !== 'Delete' && e.key !== 'Backspace') return
		const tag = String(e.target?.tagName || '').toLowerCase()
		if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
		e.preventDefault()
		void runMediaDelete()
	})
	const refreshUsb = async () => {
		try {
			const r = await api.get('/api/usb/drives')
			const n = r.drives?.length || 0
			usbBadge.textContent = n || ''
			usbBadge.style.display = n ? 'inline-flex' : 'none'
			usbBtn.classList.toggle('pending', !n)
		} catch {
			usbBadge.style.display = 'none'
			usbBtn.classList.add('pending')
		}
	}
	/** One-shot refresh when entering Media/Templates — no background polling. */
	let usbBadgeWatched = false
	const watchUsbBadge = () => {
		if (usbBadgeWatched) return
		usbBadgeWatched = true
		void refreshUsb()
	}
	const unwatchUsbBadge = () => {
		usbBadgeWatched = false
	}
	if (wsClient?.on) {
		wsClient.on('usb:attached', refreshUsb)
		wsClient.on('usb:detached', refreshUsb)
	}
	usbBtn.onclick = () => { dropMenu.style.display = 'none'; showUsbImportModal({ wsClient, onImported: refreshMedia }) }
	const upload = (fs) => Ingest.uploadFiles(fs, { setStatus, showProgress: (v) => iProgWrap.style.display = v ? 'flex' : 'none', updateProgress: (p) => { iBar.style.width = `${p}%`; iPct.textContent = `${p}%` }, refreshCallback: refreshMedia })
	root.ondragenter = (e) => { e.preventDefault(); dragOverlay.style.display = 'flex' }; root.ondragover = e => e.preventDefault(); root.ondragleave = () => dragOverlay.style.display = 'none'; root.ondrop = e => { e.preventDefault(); dragOverlay.style.display = 'none'; if (currentTab !== 'media') tabs[0].click(); upload(e.dataTransfer?.files) }
	plusBtn.onclick = e => { e.stopPropagation(); const opening = dropMenu.style.display !== 'flex'; dropMenu.style.display = opening ? 'flex' : 'none'; if (opening) void refreshUsb() }
	document.onclick = e => { if (!plusBtn.contains(e.target)) dropMenu.style.display = 'none' }
	fileBtn.onclick = () => { dropMenu.style.display = 'none'; const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.onchange = () => upload(i.files); i.click() }
	mkdirBtn.onclick = async () => { dropMenu.style.display = 'none'; const n = prompt('New Folder Name:'); if (n) { try { await api.post('/api/media/mkdir', { path: n }); setStatus(`Folder "${n}" created`, 'ok'); refreshMedia() } catch (e) { setStatus(e.message, 'error') } } }
	placeholderBtn.onclick = () => { dropMenu.style.display = 'none'; showPlaceholderModal({ onAdded: () => { if (currentTab === 'placeholders') render() } }) }
	urlBtn.onclick = async () => { const u = urlIn.value.trim(); if (!u) return; setStatus('Starting…', 'info'); try { if ((await api.post('/api/ingest/download', { url: u })).ok) { urlIn.value = ''; poller.start() } } catch (e) { setStatus(e.message, 'error') } }

	const updateOfflineUI = () => {
		const isOffline = stateStore.isOffline()
		const phTab = root.querySelector('[data-src-tab="placeholders"]')
		if (phTab) phTab.style.display = isOffline ? '' : 'none'
		if (placeholderBtn) placeholderBtn.style.display = isOffline ? 'block' : 'none'
		if (!isOffline && currentTab === 'placeholders') activateTab('media')
	}
	updateOfflineUI()
	stateStore.on('offline', updateOfflineUI) // Custom event or just check on state change
	// Actually we should listen to the stateStore offline status change.
	// In StateStore.setOffline it calls _emit('offline', offline). Wait, let's check _emit in state-store.js

	let renderTimer = null
	const debouncedRender = () => {
		if (renderTimer) return
		renderTimer = requestAnimationFrame(() => {
			render()
			renderTimer = null
		})
	}

	stateStore.on('*', p => {
		if (!p || p === '*' || !['timeline.tick', 'timeline.playback', 'variables', 'channels', 'logs', 'dmx:colors'].includes(p)) {
			debouncedRender()
		}
	})
	timelineState.on('change', debouncedRender); render(); if (['media', 'templates'].includes(currentTab)) refreshMedia()
}
