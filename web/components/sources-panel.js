/**
 * Sources panel — Media, Effects, Live sources, Timelines.
 */
import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { showLiveInputModal } from './live-input-modal.js'
import { mergeMediaProbeOverlay, renderEffectsTab, renderMediaBrowser, renderTemplatesBrowser, renderSourceList, renderPlaceholdersBrowser } from './sources-panel-helpers.js'
import { showUsbImportModal } from './usb-import-modal.js'
import * as Ingest from './sources-panel-ingest-logic.js'
import { renderLiveTab } from './sources-panel-live-render.js'
import { renderMappingBrowser } from './pixel-mapping-browser.js'
import { showPlaceholderModal } from './placeholder-modal.js'

export function initSourcesPanel(root, stateStore, opts = {}) {
	const wsClient = opts.wsClient; let previewFeedback = null; let currentTab = 'media'; let filter = ''; let mediaWithProbe = null; let usbBadgeTimer = null; let extraLiveSources = []
	const collapsedFolders = new Set()
	const selectedMedia = new Set()
	const sendToPrv = async (s) => { const ch = (stateStore.getState()?.channelMap?.previewChannels?.[0] ?? 2); try { await api.post('/api/play', { channel: ch, layer: 1, clip: s.value }); const el = root.querySelector(`[data-source-value="${CSS.escape(s.value)}"]`); if (el) { el.classList.add('source-item--previewing'); clearTimeout(previewFeedback); previewFeedback = setTimeout(() => el.classList.remove('source-item--previewing'), 1200) } } catch {} }

	root.innerHTML = `<div class="sources-tabs"><button class="sources-tab active" data-src-tab="media">Media</button><button class="sources-tab" data-src-tab="templates">Templates</button><button class="sources-tab" data-src-tab="placeholders" style="display:none">Placeholders</button><button class="sources-tab" data-src-tab="effects">Effects</button><button class="sources-tab" data-src-tab="live">Live</button><button class="sources-tab" data-src-tab="timelines">Timelines</button><button class="sources-tab" data-src-tab="mapping" style="display:none">Mapping</button></div><div class="sources-search" style="display:none"><input type="text" placeholder="Filter…" id="sources-filter" /></div><div class="sources-list" id="sources-list"></div><div class="sources-live-footer" style="display:none"><button type="button" class="sources-live-add-btn" id="sources-live-add-btn">+</button></div><div class="sources-media-footer" style="display:none"><div class="sources-media-footer__row"><button type="button" class="sources-refresh-btn" id="sources-refresh-media">↻ Refresh</button><div class="ingest-plus-wrap"><button type="button" class="ingest-plus-btn" id="ingest-plus-btn">+</button><div class="ingest-dropup-menu" style="display:none"><button class="ingest-menu-item" id="ingest-menu-file">Select File(s)</button><button class="ingest-menu-item" id="ingest-menu-mkdir">New Folder…</button><button class="ingest-menu-item ingest-menu-item--usb" id="ingest-menu-usb">Import USB…<span class="ingest-usb-badge" style="display:none"></span></button><button class="ingest-menu-item ingest-menu-item--placeholder" id="ingest-menu-placeholder" style="display:none">Add Placeholder…</button><div class="ingest-url-row"><input type="text" id="ingest-url" class="ingest-url-input" placeholder="Paste URL…" /><button type="button" id="ingest-url-btn" class="ingest-url-btn">⬇</button></div></div></div></div><div class="ingest-status-col"><div class="ingest-status" id="ingest-status"></div><div class="ingest-upload-progress" style="display:none"><div class="ingest-upload-progress__track"><div class="ingest-upload-progress__bar" style="width:0%"></div></div><span class="ingest-upload-progress__pct">0%</span></div></div></div><div id="sources-drag-overlay" class="sources-drag-overlay" style="display:none"><div class="sources-drag-overlay__content"><span>Drop to ingest</span></div></div>`
	const tabs = root.querySelectorAll('.sources-tab'); const filterInput = root.querySelector('#sources-filter'); const listEl = root.querySelector('#sources-list'); const mediaFooter = root.querySelector('.sources-media-footer'); const refreshBtn = root.querySelector('#sources-refresh-media'); const plusBtn = root.querySelector('#ingest-plus-btn'); const dropMenu = root.querySelector('.ingest-dropup-menu'); const fileBtn = root.querySelector('#ingest-menu-file'); const mkdirBtn = root.querySelector('#ingest-menu-mkdir'); const usbBtn = root.querySelector('#ingest-menu-usb'); const placeholderBtn = root.querySelector('#ingest-menu-placeholder'); const usbBadge = root.querySelector('.ingest-usb-badge'); const urlIn = root.querySelector('#ingest-url'); const urlBtn = root.querySelector('#ingest-url-btn'); const iStatus = root.querySelector('#ingest-status'); const iProgWrap = root.querySelector('.ingest-upload-progress'); const iBar = root.querySelector('.ingest-upload-progress__bar'); const iPct = root.querySelector('.ingest-upload-progress__pct'); const liveFooter = root.querySelector('.sources-live-footer'); const dragOverlay = root.querySelector('#sources-drag-overlay')
	root.querySelector('#sources-live-add-btn')?.addEventListener('click', () => showLiveInputModal(stateStore))

	const fetchMedia = async () => { try { const data = await api.get('/api/media'); mediaWithProbe = data.media || data; render() } catch { mediaWithProbe = null } }
	const refreshMedia = async () => { await api.post('/api/media/refresh').catch(() => {}); await fetchMedia(); setTimeout(fetchMedia, 400); setTimeout(fetchMedia, 1100) }
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
			const payload = await api.get('/api/device-view?pixelhue=0')
			const connectors = [
				...(Array.isArray(payload?.graph?.connectors) ? payload.graph.connectors : []),
				...(Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []),
			]
			const c = connectors.find((x) => String(x?.id || '') === connectorId) || null
			const slot = Math.max(1, (Number.isFinite(Number(c?.index)) ? Number(c.index) + 1 : parseInt(String(connectorId).replace(/^dli_/, ''), 10) || 1))
			const dev = Math.max(0, parseInt(String(c?.externalRef ?? 0), 10) || 0)
			const cm = stateStore.getState()?.channelMap || {}
			const inputsCh = cm.inputsCh
			if (!Number.isFinite(Number(inputsCh)) || Number(inputsCh) <= 0) {
				setStatus(`Mapped ${connectorId} to input. Configure DeckLink inputs host channel to start live route.`, 'ok')
				return
			}
			const cl = `${inputsCh}-${slot}`
			await api.post('/api/raw', { cmd: `STOP ${cl}` }).catch(() => {})
			await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }).catch(() => {})
			await api.post('/api/raw', { cmd: `PLAY ${cl} DECKLINK ${dev}` })
			const routeVal = `route://${cl}`
			const item = {
				type: 'route',
				routeType: 'decklink',
				value: routeVal,
				label: `decklink ${slot}`,
				decklinkSlot: slot,
				inputsChannel: Number(inputsCh),
				connectorId,
				decklinkDevice: dev,
			}
			await api.post('/api/device-view', { addExtraLiveSource: item })
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

	function render() {
		const s = stateStore.getState(); listEl.classList.remove('sources-media-list'); if (liveFooter) liveFooter.style.display = currentTab === 'live' ? 'flex' : 'none'
		if (currentTab === 'media') {
			listEl.classList.add('sources-media-list')
			renderMediaBrowser(listEl, mergeMediaProbeOverlay(s.media || [], mediaWithProbe), filter, refreshMedia, {
				collapsedFolders,
				selected: selectedMedia,
				onToggleFolder: (path) => { if (collapsedFolders.has(path)) collapsedFolders.delete(path); else collapsedFolders.add(path); render() },
				onToggleSelect: (id, isShift) => {
					if (selectedMedia.has(id)) {
						selectedMedia.delete(id)
					} else {
						selectedMedia.add(id)
					}
					render()
				},
				onMoveItem: async (sourceId, targetId) => { try { setStatus(`Moving to ${targetId}…`, 'info'); await api.post('/api/media/move', { sourceId, targetId }); setStatus('Moved successfully', 'ok'); refreshMedia() } catch (e) { setStatus(e.message, 'error') } }
			})
			mediaFooter.style.display = 'flex'; startUsb()
		}
		else if (currentTab === 'templates') { renderTemplatesBrowser(listEl, s.templates || [], filter); mediaFooter.style.display = 'flex'; startUsb() }
		else if (currentTab === 'placeholders') { renderPlaceholdersBrowser(listEl, window.placeholderState?.getAll() || [], filter); mediaFooter.style.display = 'flex'; stopUsb() }
		else if (currentTab === 'effects') { stopUsb(); renderEffectsTab(listEl, filter); mediaFooter.style.display = 'none' }
		else if (currentTab === 'live') { stopUsb(); renderLiveTab(listEl, { channelMap: s.channelMap || {}, decklinkInputsStatus: s.decklinkInputsStatus, extraSources: s.extraLiveSources || [], connectors: s.connectors || [] }); mediaFooter.style.display = 'none' }
		else if (currentTab === 'mapping') { stopUsb(); renderMappingBrowser(listEl, stateStore); mediaFooter.style.display = 'none' }
		else { stopUsb(); renderSourceList(listEl, (timelineState.getAll() || s.timelines || []).map(t => ({ id: t.id || t.name, label: t.name || t.id })), 'timeline', filter, null); mediaFooter.style.display = 'none' }
		root.querySelector('.sources-search').style.display = (['live', 'mapping'].includes(currentTab) ? 'none' : 'block')
	}

	window.addEventListener('highascg-mapping-browser-visibility', (ev) => {
		const mappingTabBtn = root.querySelector('[data-src-tab="mapping"]')
		if (!mappingTabBtn) return
		const visible = !!ev.detail?.visible
		mappingTabBtn.style.display = visible ? '' : 'none'
		if (visible && ev.detail?.activate) activateTab('mapping')
		else if (!visible && currentTab === 'mapping') activateTab('media')
	})

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
	const refreshUsb = async () => { try { const r = await api.get('/api/usb/drives'); const n = r.drives?.length || 0; usbBadge.textContent = n || ''; usbBadge.style.display = n ? 'inline-flex' : 'none'; usbBtn.classList.toggle('pending', !n) } catch { usbBadge.style.display = 'none'; usbBtn.classList.add('pending') } }
	const startUsb = () => { if (!usbBadgeTimer) { refreshUsb(); usbBadgeTimer = setInterval(refreshUsb, 5000) } }; const stopUsb = () => { if (usbBadgeTimer) { clearInterval(usbBadgeTimer); usbBadgeTimer = null } }
	if (wsClient?.on) { wsClient.on('usb:attached', refreshUsb); wsClient.on('usb:detached', refreshUsb) }
	usbBtn.onclick = () => { dropMenu.style.display = 'none'; showUsbImportModal({ wsClient, onImported: refreshMedia }) }
	const upload = (fs) => Ingest.uploadFiles(fs, { setStatus, showProgress: (v) => iProgWrap.style.display = v ? 'flex' : 'none', updateProgress: (p) => { iBar.style.width = `${p}%`; iPct.textContent = `${p}%` }, refreshCallback: refreshMedia })
	root.ondragenter = (e) => { e.preventDefault(); dragOverlay.style.display = 'flex' }; root.ondragover = e => e.preventDefault(); root.ondragleave = () => dragOverlay.style.display = 'none'; root.ondrop = e => { e.preventDefault(); dragOverlay.style.display = 'none'; if (currentTab !== 'media') tabs[0].click(); upload(e.dataTransfer?.files) }
	plusBtn.onclick = e => { e.stopPropagation(); dropMenu.style.display = dropMenu.style.display === 'flex' ? 'none' : 'flex' }
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

	stateStore.on('*', p => { if (!p || p === '*' || !['timeline.tick', 'timeline.playback', 'variables'].includes(p)) render() })
	timelineState.on('change', render); render(); if (['media', 'templates'].includes(currentTab)) refreshMedia()
}
