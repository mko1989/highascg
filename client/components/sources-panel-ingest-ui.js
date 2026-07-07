/**
 * Sources panel — ingest dropup, replication sync UI, USB badge, offline placeholders.
 */

import { api } from '../lib/api-client.js'
import { getDefaultUploadSubdir } from '../lib/project-media-context.js'
import {
	initReplicationMediaSpread,
	onReplicationMediaSyncUiChange,
	getReplicationMediaSyncUiState,
	runReplicationMediaPush,
	runReplicationMediaPull,
} from '../lib/replication-media-spread.js'
import * as Ingest from './sources-panel-ingest-logic.js'
import { showUsbImportModal } from './usb-import-modal.js'
import { showPlaceholderModal } from './placeholder-modal.js'

/**
 * @param {object} ctx
 */
export function bindSourcesPanelIngestUi(ctx) {
	const {
		root,
		stateStore,
		wsClient,
		tabs,
		dragOverlay,
		plusBtn,
		dropMenu,
		fileBtn,
		mkdirBtn,
		usbBtn,
		placeholderBtn,
		usbBadge,
		urlIn,
		urlBtn,
		iStatus,
		iProgWrap,
		iBar,
		iPct,
		spreadProgWrap,
		spreadBar,
		spreadPct,
		replMediaBtn,
		getCurrentTab,
		activateTab,
		render,
		refreshMedia,
	} = ctx

	const setStatus = (m, t) => {
		iStatus.textContent = m
		iStatus.className = `ingest-status ingest-status--${t}`
		if (t === 'ok') {
			setTimeout(() => {
				iStatus.textContent = ''
				iStatus.className = 'ingest-status'
			}, 4000)
		}
	}

	const updateReplMediaSyncUi = () => {
		if (!replMediaBtn) return
		const ui = getReplicationMediaSyncUiState()
		if (ui.showSpread) {
			replMediaBtn.style.display = ''
			replMediaBtn.textContent = ui.syncing ? '…' : '⤴'
			replMediaBtn.title = 'Spread new project media to backup'
			replMediaBtn.setAttribute('aria-label', 'Spread project media to backup')
			replMediaBtn.classList.toggle('sources-repl-media-btn--highlight', !ui.syncing)
		} else if (ui.showPull) {
			replMediaBtn.style.display = ''
			replMediaBtn.textContent = ui.syncing ? '…' : '⬇'
			replMediaBtn.title = 'Download project media from leader'
			replMediaBtn.setAttribute('aria-label', 'Download project media from leader')
			replMediaBtn.classList.remove('sources-repl-media-btn--highlight')
		} else {
			replMediaBtn.style.display = 'none'
			replMediaBtn.title = ''
		}
		replMediaBtn.disabled = ui.syncing
		replMediaBtn.classList.toggle('sources-repl-media-btn--syncing', ui.syncing)

		if (spreadProgWrap && spreadBar && spreadPct) {
			if (ui.syncing && ui.syncProgress) {
				spreadProgWrap.style.display = 'flex'
				spreadBar.style.width = `${ui.syncProgress.percent}%`
				spreadPct.textContent = `${ui.syncProgress.percent}%`
				if (iProgWrap) iProgWrap.style.display = 'none'
				if (iStatus) {
					iStatus.textContent = ui.syncProgress.label
					iStatus.className = 'ingest-status ingest-status--spread'
				}
			} else {
				spreadProgWrap.style.display = 'none'
				spreadBar.style.width = '0%'
				spreadPct.textContent = '0%'
				if (iStatus?.classList.contains('ingest-status--spread')) {
					iStatus.textContent = ''
					iStatus.className = 'ingest-status'
				}
			}
		}
	}

	initReplicationMediaSpread()
	onReplicationMediaSyncUiChange(updateReplMediaSyncUi)
	updateReplMediaSyncUi()
	if (replMediaBtn) {
		replMediaBtn.onclick = async () => {
			const ui = getReplicationMediaSyncUiState()
			if (ui.syncing) return
			try {
				if (ui.showSpread) {
					await runReplicationMediaPush()
					await refreshMedia()
				} else if (ui.showPull) {
					await runReplicationMediaPull()
					await refreshMedia()
				}
			} catch {
				/* toast shown in helper */
			}
		}
	}

	const poller = Ingest.createDownloadPoller({ setStatus, refreshCallback: refreshMedia })

	let usbBadgeWatched = false
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
	usbBtn.onclick = () => {
		dropMenu.style.display = 'none'
		showUsbImportModal({ wsClient, onImported: refreshMedia })
	}

	const upload = (fs) =>
		Ingest.uploadFiles(fs, {
			setStatus,
			showProgress: (v) => {
				iProgWrap.style.display = v ? 'flex' : 'none'
			},
			updateProgress: (p) => {
				iBar.style.width = `${p}%`
				iPct.textContent = `${p}%`
			},
			refreshCallback: refreshMedia,
			uploadSubdir: getDefaultUploadSubdir(),
		})

	root.ondragenter = (e) => {
		e.preventDefault()
		dragOverlay.style.display = 'flex'
	}
	root.ondragover = (e) => e.preventDefault()
	root.ondragleave = () => {
		dragOverlay.style.display = 'none'
	}
	root.ondrop = (e) => {
		e.preventDefault()
		dragOverlay.style.display = 'none'
		if (getCurrentTab() !== 'media') tabs[0].click()
		upload(e.dataTransfer?.files)
	}
	plusBtn.onclick = (e) => {
		e.stopPropagation()
		const opening = dropMenu.style.display !== 'flex'
		dropMenu.style.display = opening ? 'flex' : 'none'
		if (opening) void refreshUsb()
	}
	document.onclick = (e) => {
		if (!plusBtn.contains(e.target)) dropMenu.style.display = 'none'
	}
	fileBtn.onclick = () => {
		dropMenu.style.display = 'none'
		const i = document.createElement('input')
		i.type = 'file'
		i.multiple = true
		i.onchange = () => upload(i.files)
		i.click()
	}
	mkdirBtn.onclick = async () => {
		dropMenu.style.display = 'none'
		const base = getDefaultUploadSubdir()
		const n = prompt(base ? `New folder under ${base}/:` : 'New folder name:')
		if (!n?.trim()) return
		const leaf = n.trim().replace(/^\/+|\/+$/g, '')
		const path = base ? `${base}/${leaf}` : leaf
		try {
			await api.post('/api/media/mkdir', { path })
			setStatus(`Folder "${path}" created`, 'ok')
			refreshMedia()
		} catch (e) {
			setStatus(e.message, 'error')
		}
	}
	placeholderBtn.onclick = () => {
		dropMenu.style.display = 'none'
		showPlaceholderModal({
			onAdded: () => {
				if (getCurrentTab() === 'placeholders') render()
			},
		})
	}
	urlBtn.onclick = async () => {
		const u = urlIn.value.trim()
		if (!u) return
		setStatus('Starting…', 'info')
		try {
			const subdir = getDefaultUploadSubdir()
			const body = subdir ? { url: u, path: subdir } : { url: u }
			if ((await api.post('/api/ingest/download', body)).ok) {
				urlIn.value = ''
				poller.start()
			}
		} catch (e) {
			setStatus(e.message, 'error')
		}
	}

	const updateOfflineUI = () => {
		const isOffline = stateStore.isOffline()
		const phTab = root.querySelector('[data-src-tab="placeholders"]')
		if (phTab) phTab.style.display = isOffline ? '' : 'none'
		if (placeholderBtn) placeholderBtn.style.display = isOffline ? 'block' : 'none'
		if (!isOffline && getCurrentTab() === 'placeholders') activateTab('media')
	}
	updateOfflineUI()
	stateStore.on('offline', updateOfflineUI)

	return { setStatus, watchUsbBadge, unwatchUsbBadge }
}
