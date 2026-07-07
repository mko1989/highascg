/**
 * Device view DOM shell: header, cable toolbar, layout panels.
 */

import { readSimpleWiring, writeSimpleWiring } from '../lib/device-view-simple-wiring-prefs.js'

export function buildDeviceViewShell(root) {
	root.innerHTML = ''
	const wrap = document.createElement('div')
	wrap.className = 'device-view'

	const header = document.createElement('div')
	header.className = 'device-view__header'
	const actions = document.createElement('div')
	actions.className = 'device-view__actions'
	const refreshBtn = document.createElement('button')
	refreshBtn.className = 'header-btn'
	refreshBtn.textContent = 'Refresh'
	const resetBtn = document.createElement('button')
	resetBtn.className = 'header-btn'
	resetBtn.textContent = 'Reset all cabling'
	const applyCasparBtn = document.createElement('button')
	applyCasparBtn.className = 'header-btn device-view__apply-btn'
	applyCasparBtn.textContent = 'Apply Caspar config (restart)'
	const editCasparBtn = document.createElement('button')
	editCasparBtn.type = 'button'
	editCasparBtn.className = 'header-btn device-view__edit-config-btn'
	editCasparBtn.innerHTML = `<svg class="device-view__edit-config-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="12" height="13" rx="1.5"/><line x1="7" y1="12" x2="13" y2="12"/><line x1="7" y1="15" x2="13" y2="15"/><line x1="7" y1="18" x2="10" y2="18"/><line x1="12" y1="3" x2="20" y2="11"/><line x1="19" y1="10" x2="21" y2="12"/><line x1="10" y1="5" x2="12" y2="3"/></svg>`
	editCasparBtn.title = 'View or edit generated Caspar config (advanced)'
	editCasparBtn.setAttribute('aria-label', 'Caspar config editor')
	const saveSnapBtn = document.createElement('button')
	saveSnapBtn.className = 'header-btn'
	saveSnapBtn.textContent = 'Save snapshot'
	const loadSnapBtn = document.createElement('button')
	loadSnapBtn.className = 'header-btn'
	loadSnapBtn.textContent = 'Load snapshot'
	actions.append(refreshBtn, saveSnapBtn, loadSnapBtn, resetBtn, applyCasparBtn, editCasparBtn)
	header.append(
		Object.assign(document.createElement('h2'), { className: 'device-view__title', textContent: 'Devices' }),
		actions,
	)

	const cableRow = document.createElement('div')
	cableRow.className = 'device-view__toolbar'
	const clearCableBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Cancel cable',
		style: 'display:none',
	})
	const messinessLabel = Object.assign(document.createElement('label'), {
		textContent: 'Cable loops: ',
		style: 'margin-left: 14px; font-size: 11px; opacity: 0.8',
	})
	const messinessSlider = Object.assign(document.createElement('input'), {
		type: 'range',
		min: '0',
		max: '2',
		value: '0',
		id: 'cable-messiness',
		style: 'width: 40px; height: 8px; cursor: pointer;',
	})
	const messinessVal = Object.assign(document.createElement('span'), {
		textContent: '0',
		style: 'margin-left: 6px; font-size: 11px; font-weight: 600;',
	})
	const messinessWrap = document.createElement('span')
	messinessWrap.className = 'device-view__messiness-wrap'
	messinessWrap.append(messinessLabel, messinessSlider, messinessVal)

	const simpleLabel = Object.assign(document.createElement('label'), {
		className: 'device-view__simple-wiring-toggle',
		title: 'Compact node layout and straight cable lines on the rear panel.',
	})
	const simpleWiringCk = Object.assign(document.createElement('input'), { type: 'checkbox' })
	simpleWiringCk.checked = readSimpleWiring()
	const simpleText = document.createElement('span')
	simpleText.textContent = ' Node view'
	simpleLabel.append(simpleWiringCk, simpleText)

	const matrixLabel = Object.assign(document.createElement('label'), {
		className: 'device-view__matrix-view-toggle',
		title: 'Dense Dante-style routing matrix.',
		style: 'margin-left: 14px;',
	})
	const matrixCk = Object.assign(document.createElement('input'), { type: 'checkbox' })
	matrixCk.checked = window.localStorage.getItem('device-view-matrix') === 'true'
	const matrixText = document.createElement('span')
	matrixText.textContent = ' Matrix view'
	matrixLabel.append(matrixCk, matrixText)

	cableRow.append(clearCableBtn, messinessWrap, simpleLabel, matrixLabel)

	const destPanel = document.createElement('div')
	destPanel.className = 'device-view__destinations'
	const destHead = document.createElement('div')
	destHead.className = 'device-view__destinations-head'
	const destTitle = Object.assign(document.createElement('span'), {
		className: 'device-view__note',
		textContent: 'Screen destinations',
	})
	const destAdd = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: '+' })
	const destType = document.createElement('select')
	destHead.append(destTitle, destType, destAdd)
	const destBody = document.createElement('div')
	destBody.className = 'device-view__destinations-body'
	const destLiveHost = document.createElement('div')
	destLiveHost.className = 'device-view__live-sources-host'
	destPanel.append(destHead, destBody, destLiveHost)

	const mappingPanel = document.createElement('div')
	mappingPanel.className = 'device-view__mappings-column'
	const rearPanel = document.createElement('div')
	rearPanel.className = 'device-view__rear-column'
	const cableOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	cableOverlay.classList.add('device-view__cable-overlay')
	cableOverlay.innerHTML = '<g data-cable-lines></g>'
	const edgesHost = document.createElement('div')
	edgesHost.className = 'device-view__edges-host'
	const matrixHost = document.createElement('div')
	matrixHost.className = 'device-view__matrix-host'
	matrixHost.style.display = 'none'
	const inspector = document.createElement('div')
	inspector.className = 'device-view__inspector'
	const statusEl = document.createElement('div')
	statusEl.className = 'device-view__status'
	const layout = document.createElement('div')
	layout.className = 'device-view__layout'
	const side = document.createElement('aside')
	side.className = 'device-view__side'
	side.append(inspector)
	rearPanel.append(edgesHost)
	layout.append(destPanel, mappingPanel, rearPanel, matrixHost, side)
	wrap.append(
		cableOverlay,
		header,
		cableRow,
		Object.assign(document.createElement('p'), {
			className: 'device-view__note',
			textContent: 'Cable mode: connect channels to outputs. Apply Caspar config restarts CasparCG.',
		}),
		layout,
		statusEl,
	)
	root.append(wrap)

	return {
		wrap,
		layout,
		refreshBtn,
		resetBtn,
		applyCasparBtn,
		editCasparBtn,
		saveSnapBtn,
		loadSnapBtn,
		clearCableBtn,
		messinessSlider,
		messinessVal,
		messinessWrap,
		simpleLabel,
		simpleWiringCk,
		matrixLabel,
		matrixCk,
		destPanel,
		destBody,
		destLiveHost,
		destAdd,
		destType,
		mappingPanel,
		rearPanel,
		cableOverlay,
		edgesHost,
		matrixHost,
		inspector,
		statusEl,
	}
}

