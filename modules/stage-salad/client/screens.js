/**
 * Full-screen messages (not running / full / kicked / errors) and the loading bar of Stage Salad (WO-1089).
 * COPY-ADAPTED from the Skirmish screens (modules/toy-skirmish/client/sk-screens.js), which import that game's own
 * dom.js; this one uses the salad dom.js.
 */
import { h, setText, show } from './dom.js'

export function createScreens(root, loadingRoot) {
	const title = h('h1')
	const text = h('p')
	const buttons = h('div.actions')
	const card = h('div.panel.screen-card', title, text, buttons)
	root.textContent = ''
	root.append(card)
	show(root, false)

	const barFill = h('div.load-fill')
	const barText = h('div.load-text')
	loadingRoot.textContent = ''
	loadingRoot.append(h('div.load-bar', barFill), barText)
	show(loadingRoot, false)

	return {
		/** @param {string} t @param {string} body @param {{ label: string, onClick: Function }[]} [actions] */
		show(t, body, actions = []) {
			setText(title, t)
			setText(text, body)
			buttons.textContent = ''
			for (const a of actions) {
				const b = h('button.big', { type: 'button', text: a.label })
				b.addEventListener('click', a.onClick)
				buttons.append(b)
			}
			show(root, true)
		},
		hide() {
			show(root, false)
		},
		get visible() {
			return !root.hidden
		},
		/** @param {number|null} frac 0…1, or null to hide; @param {string} label */
		loading(frac, label = '') {
			if (frac == null) {
				show(loadingRoot, false)
				return
			}
			show(loadingRoot, true)
			barFill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, frac)).toFixed(3)})`
			setText(barText, label)
		},
	}
}
