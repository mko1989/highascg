import { sceneState } from '../lib/scene-state.js'
import { PIP_OVERLAY_MAP } from '../lib/pip-overlay-registry.js'
import { renderParamEditor } from './inspector-pip-overlay.js'
import { showScenesToast } from './scenes-editor-support.js'
import { requestGlobalBorderPush } from './inspector-global-border-events.js'
import { attachMathInput } from '../lib/math-input.js'

/**
 * @param {HTMLElement} root
 * @param {number} screenIndex
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {() => import('../lib/scene-state.js').GlobalBorderConfig | null | undefined} gbNow
 * @param {(patch: object) => void} patchGlobalBorder
 * @param {() => void} rerender
 */
export function appendGlobalBorderEffectSections(
	root,
	screenIndex,
	stateStore,
	gbNow,
	patchGlobalBorder,
	rerender,
) {
	const gb = gbNow()
	if (!gb) return

	const borderGrp = document.createElement('div')
	borderGrp.className = 'inspector-group'
	borderGrp.innerHTML = '<div class="inspector-group__title">Global Border Effect</div>'

	const typeWrap = document.createElement('div')
	typeWrap.className = 'inspector-field'
	const typeLab = document.createElement('label')
	typeLab.className = 'inspector-field__label'
	typeLab.textContent = 'Type'
	const typeSel = document.createElement('select')
	typeSel.className = 'inspector-field__select'
	for (const t of ['border', 'shadow', 'edge_strip', 'glow']) {
		const opt = document.createElement('option')
		opt.value = t
		opt.textContent = t
		if (t === gb.type) opt.selected = true
		typeSel.appendChild(opt)
	}
	typeSel.addEventListener('change', () => {
		patchGlobalBorder({ type: typeSel.value })
		rerender()
	})
	typeLab.appendChild(typeSel)
	typeWrap.appendChild(typeLab)
	borderGrp.appendChild(typeWrap)

	const fadeWrap = document.createElement('div')
	fadeWrap.className = 'inspector-field'
	const fadeLab = document.createElement('label')
	fadeLab.className = 'inspector-field__label'
	fadeLab.textContent = 'Fade Duration (frames)'
	const fadeInp = document.createElement('input')
	fadeInp.type = 'number'
	fadeInp.className = 'inspector-field__input'
	fadeInp.style.width = '60px'
	fadeInp.min = 0
	fadeInp.max = 250
	fadeInp.value = gb.fadeDuration ?? 25
	fadeInp.addEventListener('change', () => {
		const val = parseInt(fadeInp.value, 10)
		patchGlobalBorder({ fadeDuration: isNaN(val) ? 25 : val })
	})
	attachMathInput(fadeInp, { decimals: 0 })
	fadeLab.appendChild(fadeInp)
	fadeWrap.appendChild(fadeLab)
	borderGrp.appendChild(fadeWrap)

	const mirrorWrap = document.createElement('div')
	mirrorWrap.className = 'inspector-field'
	const mirrorLab = document.createElement('label')
	mirrorLab.className = 'inspector-field__label'
	mirrorLab.style.display = 'flex'
	mirrorLab.style.alignItems = 'center'
	mirrorLab.style.gap = '8px'
	const mirrorChk = document.createElement('input')
	mirrorChk.type = 'checkbox'
	mirrorChk.checked = gb.mirrorBorderOnPrv === true
	mirrorChk.addEventListener('change', () => {
		patchGlobalBorder({ mirrorBorderOnPrv: mirrorChk.checked })
		rerender()
	})
	const prvCh = stateStore?.getState?.()?.channelMap?.previewChannels?.[screenIndex]
	const mirrorTxt = document.createElement('span')
	mirrorTxt.textContent = prvCh
		? `PRV on ch ${prvCh} — border controls update layer 997 only (PGM 998/996 unchanged until this is off)`
		: 'PRV on preview bus — layer 997 (no PRV channel mapped for this screen)'
	mirrorLab.appendChild(mirrorChk)
	mirrorLab.appendChild(mirrorTxt)
	mirrorWrap.appendChild(mirrorLab)
	borderGrp.appendChild(mirrorWrap)

	const def = PIP_OVERLAY_MAP.get(gb.type)
	if (def) {
		const paramsBlock = document.createElement('div')
		paramsBlock.className = 'inspector-effect-card__params'
		for (const schema of def.schema) {
			if (schema.key === 'side') continue
			/* Owner 27.07: secondary color + its transition time hide under the enable toggle. */
			if ((schema.key === 'color2' || schema.key === 'colorCycleSec') && gb.params?.color2Enabled !== true) continue
			const curVal = gb.params?.[schema.key] ?? schema.default
			renderParamEditor(paramsBlock, schema, curVal, (newVal) => {
				const cur = gbNow()
				if (!cur) return
				patchGlobalBorder({
					params: { ...cur.params, [schema.key]: newVal, side: 'inside' },
				})
				if (schema.key === 'color2Enabled') rerender()
			})
		}
		borderGrp.appendChild(paramsBlock)
	}

	/* Owner 27.07: the border AREA — x/y/w/h in % of canvas; the border draws INSIDE this rect.
	 * Slices (below) override the area when any are defined. */
	const areaWrap = document.createElement('div')
	areaWrap.className = 'inspector-field'
	const areaLab = document.createElement('label')
	areaLab.className = 'inspector-field__label'
	areaLab.textContent = 'Area % (X / Y / W / H — slices override)'
	const areaRow = document.createElement('div')
	areaRow.style.cssText = 'display:flex;gap:6px;align-items:center'
	const innerNow = gb.inner || { l: 0, t: 0, w: 1, h: 1 }
	const areaInputs = ['l', 't', 'w', 'h'].map((k) => {
		const inp = document.createElement('input')
		inp.type = 'number'
		inp.className = 'inspector-field__input'
		inp.style.width = '58px'
		inp.min = 0
		inp.max = 100
		inp.step = 1
		inp.value = String(Math.round((Number(innerNow[k]) || (k === 'w' || k === 'h' ? 1 : 0)) * 100))
		inp.dataset.k = k
		inp.addEventListener('change', () => {
			const val = {}
			for (const el2 of areaInputs) {
				val[el2.dataset.k] = Math.max(0, Math.min(100, parseFloat(el2.value) || 0)) / 100
			}
			patchGlobalBorder({ inner: val })
		})
		attachMathInput(inp, { decimals: 0 })
		areaRow.appendChild(inp)
		return inp
	})
	areaLab.appendChild(areaRow)
	areaWrap.appendChild(areaLab)
	borderGrp.appendChild(areaWrap)
	root.appendChild(borderGrp)

	const screenActions = document.createElement('div')
	screenActions.className = 'inspector-group'
	screenActions.style.marginTop = '8px'
	const removeBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'scenes-btn scenes-btn--danger',
		textContent: 'Remove border from this screen',
	})
	removeBtn.title = 'Clears this screen from globalBorders (null slot). Art-Net and PGM border stop for this screen.'
	removeBtn.addEventListener('click', () => {
		if (!window.confirm(`Remove global border configuration from Screen ${screenIndex + 1}?`)) return
		sceneState.setGlobalBorderForScreen(screenIndex, { __clearSlot: true })
		requestGlobalBorderPush()
		window.dispatchEvent(new CustomEvent('global-border-state-changed'))
		rerender()
	})
	screenActions.appendChild(removeBtn)
	root.appendChild(screenActions)

	const presetGrp = document.createElement('div')
	presetGrp.className = 'inspector-group'
	presetGrp.innerHTML = '<div class="inspector-group__title">Border presets (PGM layers 998 ↔ 996)</div>'
	const presetRows = document.createElement('div')
	presetRows.style.display = 'flex'
	presetRows.style.flexDirection = 'column'
	presetRows.style.gap = '6px'
	const slotCount = sceneState.getGlobalBorderPresetSlotCount(screenIndex)
	for (let s = 1; s <= slotCount; s++) {
		const row = document.createElement('div')
		row.style.display = 'flex'
		row.style.flexWrap = 'wrap'
		row.style.alignItems = 'center'
		row.style.gap = '8px'
		const preset = sceneState.getGlobalBorderPreset(screenIndex, s)
		const lab = document.createElement('span')
		lab.style.minWidth = '120px'
		lab.style.fontSize = '0.85rem'
		lab.textContent = preset ? `${s}. ${preset.name}` : `${s}. —`
		const recallBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn scenes-btn--sm',
			textContent: 'Recall',
			disabled: !preset,
		})
		recallBtn.addEventListener('click', () => {
			if (!preset) return
			window.dispatchEvent(
				new CustomEvent('highascg-border-preset-recall', { detail: { screenIndex, slot: s } }),
			)
			showScenesToast('Preset recall sent to program border stack.', 'info')
		})
		const saveBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn scenes-btn--sm',
			textContent: 'Save',
		})
		saveBtn.addEventListener('click', () => {
			const nm = window.prompt('Preset name?', preset?.name || `Preset ${s}`)
			if (nm === null) return
			sceneState.saveGlobalBorderPresetSlot(screenIndex, s, nm)
			showScenesToast(`Saved border preset ${s}.`, 'info')
			rerender()
		})
		row.appendChild(lab)
		row.appendChild(recallBtn)
		row.appendChild(saveBtn)
		if (preset) {
			const delBtn = Object.assign(document.createElement('button'), {
				type: 'button',
				className: 'scenes-btn scenes-btn--sm scenes-btn--danger',
				textContent: 'Delete',
			})
			delBtn.addEventListener('click', () => {
				if (!window.confirm(`Delete preset ${s} (${preset.name})?`)) return
				sceneState.deleteGlobalBorderPresetSlot(screenIndex, s)
				showScenesToast('Preset removed.', 'info')
				rerender()
			})
			row.appendChild(delBtn)
		}
		presetRows.appendChild(row)
	}
	presetGrp.appendChild(presetRows)
	root.appendChild(presetGrp)
}
