/**
 * Edit view rendering for Scenes Editor.
 */
import { defaultTransition as defaultTransitionDef } from '../lib/scene-state.js'
import { mountLookTransitionControls } from './scenes-shared.js'
import { appendLayerPresetBar, appendSceneLayerStripRows } from './scene-layer-row.js'
import { escapeHtml } from './scenes-editor-support.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'

function commitEditLookName(input, sceneId, sceneState) {
	if (!(input instanceof HTMLInputElement) || !sceneId) return
	sceneState.setSceneName(sceneId, input.value)
	const u = sceneState.getScene(sceneId)
	if (u && input.value !== u.name) input.value = u.name
}

function mainIdxForScene(scene, sceneState) {
	const scope = String(scene?.mainScope || 'all')
	if (scope !== 'all') {
		const n = parseInt(scope, 10)
		if (Number.isFinite(n) && n >= 0) return n
	}
	return sceneState.activeScreenIndex ?? 0
}

export function renderEdit(ctx) {
	const { mainHost, sceneState, stateStore, getChannelMap = () => ({}), takeSceneToProgram, clearLastPreviewLayers, onExitEdit, dispatchLayerSelect, schedulePreviewPush, applyNativeFillForSource, buildLayerRouteLiveSourceItem, renderCompose, selectedLayerIndexRef, showScenesToast } = ctx
	const id = sceneState.editingSceneId; const scene = id ? sceneState.getScene(id) : null
	if (!scene) { sceneState.setEditingScene(null); return }

	mainHost.innerHTML = ''
	const bar = document.createElement('div'); bar.className = 'scenes-edit-bar'
	bar.innerHTML = `
		<button type="button" class="scenes-btn scenes-btn--icon" id="scenes-back">←</button>
		<input type="text" class="scenes-edit-name" id="scenes-name" value="${escapeHtml(scene.name)}" placeholder="Look name" />
		<button type="button" class="scenes-btn scenes-btn--take scenes-btn--icon" id="scenes-take-live">▶</button>
		<button type="button" class="scenes-btn scenes-btn--sm" id="scenes-take-cut" title="Hard cut" aria-label="Hard cut">CUT</button>
		<button type="button" class="scenes-btn scenes-btn--primary scenes-btn--icon" id="scenes-add-layer">＋</button>
	`
	mainHost.appendChild(bar)

	bar.querySelector('#scenes-take-live').addEventListener('click', () => {
		void takeSceneToProgram(scene.id, false)
	})
	bar.querySelector('#scenes-take-cut').addEventListener('click', () => {
		void takeSceneToProgram(scene.id, true)
	})
	bar.querySelector('#scenes-back').addEventListener('click', () => {
		void (async () => {
			if (typeof onExitEdit === 'function') {
				await onExitEdit()
			} else {
				sceneState.setEditingScene(null)
				selectedLayerIndexRef.current = null
				dispatchLayerSelect(null)
				clearLastPreviewLayers()
			}
		})()
	})
	bar.querySelector('#scenes-name').addEventListener('blur', (e) =>
		commitEditLookName(e.target, scene.id, sceneState),
	)
	bar.querySelector('#scenes-name').addEventListener('change', (e) =>
		commitEditLookName(e.target, scene.id, sceneState),
	)
	bar.querySelector('#scenes-name').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault()
			e.target.blur()
		}
	})
	bar.querySelector('#scenes-add-layer').addEventListener('click', () => sceneState.addLayer(scene.id))

	const body = document.createElement('div'); body.className = 'scenes-edit-body scenes-edit-body--stacked'
	const mainRow = document.createElement('div'); mainRow.className = 'scenes-edit-main'
	const layerStrip = document.createElement('div'); layerStrip.className = 'scenes-layer-strip'
	layerStrip.innerHTML = '<div class="scenes-layer-strip__title">Layers (bottom → top)</div>'

	const renderFn = () => renderEdit(ctx)
	appendSceneLayerStripRows(layerStrip, { scene, dispatchLayerSelect, render: renderFn, showToast: showScenesToast, schedulePreviewPush, selectedLayerIndexRef, sceneState, stateStore, escapeHtml, applyNativeFillForSource, buildLayerRouteLiveSourceItem })
	appendLayerPresetBar(layerStrip, { scene, render: renderFn, showToast: showScenesToast, schedulePreviewPush, selectedLayerIndexRef, sceneState })

	mainRow.appendChild(layerStrip); mainRow.appendChild(renderCompose(scene))
	const editMainIdx = mainIdxForScene(scene, sceneState)
	const editPgmOnly = !isPreviewBusAvailable(getChannelMap(), editMainIdx)
	mountLookTransitionControls(
		body,
		scene.defaultTransition || defaultTransitionDef(),
		(t) => sceneState.setDefaultTransition(scene.id, t),
		'scenes-edit-dt',
		{
			label: 'Look transition (this look)',
			hint: editPgmOnly
				? 'MIX/WIPE/Slide/Push use +Animate on this PGM-only screen at take.'
				: 'Applies when layers enter or change.',
		},
	)
	


	body.appendChild(mainRow); mainHost.appendChild(body)
}
