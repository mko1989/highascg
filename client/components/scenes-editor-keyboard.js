'use strict'

function isScenesTabActive() {
	const tab = document.getElementById('tab-scenes')
	return !!tab?.classList?.contains('active')
}

/**
 * Global shortcuts while the Scenes workspace tab is active.
 * Space → take preview to program (skipped when typing in a field).
 *
 * @param {{ globalTakeFromPreview: () => void | Promise<void> }} deps
 */
export function attachScenesEditorKeyboard(deps) {
	const onKeydown = (e) => {
		if (!isScenesTabActive()) return
		if (e.defaultPrevented) return
		if (e.ctrlKey || e.metaKey || e.altKey) return
		if (e.key !== ' ') return
		if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return
		e.preventDefault()
		void deps.globalTakeFromPreview()
	}

	document.addEventListener('keydown', onKeydown, true)
	return {
		destroy() {
			document.removeEventListener('keydown', onKeydown, true)
		},
	}
}
