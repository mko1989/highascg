/**
 * Header PGM channel playback-timer chips + timer host mount.
 */
import { mountPgmTopLayerPlaybackTimer } from '../components/playback-timer.js'

export function initPgmHeaderTimer({ stateStore, sceneState, statusEl, getOscClient }) {
	let pgmHeaderTimerDestroy = null
	let selectedPlaybackChannel = null
	const playbackChannelStorageKey = 'highascg_header_playback_channel'
	try {
		const saved = parseInt(String(localStorage.getItem(playbackChannelStorageKey) || ''), 10)
		if (Number.isFinite(saved) && saved > 0) selectedPlaybackChannel = saved
	} catch {
		// ignore storage failures
	}
	const getProgramChannels = () => {
		const cm = stateStore.getState()?.channelMap || {}
		const list = cm.playbackChannels || cm.programChannels
		return Array.isArray(list) && list.length ? list.map((v) => parseInt(String(v), 10)).filter((v) => Number.isFinite(v) && v > 0) : [1]
	}
	const ensureSelectedPlaybackChannel = () => {
		const list = getProgramChannels()
		if (!list.includes(selectedPlaybackChannel)) selectedPlaybackChannel = list[0] ?? 1
		return selectedPlaybackChannel
	}
	const persistSelectedPlaybackChannel = () => {
		try { localStorage.setItem(playbackChannelStorageKey, String(selectedPlaybackChannel || '')) } catch { /* ignore */ }
	}
	const renderPlaybackChannelChips = () => {
		const slot = document.getElementById('header-pgm-timer')
		if (!slot) return
		const chips = slot.querySelector('.header-pgm-timer-chips')
		if (!chips) return
		ensureSelectedPlaybackChannel()
		const list = getProgramChannels()
		chips.innerHTML = ''
		list.forEach((ch, idx) => {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'header-pgm-timer-chip' + (ch === selectedPlaybackChannel ? ' header-pgm-timer-chip--active' : '')
			b.textContent = `P${idx + 1}`
			b.title = `Show playback timer for channel ${ch}`
			b.addEventListener('click', () => {
				selectedPlaybackChannel = ch
				persistSelectedPlaybackChannel()
				renderPlaybackChannelChips()
				pgmHeaderTimerDestroy?.refresh()
			})
			chips.appendChild(b)
		})
	}
	const mountTimer = () => {
		if (!statusEl || !getOscClient()) return
		let slot = document.getElementById('header-pgm-timer') || document.createElement('div')
		if (!slot.id) { slot.id = 'header-pgm-timer'; slot.className = 'header-pgm-timer-wrap'; statusEl.insertBefore(slot, statusEl.firstChild) }
		let chips = slot.querySelector('.header-pgm-timer-chips')
		let timerHost = slot.querySelector('.header-pgm-timer-host')
		if (!chips || !timerHost) {
			slot.innerHTML = ''
			chips = document.createElement('div')
			chips.className = 'header-pgm-timer-chips'
			timerHost = document.createElement('div')
			timerHost.className = 'header-pgm-timer-host'
			slot.append(chips, timerHost)
		}
		if (pgmHeaderTimerDestroy) pgmHeaderTimerDestroy.destroy()
		pgmHeaderTimerDestroy = mountPgmTopLayerPlaybackTimer(timerHost, {
			oscClient: getOscClient(), getState: () => stateStore.getState(),
			getChannel: () => ensureSelectedPlaybackChannel(),
		})
		renderPlaybackChannelChips()
	}
	mountTimer(); sceneState.on('screenChange', () => pgmHeaderTimerDestroy?.refresh())
	stateStore.on('*', (path) => {
		if (path === 'channelMap') renderPlaybackChannelChips()
		if (['channelMap', 'channels', null].includes(path)) pgmHeaderTimerDestroy?.refresh()
	})
}
