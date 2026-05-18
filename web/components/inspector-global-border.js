import { sceneState } from '../lib/scene-state.js'
import { PIP_OVERLAY_MAP } from '../lib/pip-overlay-registry.js'
import { renderParamEditor } from './inspector-pip-overlay.js'
import { showScenesToast } from './scenes-editor-support.js'
import { getResolutionForScreen } from './inspector-channel-resolution.js'

export function renderGlobalBorderInspector(root, screenIndex, stateStore) {
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Global Border: Screen ${screenIndex + 1}`
	root.appendChild(title)

	const gbNow = () => sceneState.getGlobalBorderForScreen(screenIndex)
	const gb = gbNow()

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
	const types = ['border', 'shadow', 'edge_strip', 'glow']
	types.forEach(t => {
		const opt = document.createElement('option')
		opt.value = t
		opt.textContent = t
		if (t === gb.type) opt.selected = true
		typeSel.appendChild(opt)
	})
	typeSel.addEventListener('change', () => {
		sceneState.setGlobalBorderForScreen(screenIndex, { type: typeSel.value })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
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
		sceneState.setGlobalBorderForScreen(screenIndex, { fadeDuration: isNaN(val) ? 25 : val })
	})
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
		sceneState.setGlobalBorderForScreen(screenIndex, { mirrorBorderOnPrv: mirrorChk.checked })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
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
			
			const curVal = gb.params?.[schema.key] ?? schema.default
			renderParamEditor(paramsBlock, schema, curVal, (newVal) => {
				const cur = gbNow()
				sceneState.setGlobalBorderForScreen(screenIndex, {
					params: { ...cur.params, [schema.key]: newVal, side: 'inside' }
				})
			})
		}
		borderGrp.appendChild(paramsBlock)
	}
	root.appendChild(borderGrp)

	const presetGrp = document.createElement('div')
	presetGrp.className = 'inspector-group'
	presetGrp.innerHTML = '<div class="inspector-group__title">Border presets (PGM layers 998 ↔ 996)</div>'
	const slotCount = sceneState.getGlobalBorderPresetSlotCount(screenIndex)
	const presetRows = document.createElement('div')
	presetRows.style.display = 'flex'
	presetRows.style.flexDirection = 'column'
	presetRows.style.gap = '6px'
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
			renderGlobalBorderInspector(root, screenIndex, stateStore)
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
				renderGlobalBorderInspector(root, screenIndex, stateStore)
			})
			row.appendChild(delBtn)
		}
		presetRows.appendChild(row)
	}
	presetGrp.appendChild(presetRows)
	root.appendChild(presetGrp)

	const slicesGrp = document.createElement('div')
	slicesGrp.className = 'inspector-group'
	slicesGrp.innerHTML = '<div class="inspector-group__title">Slices (Multi-segment physical layout)</div>'
	const slicesBody = document.createElement('div')
	slicesBody.className = 'inspector-effect-card__params'
	slicesBody.style.display = 'flex'
	slicesBody.style.flexDirection = 'column'
	slicesBody.style.gap = '10px'

	const slices = gb.slices || []
	const res = getResolutionForScreen(stateStore)

	if (slices.length === 0) {
		const empty = document.createElement('div')
		empty.className = 'inspector-field inspector-field--hint'
		empty.textContent = 'No slices defined. Defaulting to full canvas (0,0 100×100).'
		slicesBody.appendChild(empty)
	}

	slices.forEach((s, idx) => {
		const row = document.createElement('div')
		row.className = 'inspector-slice-row'
		row.style.display = 'flex'
		row.style.alignItems = 'center'
		row.style.gap = '6px'
		row.style.background = 'rgba(255,255,255,0.03)'
		row.style.padding = '6px'
		row.style.borderRadius = '4px'

		const createInput = (key, label, val, maxRes) => {
			const w = document.createElement('div')
			w.style.display = 'flex'
			w.style.flexDirection = 'column'
			w.style.gap = '2px'
			const l = document.createElement('label')
			l.style.fontSize = '0.65rem'
			l.style.color = 'var(--text-muted)'
			l.textContent = label
			const i = document.createElement('input')
			i.type = 'number'
			i.className = 'inspector-field__input'
			i.style.width = '52px'
			i.style.padding = '2px 4px'
			i.min = 0
			i.max = maxRes
			i.value = Math.round(val * maxRes)
			i.addEventListener('change', () => {
				const currentSlices = sceneState.getGlobalBorderForScreen(screenIndex).slices || []
				const next = [...currentSlices]
				if (next[idx]) {
					next[idx] = { ...next[idx], [key]: Math.max(0, Math.min(maxRes, parseFloat(i.value) || 0)) / maxRes }
					sceneState.setGlobalBorderForScreen(screenIndex, { slices: next })
				}
			})
			w.appendChild(l)
			w.appendChild(i)
			return w
		}

		row.appendChild(createInput('x', 'X(px)', s.x ?? 0, res.w))
		row.appendChild(createInput('y', 'Y(px)', s.y ?? 0, res.h))
		row.appendChild(createInput('w', 'W(px)', s.w ?? 1, res.w))
		row.appendChild(createInput('h', 'H(px)', s.h ?? 1, res.h))

		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'scenes-btn scenes-btn--sm scenes-btn--danger'
		del.style.marginLeft = 'auto'
		del.style.padding = '2px 6px'
		del.textContent = '×'
		del.title = 'Remove slice'
		del.addEventListener('click', () => {
			const currentSlices = sceneState.getGlobalBorderForScreen(screenIndex).slices || []
			const next = currentSlices.filter((_, i) => i !== idx)
			sceneState.setGlobalBorderForScreen(screenIndex, { slices: next })
			renderGlobalBorderInspector(root, screenIndex, stateStore)
		})
		row.appendChild(del)
		slicesBody.appendChild(row)
	})

	const sliceBtns = document.createElement('div')
	sliceBtns.style.display = 'flex'
	sliceBtns.style.gap = '8px'
	sliceBtns.style.marginTop = '4px'

	const addBtn = document.createElement('button')
	addBtn.type = 'button'
	addBtn.className = 'scenes-btn scenes-btn--sm'
	addBtn.textContent = '+ Add Slice'
	addBtn.addEventListener('click', () => {
		const currentSlices = sceneState.getGlobalBorderForScreen(screenIndex).slices || []
		// Default to half-width, full-height
		const next = [...currentSlices, { x: 0, y: 0, w: 0.5, h: 1 }]
		sceneState.setGlobalBorderForScreen(screenIndex, { slices: next })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})

	const fullBtn = document.createElement('button')
	fullBtn.type = 'button'
	fullBtn.className = 'scenes-btn scenes-btn--sm'
	fullBtn.textContent = 'Full Canvas'
	fullBtn.title = 'Reset to full screen border'
	fullBtn.addEventListener('click', () => {
		sceneState.setGlobalBorderForScreen(screenIndex, { slices: [] })
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})

	sliceBtns.appendChild(addBtn)
	sliceBtns.appendChild(fullBtn)
	slicesBody.appendChild(sliceBtns)

	slicesGrp.appendChild(slicesBody)
	root.appendChild(slicesGrp)

	const patchGrp = document.createElement('div')
	patchGrp.className = 'inspector-group'
	patchGrp.innerHTML = '<div class="inspector-group__title">Art-Net Patch</div>'
	
	const patchBlock = document.createElement('div')
	patchBlock.className = 'inspector-effect-card__params'
	
	const scWrap = document.createElement('div')
	scWrap.className = 'inspector-field'
	const scLab = document.createElement('label')
	scLab.className = 'inspector-field__label'
	scLab.textContent = 'Start Channel'
	const scInp = document.createElement('input')
	scInp.type = 'number'
	scInp.className = 'inspector-field__input'
	scInp.style.width = '60px'
	scInp.min = 1
	scInp.max = 512
	scInp.value = gb.artnetPatch?.startChannel || 1
	scInp.addEventListener('change', () => {
		const val = parseInt(scInp.value, 10)
		const cur = gbNow()
		sceneState.setGlobalBorderForScreen(screenIndex, {
			artnetPatch: { ...cur.artnetPatch, startChannel: isNaN(val) ? 1 : val }
		})
		renderGlobalBorderInspector(root, screenIndex, stateStore)
	})
	scLab.appendChild(scInp)
	scWrap.appendChild(scLab)
	patchBlock.appendChild(scWrap)

	const uniWrap = document.createElement('div')
	uniWrap.className = 'inspector-field'
	const uniLab = document.createElement('label')
	uniLab.className = 'inspector-field__label'
	uniLab.textContent = 'Universe'
	const uniInp = document.createElement('input')
	uniInp.type = 'number'
	uniInp.className = 'inspector-field__input'
	uniInp.style.width = '60px'
	uniInp.min = 0
	uniInp.max = 16
	uniInp.value = gb.artnetPatch?.universe || 0
	uniInp.addEventListener('change', () => {
		const val = parseInt(uniInp.value, 10)
		const cur = gbNow()
		sceneState.setGlobalBorderForScreen(screenIndex, {
			artnetPatch: { ...cur.artnetPatch, universe: isNaN(val) ? 0 : val }
		})
	})
	uniLab.appendChild(uniInp)
	uniWrap.appendChild(uniLab)
	patchBlock.appendChild(uniWrap)

	const start = gb.artnetPatch?.startChannel || 1
	const mapping = [
		{ label: 'On/Off', ch: start },
		{ label: 'Effect Type', ch: start + 1 },
		{ label: 'Opacity', ch: start + 2 },
		{ label: 'Color (RGB)', ch: `${start + 3} - ${start + 5}` },
		{ label: 'Width / Thickness', ch: start + 6 },
		{ label: 'Speed', ch: start + 7 },
		{ label: 'Spread / Blur', ch: start + 8 },
		{ label: 'Glow Color (RGB)', ch: `${start + 9} - ${start + 11}` },
		{ label: 'Radius', ch: start + 12 },
		{ label: 'Count (edge strip)', ch: start + 13 },
		{ label: 'Length (edge strip)', ch: start + 14 },
		{ label: 'Segments / edge (glow/shadow)', ch: start + 15 },
		{ label: 'Segment ease (glow/shadow)', ch: start + 16 },
		{ label: 'Segmentation mode (glow/shadow)', ch: start + 17 },
	]

	const table = document.createElement('table')
	table.className = 'inspector-mapping-table'
	table.style.width = '100%'
	table.style.marginTop = '10px'
	table.style.fontSize = '0.8rem'
	table.style.borderCollapse = 'collapse'
	
	table.innerHTML = `
		<thead>
			<tr style="text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">
				<th style="padding: 4px;">Parameter</th>
				<th style="padding: 4px;">Channel</th>
			</tr>
		</thead>
		<tbody>
			${mapping.map(m => `
				<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
					<td style="padding: 4px;">${m.label}</td>
					<td style="padding: 4px;">${m.ch}</td>
				</tr>
			`).join('')}
		</tbody>
	`
	patchBlock.appendChild(table)
	
	const dlLink = document.createElement('a')
	dlLink.href = '/fixtures/global-border.txt'
	dlLink.download = 'global-border.txt'
	dlLink.textContent = 'Download Fixture File'
	dlLink.style.display = 'block'
	dlLink.style.marginTop = '15px'
	dlLink.style.color = '#38bdf8'
	dlLink.style.textDecoration = 'none'
	dlLink.style.fontSize = '0.85rem'
	dlLink.style.fontWeight = 'bold'
	patchBlock.appendChild(dlLink)
	
	patchGrp.appendChild(patchBlock)
	root.appendChild(patchGrp)
}
