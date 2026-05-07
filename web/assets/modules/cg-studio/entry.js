/**
 * Template Editor (CG Studio) web entry point.
 * This is loaded dynamically when the cg-studio module is enabled.
 */

console.log('[cg-studio] Template Editor module loaded successfully.')

function initCgStudio() {
	const tabs = document.querySelector('.workspace__tabs')
	const content = document.querySelector('.workspace__content')
	if (!tabs || !content) return

	const btn = document.createElement('button')
	btn.className = 'tab'
	btn.dataset.tab = 'cg-studio'
	btn.textContent = 'Template Editor'
	tabs.appendChild(btn)

	const pane = document.createElement('div')
	pane.className = 'tab-pane'
	pane.id = 'tab-cg-studio'
	// GrapesJS needs full height
	pane.style.display = 'none'
	pane.style.flexDirection = 'column'
	content.appendChild(pane)

	let editorLoaded = false

	// Handle standard tab switching for our new tab
	btn.addEventListener('click', async () => {
		document.querySelectorAll('.workspace__tabs .tab').forEach(t => t.classList.remove('active'))
		document.querySelectorAll('.workspace__content .tab-pane').forEach(p => {
			if (p.id === 'tab-cg-studio') p.style.display = 'none'
			else p.classList.remove('active')
		})
		btn.classList.add('active')
		pane.style.display = 'flex'

		if (!editorLoaded) {
			editorLoaded = true
			try {
				const { initEditor } = await import('./cg-studio-editor.js?v=' + Date.now())
				initEditor(pane)
			} catch (e) {
				console.error('[cg-studio] Failed to load editor:', e)
				pane.innerHTML = `<div class="error-msg">Failed to load Template Editor: ${e.message}</div>`
			}
		}
	})

	// Add global CSS for cg-studio tab overrides if needed
	const style = document.createElement('style')
	style.textContent = `
		#tab-cg-studio { height: 100%; width: 100%; overflow: hidden; }
		.gjs-cv-canvas { top: 0; width: 100%; height: 100%; }
		/* HighAsCG specific tweaks for GrapesJS */
		.cg-studio-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--bg-panel); border-bottom: 1px solid var(--border); }
		.gjs-pn-views-container { height: 100%; }
	`
	document.head.appendChild(style)
}

// When the DOM is ready (which it usually is when modules load), inject the UI
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initCgStudio)
} else {
	initCgStudio()
}
