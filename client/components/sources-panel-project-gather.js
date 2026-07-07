/**
 * Sources panel — project media bar and gather-into-folder workflow.
 */

import { projectState } from '../lib/project-state.js'
import { sceneState } from '../lib/scene-state.js'
import { timelineState } from '../lib/timeline-state.js'
import { multiviewState } from '../lib/multiview-state.js'
import { programOutputState } from '../lib/program-output-state.js'
import { settingsState } from '../lib/settings-state.js'
import { planGatherProjectMediaIntoFolder, executeGatherProjectMedia } from '../lib/project-media-gather.js'
import { mergeMediaProbeOverlay } from './sources-panel-helpers.js'
import {
	refreshProjectMediaContext,
	getDefaultUploadSubdir,
} from '../lib/project-media-context.js'

/**
 * @param {object} ctx
 * @param {() => string} ctx.getCurrentTab
 * @param {object} ctx.stateStore
 * @param {() => object|null} ctx.getMediaWithProbe
 * @param {(list: object[]) => void} ctx.applyMediaList
 * @param {() => Promise<void>} ctx.refreshMedia
 * @param {(msg: string, type: string) => void} ctx.setStatus
 * @param {() => void} ctx.render
 * @param {HTMLElement | null} ctx.projectMediaBar
 * @param {HTMLElement | null} ctx.projectMediaPath
 * @param {HTMLInputElement | null} ctx.projectMediaFilter
 * @param {HTMLButtonElement | null} ctx.gatherMediaBtn
 * @param {() => boolean} ctx.getFilterProjectOnly
 * @param {(v: boolean) => void} ctx.setFilterProjectOnly
 */
export function createProjectMediaGather(ctx) {
	let projectMediaCtx = refreshProjectMediaContext()
	let gatherAvailabilityTimer = null

	function computeGatherPendingCount() {
		const folder = getDefaultUploadSubdir()
		if (!folder) return 0
		try {
			const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
			const mediaList = mergeMediaProbeOverlay(ctx.stateStore.getState().media || [], ctx.getMediaWithProbe())
			const plan = planGatherProjectMediaIntoFolder({
				project,
				mediaList,
				projectFolder: folder,
				settings: settingsState.getSettings(),
			})
			return plan.pending
		} catch {
			return 0
		}
	}

	function updateGatherAvailability() {
		if (!ctx.gatherMediaBtn) return
		const pending = computeGatherPendingCount()
		ctx.gatherMediaBtn.style.display = pending > 0 ? '' : 'none'
		if (pending > 0) {
			ctx.gatherMediaBtn.textContent = `Gather (${pending})`
			ctx.gatherMediaBtn.title = `${pending} referenced clip(s) live outside the project folder — move them in`
		}
	}

	function scheduleGatherAvailabilityUpdate() {
		if (gatherAvailabilityTimer) clearTimeout(gatherAvailabilityTimer)
		gatherAvailabilityTimer = setTimeout(() => {
			gatherAvailabilityTimer = null
			updateGatherAvailability()
		}, 400)
	}

	async function refreshProjectMediaBar() {
		projectMediaCtx = await refreshProjectMediaContext()
		const { projectScopedEnabled, mediaFolder, activeSlug } = projectMediaCtx
		const show = ctx.getCurrentTab() === 'media' && projectScopedEnabled && !!activeSlug && !!mediaFolder
		if (ctx.projectMediaBar) ctx.projectMediaBar.style.display = show ? 'flex' : 'none'
		if (!show) return
		if (ctx.projectMediaPath) ctx.projectMediaPath.textContent = mediaFolder
		if (ctx.projectMediaFilter) ctx.projectMediaFilter.checked = ctx.getFilterProjectOnly()
		updateGatherAvailability()
	}

	async function runGatherProjectMedia() {
		const folder = getDefaultUploadSubdir()
		if (!folder) {
			ctx.setStatus('Project media folder is not configured', 'error')
			return
		}
		const project = projectState.exportProject(sceneState, timelineState, multiviewState, programOutputState)
		const mediaList = mergeMediaProbeOverlay(ctx.stateStore.getState().media || [], ctx.getMediaWithProbe())
		if (ctx.gatherMediaBtn) ctx.gatherMediaBtn.disabled = true
		ctx.setStatus('Gathering referenced media…', 'info')
		try {
			const plan = planGatherProjectMediaIntoFolder({
				project,
				mediaList,
				projectFolder: folder,
				settings: settingsState.getSettings(),
			})
			if (plan.pending > 0) {
				const noun = plan.pending === 1 ? 'clip' : 'clips'
				if (
					!confirm(
						`Move ${plan.pending} referenced ${noun} into ${folder}/?\n\nLooks will be updated to match.`,
					)
				) {
					ctx.setStatus('Gather cancelled', 'info')
					return
				}
			}
			const result = await executeGatherProjectMedia(plan, {
				refreshMedia: async () => {
					await ctx.refreshMedia()
				},
			})
			if (result.projectUpdated) {
				projectState.importProject(
					result.projectUpdated,
					sceneState,
					timelineState,
					multiviewState,
					programOutputState,
					{ silent: true },
				)
				sceneState.refreshLiveSnapshotsFromScenes()
				sceneState._save()
				document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
				window.dispatchEvent(new Event('project-loaded'))
			}
			if (result.failed > 0) {
				ctx.setStatus(`Gathered ${result.moved} file(s), ${result.failed} failed`, 'error')
			} else if (result.moved > 0) {
				ctx.setStatus(`Gathered ${result.moved} file(s) into ${folder}/`, 'ok')
			} else if (result.pathsUpdated) {
				ctx.setStatus('Updated media paths in looks', 'ok')
			} else {
				ctx.setStatus('All referenced clips are already in the project folder', 'ok')
			}
			await ctx.refreshMedia()
		} catch (e) {
			ctx.setStatus(`Gather failed: ${e?.message || e}`, 'error')
		} finally {
			if (ctx.gatherMediaBtn) ctx.gatherMediaBtn.disabled = false
			updateGatherAvailability()
		}
	}

	function bindProjectMediaFilter() {
		if (!ctx.projectMediaFilter) return
		ctx.projectMediaFilter.addEventListener('change', () => {
			ctx.setFilterProjectOnly(!!ctx.projectMediaFilter.checked)
			ctx.render()
		})
	}

	sceneState.on('change', scheduleGatherAvailabilityUpdate)
	timelineState.on?.('change', scheduleGatherAvailabilityUpdate)

	return {
		refreshProjectMediaBar,
		runGatherProjectMedia,
		scheduleGatherAvailabilityUpdate,
		bindProjectMediaFilter,
	}
}
