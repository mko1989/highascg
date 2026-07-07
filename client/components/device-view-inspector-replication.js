/**
 * Device View — server inspector hot backup section (WO-54 operator UX).
 */
import { wireReplicationInspector } from './device-view-inspector-replication-controls.js'

/**
 * @param {HTMLElement} host
 * @param {{ statusEl: HTMLElement, load: () => Promise<void> }} ctx
 * @returns {() => void} cleanup
 */
export function renderReplicationInspector(host, ctx) {
	const sec = document.createElement('div')
	sec.className = 'device-view__inspector-section device-view__replication-section'
	sec.innerHTML = '<p class="device-view__note"><strong>Hot backup</strong></p>'

	const statusLine = document.createElement('p')
	statusLine.className = 'device-view__note small device-view__replication-status'
	statusLine.textContent = 'Loading replication status…'

	const projectPairLine = document.createElement('p')
	projectPairLine.className = 'device-view__note small device-view__replication-project-pair'
	projectPairLine.hidden = true

	const connectionDetails = document.createElement('details')
	connectionDetails.className = 'device-view__inspector-section device-view__replication-connection'
	connectionDetails.open = true
	connectionDetails.hidden = true
	const connectionSummary = document.createElement('summary')
	connectionSummary.className = 'device-view__note'
	connectionSummary.innerHTML = '<strong>Connection</strong>'
	connectionDetails.append(connectionSummary)

	const channelParityLine = document.createElement('p')
	channelParityLine.className = 'device-view__note small device-view__replication-channel-parity'
	channelParityLine.hidden = true

	const casparParityLine = document.createElement('p')
	casparParityLine.className = 'device-view__note small device-view__replication-caspar-parity'
	casparParityLine.hidden = true

	const connectionActions = document.createElement('div')
	connectionActions.className = 'device-view__replication-actions'
	const refreshConnBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Refresh connection',
		title: 'Reconnect peer HTTP, live-state WebSocket, and AMCP fan-out; force ping and reconcile',
	})
	connectionActions.append(refreshConnBtn)

	const localTableHost = document.createElement('div')
	localTableHost.className = 'device-view__replication-local-table'
	const peerTableHost = document.createElement('div')
	peerTableHost.className = 'device-view__replication-peer-table'
	const transportTableHost = document.createElement('div')
	transportTableHost.className = 'device-view__replication-transport-table'

	const connectionWarnLine = document.createElement('p')
	connectionWarnLine.className = 'device-view__note small device-view__replication-connection-warn'
	connectionWarnLine.hidden = true

	connectionDetails.append(
		channelParityLine,
		casparParityLine,
		connectionActions,
		localTableHost,
		peerTableHost,
		transportTableHost,
		connectionWarnLine,
	)

	const outputWarnLine = document.createElement('p')
	outputWarnLine.className = 'device-view__note small device-view__replication-output-warn'
	outputWarnLine.hidden = true

	const localWiringNote = document.createElement('p')
	localWiringNote.className = 'device-view__note small device-view__replication-local-note'
	localWiringNote.hidden = true
	localWiringNote.textContent =
		'Screen destinations sync from the leader (channel ids must match). Wiring, cables, and Caspar consumers stay local — cable outputs on this box after connect, then Regenerate Caspar from Device View.'

	const reloadLocalBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Apply Device View → Caspar',
		title: 'Load leader screen destinations into config and regenerate casparcg.config on this backup box',
	})

	const modeLab = document.createElement('label')
	modeLab.className = 'device-view__field'
	modeLab.innerHTML = '<span class="device-view__field-label">Mode</span>'
	const modeSel = document.createElement('select')
	modeSel.className = 'device-view__destinations-type'
	for (const [val, label] of [
		['standalone', 'Standalone'],
		['leader', 'Leader (available for followers)'],
		['follower', 'Follower'],
	]) {
		const opt = document.createElement('option')
		opt.value = val
		opt.textContent = label
		modeSel.append(opt)
	}
	modeLab.append(modeSel)

	const leaderPick = document.createElement('div')
	leaderPick.className = 'device-view__field device-view__replication-leader-pick'
	leaderPick.style.display = 'none'
	leaderPick.innerHTML = '<span class="device-view__field-label">Leader server</span>'
	const leaderSel = document.createElement('select')
	leaderSel.className = 'device-view__destinations-type'
	leaderPick.append(leaderSel)

	const btnRow = document.createElement('div')
	btnRow.className = 'device-view__replication-actions'

	const scanBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Scan for leaders',
	})
	const becomeBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Become leader',
	})
	const stopLeaderBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Stop offering as leader',
	})
	const connectBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Connect to leader',
	})
	const disconnectBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Disconnect (standalone)',
	})
	btnRow.append(scanBtn, becomeBtn, stopLeaderBtn, connectBtn, disconnectBtn, reloadLocalBtn)
	sec.append(statusLine, projectPairLine, connectionDetails, outputWarnLine, localWiringNote, modeLab, leaderPick, btnRow)
	host.append(sec)

	return wireReplicationInspector(
		{
			statusLine,
			projectPairLine,
			localWiringNote,
			modeSel,
			leaderSel,
			leaderPick,
			scanBtn,
			becomeBtn,
			stopLeaderBtn,
			connectBtn,
			disconnectBtn,
			reloadLocalBtn,
			refreshConnBtn,
			outputWarnLine,
			connectionDetails,
			connectionSummary,
			channelParityLine,
			casparParityLine,
			localTableHost,
			peerTableHost,
			transportTableHost,
			connectionWarnLine,
		},
		ctx,
	)
}
