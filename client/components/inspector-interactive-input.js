/**
 * Scene layer — Interactive input arm/release toggle (WO-232 T232.6).
 * Provides an "Interactive input" toggle for browser/template sources matching /mario|cef_input_test/i,
 * allowing operators to arm input forwarding without the full live-webpage workflow.
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'
import { resolveLookStackChannelForBus, resolveMainIndexForScene } from '../lib/look-stack-amcp-channel.js'
import { escapeAttr } from '../lib/dom-escape.js'

/**
 * @param {object|null|undefined} source
 * @returns {boolean}
 */
export function isInteractiveSource(source) {
	if (!source?.value) return false
	const v = String(source.value).toLowerCase().replace(/\\/g, '/')
	return /mario|cef_input_test/i.test(v)
}

/**
 * Determine the needle to use for arming this source.
 * @param {string} sourceValue
 * @returns {string}
 */
function getNeedleForSource(sourceValue) {
	const v = String(sourceValue || '').toLowerCase().replace(/\\/g, '/')
	if (v.includes('mario')) return 'template/mario'
	if (v.includes('cef_input_test')) return 'cef_input_test'
	return ''
}

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {string} opts.sceneId
 * @param {number} opts.layerIndex
 * @param {object} opts.layer
 * @param {object} opts.stateStore
 */
export function appendInteractiveInputGroup(root, { sceneId, layerIndex, layer, stateStore }) {
	const src = layer?.source
	if (!isInteractiveSource(src)) return

	const scene = sceneState.getScene(sceneId)
	const mIdx = resolveMainIndexForScene(scene, sceneState)
	const cm = stateStore?.channelMap
	const channel =
		(cm && mIdx != null ? resolveLookStackChannelForBus(cm, sceneState, scene, 'edit', mIdx) : null) ??
		Number(cm?.programChannels?.[mIdx] ?? cm?.playbackChannels?.[mIdx] ?? 1)
	const layerNum = parseInt(layer.layerNumber, 10) || 1

	let isArmed = false

	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-interactive-input-group'
	grp.innerHTML = '<div class="inspector-group__title">Interactive input</div>'

	const toggleWrap = document.createElement('div')
	toggleWrap.className = 'inspector-field'
	const toggleBtn = document.createElement('button')
	toggleBtn.type = 'button'
	toggleBtn.className = 'scenes-btn scenes-btn--md'
	toggleBtn.setAttribute('aria-label', 'Toggle input arm state')

	function updateButtonState() {
		if (isArmed) {
			toggleBtn.textContent = '⏹ Release Input'
			toggleBtn.classList.add('scenes-btn--active')
		} else {
			toggleBtn.textContent = '▶ Arm Input'
			toggleBtn.classList.remove('scenes-btn--active')
		}
	}

	updateButtonState()

	toggleBtn.addEventListener('click', async () => {
		try {
			const needle = getNeedleForSource(src.value)
			if (!needle) {
				console.warn('Could not determine needle for source:', src.value)
				return
			}

			if (isArmed) {
				// Release
				const resp = await api('POST', '/api/cef/release-input', {})
				if (resp?.ok) {
					isArmed = false
					updateButtonState()
				}
			} else {
				// Arm
				const resp = await api('POST', '/api/cef/arm-input', {
					channel,
					layer: layerNum,
					needle,
				})
				if (resp?.ok) {
					isArmed = true
					updateButtonState()
				}
			}
		} catch (e) {
			console.error('Error toggling input arm state:', e)
		}
	})

	toggleWrap.appendChild(toggleBtn)
	grp.appendChild(toggleWrap)

	const hint = document.createElement('p')
	hint.className = 'inspector-field inspector-field--hint'
	hint.textContent = 'Arm to forward keyboard input directly to this layer. Release to stop.'
	grp.appendChild(hint)

	root.appendChild(grp)
}
