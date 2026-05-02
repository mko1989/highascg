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
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 * @param {(s: string) => string} opts.escapeHtml
 * @param {(layerIndex: number, data: object) => Promise<void>} opts.applyNativeFillForSource
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
		applyNativeFillForSource,
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
						<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon" data-save-preset="${realIdx}" title="Save as layer style preset" aria-label="Save as layer style preset">💾</button>
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
				e.preventDefault()
				e.stopPropagation()
				if (layerDragFrom !== null) {
					e.dataTransfer.dropEffect = 'move'
				} else {
					e.dataTransfer.dropEffect = 'copy'
				}
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
				
				if (layerDragFrom !== null) {
					const fromV = layerDragFrom
					const toV = visualIdx
					if (fromV === toV) return
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
					return
				}

				// Media drop
				let data
				try {
					data = JSON.parse(e.dataTransfer.getData('application/json'))
				} catch {
					const val = e.dataTransfer.getData('text/plain')
					if (val) data = { type: 'media', value: val, label: val }
				}

				if (data?.value) {
					sceneState.setLayerSource(scene.id, realIdx, {
						type: data.type || 'media',
						value: data.value,
						label: data.label || data.value,
					})
					void applyNativeFillForSource(realIdx, {
						type: data.type || 'media',
						value: data.value,
						label: data.label,
						resolution: data.resolution,
					}).then(() => {
						const updated = sceneState.getScene(scene.id)
						const layer = updated?.layers?.[realIdx]
						if (layer) dispatchLayerSelect({ sceneId: scene.id, layerIndex: realIdx, layer })
						schedulePreviewPush()
						render()
					})
				}
			})
			row.addEventListener('click', (e) => {
				if (
					e.target.closest(
						'[data-remove], [data-copy-style], [data-paste-style], [data-save-preset], .scenes-layer-row__drag',
					)
				)
					return
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
			row.querySelector('[data-save-preset]')?.addEventListener('click', (e) => {
				e.stopPropagation()
				const name = window.prompt('Layer style preset name?')
				if (name == null) return
				const id = sceneState.saveLayerPresetFromLayer(scene.id, realIdx, name)
				if (id) {
					showToast('Layer preset saved.', 'info')
					render()
				} else {
					showToast('Could not save preset (empty name).', 'warn')
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

/**
 * Shared UI: select a named layer style + apply / remove.
 * @param {HTMLElement} parent
 * @param {object} opts
 * @param {string} opts.sceneId
 * @param {() => number | null} opts.getLayerIndex
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 * @param {(msg: string, type?: string) => void} opts.showToast
 * @param {() => void} [opts.onAfterChange]
 * @param {string | null} [opts.title] — if non-null, prepends {@link .scenes-layer-presets__title}
 * @param {string | null} [opts.hintText] — if non-null, appends hint line
 * @param {string} [opts.applyButtonLabel] — default “Apply to selected”
 */
export function mountLayerPresetControls(parent, opts) {
	const {
		sceneId,
		getLayerIndex,
		sceneState,
		showToast,
		onAfterChange,
		title,
		hintText,
		applyButtonLabel = 'Apply to selected',
	} = opts

	if (title) {
		const t = document.createElement('div')
		t.className = 'scenes-layer-presets__title'
		t.textContent = title
		parent.appendChild(t)
	}

	const presets = sceneState.getLayerPresets()
	const has = presets.length > 0
	const row = document.createElement('div')
	row.className = 'scenes-layer-presets__row'
	row.innerHTML = `
		<select class="scenes-layer-presets__sel" aria-label="Saved layer style preset" ${has ? '' : 'disabled'}>
			<option value="">${has ? '— choose preset —' : '— no presets yet —'}</option>
		</select>
		<button type="button" class="scenes-btn scenes-btn--sm" data-apply-preset ${has ? '' : 'disabled'}></button>
		<button type="button" class="scenes-btn scenes-btn--sm scenes-btn--icon scenes-btn--danger" data-remove-preset title="Delete selected preset" aria-label="Delete preset" ${has ? '' : 'disabled'}>🗑</button>
	`
	const sel = row.querySelector('.scenes-layer-presets__sel')
	if (sel && has) {
		for (const p of presets) {
			const o = document.createElement('option')
			o.value = p.id
			o.textContent = p.name
			sel.appendChild(o)
		}
	}
	const applyEl = row.querySelector('[data-apply-preset]')
	if (applyEl) applyEl.textContent = applyButtonLabel
	parent.appendChild(row)

	if (hintText) {
		const h = document.createElement('div')
		h.className = 'scenes-layer-presets__hint'
		h.textContent = hintText
		parent.appendChild(h)
	}

	const applyBtn = row.querySelector('[data-apply-preset]')
	const removeBtn = row.querySelector('[data-remove-preset]')

	applyBtn?.addEventListener('click', (e) => {
		e.preventDefault()
		const pid = sel?.value
		if (!pid) {
			showToast('Choose a layer style preset first.', 'info')
			return
		}
		if (!sceneId || !sceneState.getScene(sceneId)) {
			showToast('Select a layer in a look first.', 'info')
			return
		}
		const li = getLayerIndex()
		if (li == null) {
			showToast('Select a layer in a look first.', 'info')
			return
		}
		if (sceneState.applyLayerPresetToLayer(sceneId, li, pid)) {
			showToast('Layer preset applied.', 'info')
			onAfterChange?.()
		}
	})
	removeBtn?.addEventListener('click', (e) => {
		e.preventDefault()
		const pid = sel?.value
		if (!pid) {
			showToast('Choose a preset to remove.', 'info')
			return
		}
		if (sceneState.removeLayerPreset(pid)) {
			showToast('Layer preset removed.', 'info')
			onAfterChange?.()
		}
	})
}

/**
 * @param {HTMLElement} parent
 * @param {object} opts
 * @param {import('../lib/scene-state.js').Scene} opts.scene
 * @param {() => void} opts.render
 * @param {(msg: string, type?: string) => void} opts.showToast
 * @param {() => void} opts.schedulePreviewPush
 * @param {{ current: number | null }} opts.selectedLayerIndexRef
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 */
export function appendLayerPresetBar(parent, opts) {
	const { scene, render, showToast, schedulePreviewPush, selectedLayerIndexRef, sceneState } = opts
	const wrap = document.createElement('div')
	wrap.className = 'scenes-layer-presets'
	mountLayerPresetControls(wrap, {
		sceneId: scene.id,
		getLayerIndex: () => selectedLayerIndexRef.current,
		sceneState,
		showToast,
		onAfterChange: () => {
			schedulePreviewPush()
			render()
		},
		title: 'Layer style presets',
		hintText: '💾 on a row saves the same data as ⎘ / 📋, by name.',
	})
	parent.appendChild(wrap)
}
