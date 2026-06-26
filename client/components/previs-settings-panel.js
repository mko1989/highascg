/**
 * WO-17 T5.3 — persisted 3D previs scene settings (client-side).
 *
 * Small form mounted on the 3D overlay (bottom-left). Writes through `previs-state.setUI`
 * so values survive reload. The keystone applies live updates via `sceneHandle.applySettings`
 * and `modelHost.setEmissiveIntensity` when `PREVIS_STATE_EVENTS.UI` fires.
 *
 * Antialiasing applies only after the WebGLRenderer is recreated (leave 3D and re-enter).
 */

import { PREVIS_STATE_EVENTS } from '../lib/previs-state.js'

/**
 * @param {{ state: ReturnType<typeof import('../lib/previs-state.js').createPrevisState> }} opts
 * @returns {{ el: HTMLElement, dispose: () => void }}
 */
export function createPrevisSettingsPanel(opts) {
	const { state } = opts
	const root = document.createElement('details')
	root.className = 'previs-pgm-3d-settings'
	const summary = document.createElement('summary')
	summary.className = 'previs-pgm-3d-settings__summary'
	summary.textContent = 'Scene settings'
	root.appendChild(summary)

	const body = document.createElement('div')
	body.className = 'previs-pgm-3d-settings__body'

	const bgRow = row('Background')
	const bgInput = document.createElement('input')
	bgInput.type = 'color'
	bgInput.className = 'previs-pgm-3d-settings__color'
	bgInput.title = 'Scene background colour'
	bgRow.appendChild(bgInput)

	const amb = rangeRow('Ambient light', 0, 3, 0.05)
	const dir = rangeRow('Key light', 0, 4, 0.05)
	const emi = rangeRow('Screen glow', 0, 3, 0.05)
	const fov = rangeRow('Camera FOV', 20, 100, 1)
	const prv = rangeRow('PRV width (3D)', 5, 50, 1)

	const pxRow = labeled('Pixel ratio cap')
	const pxSel = document.createElement('select')
	pxSel.className = 'previs-pgm-3d-settings__select'
	for (const n of [1, 2, 4]) {
		const o = document.createElement('option')
		o.value = String(n)
		o.textContent = `${n}x`
		pxSel.appendChild(o)
	}
	pxRow.appendChild(pxSel)

	const texRow = labeled('Video texture max')
	const texSel = document.createElement('select')
	texSel.className = 'previs-pgm-3d-settings__select'
	texSel.title = 'Cap GPU video texture size (native = full WebRTC frame; lower = less VRAM)'
	for (const { value, label } of [
		{ value: 'auto', label: 'Auto (1080p long edge)' },
		{ value: 'native', label: 'Native (full resolution)' },
		{ value: '720p', label: '720p long edge' },
		{ value: '1080p', label: '1080p long edge' },
	]) {
		const o = document.createElement('option')
		o.value = value
		o.textContent = label
		texSel.appendChild(o)
	}
	texRow.appendChild(texSel)

	const vcRow = labeled('Virtual canvas (px)')
	const vcW = document.createElement('input')
	vcW.type = 'number'
	vcW.min = '64'
	vcW.max = '8192'
	vcW.step = '1'
	vcW.className = 'previs-pgm-3d-settings__num'
	vcW.title = 'Logical canvas width for UV math (Show Creator virtual canvas)'
	const vcSep = document.createElement('span')
	vcSep.className = 'previs-pgm-3d-settings__vc-sep'
	vcSep.textContent = '×'
	const vcH = document.createElement('input')
	vcH.type = 'number'
	vcH.min = '64'
	vcH.max = '8192'
	vcH.step = '1'
	vcH.className = 'previs-pgm-3d-settings__num'
	vcH.title = 'Logical canvas height for UV math'
	vcRow.append(vcW, vcSep, vcH)

	const aaRow = labeled('Antialiasing')
	const aa = document.createElement('input')
	aa.type = 'checkbox'
	aa.className = 'previs-pgm-3d-settings__check'
	const aaHint = document.createElement('span')
	aaHint.className = 'previs-pgm-3d-settings__hint'
	aaHint.textContent = ' (applies after toggling 3D off/on)'
	aaRow.append(aa, aaHint)

	body.append(
		bgRow, amb.row, dir.row, emi.row, fov.row, prv.row, pxRow, texRow, vcRow, aaRow,
	)

	root.appendChild(body)

	let ignore = false
	const unsub = state.on(PREVIS_STATE_EVENTS.UI, () => {
		if (ignore) return
		syncFromState()
	})
	syncFromState()

	return {
		el: root,
		dispose() {
			unsub()
		},
	}

	function syncFromState() {
		const ui = state.getUI()
		ignore = true
		try {
			bgInput.value = intToColorHex(ui.backgroundColor)
			amb.input.value = String(ui.ambientIntensity)
			dir.input.value = String(ui.directionalIntensity)
			emi.input.value = String(ui.emissiveIntensity)
			fov.input.value = String(ui.cameraFov)
			prv.input.value = String(Math.round(ui.prvFractionWhen3d * 100))
			pxSel.value = String(ui.pixelRatioCap)
			texSel.value = String(ui.videoTextureMax || 'auto')
			vcW.value = String(ui.virtualCanvasWidth)
			vcH.value = String(ui.virtualCanvasHeight)
			aa.checked = !!ui.antialias
			amb.val.textContent = amb.input.value
			dir.val.textContent = dir.input.value
			emi.val.textContent = emi.input.value
			fov.val.textContent = fov.input.value
			prv.val.textContent = `${prv.input.value}%`
		} finally {
			ignore = false
		}
	}

	bgInput.addEventListener('input', () => {
		state.setUI({ backgroundColor: colorHexToInt(bgInput.value) })
	})
	amb.input.addEventListener('input', () => {
		amb.val.textContent = amb.input.value
		state.setUI({ ambientIntensity: Number(amb.input.value) })
	})
	dir.input.addEventListener('input', () => {
		dir.val.textContent = dir.input.value
		state.setUI({ directionalIntensity: Number(dir.input.value) })
	})
	emi.input.addEventListener('input', () => {
		emi.val.textContent = emi.input.value
		state.setUI({ emissiveIntensity: Number(emi.input.value) })
	})
	fov.input.addEventListener('input', () => {
		fov.val.textContent = fov.input.value
		state.setUI({ cameraFov: Number(fov.input.value) })
	})
	prv.input.addEventListener('input', () => {
		prv.val.textContent = `${prv.input.value}%`
		state.setUI({ prvFractionWhen3d: Number(prv.input.value) / 100 })
	})
	pxSel.addEventListener('change', () => {
		state.setUI({ pixelRatioCap: Number(pxSel.value) })
	})
	texSel.addEventListener('change', () => {
		state.setUI({ videoTextureMax: /** @type {'native'|'720p'|'1080p'|'auto'} */ (texSel.value) })
	})
	const applyVirtualCanvas = () => {
		state.setUI({
			virtualCanvasWidth: Number(vcW.value),
			virtualCanvasHeight: Number(vcH.value),
		})
	}
	vcW.addEventListener('change', applyVirtualCanvas)
	vcH.addEventListener('change', applyVirtualCanvas)
	aa.addEventListener('change', () => {
		state.setUI({ antialias: aa.checked })
	})
}

