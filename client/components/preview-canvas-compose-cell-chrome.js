/**
 * Compose PRV/PGM cell chrome — the "edit live on PGM" role badge + per-cell zoom slider overlaid
 * on each compose-pair cell (client/components/preview-canvas-panel.js's `rebuildComposeCellsIfNeeded`).
 * Split out (WO-256) purely to keep preview-canvas-panel.js under the repo's ~500-line file cap
 * while making room for the operator-GUI free-tile canvas branch — no behavior change, this is a
 * straight extraction of the same DOM/markup/handlers that used to live inline there.
 */

/**
 * Builds the badge + zoom overlay on `cell` and returns the `composeCells[]` entry
 * preview-canvas-panel.js pushes and later reads (`id/role/mainIndex/label/cellEl/canvas/ctx/zoom`).
 * @param {{ cell: HTMLElement, canvas: HTMLCanvasElement, def: { id: string, role: 'pgm'|'prv', mainIndex: number, label: string }, scheduleDraw: () => void }} args
 */
export function createComposeCellObj({ cell, canvas, def: d, scheduleDraw }) {
	const badge = document.createElement('div')
	badge.style.position = 'absolute'
	if (d.role === 'pgm') badge.style.right = '4px'
	else badge.style.left = '4px'
	badge.style.top = '4px'
	badge.style.padding = '1px 5px'
	badge.style.borderRadius = '999px'
	badge.style.fontSize = '10px'
	badge.style.lineHeight = '1.2'
	badge.style.color = 'rgba(230,237,243,0.95)'
	badge.style.background = 'rgba(0,0,0,0.55)'
	badge.style.border = '1px solid rgba(255,255,255,0.22)'
	badge.style.pointerEvents = 'auto'
	badge.style.zIndex = '10'

	if (d.role === 'pgm') {
		badge.style.cursor = 'pointer'
		badge.title = 'Edit live on PGM'
		badge.onclick = (e) => {
			e.stopPropagation()
			document.dispatchEvent(new CustomEvent('scenes-edit-live-on-pgm', { detail: { mainIndex: d.mainIndex } }))
		}
		const lockSpan = document.createElement('span')
		lockSpan.textContent = '🔓 '
		badge.appendChild(lockSpan)
		const textSpan = document.createElement('span')
		textSpan.textContent = d.label
		badge.appendChild(textSpan)
	} else {
		const textSpan = document.createElement('span')
		textSpan.textContent = d.label
		badge.appendChild(textSpan)
	}

	cell.style.position = 'relative'
	cell.appendChild(badge)

	const zoomContainer = document.createElement('div')
	zoomContainer.className = 'preview-panel__zoom-wrap'
	zoomContainer.style.cssText =
		'position:absolute;right:4px;bottom:4px;display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:999px;font-size:9px;color:rgba(230,237,243,0.85);background:rgba(0,0,0,0.65);border:1px solid rgba(255,255,255,0.15);z-index:10;pointer-events:auto;'

	const zoomLabel = document.createElement('span')
	zoomLabel.textContent = '1.0x'

	const zoomMinus = document.createElement('button')
	zoomMinus.type = 'button'
	zoomMinus.textContent = '-'
	zoomMinus.style.cssText =
		'background:transparent;border:none;color:inherit;font-size:11px;font-weight:bold;cursor:pointer;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;user-select:none;line-height:1;'

	const zoomPlus = document.createElement('button')
	zoomPlus.type = 'button'
	zoomPlus.textContent = '+'
	zoomPlus.style.cssText = zoomMinus.style.cssText

	const zoomSlider = document.createElement('input')
	zoomSlider.type = 'range'
	zoomSlider.min = '0.5'
	zoomSlider.max = '3'
	zoomSlider.step = '0.05'
	zoomSlider.value = '1'
	zoomSlider.setAttribute('value', '1')
	zoomSlider.defaultValue = '1'
	zoomSlider.style.cssText = 'width:50px;height:4px;margin:0;cursor:pointer;opacity:0.8;accent-color:#58a6ff;'

	const cellObj = {
		id: d.id,
		role: d.role,
		mainIndex: d.mainIndex,
		label: d.label,
		cellEl: cell,
		canvas,
		ctx: canvas.getContext('2d'),
		zoom: 1.0,
	}

	const updateZoom = (val) => {
		const clamped = Math.max(0.5, Math.min(3.0, val))
		cellObj.zoom = clamped
		zoomSlider.value = String(clamped)
		zoomLabel.textContent = `${clamped.toFixed(1)}x`
		scheduleDraw()
	}

	zoomSlider.addEventListener('input', () => updateZoom(parseFloat(zoomSlider.value) || 1.0))
	zoomMinus.addEventListener('click', (e) => { e.stopPropagation(); updateZoom(cellObj.zoom - 0.1) })
	zoomPlus.addEventListener('click', (e) => { e.stopPropagation(); updateZoom(cellObj.zoom + 0.1) })

	zoomContainer.append(zoomMinus, zoomSlider, zoomPlus, zoomLabel)
	cell.appendChild(zoomContainer)

	return cellObj
}
