/**
 * Hot backup inspector — mode sync, API actions, status polling.
 */
import { api } from '../lib/api-client.js'
import { setStatus, buildInspectorTable } from './device-view-ui-utils.js'
import { showAppToast } from '../lib/app-toast.js'
import {
	refreshReplicationStatusSoon,
	getReplicationInspectorMode,
	setReplicationInspectorMode,
} from '../lib/replication-ui-state.js'
import { hotBackupPairedTitle, hotBackupPeerBoxForViewer } from '../lib/hot-backup-project.js'
import { escapeHtml } from '../lib/dom-escape.js'
import {
	formatStatus,
	syncConnectionPanel,
	syncProjectPairLineWithHelpers,
	syncOutputWarnings,
} from './device-view-inspector-replication-shared.js'

/**
 * @param {object} ui — DOM refs from renderReplicationInspector
 * @param {{ statusEl: HTMLElement, load: () => Promise<void> }} ctx
 * @returns {() => void} cleanup
 */
export function wireReplicationInspector(ui, ctx) {
	const {
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
	} = ui

	let lastStatus = null
	/** @type {ReturnType<typeof setInterval>|null} */
	let pollTimer = null

	const savedMode = getReplicationInspectorMode()
	if (savedMode) modeSel.value = savedMode

	const tableDeps = { buildInspectorTable, escapeHtml }
	const pairHelpers = { hotBackupPairedTitle, hotBackupPeerBoxForViewer }

	function applyServerMode(st) {
		if (!st?.enabled) return
		if (st.configuredRole === 'follower' || st.role === 'follower') {
			modeSel.value = 'follower'
			setReplicationInspectorMode('follower')
		} else {
			modeSel.value = 'leader'
			setReplicationInspectorMode('leader')
		}
	}

	function syncModeFromStatus(st) {
		if (st?.enabled) {
			applyServerMode(st)
			return
		}
		const intent = getReplicationInspectorMode()
		if (intent === 'follower' || intent === 'leader') {
			modeSel.value = intent
			return
		}
		modeSel.value = st?.leaderAvailable ? 'leader' : 'standalone'
		if (modeSel.value === 'standalone') setReplicationInspectorMode('standalone')
	}

	function syncLeaderSelect(st) {
		if (st?.enabled && (st.role === 'follower' || st.configuredRole === 'follower') && st.peer?.host) {
			const host = String(st.peer.host)
			const port = parseInt(String(st.peer.port || 4200), 10) || 4200
			const value = `${host}:${port}`
			const label = st.peerHostname || st.peerSelfId || host
			leaderSel.innerHTML = ''
			const opt = document.createElement('option')
			opt.value = value
			opt.textContent = `${label} (${value}) — connected`
			opt.selected = true
			leaderSel.append(opt)
			return
		}
		if (!leaderSel.options.length) {
			const opt = document.createElement('option')
			opt.value = ''
			opt.textContent = '(scan for leaders, then connect)'
			leaderSel.append(opt)
		}
	}

	function syncModeUi() {
		const mode = modeSel.value
		leaderPick.style.display = mode === 'follower' ? '' : 'none'
		becomeBtn.style.display = mode === 'leader' && !lastStatus?.enabled ? '' : 'none'
		stopLeaderBtn.style.display = lastStatus?.leaderAvailable && !lastStatus?.enabled ? '' : 'none'
		connectBtn.style.display = mode === 'follower' && !lastStatus?.enabled ? '' : 'none'
		disconnectBtn.style.display = lastStatus?.enabled ? '' : 'none'
		const isFollower = lastStatus?.role === 'follower' || (mode === 'follower' && lastStatus?.enabled)
		reloadLocalBtn.style.display = isFollower ? '' : 'none'
	}

	async function scanForLeaders(opts = {}) {
		const { quiet = false } = opts
		scanBtn.disabled = true
		try {
			const res = await api.get('/api/replication/leaders')
			leaderSel.innerHTML = ''
			const leaders = Array.isArray(res?.leaders) ? res.leaders : []
			if (!leaders.length) {
				const opt = document.createElement('option')
				opt.value = ''
				opt.textContent = '(no leaders found — scan again or use Become leader on primary box)'
				leaderSel.append(opt)
			}
			for (const l of leaders) {
				const opt = document.createElement('option')
				opt.value = `${l.host}:${l.port || 4200}`
				opt.textContent = `${l.hostname || l.host} (${l.selfId || l.host})`
				leaderSel.append(opt)
			}
			if (!quiet) {
				setStatus(ctx.statusEl, `Found ${leaders.length} leader(s)`, true)
				showAppToast(
					leaders.length ? `Found ${leaders.length} leader(s)` : 'No leaders on subnet',
					leaders.length ? 'success' : 'warn',
				)
			}
			return leaders
		} catch (e) {
			if (!quiet) {
				setStatus(ctx.statusEl, e?.message || String(e), false)
				showAppToast(e?.message || String(e), 'error')
			}
			throw e
		} finally {
			scanBtn.disabled = false
		}
	}

	async function refreshStatus() {
		try {
			lastStatus = await api.get('/api/replication/status')
			statusLine.textContent = formatStatus(lastStatus)
			syncProjectPairLineWithHelpers(projectPairLine, lastStatus, pairHelpers)
			syncConnectionPanel(ui, lastStatus, tableDeps)
			localWiringNote.hidden = !lastStatus.enabled
			syncModeFromStatus(lastStatus)
			syncLeaderSelect(lastStatus)
			syncOutputWarnings(outputWarnLine, lastStatus)
			syncModeUi()
		} catch (e) {
			statusLine.textContent = `Replication unavailable: ${e?.message || e}`
		}
	}

	scanBtn.onclick = async () => {
		try {
			await scanForLeaders()
		} catch {
			/* toast/status in scanForLeaders */
		}
	}

	becomeBtn.onclick = async () => {
		becomeBtn.disabled = true
		try {
			await api.post('/api/replication/become-leader', {})
			setStatus(ctx.statusEl, 'This server is now available as leader', true)
			showAppToast('Leader available for followers', 'success')
			refreshReplicationStatusSoon()
			await refreshStatus()
			await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			becomeBtn.disabled = false
		}
	}

	stopLeaderBtn.onclick = async () => {
		stopLeaderBtn.disabled = true
		try {
			await api.post('/api/replication/stop-leader', {})
			setStatus(ctx.statusEl, 'Leader availability stopped', true)
			showAppToast('Leader availability stopped', 'info')
			refreshReplicationStatusSoon()
			await refreshStatus()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			stopLeaderBtn.disabled = false
		}
	}

	connectBtn.onclick = async () => {
		const raw = leaderSel.value
		if (!raw) {
			setStatus(ctx.statusEl, 'Select a leader first (Scan for leaders)', false)
			showAppToast('Select a leader first', 'warn')
			return
		}
		const [host, portStr] = raw.split(':')
		connectBtn.disabled = true
		showAppToast('Connecting to leader…', 'info')
		try {
			const out = await api.post('/api/replication/connect', {
				leaderHost: host,
				leaderPort: parseInt(portStr, 10) || 4200,
			})
			const ok = !!out?.ok
			const msg = ok
				? out.syncing
					? 'Connected as follower — syncing project from leader…'
					: 'Connected as follower — project + media syncing'
				: out?.error || 'Connect failed'
			setStatus(ctx.statusEl, msg, ok)
			showAppToast(
				ok ? (out.syncing ? 'Connected — sync in progress' : 'Connected as follower') : out?.error || 'Connect failed',
				ok ? 'success' : 'error',
			)
			refreshReplicationStatusSoon()
			await refreshStatus()
			await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			connectBtn.disabled = false
		}
	}

	disconnectBtn.onclick = async () => {
		if (!confirm('Disconnect hot backup and return to standalone? Each machine keeps playing locally.')) return
		disconnectBtn.disabled = true
		try {
			await api.post('/api/replication/disconnect', {})
			setReplicationInspectorMode('standalone')
			setStatus(ctx.statusEl, 'Standalone — local playout continues', true)
			showAppToast('Disconnected — standalone playout', 'warn')
			refreshReplicationStatusSoon()
			await refreshStatus()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			disconnectBtn.disabled = false
		}
	}

	refreshConnBtn.onclick = async () => {
		if (!lastStatus?.enabled) {
			showAppToast('Not paired — connect to a leader first', 'warn')
			return
		}
		refreshConnBtn.disabled = true
		showAppToast('Refreshing replication connection…', 'info')
		try {
			const out = await api.post('/api/replication/refresh-connection', {})
			const ok = !!out?.ok
			if (out?.status) {
				lastStatus = out.status
				statusLine.textContent = formatStatus(lastStatus)
				syncConnectionPanel(ui, lastStatus, tableDeps)
				syncLeaderSelect(lastStatus)
				syncOutputWarnings(outputWarnLine, lastStatus)
				syncModeUi()
			} else {
				await refreshStatus()
			}
			const msg = ok
				? out.pingOk
					? 'Connection refreshed'
					: `Reloaded transports; peer ping failed: ${out.pingError || 'unknown'}`
				: out?.error || 'Refresh failed'
			setStatus(ctx.statusEl, msg, ok && out.pingOk !== false)
			showAppToast(msg, ok ? (out.pingOk ? 'success' : 'warn') : 'error')
			refreshReplicationStatusSoon()
			if (ok && typeof ctx.load === 'function') await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			refreshConnBtn.disabled = false
		}
	}

	reloadLocalBtn.onclick = async () => {
		reloadLocalBtn.disabled = true
		showAppToast('Applying Device View setup and regenerating Caspar…', 'info')
		try {
			const out = await api.post('/api/replication/apply-device-view-caspar', {})
			const parity = out?.parity
			const ok = !!out?.ok && parity?.ok !== false && parity?.regenerateOk !== false
			const msg = parity?.ok
				? 'Caspar channels now match leader'
				: parity?.followerNeedsMoreChannels
					? `Still short ${parity.missingCount} channel(s) — check Device View destinations`
					: parity?.regenerateError || out?.parity?.mismatches?.[0]?.message || 'Regenerate finished — review parity'
			setStatus(ctx.statusEl, msg, ok)
			showAppToast(msg, ok ? 'success' : 'warn')
			refreshReplicationStatusSoon()
			await refreshStatus()
			if (typeof ctx.load === 'function') await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			reloadLocalBtn.disabled = false
		}
	}

	modeSel.onchange = async () => {
		const mode = modeSel.value
		setReplicationInspectorMode(mode)
		syncModeUi()

		if (mode === 'follower') {
			try {
				await scanForLeaders({ quiet: false })
			} catch {
				/* scanForLeaders reports errors */
			}
			if (lastStatus?.leaderAvailable && !lastStatus?.enabled) {
				try {
					await api.post('/api/replication/stop-leader', {})
					showAppToast('Leader availability stopped — pick a leader and connect', 'info')
					refreshReplicationStatusSoon()
					await refreshStatus()
				} catch (e) {
					showAppToast(e?.message || String(e), 'error')
				}
			}
		}
	}

	void refreshStatus().then(() => {
		if (getReplicationInspectorMode() === 'follower' && !lastStatus?.enabled) {
			void scanForLeaders({ quiet: true }).catch(() => {})
		}
	})
	pollTimer = setInterval(() => void refreshStatus(), 3000)

	const onFocus = () => void refreshStatus()
	window.addEventListener('highascg-device-view-focus-server', onFocus)

	return () => {
		if (pollTimer) clearInterval(pollTimer)
		window.removeEventListener('highascg-device-view-focus-server', onFocus)
	}
}
