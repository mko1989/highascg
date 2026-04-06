/**
 * Dashboard — column/layer grid inspired by Millumin.
 * Drag sources onto cells, activate columns to send to program channel.
 * Click a cell to cue its clip on PRV (preview). Activate a column to take to PGM.
 * @see main_plan.md Prompt 13, Prompt 18
 */

import {
	dashboardState,
	DEFAULT_TRANSITION,
	TRANSITION_TYPES,
	TRANSITION_TWEENS,
	dashboardCasparLayer,
} from '../lib/dashboard-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { api, getApiBase } from '../lib/api-client.js'
import { calcMixerFill } from '../lib/mixer-fill.js'
import { initPreviewPanel, drawDashboardProgramStack } from './preview-canvas.js'
import { createDashboardCell, escapeHtml, truncate } from './dashboard-cell.js'
import { getVariableStore } from '../lib/variable-state.js'
import { ws } from '../app.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { parseNumberInput } from '../lib/math-input.js'

const LAYER_COUNT = 9
/** Ad-hoc cell preview on PRV — above dashboard rows (10–18) and black (9). */
const PRV_PREVIEW_LAYER = 19

/**
 * @param {HTMLElement} root - Dashboard container (tab-dashboard)
 * @param {object} stateStore - Module state (for channelMap)
 */
