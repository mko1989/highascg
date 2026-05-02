/**
 * Scene layer — Caspar HTML / template source helpers (CALL RELOAD).
 * @see CasparCG HTML producer — reload page without re-taking the look.
 */

import { api } from '../lib/api-client.js'

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {import('../lib/scene-state.js').SceneState} opts.sceneState
 * @param {object} opts.stateStore
 * @param {string} opts.sceneId
 * @param {object | null | undefined} opts.layer
 */
export function appendSceneLayerHtmlTemplateGroup(root, { sceneState, stateStore, sceneId, layer }) {
	const src = layer?.source
	if (!src?.value) return
	const t = src.type
	if (t !== 'template' && t !== 'html') return

	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-html-template-group'
	grp.innerHTML = '<div class="inspector-group__title">HTML template</div>'

	const row = document.createElement('div')
	row.className = 'inspector-field inspector-row'
	row.style.flexWrap = 'wrap'
	row.style.gap = '8px'
	row.style.alignItems = 'center'

	const hint = document.createElement('p')
	hint.className = 'inspector-field inspector-field--hint'
	hint.style.fontSize = '0.78rem'
	hint.style.margin = '0'
	hint.style.flex = '1 1 100%'
	hint.textContent = `Source: ${src.label || src.value}`

	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'inspector-btn-sm'
	btn.textContent = 'Reload page'
	btn.title = 'CALL RELOAD on preview (and program if this look is on air) — refreshes the HTML layer in Caspar'

	btn.addEventListener('click', () => {
		void reloadHtmlTemplateLayers({ sceneState, stateStore, sceneId, layer })
	})

	row.appendChild(btn)
	grp.appendChild(hint)
	grp.appendChild(row)
	root.appendChild(grp)
}

/**
 * @param {{ sceneState: object, stateStore: object, sceneId: string, layer: object }} ctx
 */
async function reloadHtmlTemplateLayers(ctx) {
	const { sceneState, stateStore, sceneId, layer } = ctx
	const layerNum = layer?.layerNumber
	if (layerNum == null || !Number.isFinite(Number(layerNum))) return

	const cm = stateStore.getState()?.channelMap || {}
	const screenIdx = sceneState.activeScreenIndex ?? 0
	const pickCh = (arr) => {
		const a = Array.isArray(arr) && arr.length ? arr : [1]
		return a[Math.min(screenIdx, Math.max(0, a.length - 1))] ?? 1
	}
	const previewCh = pickCh(cm.previewChannels)
	const programCh = pickCh(cm.programChannels)

	const targets = new Set([previewCh])
	if (sceneState.liveSceneId === sceneId) {
		targets.add(programCh)
	}

	for (const channel of targets) {
		try {
			await api.post('/api/call', { channel, layer: layerNum, fn: 'RELOAD', params: '' })
		} catch (e) {
			console.warn(`[html-template] CALL RELOAD ch ${channel} layer ${layerNum}:`, e?.message || e)
		}
	}
}
