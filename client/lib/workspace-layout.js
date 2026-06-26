/**
 * Resizable / collapsible Sources + Inspector side panels (main app shell).
 * Persists widths and collapsed state in localStorage (`highascg.workspace.v1.*`).
 */

const NS = 'highascg.workspace.v1'
const K = {
	sourcesW: `${NS}.sourcesW`,
	inspectorW: `${NS}.inspectorW`,
	sourcesCollapsed: `${NS}.sourcesCollapsed`,
	inspectorCollapsed: `${NS}.inspectorCollapsed`,
}

function readNum(key, fallback, min, max) {
	try {
		const n = parseInt(localStorage.getItem(key) || '', 10)
		if (!Number.isFinite(n)) return fallback
		return Math.max(min, Math.min(max, n))
	} catch {
		return fallback
	}
}

/**
 * Wire collapse buttons and resize handles for `#panel-sources`, `#panel-inspector`,
 * `#resize-sources`, `#resize-inspector`.
 */
export function initWorkspaceLayout() {
	const root = document.documentElement
	const panelSources = document.getElementById('panel-sources')
	const panelInspector = document.getElementById('panel-inspector')
	const resizeSources = document.getElementById('resize-sources')
	const resizeInspector = document.getElementById('resize-inspector')
	const btnSources = document.getElementById('panel-sources-collapse')
	const btnInspector = document.getElementById('panel-inspector-collapse')
	if (!panelSources || !panelInspector) return

	let sourcesW = readNum(K.sourcesW, 300, 220, 520)
	let inspectorW = readNum(K.inspectorW, 280, 220, 640)
	let sourcesCollapsed = false
	let inspectorCollapsed = false
	try {
		sourcesCollapsed = localStorage.getItem(K.sourcesCollapsed) === '1'
	} catch {
		/* ignore */
	}
	try {
		inspectorCollapsed = localStorage.getItem(K.inspectorCollapsed) === '1'
	} catch {
		/* ignore */
	}

	function persist() {
		try {
			localStorage.setItem(K.sourcesW, String(sourcesW))
			localStorage.setItem(K.inspectorW, String(inspectorW))
			localStorage.setItem(K.sourcesCollapsed, sourcesCollapsed ? '1' : '0')
			localStorage.setItem(K.inspectorCollapsed, inspectorCollapsed ? '1' : '0')
		} catch {
			/* ignore */
		}
	}

	function apply() {
		root.style.setProperty('--sources-panel-w', `${sourcesW}px`)
		root.style.setProperty('--inspector-panel-w', `${inspectorW}px`)
		panelSources.classList.toggle('panel--collapsed', sourcesCollapsed)
		panelInspector.classList.toggle('panel--collapsed', inspectorCollapsed)
		if (resizeSources) resizeSources.hidden = sourcesCollapsed
		if (resizeInspector) resizeInspector.hidden = inspectorCollapsed
		if (btnSources) {
			btnSources.setAttribute('aria-expanded', sourcesCollapsed ? 'false' : 'true')
			btnSources.textContent = sourcesCollapsed ? '»' : '«'
			btnSources.title = sourcesCollapsed ? 'Expand Sources' : 'Collapse Sources'
		}
		if (btnInspector) {
			btnInspector.setAttribute('aria-expanded', inspectorCollapsed ? 'false' : 'true')
			btnInspector.textContent = inspectorCollapsed ? '«' : '»'
			btnInspector.title = inspectorCollapsed ? 'Expand Inspector' : 'Collapse Inspector'
		}
	}

	apply()

	btnSources?.addEventListener('click', () => {
		sourcesCollapsed = !sourcesCollapsed
		persist()
		apply()
	})
	btnInspector?.addEventListener('click', () => {
		inspectorCollapsed = !inspectorCollapsed
		persist()
		apply()
	})

	const minW = 220
	const maxW = 520
	if (resizeSources) {
		resizeSources.addEventListener('mousedown', (e) => {
			if (e.button !== 0 || sourcesCollapsed) return
			e.preventDefault()
			const startX = e.clientX
			const startW = panelSources.getBoundingClientRect().width
			const onMove = (ev) => {
				const dx = ev.clientX - startX
				sourcesW = Math.max(minW, Math.min(maxW, startW + dx))
				root.style.setProperty('--sources-panel-w', `${sourcesW}px`)
			}
			const onUp = () => {
				document.removeEventListener('mousemove', onMove)
				document.removeEventListener('mouseup', onUp)
				document.body.style.cursor = ''
				document.body.style.userSelect = ''
				persist()
			}
			document.body.style.cursor = 'col-resize'
			document.body.style.userSelect = 'none'
			document.addEventListener('mousemove', onMove)
			document.addEventListener('mouseup', onUp)
		})
	}

	const minIn = 220
	const maxIn = 640
	if (resizeInspector) {
		resizeInspector.addEventListener('mousedown', (e) => {
			if (e.button !== 0 || inspectorCollapsed) return
			e.preventDefault()
			const startX = e.clientX
			const startW = panelInspector.getBoundingClientRect().width
			const onMove = (ev) => {
				const dx = startX - ev.clientX
				inspectorW = Math.max(minIn, Math.min(maxIn, startW + dx))
				root.style.setProperty('--inspector-panel-w', `${inspectorW}px`)
			}
			const onUp = () => {
				document.removeEventListener('mousemove', onMove)
				document.removeEventListener('mouseup', onUp)
				document.body.style.cursor = ''
				document.body.style.userSelect = ''
				persist()
			}
			document.body.style.cursor = 'col-resize'
			document.body.style.userSelect = 'none'
			document.addEventListener('mousemove', onMove)
			document.addEventListener('mouseup', onUp)
		})
	}
}