export function initDashboard(root, stateStore) {
	function getChannelMap() {
		return stateStore.getState()?.channelMap || {}
	}

	function getScreenCount() {
		return Math.max(1, getChannelMap().screenCount ?? 1)
	}

	function getProgramChannel() {
		const s = dashboardState.activeScreenIndex
		const ch = getChannelMap().programChannels?.[s]
		return ch != null ? ch : 1
	}

	function getPreviewChannel() {
		const s = dashboardState.activeScreenIndex
		const ch = getChannelMap().previewChannels?.[s]
		return ch != null ? ch : 2
	}

	function getResolution() {
		const s = dashboardState.activeScreenIndex
		const res = getChannelMap().programResolutions?.[s]
		return res || { w: 1920, h: 1080 }
	}

	/** Play a clip on the PRV channel for quick preview (dedicated layer above dashboard stack). */
	async function cuePreview(src) {
		if (!src?.value) return
		const previewCh = getPreviewChannel()
		try {
			await api.post('/api/stop', { channel: previewCh, layer: PRV_PREVIEW_LAYER })
			await api.post('/api/play', { channel: previewCh, layer: PRV_PREVIEW_LAYER, clip: src.value })
		} catch (e) {
			console.warn('Preview cue failed:', e?.message || e)
		}
	}

	/** Clear PRV preview layer — called when user deselects or clicks elsewhere. */
	async function clearPreview() {
		const previewCh = getPreviewChannel()
		try {
			await api.post('/api/stop', { channel: previewCh, layer: PRV_PREVIEW_LAYER })
		} catch {
			// Ignore
		}
	}

	async function activateColumn(colIdx) {
		const programCh = getProgramChannel()
		const previewCh = getPreviewChannel()
		const res = getResolution()

		// Capture which column was previously active (for same-clip detection)
		const prevActiveIdx = dashboardState.getActiveColumnIndex()
		dashboardState.setActiveColumnIndex(colIdx)

		const column = dashboardState.getColumn(colIdx)
		if (!column) return

		const prevColumn = prevActiveIdx >= 0 ? dashboardState.getColumn(prevActiveIdx) : null

		// Stop any timeline that was running from the previous column if the new column doesn't share it
		if (prevColumn) {
			const prevTimelineIds = (prevColumn.layers || [])
				.filter((l) => l?.source?.type === 'timeline' && l?.source?.value)
				.map((l) => l.source.value)
			const newTimelineIds = new Set(
				(column.layers || [])
					.filter((l) => l?.source?.type === 'timeline' && l?.source?.value)
					.map((l) => l.source.value)
			)
			for (const tid of prevTimelineIds) {
				if (!newTimelineIds.has(tid)) {
					try { await api.post(`/api/timelines/${tid}/stop`) } catch {}
				}
			}
		}

		let primaryTimelineId = null

		for (let layerIdx = 0; layerIdx < LAYER_COUNT; layerIdx++) {
			const layer = column.layers?.[layerIdx]
			const hasContent = !!layer?.source?.value
			const casparLayer = dashboardCasparLayer(layerIdx)
			const ls = dashboardState.getLayerSetting(layerIdx)

			if (hasContent) {
				const src = layer.source

				// If same clip is already playing on this layer (column switch, same content) → apply mixer only
				const prevLayer = prevColumn?.layers?.[layerIdx]
				const sameClip = prevLayer?.source?.value === src.value && prevActiveIdx !== colIdx

				const trans = dashboardState.getTransitionForLayer(colIdx, layerIdx)
				const hasTransition = trans.type !== 'CUT' && trans.duration > 0

				try {
					if (!sameClip) {
						if (src.type === 'timeline') {
							primaryTimelineId = primaryTimelineId || src.value
						} else if (hasTransition) {
							// Prompt 27: LOADBG + PLAY for seamless MIX — avoids black flash.
							// Load to BG with transition, then PLAY to trigger swap from current FG.
							await api.post('/api/loadbg', {
								channel: programCh,
								layer: casparLayer,
								clip: src.value,
								transition: trans.type,
								duration: trans.duration,
								tween: trans.tween || 'linear',
								loop: !!layer.overrides?.loop,
								audioRoute: ls.audioRoute || '1+2',
							})
							await api.post('/api/play', { channel: programCh, layer: casparLayer, audioRoute: ls.audioRoute || '1+2' })
						} else {
							// CUT: direct PLAY
							await api.post('/api/play', {
								channel: programCh,
								layer: casparLayer,
								clip: src.value,
								loop: !!layer.overrides?.loop,
								audioRoute: ls.audioRoute || '1+2',
							})
						}
					}
					const fill = calcMixerFill(ls, res, null)
					await api.post('/api/mixer/fill', {
						channel: programCh, layer: casparLayer, ...fill,
						stretch: ls.stretch || 'none',
						layerX: ls.x ?? 0, layerY: ls.y ?? 0,
						layerW: ls.w ?? res.w, layerH: ls.h ?? res.h,
						channelW: res.w, channelH: res.h,
					})
					await api.post('/api/mixer/opacity', { channel: programCh, layer: casparLayer, opacity: ls.opacity ?? 1 })
					await api.post('/api/audio/volume', { channel: programCh, layer: casparLayer, volume: ls.volume ?? 1 })
					await api.post('/api/mixer/blend', { channel: programCh, layer: casparLayer, mode: ls.blend ?? 'normal' })
				} catch (e) {
					showToast('Layer ' + (layerIdx + 1) + ': ' + (e?.message || String(e)), 'error')
				}
			} else {
				// Empty layer: stop whatever was playing and clear the mixer state
				try {
					await api.post('/api/stop', { channel: programCh, layer: casparLayer })
					await api.post('/api/mixer/clear', { channel: programCh, layer: casparLayer })
				} catch {
					// Ignore stop/clear errors on empty layers
				}
			}
		}

		if (primaryTimelineId) {
			const tl = timelineState.getTimeline(primaryTimelineId)
			if (tl) {
				const tlLayer = column.layers?.find((l) => l?.source?.type === 'timeline' && l?.source?.value === primaryTimelineId)
				const shouldLoop = !!tlLayer?.overrides?.loop
				try {
					await api.post('/api/timelines', tl)
					await api.post(`/api/timelines/${primaryTimelineId}/sendto`, {
						preview: true,
						program: true,
						screenIdx: dashboardState.activeScreenIndex,
					})
					await api.post(`/api/timelines/${primaryTimelineId}/loop`, { loop: shouldLoop })
					await api.post(`/api/timelines/${primaryTimelineId}/play`, { from: 0 })
				} catch (e) {
					console.error('Timeline play error:', e)
				}
			}
		}

		try {
			await api.post('/api/mixer/commit', { channel: programCh })
		} catch (e) {
			showToast('Mixer commit: ' + (e?.message || String(e)), 'error')
		}

		// PRV is independent — column activation does NOT send to PRV

		render()
	}

	root.innerHTML = ''
	const previewHost = document.createElement('div')
	previewHost.className = 'preview-host'
	const mainHost = document.createElement('div')
	mainHost.className = 'dashboard-main'
	root.appendChild(previewHost)
	root.appendChild(mainHost)

	const previewPanel = initPreviewPanel(previewHost, {
		title: 'Program stack',
		storageKeyPrefix: 'casparcg_preview_dashboard',
		getOutputResolution: getResolution,
		stateStore,
		streamName: 'pgm_1',
		draw(ctx, W, H, isLive) {
			drawDashboardProgramStack(ctx, W, H, {
				dashboardState,
				layerCount: LAYER_COUNT,
				isLive,
				getThumbUrl: (src) =>
					src?.type === 'media' && src?.value
						? `${getApiBase()}/api/thumbnail/${encodeURIComponent(src.value)}`
						: null,
				onThumbLoaded: () => previewPanel.scheduleDraw(),
			})
		},
	})

	function render() {
		const columns = dashboardState.getColumns()
		const active = dashboardState.getActiveColumnIndex()
		const screenCount = getScreenCount()
		const activeScreen = dashboardState.activeScreenIndex

		// Build screen tabs HTML
		let screenTabsHtml = ''
		if (screenCount > 1) {
			const tabs = Array.from({ length: screenCount }, (_, i) =>
				`<button class="dashboard-screen-tab ${i === activeScreen ? 'active' : ''}" data-screen="${i}">Screen ${i + 1}</button>`
			).join('')
			screenTabsHtml = `<div class="dashboard-screen-tabs">${tabs}</div>`
		}

		mainHost.innerHTML = `
			${screenTabsHtml}
			<div class="dashboard-toolbar">
				<button class="dashboard-btn" id="dashboard-add-col" title="Add column">+ Column</button>
				<button class="dashboard-btn" id="dashboard-remove-col" title="Remove last column">− Column</button>
				<span class="dashboard-screen-label">${screenCount > 1 ? `PGM ch ${getProgramChannel()} / PRV ch ${getPreviewChannel()}` : ''}</span>
			</div>
			<div class="dashboard-grid" id="dashboard-grid"></div>
		`

		// Screen tabs events
		mainHost.querySelectorAll('.dashboard-screen-tab').forEach((btn) => {
			btn.addEventListener('click', () => {
				const idx = parseInt(btn.dataset.screen, 10)
				dashboardState.switchScreen(idx)
				render()
			})
		})

		const grid = mainHost.querySelector('#dashboard-grid')
		mainHost.querySelector('#dashboard-add-col').addEventListener('click', () => {
			dashboardState.addColumn()
			render()
		})
		mainHost.querySelector('#dashboard-remove-col').addEventListener('click', () => {
			if (dashboardState.getColumns().length > 1) {
				dashboardState.removeColumn(dashboardState.getColumns().length - 1)
				render()
			}
		})

		// Header row: column indices + transition settings
		const headerRow = document.createElement('div')
		headerRow.className = 'dashboard-row dashboard-header'
		const layerLabel = document.createElement('div')
		layerLabel.className = 'dashboard-cell dashboard-layer-label'
		layerLabel.textContent = 'Layers'
		headerRow.appendChild(layerLabel)
		columns.forEach((col, colIdx) => {
			const cell = document.createElement('div')
			cell.className = `dashboard-cell dashboard-col-header ${colIdx === active ? 'active' : ''}`
			const trans = col.transition || { ...DEFAULT_TRANSITION }
			const colName = dashboardState.getColumnName(colIdx)
			cell.innerHTML = `
				<span class="dashboard-col-number" title="Click to activate">${escapeHtml(truncate(colName, 8))}</span>
				<button type="button" class="dashboard-col-settings" title="Column settings" aria-label="Settings">⚙</button>
				<div class="dashboard-col-popover" id="popover-col-${colIdx}" hidden>
					<div class="dashboard-popover-title">Column ${colIdx + 1}</div>
					<div class="dashboard-popover-row">
						<label>Name</label>
						<input type="text" data-field="name" value="${escapeHtml(colName)}" placeholder="Column ${colIdx + 1}" />
					</div>
					<div class="dashboard-popover-row">
						<label>Transition type</label>
						<select data-field="type">
							${TRANSITION_TYPES.map((t) => `<option value="${t}" ${t === trans.type ? 'selected' : ''}>${t}</option>`).join('')}
						</select>
					</div>
					<div class="dashboard-popover-row">
						<label>Duration (frames)</label>
						<input type="text" data-field="duration" class="inspector-math-input" inputmode="decimal" value="${trans.duration ?? 0}" />
					</div>
					<div class="dashboard-popover-row">
						<label>Tween</label>
						<select data-field="tween">
							${TRANSITION_TWEENS.map((tw) => `<option value="${tw}" ${(trans.tween || 'linear') === tw ? 'selected' : ''}>${tw}</option>`).join('')}
						</select>
					</div>
				</div>
			`
			cell.addEventListener('click', (e) => {
				if (!e.target.closest('.dashboard-col-settings') && !e.target.closest('.dashboard-col-popover')) {
					activateColumn(colIdx)
				}
			})
			const settingsBtn = cell.querySelector('.dashboard-col-settings')
			const popover = cell.querySelector('.dashboard-col-popover')
			settingsBtn.addEventListener('click', (e) => {
				e.stopPropagation()
				const isHidden = popover.hidden
				mainHost.querySelectorAll('.dashboard-col-popover').forEach((p) => { p.hidden = true })
				popover.hidden = !isHidden
			})
			popover.querySelector('[data-field="name"]')?.addEventListener('change', (e) => {
				dashboardState.setColumnName(colIdx, e.target.value)
				render()
			})
			popover.querySelector('[data-field="type"]').addEventListener('change', (e) => {
				dashboardState.setColumnTransition(colIdx, { type: e.target.value })
			})
			popover.querySelector('[data-field="duration"]').addEventListener('change', (e) => {
				const v = parseNumberInput(e.target.value, 0)
				dashboardState.setColumnTransition(colIdx, { duration: Math.max(0, Math.round(v)) })
			})
			popover.querySelector('[data-field="tween"]').addEventListener('change', (e) => {
				dashboardState.setColumnTransition(colIdx, { tween: e.target.value })
			})
			headerRow.appendChild(cell)
		})
		// Close column-transition popovers when clicking outside
		grid.addEventListener('click', (e) => {
			if (!e.target.closest('.dashboard-col-settings') && !e.target.closest('.dashboard-col-popover')) {
				mainHost.querySelectorAll('.dashboard-col-popover').forEach((p) => { p.hidden = true })
			}
		})
		grid.appendChild(headerRow)

		// Layer rows
		for (let layerIdx = 0; layerIdx < LAYER_COUNT; layerIdx++) {
			const row = document.createElement('div')
			row.className = 'dashboard-row'
			const layerLabel = document.createElement('div')
			layerLabel.className = 'dashboard-cell dashboard-layer-label'
			const layerName = dashboardState.getLayerName(layerIdx)
			layerLabel.innerHTML = `
				<span class="dashboard-layer-name" title="${escapeHtml(layerName)}">${escapeHtml(truncate(layerName, 14))}</span>
			`
			layerLabel.addEventListener('click', (e) => {
				e.stopPropagation()
				mainHost.querySelectorAll('.dashboard-cell').forEach((c) => c.classList.remove('selected'))
				layerLabel.classList.add('selected')
				window.dispatchEvent(new CustomEvent('dashboard-layer-select', { detail: { layerIdx } }))
			})
			row.appendChild(layerLabel)

			columns.forEach((col, colIdx) => {
				const cell = createDashboardCell({
					colIdx,
					layerIdx,
					mainHost,
					render,
					cuePreview,
					clearPreview,
				})
				row.appendChild(cell)
			})
			grid.appendChild(row)
		}

		previewPanel.scheduleDraw()
	}

	function showToast(msg, type = 'info') {
		let container = document.getElementById('dashboard-toast-container')
		if (!container) {
			container = document.createElement('div')
			container.id = 'dashboard-toast-container'
			container.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;'
			document.body.appendChild(container)
		}
		const toast = document.createElement('div')
		toast.style.cssText = `padding:10px 16px;border-radius:6px;font-size:13px;font-family:${UI_FONT_FAMILY};max-width:360px;word-break:break-all;box-shadow:0 2px 8px rgba(0,0,0,.4);background:${type === 'error' ? '#b91c1c' : '#1d4ed8'};color:#fff;`
		toast.textContent = msg
		container.appendChild(toast)
		setTimeout(() => toast.remove(), 5000)
	}

	dashboardState.on('change', render)
	document.addEventListener('dashboard-tab-activated', () => previewPanel.scheduleDraw())

	// T2: Real-time progress and clip name updates
	const vars = getVariableStore(ws)
	vars.subscribe((all) => {
		const colIdx = dashboardState.getActiveColumnIndex()
		if (colIdx < 0) return
		const ch = getProgramChannel()
		
		for (let layerIdx = 0; layerIdx < LAYER_COUNT; layerIdx++) {
			const ln = dashboardCasparLayer(layerIdx)
			const progress = all[`osc_ch${ch}_l${ln}_progress`] || ''
			const clip = all[`osc_ch${ch}_l${ln}_clip`] || ''
			
			// Target the cell in the active column
			const selector = `.dashboard-cell[data-col="${colIdx}"][data-layer="${layerIdx}"]`
			const cellEl = grid?.querySelector(selector)
			if (cellEl) {
				const bar = cellEl.querySelector('.dashboard-cell__progress-bar')
				const info = cellEl.querySelector('.dashboard-cell__live-info')
				if (bar) bar.style.width = progress ? `${progress}%` : '0%'
				if (info) info.textContent = clip || ''
			}
		}
	})

	// Click anywhere outside a dashboard cell with content → deselect and clear PRV
	// Only when dashboard tab is active — avoids clearing multiview selection when using that tab
	// Ignore clicks in inspector or sources panel — so user can set Loop etc. without deselection or PRV clear
	const onDocClick = (e) => {
		if (!document.getElementById('tab-dashboard')?.classList.contains('active')) return
		if (e.target.closest('.dashboard-cell-drop.has-source')) return
		if (e.target.closest('#panel-inspector') || e.target.closest('#panel-sources')) return
		const hadSelection = mainHost.querySelector('.dashboard-cell-drop.has-source.selected')
		mainHost.querySelectorAll('.dashboard-cell').forEach((c) => c.classList.remove('selected'))
		if (hadSelection) clearPreview()
		window.dispatchEvent(new CustomEvent('dashboard-select', { detail: null }))
	}
	document.addEventListener('click', onDocClick)

	render()
}
