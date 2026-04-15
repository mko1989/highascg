/**
 * Header bar monitor audio (headphones + channel menu).
 */

import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'

/** Lucide-style headphones (stroke) */
const HEADPHONES_SVG =
	'<svg class="header-audio__icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>'

/**
 * @param {import('../lib/state-store.js').StateStore | undefined} stateStore
 * @returns {HTMLElement}
 */
export function createHeaderAudioMonitor(stateStore) {
	const audioGroup = document.createElement('div')
	audioGroup.className = 'header-audio'

	const audioToggle = document.createElement('button')
	audioToggle.type = 'button'
	audioToggle.className = 'header-btn header-audio__toggle'
	audioToggle.innerHTML = HEADPHONES_SVG
	audioToggle.title = 'Monitor audio'
	audioToggle.setAttribute('aria-haspopup', 'true')
	audioToggle.setAttribute('aria-expanded', 'false')

	const dropdown = document.createElement('div')
	dropdown.className = 'header-audio__dropdown'
	dropdown.hidden = true
	dropdown.setAttribute('role', 'menu')

	const channelList = document.createElement('div')
	channelList.className = 'header-audio__channels'
	dropdown.appendChild(channelList)

	const muteRow = document.createElement('label')
	muteRow.className = 'header-audio__mute'
	const muteCb = document.createElement('input')
	muteCb.type = 'checkbox'
	muteRow.appendChild(muteCb)
	muteRow.appendChild(document.createTextNode(' Mute'))
	dropdown.appendChild(muteRow)

	audioGroup.appendChild(audioToggle)
	audioGroup.appendChild(dropdown)

	/** @returns {{ id: string, label: string }[]} */
	function getMonitorChannelOptions() {
		const cm = stateStore?.getState?.()?.channelMap || {}
		const programChannels = cm.programChannels || [1]
		const previewChannels = cm.previewChannels || [2]
		const mvCh = cm.multiviewCh
		const base = [
			{ id: 'pgm_1', label: `PGM · ch ${programChannels[0] ?? 1}` },
			{ id: 'prv_1', label: `PRV · ch ${previewChannels[0] ?? 2}` },
		]
		if (mvCh != null) base.push({ id: 'multiview', label: `Multiview · ch ${mvCh}` })
		const avail = streamState.availableStreams || []
		if (avail.length === 0) return base
		const filtered = base.filter((o) => avail.includes(o.id))
		return filtered.length > 0 ? filtered : base
	}

	function renderChannelMenu() {
		channelList.innerHTML = ''
		const opts = getMonitorChannelOptions()
		for (const o of opts) {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'header-audio__channel'
			b.dataset.source = o.id
			b.setAttribute('role', 'menuitemradio')
			b.textContent = o.label
			b.addEventListener('click', (e) => {
				e.stopPropagation()
				streamState.setAudioSource(o.id)
				setDropdownOpen(false)
			})
			channelList.appendChild(b)
		}
		syncChannelHighlight()
	}

	function syncChannelHighlight() {
		const id = streamState.activeAudioSource
		channelList.querySelectorAll('.header-audio__channel').forEach((btn) => {
			const sid = /** @type {HTMLElement} */ (btn).dataset.source
			btn.classList.toggle('header-audio__channel--on', sid === id)
		})
	}

	function setDropdownOpen(open) {
		dropdown.hidden = !open
		audioToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
		if (open) renderChannelMenu()
	}

	audioToggle.addEventListener('click', (e) => {
		e.stopPropagation()
		setDropdownOpen(dropdown.hidden)
	})

	muteCb.addEventListener('change', () => {
		streamState.setMuted(muteCb.checked)
	})

	function onDocClick(e) {
		if (!audioGroup.contains(/** @type {Node} */ (e.target))) setDropdownOpen(false)
	}
	document.addEventListener('click', onDocClick)

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') setDropdownOpen(false)
	})

	function updateAudioUI(state) {
		muteCb.checked = !!state.monitoringMuted
		audioToggle.classList.toggle('header-audio__toggle--muted', !!state.monitoringMuted)
		audioToggle.classList.toggle('header-audio__toggle--active', !state.monitoringMuted)

		if (!dropdown.hidden) renderChannelMenu()
		else syncChannelHighlight()

		audioGroup.style.display = shouldShowLiveVideo() ? 'flex' : 'none'
	}

	streamState.subscribe(updateAudioUI)
	settingsState.subscribe(() => {
		renderChannelMenu()
		updateAudioUI(streamState)
	})
	if (stateStore) {
		const onMap = () => {
			renderChannelMenu()
			updateAudioUI(streamState)
		}
		stateStore.on('*', onMap)
		stateStore.on('channelMap', onMap)
	}
	updateAudioUI(streamState)
	renderChannelMenu()

	return audioGroup
}
