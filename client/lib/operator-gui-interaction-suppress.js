/**
 * WO-255 T255.3 — detects the two interaction conditions that must suppress the operator-GUI video
 * overlay (client/lib/operator-gui-mode.js's `setInteractionSuppressed`): a modal/dropdown/
 * context-menu open, or a pointer-drag in progress on a preview surface.
 *
 * Deliberately a generic, DOM-shape-driven detector rather than per-component wiring — there is no
 * existing global "modal open" registry in this codebase (15+ independent modal components each
 * manage their own open/close state), but every one of them shares the SAME convention:
 * `modal.className = 'modal-overlay'` (see e.g. client/components/live-input-modal-shell.js). A
 * `MutationObserver` on `document.body` watching for `.modal-overlay` appearing/disappearing covers
 * all of them for free, with zero per-modal changes and no risk of missing a future one.
 *
 * "Pointer-drag on a preview surface" is detected the same way: a capture-phase `pointerdown` whose
 * target is inside a known preview-surface container (`.preview-panel__compose-cell` — the compose/
 * timeline surfaces share this class via `preview-canvas-panel.js`'s `initPreviewPanel` — or
 * `.mv-canvas-wrap` for the multiview editor, or `.operator-compose-tiles` for the WO-256 operator-
 * GUI free-tile canvas's own header-drag/corner-resize handles) starts suppression; the next
 * `pointerup`/`pointercancel` anywhere (drags routinely end outside the starting element) ends it.
 * This intentionally covers ANY pointer interaction on those surfaces (not just the "known" drag
 * handlers), which is the safe direction to err in — a suppressed frame during a plain click is
 * imperceptible, an unsuppressed frame during an actual drag hides the drag chrome (the bug this
 * exists to prevent).
 */

import { setInteractionSuppressed } from './operator-gui-mode.js'

// WO-263 inversion: `.operator-compose-tiles` is deliberately NOT here. Under the old video-on-top
// model a tile drag had to suppress (fill the holes) because the video couldn't show the drag. Now
// the holes are punched in FIREFOX, so a tile drag/resize reports its rects LIVE and the hole tracks
// the box in real time (operator-compose-tiles.js onDragMove → scheduleReport) — suppressing would
// blank the very video the operator is trying to position. Only genuine occluders (modals/dropdowns)
// and the OTHER preview surfaces still suppress.
const PREVIEW_SURFACE_SELECTOR = '.preview-panel__compose-cell, .preview-panel__canvas, .mv-canvas-wrap'

let _modalObserver = null
let _pointerDown = false
let _modalOpen = false

function recompute() {
	setInteractionSuppressed(_modalOpen || _pointerDown)
}

function onPointerDown(e) {
	if (!e.target || typeof e.target.closest !== 'function') return
	if (!e.target.closest(PREVIEW_SURFACE_SELECTOR)) return
	_pointerDown = true
	recompute()
}

function onPointerUp() {
	if (!_pointerDown) return
	_pointerDown = false
	recompute()
}

function hasModalOverlay() {
	return !!document.querySelector('.modal-overlay')
}

function onDomMutated() {
	const open = hasModalOverlay()
	if (open === _modalOpen) return
	_modalOpen = open
	recompute()
}

/**
 * Wires the document-level listeners. Idempotent (safe to call more than once — later calls are
 * no-ops until {@link stopOperatorGuiInteractionSuppress} runs). No-op when `document` is
 * unavailable (SSR/tests) — callers may invoke this unconditionally at startup.
 */
export function initOperatorGuiInteractionSuppress() {
	if (typeof document === 'undefined') return
	if (_modalObserver) return
	_modalOpen = hasModalOverlay()
	_modalObserver = new MutationObserver(onDomMutated)
	_modalObserver.observe(document.body, { childList: true, subtree: true })
	document.addEventListener('pointerdown', onPointerDown, true)
	document.addEventListener('pointerup', onPointerUp, true)
	document.addEventListener('pointercancel', onPointerUp, true)
	recompute()
}

/** Test-only / cleanup: tear down the listeners and reset detector state. */
export function stopOperatorGuiInteractionSuppress() {
	if (_modalObserver) {
		_modalObserver.disconnect()
		_modalObserver = null
	}
	if (typeof document !== 'undefined') {
		document.removeEventListener('pointerdown', onPointerDown, true)
		document.removeEventListener('pointerup', onPointerUp, true)
		document.removeEventListener('pointercancel', onPointerUp, true)
	}
	_pointerDown = false
	_modalOpen = false
}
