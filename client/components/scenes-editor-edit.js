/**
 * Edit view rendering for Scenes Editor.
 */
import { defaultTransition as defaultTransitionDef } from '../lib/scene-state.js'
import { mountLookTransitionControls, parseDraggableSourcesPayload, routeDropRejectionMessage } from './scenes-shared.js'
import { appendLayerPresetBar, appendSceneLayerStripRows } from './scene-layer-row.js'
import { resolveLookStackChannelForBus, resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'
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

function sourcePayloadForFill(data) {
	return {
		type: data.type || 'media',
		value: data.value,
		label: data.label,
		resolution: data.resolution,
		isPlaceholder: data.isPlaceholder,
		template: data.template,
		browserAsCg: data.browserAsCg,
	}
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
	// WO-272 edit-on-PGM: unmissable red LIVE indication — every edit in this session hits AIR
	// (geometry via the PGM mixer nudge, content changes via a forceCut server take).
	if (sceneState.editOnPgm === true) {
		bar.classList.add('scenes-edit-bar--live-pgm')
		const liveBadge = document.createElement('span')
		liveBadge.className = 'scenes-edit-live-badge'
		liveBadge.textContent = '● LIVE — EDITING PGM'
		liveBadge.title = 'Edits apply straight to the on-air PGM channel'
		bar.insertBefore(liveBadge, bar.querySelector('#scenes-name'))
	}
	mainHost.appendChild(bar)

	bar.querySelector('#scenes-take-live').addEventListener('click', () => {
		// WO-185 T185.2: Pass targetMains to take the edited scene to its configured main
		const mainIdx = resolveMainIndexForScene(scene, sceneState)
		void takeSceneToProgram(scene.id, false, { targetMains: [mainIdx] })
	})
	bar.querySelector('#scenes-take-cut').addEventListener('click', () => {
		// WO-185 T185.2: Pass targetMains to take the edited scene to its configured main
		const mainIdx = resolveMainIndexForScene(scene, sceneState)
		void takeSceneToProgram(scene.id, true, { targetMains: [mainIdx] })
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
	
	layerStrip.addEventListener('dragover', (e) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'copy'
		layerStrip.classList.add('scenes-layer-strip--dropping')
	})
	layerStrip.addEventListener('dragleave', (e) => {
		if (!e.relatedTarget || !layerStrip.contains(e.relatedTarget)) layerStrip.classList.remove('scenes-layer-strip--dropping')
	})
	layerStrip.addEventListener('drop', (e) => {
		e.preventDefault()
		layerStrip.classList.remove('scenes-layer-strip--dropping')
		const items = parseDraggableSourcesPayload(e.dataTransfer)
		if (items.length) {
			void (async () => {
				for (const data of items) {
					if (!data?.value || !sceneState.editingSceneId) continue
					
					const cm = stateStore?.getState?.()?.channelMap || {}
					const editCh = resolveLookStackChannelForBus(cm, sceneState, scene, 'edit')
					const pgmCh = resolveLookStackChannelForBus(cm, sceneState, scene, 'pgm')

					const idx = sceneState.addLayer(scene.id)
					if (idx < 0) continue

					const added = sceneState.getScene(scene.id)?.layers?.[idx]
					const targetLn = added?.layerNumber

					// WO-156: reject self-routes (same channel+layer, or whole-channel route to
					// this screen's own PGM/PRV channel — that wedges the channel in Caspar).
					if (routeDropRejectionMessage(data.value, { editChannel: editCh, pgmChannel: pgmCh, targetLayerNumber: targetLn })) {
						sceneState.removeLayer(scene.id, idx)
						continue
					}
					
					const srcType = data.type || 'media'
					sceneState.setLayerSource(scene.id, idx, {
						...data,
						type: srcType,
						value: data.value,
						label: data.label || data.value,
					})
					if (srcType === 'live_audio') sceneState.patchLayer(scene.id, idx, { opacity: 0 })
					
					await applyNativeFillForSource(idx, sourcePayloadForFill(data))
					
					const updated = sceneState.getScene(scene.id)
					const layer = updated?.layers?.[idx]
					if (layer) dispatchLayerSelect({ sceneId: scene.id, layerIndex: idx, layer })
					schedulePreviewPush()
				}
			})()
		}
	})

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
