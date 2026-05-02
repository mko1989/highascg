/**
 * WO-17 — minimal virtual-canvas region editor (drag + corner resize).
 *
 * Parent supplies logical `{ width, height }` and an initial pixel rect `region`.
 * Changes are normalised, clamped to the canvas, and emitted via `onChange`.
 */

const ROOT = 'previs-uv-editor'
const STAGE = `${ROOT}__stage`
const RECT = `${ROOT}__rect`
const HANDLE = `${ROOT}__handle`
const HINT = `${ROOT}__hint`
const ROW = `${ROOT}__row`
const BTN = `${ROOT}__btn`

/** @typedef {'move' | 'nw' | 'ne' | 'sw' | 'se'} UvDragMode */

/**
 * @param {Object} opts
 * @param {{ width: number, height: number }} opts.virtualCanvas
 * @param {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }} opts.region
 * @param {(r: { canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }) => void} [opts.onLiveChange]
 *   Called while dragging — keep light (e.g. refresh GPU crop only).
 * @param {(r: { canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }) => void} [opts.onCommit]
 *   Called on pointer-up after a drag — persist to state / localStorage.
 * @param {() => void} [opts.onReset]
 */
export function mountPrevisUvEditor(opts) {
	const vc = opts.virtualCanvas
	const wrap = document.createElement('div')
	wrap.className = ROOT

	const hint = document.createElement('div')
	hint.className = HINT
	hint.textContent = 'Drag the frame or corners — maps video sub-rect onto the mesh (virtual canvas px).'

	const stage = document.createElement('div')
	stage.className = STAGE
	const ratio = vc.height > 0 ? vc.width / vc.height : 16 / 9
	stage.style.aspectRatio = `${vc.width} / ${vc.height}`

	const rectEl = document.createElement('div')
	rectEl.className = RECT
	rectEl.tabIndex = 0

	for (const corner of /** @type {const} */ (['nw', 'ne', 'sw', 'se'])) {
		const h = document.createElement('span')
		h.className = `${HANDLE} ${HANDLE}--${corner}`
		h.dataset.corner = corner
		rectEl.appendChild(h)
	}

	stage.appendChild(rectEl)
	wrap.append(hint, stage)

	const btnRow = document.createElement('div')
	btnRow.className = ROW
	const reset = document.createElement('button')
	reset.type = 'button'
	reset.className = BTN
	reset.textContent = 'Use full canvas'
	if (typeof opts.onReset === 'function') {
		reset.addEventListener('click', () => opts.onReset())
	} else {
		reset.disabled = true
	}
	btnRow.appendChild(reset)
	wrap.appendChild(btnRow)

	let region = clampRegionPx(opts.region, vc)
	syncRectDom()

	/** @type {{ mode: UvDragMode, startX: number, startY: number, startRect: typeof region, stageRect: DOMRect } | null} */
	let drag = null
	/** @type {number | null} */
	let raf = null

	stage.addEventListener('pointerdown', onStageDown)
	window.addEventListener('pointermove', onPointerMove)
	window.addEventListener('pointerup', onPointerUp)
	window.addEventListener('pointercancel', onPointerUp)

	function onStageDown(ev) {
		const t = ev.target
		if (!(t instanceof HTMLElement)) return
		const corner = t.closest('[data-corner]')
		const mode = corner ? /** @type {UvDragMode} */ (String(corner.dataset.corner)) : 'move'
		if (!corner && t !== rectEl && !rectEl.contains(t)) return
		drag = {
			mode,
			startX: ev.clientX,
			startY: ev.clientY,
			startRect: { ...region },
			stageRect: stage.getBoundingClientRect(),
		}
		stage.setPointerCapture(ev.pointerId)
		ev.preventDefault()
	}

	function flushLive() {
		raf = null
		if (typeof opts.onLiveChange === 'function') opts.onLiveChange(region)
	}

	function onPointerMove(ev) {
		if (!drag) return
		const { mode, startX, startY, startRect, stageRect } = drag
		const dxPx = ev.clientX - startX
		const dyPx = ev.clientY - startY
		const scaleX = vc.width / Math.max(1, stageRect.width)
		const scaleY = vc.height / Math.max(1, stageRect.height)
		const dx = dxPx * scaleX
		const dy = dyPx * scaleY
		let r = { ...startRect }

		if (mode === 'move') {
			r.canvasX = startRect.canvasX + dx
			r.canvasY = startRect.canvasY + dy
		} else if (mode === 'se') {
			r.canvasWidth = startRect.canvasWidth + dx
			r.canvasHeight = startRect.canvasHeight + dy
		} else if (mode === 'ne') {
			r.canvasWidth = startRect.canvasWidth + dx
			r.canvasHeight = startRect.canvasHeight - dy
			r.canvasY = startRect.canvasY + dy
		} else if (mode === 'sw') {
			r.canvasWidth = startRect.canvasWidth - dx
			r.canvasHeight = startRect.canvasHeight + dy
			r.canvasX = startRect.canvasX + dx
		} else if (mode === 'nw') {
			r.canvasWidth = startRect.canvasWidth - dx
			r.canvasHeight = startRect.canvasHeight - dy
			r.canvasX = startRect.canvasX + dx
			r.canvasY = startRect.canvasY + dy
		}
		r = clampRegionPx(r, vc, 8)
		region = r
		syncRectDom()
		if (typeof opts.onLiveChange === 'function') {
			if (raf == null) raf = requestAnimationFrame(flushLive)
		}
	}

	function onPointerUp(ev) {
		if (!drag) return
		const startRect = drag.startRect
		try {
			stage.releasePointerCapture(ev.pointerId)
		} catch {}
		drag = null
		if (raf != null) {
			cancelAnimationFrame(raf)
			raf = null
			if (typeof opts.onLiveChange === 'function') opts.onLiveChange(region)
		}
		const changed =
			region.canvasX !== startRect.canvasX ||
			region.canvasY !== startRect.canvasY ||
			region.canvasWidth !== startRect.canvasWidth ||
			region.canvasHeight !== startRect.canvasHeight
		if (changed && typeof opts.onCommit === 'function') opts.onCommit(region)
	}

	function syncRectDom() {
		const leftPct = (region.canvasX / vc.width) * 100
		const topPct = (region.canvasY / vc.height) * 100
		const wPct = (region.canvasWidth / vc.width) * 100
		const hPct = (region.canvasHeight / vc.height) * 100
		rectEl.style.left = `${leftPct}%`
		rectEl.style.top = `${topPct}%`
		rectEl.style.width = `${wPct}%`
		rectEl.style.height = `${hPct}%`
	}

	return {
		el: wrap,
		/** @param {{ width: number, height: number }} nextVc */
		setVirtualCanvas(nextVc) {
			Object.assign(vc, nextVc)
			stage.style.aspectRatio = `${vc.width} / ${vc.height}`
			region = clampRegionPx(region, vc, 8)
			syncRectDom()
		},
		/** @param {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }} r */
		setRegion(r) {
			region = clampRegionPx(r, vc, 8)
			syncRectDom()
		},
		dispose() {
			if (raf != null) cancelAnimationFrame(raf)
			stage.removeEventListener('pointerdown', onStageDown)
			window.removeEventListener('pointermove', onPointerMove)
			window.removeEventListener('pointerup', onPointerUp)
			window.removeEventListener('pointercancel', onPointerUp)
		},
	}
}

/**
 * @param {{ canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number }} r
 * @param {{ width: number, height: number }} vc
 * @param {number} [minSide]
 */
function clampRegionPx(r, vc, minSide = 1) {
	const min = Math.max(1, Math.min(minSide, vc.width, vc.height))
	let x = Math.max(0, Math.min(r.canvasX, vc.width - min))
	let y = Math.max(0, Math.min(r.canvasY, vc.height - min))
	let w = Math.max(min, Math.min(r.canvasWidth, vc.width - x))
	let h = Math.max(min, Math.min(r.canvasHeight, vc.height - y))
	return { canvasX: x, canvasY: y, canvasWidth: w, canvasHeight: h }
}
