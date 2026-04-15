/**
 * Scenes edit view — layer strip rows (bottom → top list with copy/paste/remove).
 */

/**
 * @param {object} opts
 * @param {import('../lib/scene-state.js').Scene} opts.scene
 * @param {(detail: object | null) => void} opts.dispatchLayerSelect
 * @param {() => void} opts.render
 * @param {(msg: string, type?: string) => void} opts.showToast
 * @param {() => void} opts.schedulePreviewPush
 * @param {{ current: number | null }} opts.selectedLayerIndexRef
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 * @param {(s: string) => string} opts.escapeHtml
 */
export function appendSceneLayerStripRows(layerStrip, opts) {
	const {
		scene,
		dispatchLayerSelect,
		render,
		showToast,
		schedulePreviewPush,
		selectedLayerIndexRef,
		sceneState,
		escapeHtml,
	} = opts

	/** HTML5 DnD: visual index being dragged (bottom→top); avoids MIME type quirks in dragover. */
	let layerDragFrom = null

	scene.layers
		.map((l, i) => ({ l, i }))
		.sort((a, b) => a.l.layerNumber - b.l.layerNumber)
		.forEach(({ l, i: realIdx }, visualIdx) => {
			const row = document.createElement('div')
			row.className = 'scenes-layer-row' + (selectedLayerIndexRef.current === realIdx ? ' scenes-layer-row--selected' : '')
			row.dataset.visualIndex = String(visualIdx)
			const src = l.source
			const label = src ? (src.label || src.value || '').slice(0, 28) : 'Empty'
			const canPaste = sceneState.hasLayerStyleClipboard()
			row.innerHTML = `
				<span class="scenes-layer-row__drag" draggable="true" title="Drag to change stack order (Z)" aria-grabbed="false" aria-label="Drag to reorder layer">⋮⋮</span>
				<div class="scenes-layer-row__col">
					<div class="scenes-layer-row__line1">
						<span class="scenes-layer-row__num">${l.layerNumber}</span>
						<span class="scenes-layer-row__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
					</div>
					<div class="scenes-layer-row__line2">
						<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-copy-style="${realIdx}" title="Copy position, scale, opacity, keyer, transition" aria-label="Copy layer settings">⎘</button>
						<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-paste-style="${realIdx}" title="Paste copied settings" aria-label="Paste layer settings" ${canPaste ? '' : 'disabled'}>📋</button>
						<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon scenes-btn--danger" data-remove="${realIdx}" title="Remove layer" aria-label="Remove layer">🗑</button>
					</div>
				</div>
			`
			const dragEl = row.querySelector('.scenes-layer-row__drag')
			if (dragEl) {
				dragEl.addEventListener('dragstart', (e) => {
					e.stopPropagation()
					layerDragFrom = visualIdx
					try {
						e.dataTransfer.setData('text/plain', String(visualIdx))
					} catch {
						/* ignore */
					}
					e.dataTransfer.effectAllowed = 'move'
					row.classList.add('scenes-layer-row--dragging')
					dragEl.setAttribute('aria-grabbed', 'true')
				})
				dragEl.addEventListener('dragend', () => {
					layerDragFrom = null
					row.classList.remove('scenes-layer-row--dragging')
					dragEl.setAttribute('aria-grabbed', 'false')
					layerStrip.querySelectorAll('.scenes-layer-row--drop-target').forEach((el) =>
						el.classList.remove('scenes-layer-row--drop-target'),
					)
				})
			}
			row.addEventListener('dragover', (e) => {
				if (layerDragFrom === null) return
				e.preventDefault()
				e.dataTransfer.dropEffect = 'move'
				row.classList.add('scenes-layer-row--drop-target')
			})
			row.addEventListener('dragleave', (e) => {
				if (e.currentTarget.contains(e.relatedTarget)) return
				row.classList.remove('scenes-layer-row--drop-target')
			})
			row.addEventListener('drop', (e) => {
				e.preventDefault()
				e.stopPropagation()
				row.classList.remove('scenes-layer-row--drop-target')
				const fromV = layerDragFrom
				const toV = visualIdx
				if (fromV === null || fromV === toV) return
				const selLayer =
					selectedLayerIndexRef.current != null ? scene.layers[selectedLayerIndexRef.current] : null
				sceneState.reorderLayers(scene.id, fromV, toV)
				const sceneAfter = sceneState.getScene(scene.id)
				if (sceneAfter && selLayer) {
					const ni = sceneAfter.layers.indexOf(selLayer)
					selectedLayerIndexRef.current = ni >= 0 ? ni : null
					if (selectedLayerIndexRef.current != null) {
						dispatchLayerSelect({
							sceneId: scene.id,
							layerIndex: selectedLayerIndexRef.current,
							layer: sceneAfter.layers[selectedLayerIndexRef.current],
						})
					} else {
						dispatchLayerSelect(null)
					}
				}
				schedulePreviewPush()
				render()
			})
			row.addEventListener('click', (e) => {
				if (e.target.closest('[data-remove], [data-copy-style], [data-paste-style], .scenes-layer-row__drag')) return
				dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer: l })
				render()
			})
			row.querySelector('[data-copy-style]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				if (sceneState.copyLayerStyle(scene.id, realIdx)) {
					showToast('Layer settings copied (not source).', 'info')
					layerStrip.querySelectorAll('[data-paste-style]').forEach((btn) => {
						btn.disabled = false
					})
				}
			})
			row.querySelector('[data-paste-style]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				if (sceneState.pasteLayerStyle(scene.id, realIdx)) {
					showToast('Settings pasted.', 'info')
					schedulePreviewPush()
					render()
				}
			})
			row.querySelector('[data-remove]').addEventListener('click', (e) => {
				e.stopPropagation()
				sceneState.removeLayer(scene.id, realIdx)
				if (selectedLayerIndexRef.current === realIdx) {
					selectedLayerIndexRef.current = null
					dispatchLayerSelect(null)
				}
				schedulePreviewPush()
			})
			layerStrip.appendChild(row)
		})
}
