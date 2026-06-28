/**
 * Header hot-backup badge — L / F circle (like stream/rec indicators).
 */
import { subscribeReplicationStatus } from '../lib/replication-ui-state.js'

/**
 * @param {HTMLElement} container — usually .header-stream-state sibling wrap
 */
export function initReplicationBadge(container) {
	const wrap = document.createElement('div')
	wrap.className = 'header-replication-state'
	wrap.hidden = true
	container.appendChild(wrap)

	function focusHotBackupInspector() {
		if (typeof window.highascgActivateWorkspaceTab === 'function') {
			window.highascgActivateWorkspaceTab('device-view')
		}
		setTimeout(() => {
			window.dispatchEvent(new CustomEvent('highascg-device-view-focus-server'))
		}, 80)
	}

	function render(status) {
		wrap.innerHTML = ''
		if (!status) {
			wrap.hidden = true
			return
		}

		const role = String(status.role || 'standalone')
		const enabled = !!status.enabled
		const leaderAvail = !!status.leaderAvailable
		const peerOk = !!(status.peerLinkReady ?? status.peerReachable)

		let letter = ''
		let mode = 'hidden'
		let title = 'Hot backup'

		if (enabled && role === 'follower') {
			letter = 'F'
			mode = peerOk ? 'active' : 'pending'
			title = peerOk
				? `Follower — linked to ${status.peer?.host || 'leader'}`
				: `Follower — connecting to ${status.peer?.host || 'leader'}…`
		} else if (enabled && role === 'leader') {
			letter = 'L'
			mode = peerOk ? 'active' : 'pending'
			const peerLabel = status.peer?.host || status.peerSelfId || 'follower'
			title = peerOk ? `Leader — follower ${peerLabel} online` : `Leader — waiting for follower (${peerLabel})…`
		} else if (leaderAvail) {
			letter = 'L'
			mode = 'available'
			title = 'Leader available — waiting for follower to connect'
		} else {
			wrap.hidden = true
			return
		}

		const b = document.createElement('button')
		b.type = 'button'
		b.className = `header-replication-indicator header-replication-indicator--${letter.toLowerCase()} header-replication-indicator--${mode}`
		b.textContent = letter
		b.title = title
		b.setAttribute('aria-label', title)
		b.addEventListener('click', focusHotBackupInspector)
		wrap.appendChild(b)
		wrap.hidden = false
	}

	const unsub = subscribeReplicationStatus(render)
	return {
		destroy: () => {
			unsub()
			wrap.remove()
		},
	}
}
