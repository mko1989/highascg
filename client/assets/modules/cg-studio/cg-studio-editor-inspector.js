/** @type {HTMLElement | null} */
let panelsHost = null
/** @type {HTMLElement | null} */
let panelsPark = null

/** @returns {{ panelsHost: HTMLElement, panelsPark: HTMLElement }} */
export function createInspectorPanelHosts() {
	panelsPark = document.createElement('div')
	panelsPark.className = 'cg-studio-panels-park'
	panelsPark.setAttribute('aria-hidden', 'true')

	panelsHost = document.createElement('div')
	panelsHost.className = 'cg-studio-panels-host cg-studio-panels-host--parked'
	panelsHost.innerHTML = `
		<section class="cg-studio-inspector-section">
			<h4 class="cg-studio-inspector-section__title">Blocks</h4>
			<div class="cg-studio-inspector-blocks"></div>
		</section>
		<section class="cg-studio-inspector-section">
			<h4 class="cg-studio-inspector-section__title">Layers</h4>
			<div class="cg-studio-inspector-layers"></div>
		</section>
		<section class="cg-studio-inspector-section cg-studio-inspector-section--grow">
			<h4 class="cg-studio-inspector-section__title">Style</h4>
			<div class="cg-studio-inspector-styles"></div>
		</section>
	`
	panelsPark.appendChild(panelsHost)
	return { panelsHost, panelsPark }
}

/**
 * @param {HTMLElement} root — `#panel-inspector-scroll`
 * @returns {boolean}
 */
export function mountInspectorPanels(root) {
	if (!panelsHost || !root) return false

	let shell = root.querySelector('.cg-studio-inspector-shell')
	if (!shell) {
		root.replaceChildren()
		shell = document.createElement('div')
		shell.className = 'cg-studio-inspector-shell'
		const title = document.createElement('h3')
		title.className = 'inspector-section-title cg-studio-inspector-title'
		title.textContent = 'CG Studio'
		const mount = document.createElement('div')
		mount.className = 'cg-studio-inspector-panels-mount'
		shell.append(title, mount)
		root.appendChild(shell)
	}

	const mount = shell.querySelector('.cg-studio-inspector-panels-mount')
	if (!mount) return false
	if (panelsHost.parentNode !== mount) mount.appendChild(panelsHost)
	panelsHost.classList.remove('cg-studio-panels-host--parked')
	return true
}

export function parkInspectorPanels() {
	if (!panelsHost || !panelsPark) return
	panelsHost.classList.add('cg-studio-panels-host--parked')
	panelsPark.appendChild(panelsHost)
}

function isCgStudioWorkspaceTabActive() {
	const t = document.querySelector('.workspace__tabs .tab[data-tab="cg-studio"]')
	return !!(t && t.classList.contains('active'))
}

export function tryMountInspectorPanels() {
	if (!isCgStudioWorkspaceTabActive()) return
	const root = document.getElementById('panel-inspector-scroll')
	if (!root) return
	const evt = new CustomEvent('highascg-cg-studio-inspector-mount', {
		detail: { root, handled: false },
	})
	window.dispatchEvent(evt)
	if (!evt.detail.handled) mountInspectorPanels(root)
}

/**
 * @param {object} editor
 * @param {{ onTabActivated?: () => void }} [opts]
 */
export function bindInspectorPanelEvents(editor, { onTabActivated } = {}) {
	window.addEventListener('highascg-cg-studio-inspector-mount', (e) => {
		const root = e.detail?.root
		if (!root) return
		if (mountInspectorPanels(root)) e.detail.handled = true
	})

	window.addEventListener('highascg-workspace-tab-activated', (e) => {
		if (e.detail?.tab === 'cg-studio') {
			tryMountInspectorPanels()
			requestAnimationFrame(() => {
				if (editor) {
					editor.refresh()
					onTabActivated?.()
				}
			})
		} else {
			parkInspectorPanels()
		}
	})
}
