/**
 * Device View — server inspector hot backup section (WO-54 operator UX).
 */
import { api } from '../lib/api-client.js'
import { setStatus } from './device-view-ui-utils.js'
import { showAppToast } from '../lib/app-toast.js'
import { refreshReplicationStatusSoon } from '../lib/replication-ui-state.js'

/**
 * @param {HTMLElement} host
 * @param {{ statusEl: HTMLElement, load: () => Promise<void> }} ctx
 */
export function renderReplicationInspector(host, ctx) {
	const sec = document.createElement('div')
	sec.className = 'device-view__inspector-section device-view__replication-section'
	sec.innerHTML = '<p class="device-view__note"><strong>Hot backup</strong></p>'

	const statusLine = document.createElement('p')
	statusLine.className = 'device-view__note small device-view__replication-status'
	statusLine.textContent = 'Loading replication status…'

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
		textContent: 'Regenerate Caspar from Device View',
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
	sec.append(statusLine, outputWarnLine, localWiringNote, modeLab, leaderPick, btnRow)
	host.append(sec)

	let lastStatus = null
	let modeUserSet = false
	/** @type {ReturnType<typeof setInterval>|null} */
	let pollTimer = null

	function applyServerMode(st) {
		if (!st?.enabled) return
		if (st.configuredRole === 'follower' || st.role === 'follower') modeSel.value = 'follower'
		else modeSel.value = 'leader'
		modeUserSet = false
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

	function formatStatus(st) {
		if (!st) return 'Replication unavailable'
		const parts = [`Role: ${st.role || 'standalone'}`]
		if (st.leaderAvailable && !st.enabled) parts.push('accepting followers')
		if (st.enabled) {
			const peerLabel = st.peerSelfId || st.peerHostname || st.peer?.host || '?'
			parts.push(`paired → ${peerLabel}`)
			parts.push(st.peerReachable ? 'peer online' : 'peer offline')
		} else if (!st.leaderAvailable) {
			parts.push('not paired')
		}
		if (st.mediaSync?.percent != null) parts.push(`media ${st.mediaSync.percent}%`)
		if (st.casparOutput?.ok === false && st.casparOutput.warnings?.length) parts.push('Caspar output needs wiring')
		if (st.scheduledApply === false) parts.push('mirror immediate')
		else if (st.scheduledApplyLeadMs != null) parts.push(`mirror lead ${st.scheduledApplyLeadMs}ms`)
		if (st.peerLiveStateSeq > 0 && st.lastAppliedSeq < st.peerLiveStateSeq) {
			parts.push(`behind seq ${st.peerLiveStateSeq - st.lastAppliedSeq}`)
		}
		return parts.join(' · ')
	}

	function syncOutputWarnings(st) {
		const warnings = Array.isArray(st?.casparOutput?.warnings) ? st.casparOutput.warnings : []
		if (!warnings.length) {
			outputWarnLine.hidden = true
			outputWarnLine.textContent = ''
			return
		}
		outputWarnLine.hidden = false
		outputWarnLine.textContent = warnings.map((w) => w.message).join(' ')
	}

	async function refreshStatus() {
		try {
			lastStatus = await api.get('/api/replication/status')
			statusLine.textContent = formatStatus(lastStatus)
			if (lastStatus.enabled) {
				applyServerMode(lastStatus)
				localWiringNote.hidden = false
			} else {
				localWiringNote.hidden = true
				if (!modeUserSet) {
					modeSel.value = lastStatus.leaderAvailable ? 'leader' : 'standalone'
				}
			}
			syncLeaderSelect(lastStatus)
			syncOutputWarnings(lastStatus)
			syncModeUi()
		} catch (e) {
			statusLine.textContent = `Replication unavailable: ${e?.message || e}`
		}
	}

	scanBtn.onclick = async () => {
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
			setStatus(ctx.statusEl, `Found ${leaders.length} leader(s)`, true)
			showAppToast(leaders.length ? `Found ${leaders.length} leader(s)` : 'No leaders on subnet', leaders.length ? 'success' : 'warn')
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			scanBtn.disabled = false
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
			showAppToast(ok ? (out.syncing ? 'Connected — sync in progress' : 'Connected as follower') : out?.error || 'Connect failed', ok ? 'success' : 'error')
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

	reloadLocalBtn.onclick = async () => {
		reloadLocalBtn.disabled = true
		showAppToast('Regenerating Caspar config from local Device View…', 'info')
		try {
			const out = await api.post('/api/replication/reload-local-machine', {})
			const ok = !!out?.ok && out?.caspar?.ok !== false
			setStatus(
				ctx.statusEl,
				ok ? 'Caspar config regenerated from this server’s Device View' : out?.caspar?.body?.error || 'Regenerate failed',
				ok,
			)
			showAppToast(ok ? 'Caspar config regenerated' : out?.caspar?.body?.error || 'Regenerate failed', ok ? 'success' : 'error')
			if (ok && typeof ctx.load === 'function') await ctx.load()
		} catch (e) {
			setStatus(ctx.statusEl, e?.message || String(e), false)
			showAppToast(e?.message || String(e), 'error')
		} finally {
			reloadLocalBtn.disabled = false
		}
	}

	modeSel.onchange = async () => {
		modeUserSet = true
		syncModeUi()
		if (modeSel.value === 'follower' && lastStatus?.leaderAvailable && !lastStatus?.enabled) {
			try {
				await api.post('/api/replication/stop-leader', {})
				showAppToast('Leader availability stopped — scan and connect', 'info')
				refreshReplicationStatusSoon()
				await refreshStatus()
			} catch (e) {
				showAppToast(e?.message || String(e), 'error')
			}
		}
	}
	void refreshStatus()
	pollTimer = setInterval(() => void refreshStatus(), 3000)

	const onFocus = () => void refreshStatus()
	window.addEventListener('highascg-device-view-focus-server', onFocus)

	return () => {
		if (pollTimer) clearInterval(pollTimer)
		window.removeEventListener('highascg-device-view-focus-server', onFocus)
	}
}
