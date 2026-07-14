/**
 * Sources panel — Media, Effects, Live sources, Timelines (orchestrator).
 */
import { timelineState } from '../lib/timeline-state.js'
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { showLiveInputModal } from './live-input-modal.js'
import { refreshLiveAudioConfigured } from '../lib/live-audio-state.js'
import { refreshV4l2Configured } from '../lib/v4l2-input-state.js'
import { refreshProjectMediaParity } from '../lib/replication-media-spread.js'
import { mountSourcesPanelShell } from './sources-panel-shell.js'
import { bindSourcesPanelIngestUi } from './sources-panel-ingest-ui.js'
import { createSourcesPanelRender } from './sources-panel-render.js'
import { createProjectMediaGather } from './sources-panel-project-gather.js'
import { createMediaSelection } from './sources-panel-media-selection.js'
import { attachDecklinkDropHandlers } from './sources-panel-decklink-drop.js'

export function initSourcesPanel(root, stateStore, opts = {}) {
	const liveConnectorsCache = { current: [] }
	const wsClient = opts.wsClient
	let currentTab = 'media'
	let filter = ''
	let mediaWithProbe = null
	let liveAudioConfiguredCache = null
	let v4l2ConfiguredCache = null
	const collapsedFolders = new Set()
	let filterProjectOnly = false
	const selectedMedia = new Set()
	const lastSelectedMediaId = { current: null }
	const visibleMediaOrder = { current: [] }

	const ui = mountSourcesPanelShell(root)
	const {
		tabs,
		filterInput,
		listEl,
		projectMediaBar,
		projectMediaPath,
		projectMediaFilter,
		gatherMediaBtn,
		mediaFooter,
		selectionBar,
		selectionCountEl,
		refreshBtn,
		replMediaBtn,
		copyBtn,
		moveBtn,
		deleteBtn,
		clearSelBtn,
		liveFooter,
		dragOverlay,
		liveAddBtn,
		liveRefreshBtn,
	} = ui

	const invalidateLiveTabRender = () => {
		if (listEl) listEl._lastRenderKey = null
	}

	const hooks = { render: () => {} }

	async function refreshLiveTabFromServer() {
		invalidateLiveTabRender()
		liveAudioConfiguredCache = await refreshLiveAudioConfigured(stateStore)
		v4l2ConfiguredCache = await refreshV4l2Configured(stateStore)
		try {
			const st = await api.get('/api/state')
			if (st && stateStore) {
				if (st.channelMap) stateStore.applyChange('channelMap', st.channelMap)
				if (st.decklinkInputsStatus !== undefined) {
					stateStore.applyChange('decklinkInputsStatus', st.decklinkInputsStatus)
				}
				if (st.liveAudioInputsStatus !== undefined) {
					stateStore.applyChange('liveAudioInputsStatus', st.liveAudioInputsStatus)
				}
				if (st.v4l2InputsStatus !== undefined) {
					stateStore.applyChange('v4l2InputsStatus', st.v4l2InputsStatus)
				}
				if (Array.isArray(st.extraLiveSources)) {
					stateStore.applyChange('extraLiveSources', st.extraLiveSources)
				}
				if (st.hostOperatorFullscreen !== undefined) {
					stateStore.applyChange('hostOperatorFullscreen', st.hostOperatorFullscreen)
				}
			}
		} catch (e) {
			console.warn('[Sources] Live tab state refresh failed:', e?.message || e)
		}
		try {
			const dv = await api.get('/api/device-view')
			liveConnectorsCache.current = [
				...(Array.isArray(dv?.graph?.connectors) ? dv.graph.connectors : []),
				...(Array.isArray(dv?.suggested?.connectors) ? dv.suggested.connectors : []),
			]
		} catch {
			liveConnectorsCache.current = []
		}
		if (currentTab === 'live') hooks.render()
	}

	const scheduleLiveTabRefresh = () => {
		if (currentTab === 'live') void refreshLiveTabFromServer()
		else invalidateLiveTabRender()
	}

	liveAddBtn?.addEventListener('click', () => showLiveInputModal(stateStore))
	liveRefreshBtn?.addEventListener('click', () => void refreshLiveTabFromServer())

	const applyMediaList = (list) => {
		if (!Array.isArray(list)) return
		mediaWithProbe = list
		stateStore?.applyChange?.('media', list)
		hooks.render()
		projectGather.scheduleGatherAvailabilityUpdate()
	}

	const fetchMedia = async () => {
		try {
			const data = await api.get('/api/media')
			applyMediaList(data.media || data)
		} catch {
			mediaWithProbe = null
		}
	}
	const fetchTemplates = async () => {
		try {
			const templates = await api.get('/api/templates')
			if (Array.isArray(templates) && stateStore) {
				stateStore.applyChange('templates', templates)
			}
		} catch {
			// ignore template fetch errors
		}
	}
	const loadMedia = () => void fetchMedia()
	const rescanMediaFromCaspar = async () => {
		await api.post('/api/media/refresh', { ensureHqThumbs: true }).catch(() => {})
		await fetchMedia()
		await fetchTemplates()
		await refreshProjectMediaParity()
	}
	const refreshMedia = rescanMediaFromCaspar

	const projectGather = createProjectMediaGather({
		getCurrentTab: () => currentTab,
		stateStore,
		getMediaWithProbe: () => mediaWithProbe,
		applyMediaList,
		refreshMedia,
		setStatus: (m, t) => ingest.setStatus(m, t),
		render: () => hooks.render(),
		projectMediaBar,
		projectMediaPath,
		projectMediaFilter,
		gatherMediaBtn,
		getFilterProjectOnly: () => filterProjectOnly,
		setFilterProjectOnly: (v) => {
			filterProjectOnly = v
		},
	})

	const ingest = bindSourcesPanelIngestUi({
		root,
		stateStore,
		wsClient,
		tabs,
		dragOverlay,
		plusBtn: ui.plusBtn,
		dropMenu: ui.dropMenu,
		fileBtn: ui.fileBtn,
		mkdirBtn: ui.mkdirBtn,
		usbBtn: ui.usbBtn,
		placeholderBtn: ui.placeholderBtn,
		usbBadge: ui.usbBadge,
		urlIn: ui.urlIn,
		urlBtn: ui.urlBtn,
		iStatus: ui.iStatus,
		iProgWrap: ui.iProgWrap,
		iBar: ui.iBar,
		iPct: ui.iPct,
		spreadProgWrap: ui.spreadProgWrap,
		spreadBar: ui.spreadBar,
		spreadPct: ui.spreadPct,
		replMediaBtn,
		getCurrentTab: () => currentTab,
		activateTab: (tab) => panelRender?.activateTab(tab),
		render: () => hooks.render(),
		refreshMedia,
	})

	const mediaSelection = createMediaSelection({
		stateStore,
		getMediaWithProbe: () => mediaWithProbe,
		selectedMedia,
		lastSelectedMediaId,
		visibleMediaOrder,
		selectionBar,
		selectionCountEl,
		setStatus: ingest.setStatus,
		refreshMedia,
		render: () => hooks.render(),
	})

	let panelRender
	panelRender = createSourcesPanelRender({
		root,
		stateStore,
		listEl,
		liveFooter,
		selectionBar,
		mediaFooter,
		filterInput,
		tabs,
		getCurrentTab: () => currentTab,
		setCurrentTab: (t) => {
			currentTab = t
		},
		getFilter: () => filter,
		setFilter: (f) => {
			filter = f
		},
		getFilterProjectOnly: () => filterProjectOnly,
		getMediaWithProbe: () => mediaWithProbe,
		collapsedFolders,
		selectedMedia,
		visibleMediaOrder,
		liveConnectorsCache,
		getLiveAudioConfiguredCache: () => liveAudioConfiguredCache,
		setLiveAudioConfiguredCache: (v) => {
			liveAudioConfiguredCache = v
		},
		getV4l2ConfiguredCache: () => v4l2ConfiguredCache,
		setV4l2ConfiguredCache: (v) => {
			v4l2ConfiguredCache = v
		},
		refreshProjectMediaBar: projectGather.refreshProjectMediaBar,
		refreshMedia,
		setStatus: ingest.setStatus,
		toggleMediaSelection: mediaSelection.toggleMediaSelection,
		updateSelectionBar: mediaSelection.updateSelectionBar,
		loadMedia,
		watchUsbBadge: ingest.watchUsbBadge,
		unwatchUsbBadge: ingest.unwatchUsbBadge,
		refreshLiveTabFromServer,
	})

	hooks.render = panelRender.render
	const render = panelRender.render
	const activateTab = panelRender.activateTab

	attachDecklinkDropHandlers(listEl, { stateStore, setStatus: ingest.setStatus, activateTab })
	projectGather.bindProjectMediaFilter()
	if (gatherMediaBtn) gatherMediaBtn.addEventListener('click', () => void projectGather.runGatherProjectMedia())

	window.addEventListener('project-loaded', () => {
		void projectGather.refreshProjectMediaBar().then(() => {
			scheduleLiveTabRefresh()
			if (currentTab !== 'live') render()
		})
	})
	document.addEventListener('highascg-settings-applied', () => {
		void projectGather.refreshProjectMediaBar().then(() => {
			scheduleLiveTabRefresh()
			if (currentTab !== 'live') render()
		})
	})
	document.addEventListener('highascg-device-view-reload', scheduleLiveTabRefresh)
	window.addEventListener('highascg-caspar-restart-dirty', () => {
		void settingsState.load().then(() => scheduleLiveTabRefresh())
	})
	document.addEventListener('highascg-live-audio-configured', () => {
		if (currentTab === 'live') render()
	})
	document.addEventListener('highascg-v4l2-configured', () => {
		if (currentTab === 'live') render()
	})

	tabs.forEach((t) => {
		t.onclick = () => activateTab(t.dataset.srcTab)
	})
	filterInput?.addEventListener('input', () => {
		filter = filterInput.value.trim()
		render()
	})
	if (refreshBtn) refreshBtn.onclick = rescanMediaFromCaspar
	if (copyBtn) copyBtn.onclick = () => void mediaSelection.runMediaTransfer('copy')
	if (moveBtn) moveBtn.onclick = () => void mediaSelection.runMediaTransfer('move')
	if (deleteBtn) deleteBtn.onclick = () => void mediaSelection.runMediaDelete()
	if (clearSelBtn) {
		clearSelBtn.onclick = () => {
			selectedMedia.clear()
			lastSelectedMediaId.current = null
			render()
		}
	}
	root.addEventListener('keydown', (e) => {
		if (currentTab !== 'media' || selectedMedia.size === 0) return
		if (e.key !== 'Delete' && e.key !== 'Backspace') return
		const tag = String(e.target?.tagName || '').toLowerCase()
		if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
		e.preventDefault()
		void mediaSelection.runMediaDelete()
	})

	let renderTimer = null
	const debouncedRender = () => {
		if (renderTimer) return
		renderTimer = requestAnimationFrame(() => {
			render()
			renderTimer = null
		})
	}

	stateStore.on('channelMap', invalidateLiveTabRender)
	stateStore.on('extraLiveSources', invalidateLiveTabRender)
	stateStore.on('decklinkInputsStatus', invalidateLiveTabRender)
	stateStore.on('liveAudioInputsStatus', invalidateLiveTabRender)
	stateStore.on('*', (p) => {
		if (
			!p ||
			p === '*' ||
			!['timeline.tick', 'timeline.playback', 'variables', 'channels', 'logs', 'dmx:colors'].includes(p)
		) {
			debouncedRender()
		}
	})
	timelineState.on('change', debouncedRender)
	void projectGather.refreshProjectMediaBar()
	render()
	if (['media', 'templates'].includes(currentTab)) loadMedia()
}
