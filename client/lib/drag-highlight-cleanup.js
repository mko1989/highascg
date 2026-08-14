/**
 * Clear stray drag-hover highlights when a drag ends anywhere (WO-518).
 *
 * Owner 13.08: *"going between looks and timelines screwes up the compose preview. also there is a
 * weird dotted blue line around the compose preview, why???"* — that line is
 * `outline: 1px/2px dashed var(--accent)` (#58a6ff) from a `--drag-over` / `--drop-target` class
 * that was added on `dragover` and never removed.
 *
 * `dragleave` is not a reliable counterpart to `dragover`. It does not fire when the drag is
 * cancelled with Esc, when the pointer leaves the window, or when the drop lands on a different
 * element — and if the view re-renders mid-drag the element keeps the class with no listener left
 * to clear it. The result is a highlight that outlives the gesture and follows the operator to
 * whatever they look at next.
 *
 * One window-level listener on the events that mean "the gesture is over, whatever happened"
 * (`dragend`, `drop`) sweeps every known highlight class. Capture phase, so a `stopPropagation()`
 * in a component's own handler cannot prevent the cleanup.
 */

/** Every class that paints a drag-hover affordance. Add new ones here, not to a second sweeper. */
/* WO-538: module-private. `installDragHighlightCleanup` is this file's whole public
 * surface; exporting the parts invited a second sweeper, which the comment above forbids. */
const DRAG_HIGHLIGHT_CLASSES = [
	'scenes-layer--drag-over',
	'scenes-layer-row--drop-target',
	'scenes-layer-row--dragging',
	'operator-compose-tile--drag-over',
	'scenes-deck-card--drag-over',
]

/**
 * Remove every drag-hover class currently in the document.
 * @param {Document | HTMLElement} [root]
 */
function clearDragHighlights(root = document) {
	for (const cls of DRAG_HIGHLIGHT_CLASSES) {
		for (const el of root.querySelectorAll(`.${cls}`)) el.classList.remove(cls)
	}
}

let installed = false

/** Idempotent — safe to call from every component that paints a highlight. */
export function installDragHighlightCleanup() {
	if (installed || typeof window === 'undefined') return
	installed = true
	const sweep = () => clearDragHighlights()
	// `dragend` fires on the SOURCE, `drop` on the target — between them every completed or
	// abandoned drag is covered. Capture so component handlers calling stopPropagation cannot
	// swallow it, and passive since we never preventDefault here.
	window.addEventListener('dragend', sweep, { capture: true, passive: true })
	window.addEventListener('drop', sweep, { capture: true, passive: true })
	// Esc-cancelled drags emit neither in some browsers; the key is the only signal left.
	window.addEventListener(
		'keydown',
		(e) => {
			if (e.key === 'Escape') sweep()
		},
		{ capture: true, passive: true },
	)
}
