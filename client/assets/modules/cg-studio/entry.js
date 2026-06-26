/**
 * CG Overlay Studio (Template Editor) — optional module entry (WO-32).
 *
 * Bundled by Vite; loaded from `client/lib/optional-modules.js`.
 */

import 'grapesjs/dist/css/grapes.min.css'
import '../../../styles/cg-studio.css'

const TAB_ID = 'cg-studio'
const TAB_LABEL = 'CG Studio'

/**
 * @param {{ stateStore?: object, ws?: object, api?: object }} _ctx
 */
export default async function initCgStudioModule(_ctx) {
	console.info('[cg-studio] module loading')

	try {
		const res = await fetch('/api/cg-studio/health', { credentials: 'same-origin' })
		if (res.ok) {
			const info = await res.json()
			console.info('[cg-studio] /api/cg-studio/health →', info)
		}
	} catch (e) {
		console.warn('[cg-studio] health check failed:', e && e.message ? e.message : e)
	}

	registerCgStudioWorkspaceTab()

	return { ready: true }
}

function registerCgStudioWorkspaceTab() {
	const tabs = document.querySelector('.workspace__tabs')
	const content = document.querySelector('.workspace__content')
	if (!tabs || !content) {
		console.warn('[cg-studio] workspace shell not found')
		return
	}
	if (document.querySelector(`.tab[data-tab="${TAB_ID}"]`)) return

	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'tab'
	btn.dataset.tab = TAB_ID
	btn.textContent = TAB_LABEL
	tabs.appendChild(btn)

	const pane = document.createElement('div')
	pane.className = 'tab-pane'
	pane.id = `tab-${TAB_ID}`
	content.appendChild(pane)

	let editorLoaded = false

	async function ensureEditor() {
		if (editorLoaded) return
		editorLoaded = true
		try {
			const { initEditor } = await import('./cg-studio-editor.js')
			await initEditor(pane)
		} catch (e) {
			console.error('[cg-studio] Failed to load editor:', e)
			pane.innerHTML = `<p class="cg-studio-error">Failed to load CG Studio: ${e && e.message ? e.message : e}</p>`
			throw e
		}
	}

	window.addEventListener('highascg-workspace-tab-activated', (ev) => {
		if (ev.detail?.tab === TAB_ID) {
			void ensureEditor().then(() => {
				requestAnimationFrame(() => {
					window.dispatchEvent(new CustomEvent('highascg-inspector-redraw'))
				})
			})
		}
	})

	let pendingTemplateLoad = null

	window.addEventListener('highascg-cg-studio-edit-template', async (e) => {
		const id = e.detail?.id
		if (!id) return
		pendingTemplateLoad = id

		if (typeof window.highascgActivateWorkspaceTab === 'function') {
			window.highascgActivateWorkspaceTab(TAB_ID)
		}

		await ensureEditor()

		if (pendingTemplateLoad === id) {
			pendingTemplateLoad = null
			window.dispatchEvent(new CustomEvent('highascg-cg-studio-load-template', { detail: { id } }))
		}
	})

	console.info('[cg-studio] workspace tab registered')
}
