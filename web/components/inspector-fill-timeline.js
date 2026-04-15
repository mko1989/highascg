import { parseNumberInput } from '../lib/math-input.js'
import { timelineState } from '../lib/timeline-state.js'
import { KF_PROPERTIES, KF_PROP_MAP } from './inspector-common.js'

/**
 * Timeline clip keyframes + add-keyframe UI (after title + basic clip fields).
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function appendTimelineClipKeyframes(root, opts) {
	const {
		timelineId, layerIdx, clipId, clip,
		syncTimelineToServer,
		getTimelinePlaybackPos,
		redrawClipInspector,
	} = opts

	// Keyframes: build grouped position (fill_x+fill_y) and scale (scale_x+scale_y) by time
	const allKfs = clip.keyframes || []
	const kfByProp = {}
	allKfs.forEach((kf) => { (kfByProp[kf.property] = kfByProp[kf.property] || []).push(kf) })

	const posTimes = new Set()
	;(kfByProp.fill_x || []).forEach((k) => posTimes.add(Math.round(k.time)))
	;(kfByProp.fill_y || []).forEach((k) => posTimes.add(Math.round(k.time)))
	const posKfs = []
	for (const t of posTimes) {
		const kx = (kfByProp.fill_x || []).find((k) => Math.abs(k.time - t) < 0.5)
		const ky = (kfByProp.fill_y || []).find((k) => Math.abs(k.time - t) < 0.5)
		if (kx || ky) posKfs.push({ time: t, x: kx?.value ?? 0, y: ky?.value ?? 0, easing: kx?.easing || ky?.easing || 'linear' })
	}
	posKfs.sort((a, b) => a.time - b.time)

	const scaleTimes = new Set()
	;(kfByProp.scale_x || []).forEach((k) => scaleTimes.add(Math.round(k.time)))
	;(kfByProp.scale_y || []).forEach((k) => scaleTimes.add(Math.round(k.time)))
	const scaleKfs = []
	for (const t of scaleTimes) {
		const kx = (kfByProp.scale_x || []).find((k) => Math.abs(k.time - t) < 0.5)
		const ky = (kfByProp.scale_y || []).find((k) => Math.abs(k.time - t) < 0.5)
		const v = kx?.value ?? ky?.value ?? 1
		if (kx || ky) scaleKfs.push({ time: t, value: v, easing: kx?.easing || ky?.easing || 'linear' })
	}
	scaleKfs.sort((a, b) => a.time - b.time)

	if (posKfs.length > 0) {
		const kfGrp = document.createElement('div')
		kfGrp.className = 'inspector-group'
		kfGrp.innerHTML = '<div class="inspector-group__title">Position keyframes</div>'
		posKfs.forEach((gkf) => {
			const row = document.createElement('div')
			row.className = 'inspector-field inspector-keyframe-row'
			row.innerHTML = `
				<span class="inspector-field__key">@ ${gkf.time}ms</span>
				<input type="text" class="inspector-field__input inspector-kf-x" value="${gkf.x}" placeholder="X" style="width:42px" />
				<input type="text" class="inspector-field__input inspector-kf-y" value="${gkf.y}" placeholder="Y" style="width:42px" />
				<select class="inspector-field__select inspector-keyframe-easing">
					${['linear', 'ease-in', 'ease-out', 'ease-in-out'].map((e) => `<option value="${e}" ${e === (gkf.easing || 'linear') ? 'selected' : ''}>${e}</option>`).join('')}
				</select>
				<button type="button" class="inspector-btn-sm inspector-kf-remove" title="Remove keyframe">×</button>
			`
			const xInp = row.querySelector('.inspector-kf-x')
			const yInp = row.querySelector('.inspector-kf-y')
			const easeSel = row.querySelector('.inspector-keyframe-easing')
			const removeBtn = row.querySelector('.inspector-kf-remove')
			const applyPos = () => {
				const x = parseNumberInput(xInp.value, NaN)
				const y = parseNumberInput(yInp.value, NaN)
				if (!isNaN(x)) timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'fill_x', value: x, easing: easeSel.value })
				if (!isNaN(y)) timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'fill_y', value: y, easing: easeSel.value })
				syncTimelineToServer()
			}
			xInp.addEventListener('change', applyPos)
			yInp.addEventListener('change', applyPos)
			easeSel.addEventListener('change', applyPos)
			removeBtn.addEventListener('click', () => {
				timelineState.removePositionKeyframe(timelineId, layerIdx, clipId, gkf.time)
				syncTimelineToServer()
				window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
				redrawClipInspector()
			})
			kfGrp.appendChild(row)
		})
		root.appendChild(kfGrp)
	}

	if (scaleKfs.length > 0) {
		const kfGrp = document.createElement('div')
		kfGrp.className = 'inspector-group'
		kfGrp.innerHTML = '<div class="inspector-group__title">Scale keyframes</div>'
		const scaleDef = KF_PROP_MAP.scale
		scaleKfs.forEach((gkf) => {
			const row = document.createElement('div')
			row.className = 'inspector-field inspector-keyframe-row'
			row.innerHTML = `
				<span class="inspector-field__key">@ ${gkf.time}ms</span>
				<input type="text" class="inspector-field__input inspector-kf-scale" value="${gkf.value}" style="width:50px" />
				<select class="inspector-field__select inspector-keyframe-easing">
					${['linear', 'ease-in', 'ease-out', 'ease-in-out'].map((e) => `<option value="${e}" ${e === (gkf.easing || 'linear') ? 'selected' : ''}>${e}</option>`).join('')}
				</select>
				<button type="button" class="inspector-btn-sm inspector-kf-remove" title="Remove keyframe">×</button>
			`
			const valInp = row.querySelector('.inspector-kf-scale')
			const easeSel = row.querySelector('.inspector-keyframe-easing')
			const removeBtn = row.querySelector('.inspector-kf-remove')
			valInp.addEventListener('change', () => {
				const v = parseNumberInput(valInp.value, NaN)
				if (!isNaN(v)) {
					const clamped = Math.max(scaleDef.min, Math.min(scaleDef.max, v))
					timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_x', value: clamped, easing: easeSel.value })
					timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_y', value: clamped, easing: easeSel.value })
					syncTimelineToServer()
				}
			})
			easeSel.addEventListener('change', () => {
				const v = parseNumberInput(valInp.value, NaN)
				const current = !isNaN(v) ? Math.max(scaleDef.min, Math.min(scaleDef.max, v)) : gkf.value
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_x', value: current, easing: easeSel.value })
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { time: gkf.time, property: 'scale_y', value: current, easing: easeSel.value })
				syncTimelineToServer()
			})
			removeBtn.addEventListener('click', () => {
				timelineState.removeScaleKeyframe(timelineId, layerIdx, clipId, gkf.time)
				syncTimelineToServer()
				window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
				redrawClipInspector()
			})
			kfGrp.appendChild(row)
		})
		root.appendChild(kfGrp)
	}

	for (const propDef of KF_PROPERTIES) {
		if (propDef.pair) continue
		const propKfs = kfByProp[propDef.value] || []
		if (propKfs.length === 0) continue
		const kfGrp = document.createElement('div')
		kfGrp.className = 'inspector-group'
		kfGrp.innerHTML = `<div class="inspector-group__title">${propDef.label} keyframes</div>`
		propKfs.forEach((kf) => {
			const row = document.createElement('div')
			row.className = 'inspector-field inspector-keyframe-row'
			row.innerHTML = `
				<span class="inspector-field__key">@ ${Math.round(kf.time)}ms</span>
				<input type="text" class="inspector-field__input inspector-keyframe-value" value="${kf.value}" style="width:50px" />
				<select class="inspector-field__select inspector-keyframe-easing">
					${['linear', 'ease-in', 'ease-out', 'ease-in-out'].map((e) => `<option value="${e}" ${e === (kf.easing || 'linear') ? 'selected' : ''}>${e}</option>`).join('')}
				</select>
				<button type="button" class="inspector-btn-sm inspector-kf-remove" title="Remove keyframe">×</button>
			`
			const valInp = row.querySelector('.inspector-keyframe-value')
			const easeSel = row.querySelector('.inspector-keyframe-easing')
			const removeBtn = row.querySelector('.inspector-kf-remove')
			valInp.addEventListener('change', () => {
				const v = parseNumberInput(valInp.value, NaN)
				if (!isNaN(v)) {
					const clamped = Math.max(propDef.min ?? 0, Math.min(propDef.max ?? 1, v))
					timelineState.addKeyframe(timelineId, layerIdx, clipId, { ...kf, value: clamped })
					syncTimelineToServer()
				}
			})
			easeSel.addEventListener('change', () => {
				timelineState.addKeyframe(timelineId, layerIdx, clipId, { ...kf, easing: easeSel.value })
				syncTimelineToServer()
			})
			removeBtn.addEventListener('click', () => {
				timelineState.removeKeyframe(timelineId, layerIdx, clipId, kf.property, kf.time)
				syncTimelineToServer()
				window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
				redrawClipInspector()
			})
			kfGrp.appendChild(row)
		})
		root.appendChild(kfGrp)
	}

	const clipLocalMs = Math.max(0, Math.round(getTimelinePlaybackPos() - clip.startTime))
	const defaultTime = clipLocalMs >= 0 && clipLocalMs <= clip.duration ? clipLocalMs : 0
	const addKfGrp = document.createElement('div')
	addKfGrp.className = 'inspector-group'
	addKfGrp.innerHTML = '<div class="inspector-group__title">Add keyframe</div>'
	const addKfRow = document.createElement('div')
	addKfRow.className = 'inspector-field inspector-keyframe-row'
	addKfRow.innerHTML = `
		<select class="inspector-field__select" id="inspector-kf-property">
			${KF_PROPERTIES.map((p) => `<option value="${p.value}">${p.label}</option>`).join('')}
		</select>
		<input type="text" class="inspector-field__input inspector-math-input" id="inspector-kf-time" value="${defaultTime}" placeholder="time (ms)" inputmode="decimal" style="width:70px" />
		<span id="inspector-kf-values">
			<input type="text" class="inspector-field__input inspector-kf-val-single" id="inspector-kf-value" placeholder="value" value="1" style="width:50px" />
		</span>
		<button type="button" class="inspector-btn-sm" id="inspector-kf-add">Add</button>
	`
	const valuesWrap = addKfRow.querySelector('#inspector-kf-values')
	const updateAddInputs = () => {
		const propSel = addKfRow.querySelector('#inspector-kf-property')
		const val = propSel.value
		valuesWrap.innerHTML = ''
		if (val === 'position') {
			valuesWrap.innerHTML = '<input type="text" class="inspector-field__input inspector-kf-val-x" placeholder="X" value="0" style="width:42px" /><input type="text" class="inspector-field__input inspector-kf-val-y" placeholder="Y" value="0" style="width:42px" />'
		} else if (val === 'scale') {
			valuesWrap.innerHTML = '<input type="text" class="inspector-field__input inspector-kf-val-single" placeholder="scale" value="1" style="width:50px" />'
		} else {
			valuesWrap.innerHTML = `<input type="text" class="inspector-field__input inspector-kf-val-single" placeholder="value" value="${KF_PROP_MAP[val]?.default ?? 1}" style="width:50px" />`
		}
	}
	addKfRow.querySelector('#inspector-kf-property').addEventListener('change', updateAddInputs)
	updateAddInputs()
	addKfGrp.appendChild(addKfRow)
	addKfRow.querySelector('#inspector-kf-add').addEventListener('click', () => {
		const timeInp = addKfRow.querySelector('#inspector-kf-time')
		const propSel = addKfRow.querySelector('#inspector-kf-property')
		const time = Math.max(0, Math.round(parseNumberInput(timeInp.value, 0)))
		const prop = propSel.value
		if (prop === 'position') {
			const xInp = addKfRow.querySelector('.inspector-kf-val-x')
			const yInp = addKfRow.querySelector('.inspector-kf-val-y')
			const x = parseNumberInput(xInp?.value ?? 0, 0)
			const y = parseNumberInput(yInp?.value ?? 0, 0)
			timelineState.addPositionKeyframe(timelineId, layerIdx, clipId, time, x, y)
		} else if (prop === 'scale') {
			const valInp = addKfRow.querySelector('.inspector-kf-val-single')
			const v = parseNumberInput(valInp?.value ?? 1, 1)
			const clamped = Math.max(0, Math.min(4, v))
			timelineState.addScaleKeyframe(timelineId, layerIdx, clipId, time, clamped)
		} else {
			const valInp = addKfRow.querySelector('.inspector-kf-val-single')
			const val = parseNumberInput(valInp?.value ?? 1, NaN)
			if (isNaN(val)) return
			const propInfo = KF_PROP_MAP[prop] || { min: 0, max: 1 }
			const clamped = Math.max(propInfo.min ?? 0, Math.min(propInfo.max ?? 1, val))
			timelineState.addKeyframe(timelineId, layerIdx, clipId, { time, property: prop, value: clamped, easing: 'linear' })
		}
		syncTimelineToServer()
		window.dispatchEvent(new CustomEvent('timeline-redraw-request'))
		redrawClipInspector()
	})
	root.appendChild(addKfGrp)
}
