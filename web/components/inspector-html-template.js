/**
 * Scene layer — Caspar HTML / template source helpers (CALL RELOAD).
 * @see CasparCG HTML producer — reload page without re-taking the look.
 */

import { api } from '../lib/api-client.js'

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 * @param {object} opts.stateStore
 * @param {string} opts.sceneId
 * @param {object | null | undefined} opts.layer
 */
export function appendSceneLayerHtmlTemplateGroup(root, { sceneState, stateStore, sceneId, layerIndex, layer }) {
	const src = layer?.source
	if (!src?.value) return
	const t = src.type
	if (t !== 'template' && t !== 'html') return

	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-html-template-group'
	grp.innerHTML = '<div class="inspector-group__title">HTML template</div>'

	const row = document.createElement('div')
	row.className = 'inspector-field inspector-row'
	row.style.flexWrap = 'wrap'
	row.style.gap = '8px'
	row.style.alignItems = 'center'

	const hint = document.createElement('p')
	hint.className = 'inspector-field inspector-field--hint'
	hint.style.fontSize = '0.78rem'
	hint.style.margin = '0'
	hint.style.flex = '1 1 100%'
	hint.textContent = `Source: ${src.label || src.value}`

	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'inspector-btn-sm'
	btn.textContent = 'Reload page'
	btn.title = 'CALL RELOAD on preview (and program if this look is on air) — refreshes the HTML layer in Caspar'

	btn.addEventListener('click', () => {
		void reloadHtmlTemplateLayers({ sceneState, stateStore, sceneId, layer })
	})

	row.appendChild(btn)
	grp.appendChild(hint)
	grp.appendChild(row)
	grp.style.marginBottom = '15px'
	root.appendChild(grp)

	if (src.value.includes('playback_timers.html')) {
		const cfgGrp = document.createElement('div')
		cfgGrp.className = 'inspector-group inspector-timers-config-group'
		cfgGrp.innerHTML = '<div class="inspector-group__title">Timers Config</div>'

		const cfg = src.timersConfig || {
			showLayers: true,
			showScreens: true,
			columns: 2,
			compact: false,
			titleFontSize: 28,
			clipFontSize: 20,
			timeFontSize: 28,
			elapsedFontSize: 20,
			showLabels: true,
			showProgress: true,
			showElapsed: true
		}

		// Columns
		const colField = document.createElement('div')
		colField.className = 'inspector-field'
		colField.innerHTML = `
			<label>Columns</label>
			<select class="inspector-select" id="timers-cols" style="width:100%;margin-top:4px">
				<option value="1" ${cfg.columns === 1 ? 'selected' : ''}>1 Column</option>
				<option value="2" ${cfg.columns === 2 ? 'selected' : ''}>2 Columns</option>
				<option value="3" ${cfg.columns === 3 ? 'selected' : ''}>3 Columns</option>
				<option value="4" ${cfg.columns === 4 ? 'selected' : ''}>4 Columns</option>
			</select>
		`
		cfgGrp.appendChild(colField)

		// Font size controls
		const sizeField = document.createElement('div')
		sizeField.className = 'inspector-field'
		sizeField.style.display = 'flex'
		sizeField.style.flexDirection = 'column'
		sizeField.style.gap = '10px'
		sizeField.style.marginTop = '12px'
		sizeField.innerHTML = `
			<div>
				<label style="display:flex;justify-content:space-between">Title Size: <span id="timers-font-title-val">${cfg.titleFontSize ?? 28}px</span></label>
				<input type="range" class="inspector-slider" id="timers-font-title" min="12" max="64" value="${cfg.titleFontSize ?? 28}" style="width:100%;margin-top:4px" />
			</div>
			<div>
				<label style="display:flex;justify-content:space-between">Clip Size: <span id="timers-font-clip-val">${cfg.clipFontSize ?? 20}px</span></label>
				<input type="range" class="inspector-slider" id="timers-font-clip" min="12" max="64" value="${cfg.clipFontSize ?? 20}" style="width:100%;margin-top:4px" />
			</div>
			<div>
				<label style="display:flex;justify-content:space-between">Timer Size: <span id="timers-font-time-val">${cfg.timeFontSize ?? 28}px</span></label>
				<input type="range" class="inspector-slider" id="timers-font-time" min="12" max="64" value="${cfg.timeFontSize ?? 28}" style="width:100%;margin-top:4px" />
			</div>
			<div>
				<label style="display:flex;justify-content:space-between">Elapsed Size: <span id="timers-font-elapsed-val">${cfg.elapsedFontSize ?? 20}px</span></label>
				<input type="range" class="inspector-slider" id="timers-font-elapsed" min="12" max="64" value="${cfg.elapsedFontSize ?? 20}" style="width:100%;margin-top:4px" />
			</div>
		`
		cfgGrp.appendChild(sizeField)

		// Checkboxes / Toggles
		const optField = document.createElement('div')
		optField.className = 'inspector-field'
		optField.style.display = 'flex'
		optField.style.flexDirection = 'column'
		optField.style.gap = '8px'
		optField.style.marginTop = '12px'
		optField.innerHTML = `
			<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
				<input type="checkbox" id="timers-show-screens" ${cfg.showScreens !== false ? 'checked' : ''} />
				Show Program Screens
			</label>
			<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
				<input type="checkbox" id="timers-show-layers" ${cfg.showLayers !== false ? 'checked' : ''} />
				Show Active Layers
			</label>
			<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
				<input type="checkbox" id="timers-show-labels" ${cfg.showLabels !== false ? 'checked' : ''} />
				Show Clip Labels
			</label>
			<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
				<input type="checkbox" id="timers-show-progress" ${cfg.showProgress !== false ? 'checked' : ''} />
				Show Progress Bars
			</label>
			<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
				<input type="checkbox" id="timers-show-elapsed" ${cfg.showElapsed !== false ? 'checked' : ''} />
				Show Elapsed/Total Time
			</label>
			<label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer">
				<input type="checkbox" id="timers-compact" ${cfg.compact ? 'checked' : ''} />
				Compact Mode
			</label>
		`
		cfgGrp.appendChild(optField)

		const updateConfig = () => {
			const newConfig = {
				columns: parseInt(cfgGrp.querySelector('#timers-cols').value, 10) || 2,
				showScreens: !!cfgGrp.querySelector('#timers-show-screens').checked,
				showLayers: !!cfgGrp.querySelector('#timers-show-layers').checked,
				showLabels: !!cfgGrp.querySelector('#timers-show-labels').checked,
				showProgress: !!cfgGrp.querySelector('#timers-show-progress').checked,
				showElapsed: !!cfgGrp.querySelector('#timers-show-elapsed').checked,
				compact: !!cfgGrp.querySelector('#timers-compact').checked,
				titleFontSize: parseInt(cfgGrp.querySelector('#timers-font-title').value, 10) || 28,
				clipFontSize: parseInt(cfgGrp.querySelector('#timers-font-clip').value, 10) || 20,
				timeFontSize: parseInt(cfgGrp.querySelector('#timers-font-time').value, 10) || 28,
				elapsedFontSize: parseInt(cfgGrp.querySelector('#timers-font-elapsed').value, 10) || 20,
			}
			
			// Update label value text
			cfgGrp.querySelector('#timers-font-title-val').textContent = newConfig.titleFontSize + 'px'
			cfgGrp.querySelector('#timers-font-clip-val').textContent = newConfig.clipFontSize + 'px'
			cfgGrp.querySelector('#timers-font-time-val').textContent = newConfig.timeFontSize + 'px'
			cfgGrp.querySelector('#timers-font-elapsed-val').textContent = newConfig.elapsedFontSize + 'px'

			sceneState.patchLayer(sceneId, layerIndex, {
				source: {
					...src,
					timersConfig: newConfig
				}
			})
		}

		cfgGrp.querySelector('#timers-cols').addEventListener('change', updateConfig)
		cfgGrp.querySelector('#timers-show-screens').addEventListener('change', updateConfig)
		cfgGrp.querySelector('#timers-show-layers').addEventListener('change', updateConfig)
		cfgGrp.querySelector('#timers-show-labels').addEventListener('change', updateConfig)
		cfgGrp.querySelector('#timers-show-progress').addEventListener('change', updateConfig)
		cfgGrp.querySelector('#timers-show-elapsed').addEventListener('change', updateConfig)
		cfgGrp.querySelector('#timers-compact').addEventListener('change', updateConfig)
		
		cfgGrp.querySelector('#timers-font-title').addEventListener('input', updateConfig)
		cfgGrp.querySelector('#timers-font-clip').addEventListener('input', updateConfig)
		cfgGrp.querySelector('#timers-font-time').addEventListener('input', updateConfig)
		cfgGrp.querySelector('#timers-font-elapsed').addEventListener('input', updateConfig)

		root.appendChild(cfgGrp)
	}
}

/**
 * @param {{ sceneState: object, stateStore: object, sceneId: string, layer: object }} ctx
 */
async function reloadHtmlTemplateLayers(ctx) {
	const { sceneState, stateStore, sceneId, layer } = ctx
	const layerNum = layer?.layerNumber
	if (layerNum == null || !Number.isFinite(Number(layerNum))) return

	const cm = stateStore.getState()?.channelMap || {}
	const screenIdx = sceneState.activeScreenIndex ?? 0
	const pickCh = (arr) => {
		const a = Array.isArray(arr) && arr.length ? arr : [1]
		return a[Math.min(screenIdx, Math.max(0, a.length - 1))] ?? 1
	}
	const previewCh = pickCh(cm.previewChannels)
	const programCh = pickCh(cm.programChannels)

	const targets = new Set([previewCh])
	if (sceneState.liveSceneId === sceneId) {
		targets.add(programCh)
	}

	for (const channel of targets) {
		try {
			await api.post('/api/call', { channel, layer: layerNum, fn: 'RELOAD', params: '' })
		} catch (e) {
			console.warn(`[html-template] CALL RELOAD ch ${channel} layer ${layerNum}:`, e?.message || e)
		}
	}
}
