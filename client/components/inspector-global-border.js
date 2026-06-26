import { sceneState } from '../lib/scene-state.js'
import { requestGlobalBorderPush } from './inspector-global-border-events.js'
import { appendGlobalBorderEffectSections } from './inspector-global-border-effect.js'
import { appendGlobalBorderSlicesSection } from './inspector-global-border-slices.js'
import { appendGlobalBorderArtnetSection } from './inspector-global-border-artnet.js'

export function renderGlobalBorderInspector(root, screenIndex, stateStore) {
	root.innerHTML = ''
	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = `Global Border: Screen ${screenIndex + 1}`
	root.appendChild(title)

	const gbNow = () => sceneState.getGlobalBorderForScreen(screenIndex)
	const gb = gbNow()

	if (!gb) {
		const setup = document.createElement('div')
		setup.className = 'inspector-group'
		setup.innerHTML =
			'<div class="inspector-group__title">Not configured</div><p class="inspector-field inspector-field--hint">This screen has no global border. Enable it here or check “Global Border” on the scene deck column header.</p>'
		const enableBtn = Object.assign(document.createElement('button'), {
			type: 'button',
			className: 'scenes-btn',
			textContent: 'Enable global border on this screen',
		})
		enableBtn.addEventListener('click', () => {
			sceneState.setGlobalBorderForScreen(screenIndex, { enabled: true })
			requestGlobalBorderPush()
			renderGlobalBorderInspector(root, screenIndex, stateStore)
		})
		setup.appendChild(enableBtn)
		root.appendChild(setup)
		return
	}

	const patchGlobalBorder = (patch) => {
		sceneState.setGlobalBorderForScreen(screenIndex, patch)
	}
	const rerender = () => renderGlobalBorderInspector(root, screenIndex, stateStore)

	appendGlobalBorderEffectSections(root, screenIndex, stateStore, gbNow, patchGlobalBorder, rerender)
	appendGlobalBorderSlicesSection(root, stateStore, gbNow, patchGlobalBorder)
	appendGlobalBorderArtnetSection(root, gbNow, patchGlobalBorder)
}
