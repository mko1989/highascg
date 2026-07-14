import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { shouldShowLiveVideo } from '../lib/stream-state.js'
import { mappingState } from '../lib/mapping-state.js'

export const HANDLE_SIZE = 8
export const ROTATE_HANDLE_DIST = 30

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} wrap
 */
export function createPixelMapCanvasController(canvas, wrap) {
	let scale = 1
	let offsetX = 0
	let offsetY = 0
	let dragMode = null
	let dragStart = { x: 0, y: 0, angle: 0 }
	let selectedId = null
	const ctx = canvas.getContext('2d')

	function fitInContainer() {
		if (!canvas || !wrap) return
		const r = wrap.getBoundingClientRect()
		const w = Math.max(1, r.width)
		const h = Math.max(1, r.height)
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w
			canvas.height = h
		}
		const cw = mappingState.canvasWidth
		const ch = mappingState.canvasHeight
		let minX = 0
		let minY = 0
		let maxX = cw
		let maxY = ch
		for (const m of mappingState.mappings) {
			const { x, y, w: sw, h: sh } = m.rect || { x: 0, y: 0, w: 1, h: 1 }
			minX = Math.min(minX, x)
			minY = Math.min(minY, y)
			maxX = Math.max(maxX, x + sw)
			maxY = Math.max(maxY, y + sh)
		}
		const totalW = maxX - minX
		const totalH = maxY - minY
		const margin = 160
		scale = Math.min((w - margin) / totalW, (h - margin) / totalH, 0.8)
		if (scale < 0.1) scale = 0.1
		const centerX = minX + totalW / 2
		const centerY = minY + totalH / 2
		offsetX = w / 2 - centerX * scale
		offsetY = h / 2 - centerY * scale
	}

	function toCanvas(x, y) {
		return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }
	}

	function getItemAt(cx, cy) {
		for (let i = mappingState.mappings.length - 1; i >= 0; i--) {
			const m = mappingState.mappings[i]
			const { x, y, w, h } = m.rect || { x: 0, y: 0, w: 1, h: 1 }
			const angle = (m.rotation || 0) * (Math.PI / 180)
			const dx = cx - (x + w / 2)
			const dy = cy - (y + h / 2)
			const cosA = Math.cos(-angle)
			const sinA = Math.sin(-angle)
			const lx = dx * cosA - dy * sinA
			const ly = dx * sinA + dy * cosA
			if (lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2) return m
			if (selectedId === m.id) {
				const hdist = Math.sqrt((lx - 0) ** 2 + (ly + h / 2 + ROTATE_HANDLE_DIST) ** 2)
				if (hdist < (HANDLE_SIZE / scale) * 2) return { ...m, _handle: 'rotate' }
			}
		}
		return null
	}

	function draw() {
		if (!ctx || !canvas) return
		const mw = mappingState.canvasWidth
		const mh = mappingState.canvasHeight
		const bx = offsetX
		const by = offsetY
		const bw = mw * scale
		const bh = mh * scale
		ctx.fillStyle = '#0a0e13'
		ctx.fillRect(0, 0, canvas.width, canvas.height)
		if (!shouldShowLiveVideo()) {
			ctx.fillStyle = '#131a22'
			ctx.fillRect(bx, by, bw, bh)
		}
		ctx.strokeStyle = 'rgba(255,255,255,0.2)'
		ctx.setLineDash([5, 5])
		ctx.strokeRect(bx, by, bw, bh)
		ctx.setLineDash([])
		for (const m of mappingState.mappings) {
			const { x, y, w, h } = m.rect || { x: 0, y: 0, w: 1, h: 1 }
			const angle = (m.rotation || 0) * (Math.PI / 180)
			const isSelected = selectedId === m.id
			ctx.save()
			ctx.translate(bx + (x + w / 2) * scale, by + (y + h / 2) * scale)
			ctx.rotate(angle)
			ctx.fillStyle = m.type === 'video_slice'
				? isSelected ? 'rgba(88,166,255,0.2)' : 'rgba(88,166,255,0.1)'
				: isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'
			ctx.fillRect((-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale)
			ctx.strokeStyle = isSelected ? '#58a6ff' : m.type === 'video_slice' ? '#388bfd' : '#8b949e'
			ctx.lineWidth = isSelected ? 2 : 1
			ctx.strokeRect((-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale)
			ctx.fillStyle = '#fff'
			ctx.font = `bold 10px ${UI_FONT_FAMILY}`
			ctx.textAlign = 'center'
			let label = m.label || m.id
			if (m.mirrorH || m.mirrorV) {
				label += ` [${m.mirrorH ? 'H' : ''}${m.mirrorH && m.mirrorV ? '/' : ''}${m.mirrorV ? 'V' : ''}]`
			}
			ctx.fillText(label, 0, (-h / 2) * scale - 12)
			if (isSelected) {
				ctx.beginPath()
				ctx.strokeStyle = '#58a6ff'
				ctx.moveTo(0, (-h / 2) * scale)
				ctx.lineTo(0, (-h / 2) * scale - ROTATE_HANDLE_DIST * scale)
				ctx.stroke()
				ctx.fillStyle = '#58a6ff'
				ctx.beginPath()
				ctx.arc(0, (-h / 2) * scale - ROTATE_HANDLE_DIST * scale, (HANDLE_SIZE / 2) * scale, 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.restore()
		}
	}

	function applyMagnetism(rect, mappings, canvasWidth, canvasHeight, threshold = 12) {
		let snappedX = rect.x
		let snappedY = rect.y
		const xTargets = [0, canvasWidth - rect.w]
		const yTargets = [0, canvasHeight - rect.h]
		for (const m of mappings) {
			if (m.id === selectedId) continue
			const r = m.rect
			if (!r) continue
			xTargets.push(r.x, r.x + r.w, r.x - rect.w, r.x + r.w - rect.w)
			yTargets.push(r.y, r.y + r.h, r.y - rect.h, r.y + r.h - rect.h)
		}
		let minDiffX = Infinity
		for (const target of xTargets) {
			const diff = Math.abs(rect.x - target)
			if (diff <= threshold && diff < minDiffX) {
				minDiffX = diff
				snappedX = target
			}
		}
		let minDiffY = Infinity
		for (const target of yTargets) {
			const diff = Math.abs(rect.y - target)
			if (diff <= threshold && diff < minDiffY) {
				minDiffY = diff
				snappedY = target
			}
		}
		return { x: snappedX, y: snappedY }
	}

	/**
	 * @param {{ onSelectionChange?: (id: string | null) => void }} [opts]
	 */
	function bindInteractions(opts = {}) {
		canvas.addEventListener('mousedown', (e) => {
			const rect = canvas.getBoundingClientRect()
			const p = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
				dragMode = 'pan'
				dragStart = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY }
				e.preventDefault()
				return
			}
			const item = getItemAt(p.x, p.y)
			if (item) {
				selectedId = item.id
				opts.onSelectionChange?.(selectedId)
				if (item._handle === 'rotate') {
					dragMode = 'rotate'
					const angle = (item.rotation || 0) * (Math.PI / 180)
					const dx = p.x - (item.rect.x + item.rect.w / 2)
					const dy = p.y - (item.rect.y + item.rect.h / 2)
					dragStart = { angle: Math.atan2(dy, dx) - angle }
				} else {
					dragMode = 'move'
					dragStart = { x: p.x, y: p.y, rect: { ...item.rect } }
				}
			} else {
				selectedId = null
				opts.onSelectionChange?.(null)
			}
			draw()
		})

		canvas.addEventListener('contextmenu', (e) => e.preventDefault())

		canvas.addEventListener('wheel', (e) => {
			e.preventDefault()
			const rect = canvas.getBoundingClientRect()
			const mx = e.clientX - rect.left
			const my = e.clientY - rect.top
			const before = toCanvas(mx, my)
			const factor = -e.deltaY > 0 ? 1.1 : 0.9
			scale = Math.max(0.05, Math.min(20, scale * factor))
			offsetX = mx - before.x * scale
			offsetY = my - before.y * scale
			draw()
		}, { passive: false })

		canvas.addEventListener('mousemove', (e) => {
			if (!dragMode) return
			const rect = canvas.getBoundingClientRect()
			const p = toCanvas(e.clientX - rect.left, e.clientY - rect.top)
			if (dragMode === 'pan') {
				offsetX = dragStart.ox + (e.clientX - dragStart.x)
				offsetY = dragStart.oy + (e.clientY - dragStart.y)
			} else if (dragMode === 'move') {
				const dx = p.x - dragStart.x
				const dy = p.y - dragStart.y
				let newX = Math.round(dragStart.rect.x + dx)
				let newY = Math.round(dragStart.rect.y + dy)
				const snapped = applyMagnetism(
					{ x: newX, y: newY, w: dragStart.rect.w, h: dragStart.rect.h },
					mappingState.mappings,
					mappingState.canvasWidth,
					mappingState.canvasHeight,
					12,
				)
				mappingState.updateMapping(selectedId, { rect: { x: snapped.x, y: snapped.y } })
				const m = mappingState.mappings.find((x) => x.id === selectedId)
				if (m?.outputId) {
					const elX = document.querySelector(`input[data-slice-output-id="${m.outputId}"][data-field="x"]`)
					if (elX) elX.value = snapped.x
					const elY = document.querySelector(`input[data-slice-output-id="${m.outputId}"][data-field="y"]`)
					if (elY) elY.value = snapped.y
				}
			} else if (dragMode === 'rotate') {
				const m = mappingState.mappings.find((i) => i.id === selectedId)
				if (!m) return
				const dx = p.x - (m.rect.x + m.rect.w / 2)
				const dy = p.y - (m.rect.y + m.rect.h / 2)
				const angle = Math.atan2(dy, dx) - dragStart.angle
				mappingState.updateMapping(selectedId, { rotation: Math.round(angle * (180 / Math.PI)) })
			}
			draw()
		})

		canvas.addEventListener('mouseup', () => {
			dragMode = null
			draw()
		})
	}

	return {
		fitInContainer,
		draw,
		bindInteractions,
		getSelectedId: () => selectedId,
		setSelectedId: (id) => {
			selectedId = id
		},
	}
}
