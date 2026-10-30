/**
 * WO-844: one shared focus guard for document-level keyboard shortcuts (Space play, Ctrl+C/V clip, Ctrl+Z undo,
 * Delete). Without it a shortcut meant for one tab fires while the operator types in a field of another tab: Space
 * toggled playback, Ctrl+V pasted a clip, Ctrl+Z rolled back the device graph instead of undoing the typing.
 */

const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'

/**
 * @param {unknown} target event target (or any node); non-elements fall back to the focused element
 * @returns {boolean} true when the key press belongs to a text-entry control
 */
export function isTextEntryTarget(target) {
	let el = target
	if (!el || typeof el.closest !== 'function') el = typeof document !== 'undefined' ? document.activeElement : null
	if (!el || typeof el.closest !== 'function') return false
	if (el.isContentEditable) return true
	return !!el.closest(TEXT_ENTRY_SELECTOR)
}

/**
 * @param {Element | null | undefined} panel the tab pane / view root a handler belongs to
 * @returns {boolean} true when the panel is attached, its tab is not hidden and it is laid out
 */
export function isPanelActive(panel) {
	if (!panel || panel.isConnected === false) return false
	const pane = typeof panel.closest === 'function' ? panel.closest('.tab-pane') : null
	if (pane && pane.classList && !pane.classList.contains('active')) return false
	if ('offsetParent' in panel && panel.offsetParent === null) return false
	return true
}

/**
 * True when a shortcut handler must NOT act: focus is in a text-entry control, the handler's panel is not the visible
 * one, or the event comes from inside a different tab pane than the handler's.
 *
 * @param {KeyboardEvent} ev
 * @param {Element | null} [panel] pass the handler's own tab/view root to also require it to be the active one
 * @returns {boolean}
 */
export function shouldIgnoreShortcut(ev, panel) {
	if (isTextEntryTarget(ev?.target)) return true
	if (panel === undefined) return false
	if (!isPanelActive(panel)) return true
	const targetPane = ev?.target && typeof ev.target.closest === 'function' ? ev.target.closest('.tab-pane') : null
	if (targetPane && !targetPane.contains(panel) && !panel.contains(targetPane)) return true
	return false
}