/** Wire view-mode toggles (simple wiring / matrix) once ctx.load + ctx.renderFromState exist. */
export function registerViewMode(ctx) {
	const { wrap, refs } = ctx
	const {
		simpleWiringCk,
		matrixCk,
		matrixHost,
		destPanel,
		rearPanel,
		mappingPanel,
		cableOverlay,
		simpleLabel,
		messinessWrap,
	} = refs

	function updateMessinessVisibility() {
		if (matrixCk.checked || simpleWiringCk.checked) {
			messinessWrap.style.display = 'none'
		} else {
			messinessWrap.style.display = ''
		}
	}

	function syncSimpleWiringMode() {
		const on = !!simpleWiringCk.checked
		writeSimpleWiring(on)
		wrap.classList.toggle('device-view--simple-wiring', on)
		updateMessinessVisibility()
	}

	function syncMatrixMode() {
		const on = !!matrixCk.checked
		window.localStorage.setItem('device-view-matrix', on ? 'true' : 'false')
		wrap.classList.toggle('device-view--matrix-view', on)
		if (on) {
			simpleLabel.style.display = 'none'
			matrixHost.style.display = ''
			destPanel.style.display = 'none'
			rearPanel.style.display = 'none'
			mappingPanel.style.display = 'none'
			cableOverlay.style.display = 'none'
		} else {
			simpleLabel.style.display = ''
			matrixHost.style.display = 'none'
			destPanel.style.display = ''
			rearPanel.style.display = ''
			mappingPanel.style.display = ''
			cableOverlay.style.display = ''
		}
		updateMessinessVisibility()
	}

	function beginViewModeTransition() {
		wrap.style.opacity = '0'
	}

	function endViewModeTransition() {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				ctx.updateUI()
				wrap.style.opacity = ''
			})
		})
	}

	function applyViewModeChange() {
		beginViewModeTransition()
		syncSimpleWiringMode()
		syncMatrixMode()
		if (ctx.state.lastPayload) {
			ctx.renderFromState()
			endViewModeTransition()
		} else {
			void ctx.load().then(() => endViewModeTransition())
		}
	}

	simpleWiringCk.addEventListener('change', () => {
		if (simpleWiringCk.checked) matrixCk.checked = false
		applyViewModeChange()
	})
	matrixCk.addEventListener('change', () => {
		if (matrixCk.checked) simpleWiringCk.checked = false
		applyViewModeChange()
	})

	ctx.syncSimpleWiringMode = syncSimpleWiringMode
	ctx.syncMatrixMode = syncMatrixMode
	ctx.applyViewModeChange = applyViewModeChange
}
