/**
 * Look layer inspector — live_audio source (ALSA slot).
 */
import { sceneState } from '../lib/scene-state.js'
import { LIVE_AUDIO_MAX_SLOTS, liveAudioRouteValue } from '../lib/live-audio-inputs.js'
import { routeForLiveAudioSlot } from '../lib/input-channels.js'

/**
 * @param {HTMLElement} root
 * @param {object} opts
 */
export function appendLiveAudioSourceGroup(root, { sceneId, layerIndex, layer, stateStore, rerenderSceneLayer, sel }) {
	const src = layer.source
	if (!src || String(src.type || '').toLowerCase() !== 'live_audio') return

	const cm = stateStore?.getState?.()?.channelMap || {}
	const configured = stateStore?.getState?.()?.liveAudioConfigured
	const slots = Array.isArray(configured?.configured?.slots) ? configured.configured.slots : []
	const maxSlot = Math.max(
		1,
		parseInt(String(cm.liveAudioCount ?? configured?.liveAudioCount ?? '1'), 10) || 1
	)

	const grp = document.createElement('div')
	grp.className = 'inspector-group'
	grp.innerHTML = '<div class="inspector-group__title">Live audio source</div>'

	const slotField = document.createElement('div')
	slotField.className = 'inspector-field'
	const slotLab = document.createElement('label')
	slotLab.className = 'inspector-field__label'
	slotLab.textContent = 'Input slot'
	const slotSel = document.createElement('select')
	slotSel.className = 'inspector-field__select'
	for (let i = 1; i <= Math.min(LIVE_AUDIO_MAX_SLOTS, maxSlot); i++) {
		const opt = document.createElement('option')
		opt.value = String(i)
		opt.textContent = `Slot ${i}`
		slotSel.appendChild(opt)
	}
	const curSlot = parseInt(String(src.value || '1'), 10) || 1
	if (curSlot >= 1 && curSlot <= LIVE_AUDIO_MAX_SLOTS) slotSel.value = String(curSlot)

	const routeHint = document.createElement('p')
	routeHint.className = 'inspector-field inspector-field--hint'
	routeHint.style.fontSize = '0.78rem'

	const labelField = document.createElement('div')
	labelField.className = 'inspector-field'
	labelField.innerHTML = '<label class="inspector-field__label">Label</label>'
	const labelInp = document.createElement('input')
	labelInp.className = 'inspector-field__input'
	labelInp.type = 'text'
	labelInp.value = String(src.label || '')
	labelField.appendChild(labelInp)

	const audioOnlyWrap = document.createElement('div')
	audioOnlyWrap.className = 'inspector-field inspector-row'
	const audioOnlyCb = document.createElement('input')
	audioOnlyCb.type = 'checkbox'
	audioOnlyCb.id = `insp-live-audio-only-${sceneId}-${layerIndex}`
	audioOnlyCb.checked = (layer.opacity ?? 1) === 0
	const audioOnlyLab = document.createElement('label')
	audioOnlyLab.htmlFor = audioOnlyCb.id
	audioOnlyLab.textContent = 'Audio only (opacity 0)'
	audioOnlyWrap.append(audioOnlyCb, audioOnlyLab)

	function syncRouteHint() {
		const slot = parseInt(String(slotSel.value || '1'), 10) || 1
		const row = slots.find((s) => s && Number(s.slot) === slot)
		const route = row?.route || routeForLiveAudioSlot(cm, slot) || liveAudioRouteValue(cm, slot) || '(input channel not allocated)'
		routeHint.textContent = `On take: ${route}`
	}

	const applySource = () => {
		const slot = parseInt(String(slotSel.value || '1'), 10) || 1
		const row = slots.find((s) => s && Number(s.slot) === slot)
		const label = labelInp.value.trim() || row?.label || `Live audio ${slot}`
		sceneState.patchLayer(sceneId, layerIndex, {
			source: { type: 'live_audio', value: String(slot), label },
			...(audioOnlyCb.checked ? { opacity: 0 } : {}),
		})
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		syncRouteHint()
	}

	slotSel.addEventListener('change', applySource)
	labelInp.addEventListener('change', applySource)
	audioOnlyCb.addEventListener('change', () => {
		sceneState.patchLayer(sceneId, layerIndex, { opacity: audioOnlyCb.checked ? 0 : 1 })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		rerenderSceneLayer(sel)
	})

	slotLab.appendChild(slotSel)
	slotField.appendChild(slotLab)
	grp.append(slotField, routeHint, labelField, audioOnlyWrap)
	root.appendChild(grp)
	syncRouteHint()
}
