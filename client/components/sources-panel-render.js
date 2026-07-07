/**
 * Sources panel — tab render orchestration.
 */

import { timelineState } from '../lib/timeline-state.js'
import { mergeMediaProbeOverlay, renderSourceList } from './sources-panel-helpers.js'
import { renderMediaBrowser } from './sources-panel-media.js'
import { renderTemplatesBrowser } from './sources-panel-templates.js'
import { renderEffectsTab } from './sources-panel-effects.js'
import { renderPlaceholdersBrowser } from './sources-panel-placeholders.js'
import { renderLiveTab } from './sources-panel-live-render.js'
import { filterMediaForActiveProject } from '../lib/project-media-context.js'
import { refreshLiveAudioConfigured } from '../lib/live-audio-state.js'
import { refreshV4l2Configured } from '../lib/v4l2-input-state.js'
import { settingsState } from '../lib/settings-state.js'
import { effectiveChannelMap } from '../lib/planned-channel-map.js'
import { copyMediaFiles, formatMediaOpResult, moveMediaFiles } from '../lib/media-file-ops.js'

/**
 * @param {object} ctx
 */
export function createSourcesPanelRender(ctx) {
	const {
		root,
		stateStore,
		listEl,
		liveFooter,
		selectionBar,
		mediaFooter,
		filterInput,
		tabs,
		getCurrentTab,
		setCurrentTab,
		getFilter,
		setFilter,
		getFilterProjectOnly,
		getMediaWithProbe,
		collapsedFolders,
		selectedMedia,
		visibleMediaOrder,
		liveConnectorsCache,
		getLiveAudioConfiguredCache,
		setLiveAudioConfiguredCache,
		getV4l2ConfiguredCache,
		setV4l2ConfiguredCache,
		refreshProjectMediaBar,
		refreshMedia,
		setStatus,
		toggleMediaSelection,
		updateSelectionBar,
		loadMedia,
		watchUsbBadge,
		unwatchUsbBadge,
	} = ctx

	async function fetchLiveAudioConfigured() {
		const cfg = await refreshLiveAudioConfigured(stateStore)
		setLiveAudioConfiguredCache(cfg)
		return cfg
	}

	async function fetchV4l2Configured() {
		const cfg = await refreshV4l2Configured(stateStore)
		setV4l2ConfiguredCache(cfg)
		return cfg
	}

	function render() {
		const s = stateStore.getState()
		const currentTab = getCurrentTab()
		listEl.classList.remove('sources-media-list')
		if (liveFooter) liveFooter.style.display = currentTab === 'live' ? 'flex' : 'none'
		if (selectionBar) selectionBar.style.display = 'none'
		if (currentTab === 'media') {
			listEl.classList.add('sources-media-list')
			listEl.tabIndex = 0
			void refreshProjectMediaBar()
			let mediaList = mergeMediaProbeOverlay(s.media || [], getMediaWithProbe())
			if (getFilterProjectOnly()) mediaList = filterMediaForActiveProject(mediaList)
			renderMediaBrowser(listEl, mediaList, getFilter(), refreshMedia, {
				collapsedFolders,
				selected: selectedMedia,
				onVisibleFileOrder: (ids) => {
					visibleMediaOrder.current = ids
				},
				onToggleFolder: (path) => {
					if (collapsedFolders.has(path)) collapsedFolders.delete(path)
					else collapsedFolders.add(path)
					render()
				},
				onToggleSelect: (id, modifiers) => toggleMediaSelection(id, modifiers),
				onMoveItem: async (sourceId, targetId) => {
					setStatus('Moving…', 'info')
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
					setStatus('Copying…', 'info')
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
			mediaFooter.style.display = 'flex'
			watchUsbBadge()
			updateSelectionBar()
		} else if (currentTab === 'templates') {
			renderTemplatesBrowser(listEl, s.templates || [], getFilter())
			mediaFooter.style.display = 'flex'
			watchUsbBadge()
		} else if (currentTab === 'placeholders') {
			renderPlaceholdersBrowser(listEl, window.placeholderState?.getAll() || [], getFilter())
			mediaFooter.style.display = 'flex'
			unwatchUsbBadge()
		} else if (currentTab === 'effects') {
			unwatchUsbBadge()
			renderEffectsTab(listEl, getFilter())
			mediaFooter.style.display = 'none'
		} else if (currentTab === 'live') {
			unwatchUsbBadge()
			const liveCfg = s.liveAudioConfigured || getLiveAudioConfiguredCache()
			const v4l2Cfg = s.v4l2Configured || getV4l2ConfiguredCache?.()
			if (!liveCfg || !v4l2Cfg) {
				void Promise.all([
					!liveCfg ? fetchLiveAudioConfigured() : Promise.resolve(),
					!v4l2Cfg ? fetchV4l2Configured() : Promise.resolve(),
				]).then(() => render())
			}
			renderLiveTab(listEl, {
				channelMap: effectiveChannelMap({
					settings: settingsState.getSettings(),
					liveChannelMap: s.channelMap,
				}),
				decklinkInputsStatus: s.decklinkInputsStatus,
				liveAudioInputsStatus: s.liveAudioInputsStatus,
				v4l2InputsStatus: s.v4l2InputsStatus,
				liveAudioConfigured: liveCfg,
				v4l2Configured: v4l2Cfg,
				extraSources: s.extraLiveSources || [],
				connectors: liveConnectorsCache.current.length ? liveConnectorsCache.current : s.connectors || [],
				hostOperatorFullscreen: s.hostOperatorFullscreen || null,
			})
			mediaFooter.style.display = 'none'
		} else {
			unwatchUsbBadge()
			renderSourceList(
				listEl,
				(timelineState.getAll() || s.timelines || []).map((t) => ({ id: t.id || t.name, label: t.name || t.id })),
				'timeline',
				getFilter(),
				null,
			)
			mediaFooter.style.display = 'none'
		}
		root.querySelector('.sources-search').style.display = ['live'].includes(currentTab) ? 'none' : 'block'
	}

	function activateTab(tabName) {
		setCurrentTab(tabName)
		tabs.forEach((x) => x.classList.toggle('active', x.dataset.srcTab === tabName))
		if (filterInput) filterInput.value = ''
		setFilter('')
		if (tabName === 'live') {
			ctx.refreshLiveTabFromServer()
			return
		}
		if (['media', 'templates'].includes(tabName)) loadMedia()
		render()
	}

	return { render, activateTab }
}
