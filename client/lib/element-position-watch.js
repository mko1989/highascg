/**
 * Element position watcher — fires when an element MOVES in the viewport WITHOUT resizing.
 *
 * Why (2026-07-19 bug): the operator-GUI rect reporting (client/lib/operator-gui-mode.js) is
 * re-measured on ResizeObserver / window resize / scroll — but a pure position change fires none
 * of those. Switching between the looks list and the looks editor toggles the rundown slot above
 * the compose preview, shifting the whole tile canvas vertically at the exact same size, so the
 * punched X SHAPE holes / route video stayed at the old Y while the DOM tile borders moved.
 *
 * Zero-idle-cost mechanism (no polling, no per-frame getBoundingClientRect while nothing moves):
 * an IntersectionObserver whose root box is the VIEWPORT inset via rootMargin to hug the
 * element's current rect, inflated by {@link POSITION_WATCH_SLACK}px. While the element stays put
 * it sits fully inside that box and the observer is silent; any move beyond the slack pushes part
 * of it across the box edge, a threshold is crossed, and the callback re-measures ONCE, re-hugs
 * the new position, and notifies. Sub-slack (a couple px) drift is deliberately ignored — every
 * real layout reflow (view switch, panel collapse above, splitter jump) moves by far more.
 *
 * Plain ESM with no top-level DOM access — `require()`-safe under node:test like
 * client/components/operator-compose-tiles.js (see tools/smoke/smoke-wo256-operator-compose-tiles.test.js).
 */

/** px the hug-box is inflated by on every side — also the minimum movement that gets detected. */
export const POSITION_WATCH_SLACK = 2

/** Threshold ladder (0..1 step .01): guarantees a crossing even when the element is partially
 * outside the viewport (ratio < 1 at rest, so the single `threshold: 1` edge would never fire). */
export const POSITION_WATCH_THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100)

/**
 * Pure: the IntersectionObserver rootMargin that insets the implicit (viewport) root down to
 * `rect` inflated by `slack`px on every side. Components are negative for a rect inside the
 * viewport (rootMargin shrinks toward it); an edge outside the viewport yields a positive
 * (expanding) component, which is valid — that side just can't reach full containment, and
 * movement detection rides the threshold ladder instead. Floored so rounding only ever GROWS the
 * box (containment at rest is never lost to sub-pixel positions).
 * @param {{ left: number, top: number, right: number, bottom: number }} rect - getBoundingClientRect()-shaped
 * @param {{ width: number, height: number }} viewport
 * @param {number} [slack]
 * @returns {string} `top right bottom left` px rootMargin
 */
export function positionWatchRootMargin(rect, viewport, slack = POSITION_WATCH_SLACK) {
	const top = Math.floor(rect.top) - slack
	const left = Math.floor(rect.left) - slack
	const right = Math.floor(viewport.width - rect.right) - slack
	const bottom = Math.floor(viewport.height - rect.bottom) - slack
	return `${-top}px ${-right}px ${-bottom}px ${-left}px`
}

/**
 * Watch `el`'s viewport position; call `onMoved()` whenever it moves (any direction, > ~2px)
 * without the caller's other triggers having fired. The caller MUST call `update()` after each of
 * its own layout/report passes so the hug-box tracks the freshest position (a no-op when the
 * element hasn't actually moved — cheap enough for rAF-throttled report loops).
 * @param {Element} el
 * @param {() => void} onMoved
 * @returns {{ update: () => void, destroy: () => void }}
 */
export function watchElementPosition(el, onMoved) {
	if (!el || typeof IntersectionObserver === 'undefined' || typeof window === 'undefined') {
		return { update: () => {}, destroy: () => {} }
	}
	/** @type {IntersectionObserver|null} */
	let io = null
	/** position + viewport the current hug-box was built for */
	let armed = null
	const moved = () => {
		if (!armed) return true
		const r = el.getBoundingClientRect()
		return Math.abs(r.left - armed.left) >= 1 || Math.abs(r.top - armed.top) >= 1
	}
	const arm = () => {
		if (io) { io.disconnect(); io = null }
		const r = el.getBoundingClientRect()
		const vw = Math.max(1, window.innerWidth || 1)
		const vh = Math.max(1, window.innerHeight || 1)
		armed = { left: r.left, top: r.top, vw, vh }
		// Hidden (display:none / collapsed ancestor): nothing to hug — update() re-arms once visible.
		if (!(r.width > 0) || !(r.height > 0)) return
		io = new IntersectionObserver(() => {
			// observe() always fires once immediately — only treat a callback as movement when the
			// element actually left its armed position; otherwise keep the still-hugging box.
			if (!moved()) return
			arm() // re-hug FIRST so a move during onMoved()'s (async) work isn't lost
			onMoved()
		}, { rootMargin: positionWatchRootMargin(r, { width: vw, height: vh }), threshold: POSITION_WATCH_THRESHOLDS })
		io.observe(el)
	}
	return {
		update: () => {
			const vw = Math.max(1, window.innerWidth || 1)
			const vh = Math.max(1, window.innerHeight || 1)
			if (!io || !armed || armed.vw !== vw || armed.vh !== vh || moved()) arm()
		},
		destroy: () => {
			if (io) { io.disconnect(); io = null }
			armed = null
		},
	}
}