function row(label) {
	const wrap = document.createElement('div')
	wrap.className = 'previs-pgm-3d-settings__row'
	const lab = document.createElement('label')
	lab.className = 'previs-pgm-3d-settings__label'
	lab.textContent = label
	wrap.appendChild(lab)
	return wrap
}

function labeled(text) {
	const wrap = document.createElement('div')
	wrap.className = 'previs-pgm-3d-settings__row previs-pgm-3d-settings__row--inline'
	const lab = document.createElement('span')
	lab.className = 'previs-pgm-3d-settings__label'
	lab.textContent = text
	wrap.appendChild(lab)
	return wrap
}

function rangeRow(label, min, max, step) {
	const wrap = document.createElement('div')
	wrap.className = 'previs-pgm-3d-settings__row'
	const lab = document.createElement('div')
	lab.className = 'previs-pgm-3d-settings__label'
	lab.textContent = label
	const line = document.createElement('div')
	line.className = 'previs-pgm-3d-settings__slider-line'
	const input = document.createElement('input')
	input.type = 'range'
	input.min = String(min)
	input.max = String(max)
	input.step = String(step)
	input.className = 'previs-pgm-3d-settings__range'
	const val = document.createElement('span')
	val.className = 'previs-pgm-3d-settings__value'
	line.append(input, val)
	wrap.append(lab, line)
	return { row: wrap, input, val }
}

function intToColorHex(n) {
	const x = Math.max(0, Math.min(0xffffff, Math.floor(Number(n) || 0)))
	return `#${x.toString(16).padStart(6, '0')}`
}

function colorHexToInt(hex) {
	const s = (hex || '').replace('#', '')
	const v = parseInt(s, 16)
	return Number.isFinite(v) ? Math.max(0, Math.min(0xffffff, v)) : 0x0a0a0a
}
