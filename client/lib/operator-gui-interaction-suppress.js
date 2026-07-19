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
let _htmlDrag = false

function recompute() {
	setInteractionSuppressed(_modalOpen || _pointerDown || _htmlDrag)
}

function onPointerDown(e) {
	onPointerActivity() // touch taps reach here without a preceding pointermove
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

// HTML5 drag-and-drop (2026-07-17, mv-editor blend): a source-panel drag must suppress the video
// holes for its whole duration — dragover/drop events can NEVER fire over a hole (the hole is
// outside Firefox's window shape), so without this, dropping a source onto a video window region
// of the multiview editor (or any future drop target under a hole) silently does nothing.
// dragstart/dragend both bubble to document; dragend fires on the SOURCE element even for
// cancelled drags, and `drop` is belt-and-suspenders for edge cases. BUT: if the source node
// is detached mid-drag (panels rebuild innerHTML on poll/state events), a cancelled drag's
// dragend has no propagation path to document (Firefox may skip it entirely) — see
// onPointerActivity for the recovery path, without which the latch sticks forever.
function onDragStart() {
	_htmlDrag = true
	recompute()
}

function onDragEnd() {
	if (!_htmlDrag) return
	_htmlDrag = false
	recompute()
}

// Failsafe for the lost-dragend case: during a native HTML5 drag the browser swallows all
// pointer events (only drag* fire), so ANY pointer activity while _htmlDrag is set proves the
// drag already ended and its dragend/drop never reached us — clear the latch.
function onPointerActivity() {
	if (!_htmlDrag) return
	_htmlDrag = false
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
	document.addEventListener('dragstart', onDragStart, true)
	document.addEventListener('dragend', onDragEnd, true)
	document.addEventListener('drop', onDragEnd, true)
	document.addEventListener('pointermove', onPointerActivity, true)
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
		document.removeEventListener('dragstart', onDragStart, true)
		document.removeEventListener('dragend', onDragEnd, true)
		document.removeEventListener('drop', onDragEnd, true)
		document.removeEventListener('pointermove', onPointerActivity, true)
	}
	_pointerDown = false
	_modalOpen = false
	_htmlDrag = false
}
