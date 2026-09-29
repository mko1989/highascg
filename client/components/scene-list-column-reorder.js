/**
 * Look-card reordering inside a single main's deck column (drag the thumbnail, vertical
 * drop-line shows where it will land). Scoped to one grid — no cross-column drag.
 *
 * Built on Pointer Events rather than native HTML5 drag-and-drop: the operator kiosk is
 * Firefox ESR, which does not reliably fire `dragstart` for `draggable` set on (or inside)
 * a <button> — tried both "whole card is the drag source" and "button itself is the drag
 * source" and neither worked consistently. Plain pointerdown/move/up has none of that.
 */

const DRAG_THRESHOLD_PX = 5

/**
 * @param {HTMLElement} grid — the `.scenes-deck` element for one main column
 * @param {import('../lib/scene-state.js').SceneState} sceneState
 * @returns {{ makeCardDraggable: (card: HTMLElement, handleEl: HTMLElement, sceneId: string) => void }}
 */
export function attachLookDeckReorder(grid, sceneState) {
	let dragSceneId = null

	const dropIndicator = document.createElement('div')
	dropIndicator.className = 'scenes-deck__drop-indicator'
	grid.appendChild(dropIndicator)

	function cardsExcept(id) {
		return Array.from(grid.querySelectorAll('.scenes-card')).filter((c) => c.dataset.sceneId !== id)
	}

	/* Nearest-card-by-distance, not exact hit-testing: `elementFromPoint` resolves to the grid
	 * itself (not a card) inside the gaps between cards — a common cursor position, not an edge
	 * case — and treating "no card under the cursor" as "append at the end" made the drop-line
	 * jump to the end every time the pointer crossed a gap. Snapping to whichever card's center is
	 * closest keeps the line stable and matches what's actually nearby the cursor. */
	function computeDrop(e) {
		const cards = cardsExcept(dragSceneId)
		if (!cards.length) return null
		let nearest = cards[0]
		let nearestDist = Infinity
		for (const c of cards) {
			const r = c.getBoundingClientRect()
			const dx = e.clientX - (r.left + r.width / 2)
			const dy = e.clientY - (r.top + r.height / 2)
			const dist = dx * dx + dy * dy
			if (dist < nearestDist) {
				nearestDist = dist
				nearest = c
			}
		}
		const r = nearest.getBoundingClientRect()
		if (e.clientX < r.left + r.width / 2) {
			return { insertBeforeId: nearest.dataset.sceneId, edgeEl: nearest, side: 'left' }
		}
		const idx = cards.indexOf(nearest)
		const next = cards[idx + 1]
		return { insertBeforeId: next ? next.dataset.sceneId : null, edgeEl: nearest, side: 'right' }
	}

	function showIndicator(drop) {
		const r = drop.edgeEl.getBoundingClientRect()
		const gridRect = grid.getBoundingClientRect()
		const x = (drop.side === 'left' ? r.left : r.right) - gridRect.left + grid.scrollLeft
		dropIndicator.style.left = `${x - 1}px`
		dropIndicator.style.top = `${r.top - gridRect.top + grid.scrollTop}px`
		dropIndicator.style.height = `${r.height}px`
		dropIndicator.style.display = 'block'
	}

	function hideIndicator() {
		dropIndicator.style.display = 'none'
	}

	function makeCardDraggable(card, handleEl, sceneId) {
		handleEl.style.touchAction = 'none'
		let pointerId = null
		let startX = 0
		let startY = 0
		let dragging = false
		let pendingDrop = null
		let suppressNextClick = false

		function endDrag() {
			if (pointerId != null) {
				try { handleEl.releasePointerCapture(pointerId) } catch { /* already released */ }
			}
			pointerId = null
			if (!dragging) return
			dragging = false
			dragSceneId = null
			card.classList.remove('scenes-card--dragging')
			hideIndicator()
			const drop = pendingDrop
			pendingDrop = null
			suppressNextClick = true
			if (drop && drop.insertBeforeId !== sceneId) sceneState.reorderScene(sceneId, drop.insertBeforeId)
		}

		handleEl.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return
			pointerId = e.pointerId
			startX = e.clientX
			startY = e.clientY
			dragging = false
			try { handleEl.setPointerCapture(pointerId) } catch { /* ignore */ }
		})

		handleEl.addEventListener('pointermove', (e) => {
			if (e.pointerId !== pointerId) return
			if (!dragging) {
				if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return
				dragging = true
				dragSceneId = sceneId
				card.classList.add('scenes-card--dragging')
			}
			e.preventDefault()
			const drop = computeDrop(e)
			pendingDrop = drop
			if (drop) showIndicator(drop)
			else hideIndicator()
		})

		handleEl.addEventListener('pointerup', (e) => {
			if (e.pointerId !== pointerId) return
			endDrag()
		})
		handleEl.addEventListener('pointercancel', (e) => {
			if (e.pointerId !== pointerId) return
			endDrag()
		})

		/* A completed drag still ends in a native 'click' on the handle (pointerup with no native
		 * drag session involved) — swallow that one click so it doesn't also fire "send to preview". */
		handleEl.addEventListener('click', (e) => {
			if (!suppressNextClick) return
			suppressNextClick = false
			e.stopPropagation()
			e.preventDefault()
		}, true)
	}

	return { makeCardDraggable }
}
